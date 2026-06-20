const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  powerMonitor,
  shell,
  Notification,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const AutoLaunch = require("auto-launch");
const { createClient } = require("@supabase/supabase-js");
const { autoUpdater } = require("electron-updater");
const WebSocket = require("ws");
const cfg = require("./config");
const { labelFor } = require("./app-labels");

// Navegadores Chromium: a navegação (e seu ócio, que é passive-aware para
// reuniões/vídeo) já é capturada pela extensão. O desktop NÃO atribui ócio a
// esses processos — senão o mesmo intervalo de relógio seria contado duas vezes
// (chrome.exe no desktop + navegacao_externa na extensão) e uma reunião no
// navegador viraria falso "ocioso no desktop / ativo no web".
const BROWSER_PROCESS_RE = /chrome|chromium|google chrome/i;
const isBrowserProc = (p) => BROWSER_PROCESS_RE.test(p || "");

const PORTAL_URL = "https://focus-track-sync.lovable.app";
// Janela em que a extensão é considerada "viva" para liberar o Iniciar. A
// extensão pulsa presenca_extensao a cada ~1 min; 3 min tolera uma falha/atraso
// do alarme do service worker (que pode hibernar).
const EXT_ONLINE_WINDOW_MS = 180000;

// active-win é ESM-only — carregar dinamicamente
let activeWinFn = null;
async function getActiveWin() {
  if (!activeWinFn) {
    const mod = await import("active-win");
    activeWinFn = mod.default;
  }
  return activeWinFn;
}

const store = new Store({ name: "monitor-session" });
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
  realtime: { transport: WebSocket },
});

// Persiste tokens sempre que a sessão muda (login e refresh automático). Sem
// isso, o access token expira (~1h) e os INSERTs em uso_aplicativos passam a
// falhar silenciosamente (RLS bloqueia sem JWT válido) — os logs param.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token && session?.refresh_token) {
    store.set("session", {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  }
});
// Mantém o token renovado enquanto o app está aberto (ambiente não-browser não
// dispara o auto-refresh sozinho).
try {
  supabase.auth.startAutoRefresh();
} catch {
  /* noop */
}

// Restaura sessão salva
(async () => {
  const session = store.get("session");
  if (session?.access_token && session?.refresh_token) {
    try {
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    } catch {
      /* noop */
    }
  }
})();

let win = null;
let tray = null;
let pendingUpdateVersion = null; // versão baixada e pronta para instalar (auto-update)
let monitoring = false;
let pollTimer = null;
let flushTimer = null;
let current = null; // { id, process_name, app_label, executable_path, enteredAt, idleAccum, lastIdleStart }
let syncedCount = 0; // registros (uso_aplicativos) gravados com sucesso nesta sessão
let lastError = null; // último erro de sincronização (mostrado na UI para diagnóstico)
let emptyAppTicks = 0; // macOS: ticks consecutivos sem app ativo lido (diagnóstico)
let idleWhitelist = new Set(); // process_name (lowercase) de apps passivos (reunião/vídeo)
let whitelistTimer = null;
// Coordenação com a sessão macro (registros_atividade). Só rastreamos apps
// quando o status é ATIVO. Quando a aba web está fechada, o desktop é
// co-autor: auto-inicia a sessão e gerencia INATIVO/retomada.
let macroStatus = null; // status da linha aberta (ATIVO/PAUSA/...) ou null
let macroSessionId = null; // id da linha aberta conhecida
let trackingPaused = false; // true quando não devemos rastrear apps
let desktopOwnsSession = false; // true se a sessão aberta foi criada pelo desktop
let macroPollTimer = null;
let presenceHeartbeatTimer = null; // heartbeat "app vivo" (ultimo_visto), independente do tracking
let extOnline = false; // extensão do Chrome vista recentemente em presenca_extensao
let todayData = { totals: { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 }, records: [], idleEvents: [] };
let macroChannel = null; // canal realtime de registros_atividade (sincronismo com a web)
let alertWin = null; // janela popup always-on-top "sessão perdida / voltar ao trabalho"
let alertKind = null; // "inactive" (retomar de INATIVO) | "lost" (expediente encerrado por ociosidade)
let suppressLostAlert = false; // suprime o popup "perdido" quando o próprio usuário encerrou
// Auto-update: estado visível na UI para diagnóstico (antes os erros eram engolidos).
let updateStatus = "idle"; // idle | checking | available | downloading | downloaded | none | error | manual
let lastUpdateError = null;
const RELEASES_URL = "https://github.com/Halysson-Andrade/focus-track-sync/releases/latest";

// Carrega a lista de apps passivos (reunião, player de vídeo, leitor de PDF):
// nesses apps a ausência de mouse/teclado NÃO conta como ociosidade.
async function loadWhitelist() {
  try {
    const { data } = await supabase
      .from("monitor_idle_whitelist")
      .select("identificador")
      .eq("tipo", "desktop_process")
      .eq("ativo", true);
    if (data) idleWhitelist = new Set(data.map((r) => r.identificador.toLowerCase()));
  } catch (e) {
    console.error("loadWhitelist:", e.message);
  }
}

const autoLauncher = new AutoLaunch({ name: "Focus Track Monitor", isHidden: true });

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(
      __dirname,
      "..",
      "assets",
      process.platform === "win32" ? "icon.ico" : "icon.png",
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// Popup dedicado "sessão perdida / voltar ao trabalho". Janela própria
// always-on-top que aparece sobre tudo (mesmo com o app na bandeja), em Windows
// e macOS — espelha o InactivityModal da web. `kind`: "inactive" (retomar de
// INATIVO) ou "lost" (expediente encerrado por ociosidade → reiniciar).
function showAlert(kind) {
  if (alertWin && !alertWin.isDestroyed()) {
    alertKind = kind;
    alertWin.webContents.send("alert:kind", kind);
    bringAlertToFront();
    return;
  }
  alertKind = kind;
  alertWin = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "alert-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  alertWin.loadFile(path.join(__dirname, "renderer", "alert.html"));
  alertWin.webContents.on("did-finish-load", () => {
    alertWin.webContents.send("alert:kind", alertKind);
    bringAlertToFront();
  });
  alertWin.on("closed", () => {
    alertWin = null;
    alertKind = null;
  });
}

function bringAlertToFront() {
  if (!alertWin || alertWin.isDestroyed()) return;
  // "screen-saver" garante sobreposição mesmo a telas em tela cheia / outros
  // apps always-on-top; foca e mostra para "priorizar na máquina".
  try {
    alertWin.setAlwaysOnTop(true, "screen-saver");
  } catch {
    alertWin.setAlwaysOnTop(true);
  }
  alertWin.show();
  alertWin.focus();
}

function closeAlert() {
  if (alertWin && !alertWin.isDestroyed()) {
    alertWin.close();
  }
  alertWin = null;
  alertKind = null;
}

function buildTrayMenu() {
  const items = [
    {
      label: "Abrir painel",
      click: () => {
        win.show();
      },
    },
    {
      label: "Abrir app web",
      click: () => shell.openExternal(PORTAL_URL),
    },
  ];
  // Atualização baixada e pronta (Windows): aplica e reinicia.
  if (pendingUpdateVersion) {
    items.push({ type: "separator" });
    items.push({
      label: `Atualizar e reiniciar agora (v${pendingUpdateVersion})`,
      click: () => installUpdateNow(),
    });
  } else if (updateStatus === "manual" || updateStatus === "error") {
    // Fallback manual (macOS sem assinatura, ou erro de download/apply):
    // abre a página de releases para baixar/instalar manualmente.
    items.push({ type: "separator" });
    items.push({
      label: "Baixar atualização (manual)",
      click: () => shell.openExternal(RELEASES_URL),
    });
  }
  items.push({ type: "separator" });
  items.push({
    label: "Sair",
    click: () => {
      app.isQuiting = true;
      app.quit();
    },
  });
  return Menu.buildFromTemplate(items);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "tray.png");
  let img = nativeImage.createFromPath(iconPath);
  // A bandeja do SO usa ~16px (Win) / ~18px (macOS); redimensionar evita o
  // ícone borrado quando a arte de origem é grande.
  if (!img.isEmpty()) {
    const size = process.platform === "darwin" ? 18 : 16;
    img = img.resize({ width: size, height: size, quality: "best" });
  }
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("Focus Track Monitor");
  refreshTrayMenu();
  tray.on("click", () => {
    win.isVisible() ? win.hide() : win.show();
  });
}

async function getUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

// Heartbeat de presença: sinaliza ao painel que o usuário está ativo em um app
// nativo (ex.: VSCode) mesmo sem tocar no navegador — espelha o heartbeat da
// extensão. Só é enviado quando o sistema NÃO está ocioso; throttled a ~30s.
let lastPresenceAt = 0;
async function sendPresence() {
  try {
    const userId = await getUserId();
    if (!userId) return;
    await supabase.from("presenca_desktop").upsert(
      {
        usuario_id: userId,
        ultimo_ativo: new Date().toISOString(),
        platform: process.platform,
      },
      { onConflict: "usuario_id" },
    );
  } catch (e) {
    console.error("presence:", e.message);
  }
}

// Heartbeat "app vivo": sinaliza ao painel/gate que o desktop está LOGADO e
// rodando, mesmo ocioso e fora de expediente. Vai em `ultimo_visto` — coluna
// SEPARADA de `ultimo_ativo` de propósito: `ultimo_ativo` (sendPresence acima)
// só pulsa com input real e é lido pela detecção de INATIVO da web; escrever
// `ultimo_visto` aqui NUNCA pode tocar `ultimo_ativo`, senão o usuário ausente
// nunca seria marcado INATIVO. Roda enquanto monitorando (= logado).
async function sendHeartbeat() {
  try {
    const userId = await getUserId();
    if (!userId) return;
    await supabase.from("presenca_desktop").upsert(
      {
        usuario_id: userId,
        ultimo_visto: new Date().toISOString(),
        app_version: app.getVersion(),
        platform: process.platform,
      },
      { onConflict: "usuario_id" },
    );
  } catch (e) {
    console.error("heartbeat:", e.message);
  }
}

// Persiste um intervalo de ociosidade FECHADO (apps nativos) em
// eventos_ociosidade — a linha do tempo usa isso para mostrar EM QUE MOMENTO da
// jornada houve ócio. O desktop só acumula ócio fora do navegador/passivo, então
// é complementar à extensão (navegador): não há dupla contagem entre as fontes.
async function emitIdleEvent(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return;
  try {
    const userId = await getUserId();
    if (!userId) return;
    await supabase.from("eventos_ociosidade").insert({
      usuario_id: userId,
      inicio: new Date(startMs).toISOString(),
      fim: new Date(endMs).toISOString(),
      fonte: "desktop",
    });
  } catch (e) {
    console.error("idleEvent:", e.message);
  }
}

async function closeCurrent() {
  if (!current || !current.id) {
    current = null;
    return;
  }
  const now = Date.now();
  const dur = (now - current.enteredAt) / 1000;
  // idleAccum é sempre em ms; converte só no final (evita o bug de misturar
  // ms com segundos e garante inativo_segundos <= duracao_segundos).
  const idleNowMs = current.lastIdleStart ? now - current.lastIdleStart : 0;
  const idleSeconds = (current.idleAccum + idleNowMs) / 1000;
  // Ócio ainda aberto ao fechar o app: registra o intervalo [início, agora].
  const idleOpenStart = current.lastIdleStart;
  const id = current.id;
  current = null;
  if (idleOpenStart) void emitIdleEvent(idleOpenStart, now);
  try {
    if (dur < (cfg.MIN_DURATION_S ?? 3)) {
      // Sessão muito curta (ex.: alt-tab momentâneo) — descarta para não
      // inflar a tabela. Não muda nenhum total relatado.
      await supabase.from("uso_aplicativos").delete().eq("id", id);
    } else {
      await supabase
        .from("uso_aplicativos")
        .update({
          fim: new Date(now).toISOString(),
          duracao_segundos: dur,
          inativo_segundos: Math.min(idleSeconds, dur),
        })
        .eq("id", id);
    }
  } catch (e) {
    console.error("closeCurrent:", e.message);
  }

}

async function openRow(info) {
  const userId = await getUserId();
  if (!userId) {
    lastError = "Sessão expirada — faça login novamente.";
    sendStatus();
    return;
  }
  const processName = (info.owner?.name || info.owner?.path || "unknown").toString();
  const exePath = info.owner?.path || null;
  const label = labelFor(processName);
  const now = Date.now();
  current = {
    id: null,
    process_name: processName,
    app_label: label,
    executable_path: exePath,
    enteredAt: now,
    idleAccum: 0,
    lastIdleStart: null,
  };
  try {
    const { data, error } = await supabase
      .from("uso_aplicativos")
      .insert({
        usuario_id: userId,
        process_name: processName,
        app_label: label,
        executable_path: exePath,
        platform: process.platform,
        inicio: new Date(now).toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      console.error("openRow:", error.message);
      lastError = error.message;
      sendStatus();
      return;
    }
    // Pausa pode ter ocorrido durante o INSERT — fecha a linha recém-criada
    // para não deixar registro órfão acumulando tempo durante a pausa.
    if (trackingPaused) {
      try {
        await supabase
          .from("uso_aplicativos")
          .update({ fim: new Date().toISOString(), duracao_segundos: 0, inativo_segundos: 0 })
          .eq("id", data.id);
      } catch {
        /* noop */
      }
      if (current && current.enteredAt === now) current = null;
      return;
    }
    if (data && current && current.enteredAt === now) current.id = data.id;
    syncedCount += 1;
    lastError = null;
    sendStatus();
  } catch (e) {
    console.error("openRow:", e.message);
    lastError = e.message;
    sendStatus();
  }
}

async function tick() {
  if (!monitoring) return;
  if (trackingPaused) return; // sessão macro não-ATIVA: não rastreia nem envia presença
  try {
    const activeWin = await getActiveWin();
    // Windows: undefined === comportamento atual (activeWin() sem opções), intocado.
    // macOS: pula title/url (que não usamos) e as checagens de permissão TCC que
    // fazem o active-win não retornar o app ativo no app ad-hoc/não-assinado.
    const awOpts =
      process.platform === "darwin"
        ? { accessibilityPermission: false, screenRecordingPermission: false }
        : undefined;
    const info = await activeWin(awOpts);
    const idleSec = powerMonitor.getSystemIdleTime();
    const rawIdle = idleSec >= cfg.IDLE_THRESHOLD_S;

    const procName =
      info && info.owner ? (info.owner.name || info.owner.path || "").toString() : "";

    // Diagnóstico macOS: hoje, se o app ativo não é lido, tudo falha em silêncio
    // e o painel fica eterno em "Aguardando app". Torna visível na bandeja.
    if (process.platform === "darwin") {
      if (!procName) {
        emptyAppTicks += 1;
        if (emptyAppTicks === 3) {
          lastError = "macOS: não foi possível ler o app ativo.";
          console.error("tick: active-win não retornou app ativo (macOS) por 3 ticks");
          sendStatus();
        }
      } else if (emptyAppTicks > 0) {
        emptyAppTicks = 0;
        if (lastError && lastError.startsWith("macOS: não foi possível ler o app ativo")) {
          lastError = null;
          sendStatus();
        }
      }
    }
    // App passivo (reunião/vídeo/leitura): ausência de input não é ociosidade.
    const passive = procName ? idleWhitelist.has(procName.toLowerCase()) : false;
    // Navegador em foco: ócio é responsabilidade da extensão (passive-aware),
    // então o desktop não acumula ócio para não duplicar/falsar a contagem.
    const browser = isBrowserProc(procName);
    const isIdle = rawIdle && !passive && !browser;

    if (current) {
      if (isIdle && !current.lastIdleStart) {
        // getSystemIdleTime() já é o tempo contínuo sem input — retroage o
        // início do ócio em vez de marcar "agora", senão perdemos os
        // IDLE_THRESHOLD_S iniciais. Clampa ao início da janela do app.
        current.lastIdleStart = Math.max(current.enteredAt, Date.now() - idleSec * 1000);
      } else if (!isIdle && current.lastIdleStart) {
        const idleEnd = Date.now();
        current.idleAccum += idleEnd - current.lastIdleStart;
        void emitIdleEvent(current.lastIdleStart, idleEnd);
        current.lastIdleStart = null;
      }
    }

    // Presença para o painel: envia se há input recente OU se está num app
    // passivo (reunião sem mouse/teclado não pode virar falso INATIVO).
    if ((!rawIdle || passive) && Date.now() - lastPresenceAt >= 30000) {
      lastPresenceAt = Date.now();
      sendPresence();
    }

    if (!procName) return;

    if (!current || current.process_name.toLowerCase() !== procName.toLowerCase()) {
      await closeCurrent();
      await openRow(info);
      sendStatus();
    }
  } catch (e) {
    console.error("tick:", e.message);
  }
}

async function flush() {
  if (!current || !current.id) return;
  const now = Date.now();
  const dur = (now - current.enteredAt) / 1000;
  const idleNowMs = current.lastIdleStart ? now - current.lastIdleStart : 0;
  try {
    await supabase
      .from("uso_aplicativos")
      .update({
        duracao_segundos: dur,
        inativo_segundos: Math.min((current.idleAccum + idleNowMs) / 1000, dur),
      })
      .eq("id", current.id);
  } catch (e) {
    console.error("flush:", e.message);
  }
}

// Aplica o gate de rastreamento conforme o status macro: só ATIVO rastreia.
// Ao pausar, fecha a linha de app aberta; ao retomar, o próximo tick reabre.
async function applyTrackingGate() {
  const shouldTrack = macroStatus === "ATIVO";
  if (shouldTrack === !trackingPaused) return; // sem mudança de regime
  trackingPaused = !shouldTrack;
  if (trackingPaused) await closeCurrent();
  sendStatus();
}

// Reconcilia o estado local com a linha aberta de registros_atividade.
//
// O desktop é um SEGUIDOR puro: NUNCA cria nem transiciona sessão por conta
// própria. O expediente só inicia/transiciona pelo clique do usuário (web) —
// garantir isso evita que um F5/troca de aba "reabra" o expediente sozinho.
// Aqui apenas espelhamos o status macro para abrir/fechar o rastreamento de
// apps/navegação (applyTrackingGate só rastreia quando o status é ATIVO).
async function reconcileMacro(row) {
  const prev = macroStatus;
  if (!row) {
    macroStatus = null;
    macroSessionId = null;
    await applyTrackingGate();
    // Expediente encerrado por ociosidade (servidor) enquanto a pessoa estava
    // INATIVA: oferece reiniciar. Não dispara quando o próprio usuário encerrou
    // (suppressLostAlert) nem quando já não havia expediente (prev null).
    if (prev === "INATIVO" && !suppressLostAlert) {
      showAlert("lost");
    }
    suppressLostAlert = false;
    return;
  }
  macroStatus = row.status;
  macroSessionId = row.id;
  await applyTrackingGate();
  // Espelha o popup da web: ao ser marcado INATIVO, oferece "voltar ao trabalho".
  if (row.status === "INATIVO" && prev !== "INATIVO") {
    showAlert("inactive");
  } else if (row.status === "ATIVO") {
    // Retomou: fecha o popup se estiver aberto.
    closeAlert();
  }
}

async function fetchMacroStatus() {
  if (!monitoring) return;
  const userId = await getUserId();
  if (!userId) return;
  let row = null;
  try {
    const { data } = await supabase
      .from("registros_atividade")
      .select("id,status,inicio")
      .eq("usuario_id", userId)
      .is("fim", null)
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    row = data ?? null;
  } catch (e) {
    console.error("macroStatus:", e.message);
    return; // mantém o estado anterior em caso de erro de rede
  }
  await reconcileMacro(row);
  await refreshPanel(userId); // atualiza extOnline + totais/timeline para a UI
  sendStatus();
}

// Fecha a sessão macro só se o desktop for o dono (não derruba sessão do web).
async function closeMacroSessionIfOwned() {
  if (!desktopOwnsSession || !macroSessionId) return;
  const id = macroSessionId;
  desktopOwnsSession = false;
  macroSessionId = null;
  macroStatus = null;
  try {
    const { data } = await supabase
      .from("registros_atividade")
      .select("inicio")
      .eq("id", id)
      .single();
    const dur = data ? (Date.now() - new Date(data.inicio).getTime()) / 60000 : 0;
    await supabase
      .from("registros_atividade")
      .update({ fim: new Date().toISOString(), duracao_minutos: dur })
      .eq("id", id);
  } catch {
    /* noop */
  }
}

// Assina mudanças de registros_atividade do próprio usuário em tempo real. Faz
// o desktop reagir em segundos (em vez de esperar o poll de 60s) quando a web/
// outra fonte inicia/transiciona o expediente — sincronismo bidirecional. O poll
// (macroPollTimer) permanece como rede de segurança caso o realtime caia.
let macroRtDebounce = null;
async function subscribeMacroRealtime() {
  const userId = await getUserId();
  if (!userId) return;
  if (macroChannel) {
    try {
      await supabase.removeChannel(macroChannel);
    } catch {
      /* noop */
    }
    macroChannel = null;
  }
  macroChannel = supabase
    .channel(`desktop-macro-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "registros_atividade",
        filter: `usuario_id=eq.${userId}`,
      },
      () => {
        if (macroRtDebounce) clearTimeout(macroRtDebounce);
        macroRtDebounce = setTimeout(() => {
          macroRtDebounce = null;
          fetchMacroStatus();
        }, 400);
      },
    )
    .subscribe();
}

async function unsubscribeMacroRealtime() {
  if (macroRtDebounce) {
    clearTimeout(macroRtDebounce);
    macroRtDebounce = null;
  }
  if (macroChannel) {
    try {
      await supabase.removeChannel(macroChannel);
    } catch {
      /* noop */
    }
    macroChannel = null;
  }
}

function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  pollTimer = setInterval(tick, cfg.POLL_INTERVAL_MS);
  flushTimer = setInterval(flush, cfg.FLUSH_INTERVAL_MS);
  macroPollTimer = setInterval(fetchMacroStatus, cfg.MACRO_POLL_MS);
  whitelistTimer = setInterval(loadWhitelist, cfg.WHITELIST_REFRESH_MS);
  // Heartbeat "app vivo": independente do tracking-gate, pulsa enquanto logado.
  presenceHeartbeatTimer = setInterval(sendHeartbeat, 60000);
  sendHeartbeat();
  loadWhitelist();
  fetchMacroStatus();
  subscribeMacroRealtime();
  tick();
  sendStatus();
}

async function stopMonitoring() {
  monitoring = false;
  if (pollTimer) clearInterval(pollTimer);
  if (flushTimer) clearInterval(flushTimer);
  if (macroPollTimer) clearInterval(macroPollTimer);
  if (whitelistTimer) clearInterval(whitelistTimer);
  if (presenceHeartbeatTimer) clearInterval(presenceHeartbeatTimer);
  pollTimer = flushTimer = macroPollTimer = whitelistTimer = presenceHeartbeatTimer = null;
  await unsubscribeMacroRealtime();
  closeAlert();
  await closeCurrent();
  sendStatus();
}

function statusPayload() {
  return {
    monitoring,
    current: current ? { label: current.app_label, process: current.process_name } : null,
    synced: syncedCount,
    lastError,
    macroStatus, // status da jornada (ATIVO/PAUSA/ALMOCO/INATIVO) ou null
    extOnline, // extensão do Chrome vista recentemente (gate do Iniciar)
    today: todayData, // { totals, records, idleEvents } do dia para totais/timeline
    update: {
      status: updateStatus,
      error: lastUpdateError,
      version: pendingUpdateVersion,
      current: app.getVersion(),
    },
  };
}

function sendStatus() {
  if (!win) return;
  win.webContents.send("status", statusPayload());
}

// --- Painel: dados do dia (totais + timeline) e presença da extensão ---

// Totais por status em minutos — espelha o cálculo da web (index.tsx).
function computeTotals(records) {
  const t = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
  const nowTs = Date.now();
  for (const r of records) {
    const dur =
      r.duracao_minutos ??
      (r.fim
        ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
        : (nowTs - new Date(r.inicio).getTime()) / 60000);
    if (r.status in t) t[r.status] += dur;
  }
  return t;
}

async function fetchToday(userId) {
  if (!userId) return;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  try {
    const [{ data: records }, { data: idle }] = await Promise.all([
      supabase
        .from("registros_atividade")
        .select("id,status,inicio,fim,duracao_minutos")
        .eq("usuario_id", userId)
        .gte("inicio", startOfDay.toISOString())
        .order("inicio", { ascending: true }),
      supabase
        .from("eventos_ociosidade")
        .select("inicio,fim,fonte")
        .eq("usuario_id", userId)
        .gte("inicio", startOfDay.toISOString()),
    ]);
    const list = records ?? [];
    todayData = { records: list, idleEvents: idle ?? [], totals: computeTotals(list) };
  } catch (e) {
    console.error("fetchToday:", e.message);
  }
}

// Lê o último heartbeat "vivo" da extensão (presenca_extensao) do próprio
// usuário. Usado para liberar/bloquear o Iniciar expediente no app.
async function isExtensaoOnline(userId) {
  if (!userId) return false;
  try {
    const { data } = await supabase
      .from("presenca_extensao")
      .select("ultimo_visto")
      .eq("usuario_id", userId)
      .maybeSingle();
    if (!data?.ultimo_visto) return false;
    return Date.now() - new Date(data.ultimo_visto).getTime() < EXT_ONLINE_WINDOW_MS;
  } catch (e) {
    console.error("extensaoOnline:", e.message);
    return false;
  }
}

async function refreshPanel(userId) {
  if (!userId) return;
  extOnline = await isExtensaoOnline(userId);
  await fetchToday(userId);
}

// --- Controles de jornada (mesma RPC da web; só por clique explícito) ---

// Abre/transiciona o registro via RPC abrir_registro (SECURITY DEFINER). A RLS
// recusa INSERT direto de linha aberta — abrir é exclusivo da RPC.
async function abrirRegistro(status, observacao) {
  try {
    const { error } = await supabase.rpc("abrir_registro", {
      p_status: status,
      p_observacao: observacao || undefined,
    });
    if (error) return { error: error.message };
    await fetchMacroStatus(); // reconcilia tracking + painel imediatamente
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// Encerra a jornada — espelha use-current-session.stop(): de PAUSA/ALMOCO fecha
// a linha e insere um marcador ENCERRADO de duração zero; de ATIVO/INATIVO só
// fecha a linha aberta. Encerrar NÃO usa a RPC (não abre nada).
async function encerrarJornada() {
  const userId = await getUserId();
  if (!userId) return { error: "Sessão expirada — faça login novamente." };
  // Encerramento explícito pelo usuário: não mostrar o popup "sessão perdida"
  // quando o próximo reconcile vir a linha fechada.
  suppressLostAlert = true;
  closeAlert();
  try {
    const { data: openRow } = await supabase
      .from("registros_atividade")
      .select("id,status,inicio")
      .eq("usuario_id", userId)
      .is("fim", null)
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openRow) {
      const now = new Date().toISOString();
      const dur = (Date.now() - new Date(openRow.inicio).getTime()) / 60000;
      await supabase
        .from("registros_atividade")
        .update({ fim: now, duracao_minutos: dur })
        .eq("id", openRow.id);
      if (openRow.status === "PAUSA" || openRow.status === "ALMOCO") {
        await supabase.from("registros_atividade").insert({
          usuario_id: userId,
          status: "ENCERRADO",
          inicio: now,
          fim: now,
          duracao_minutos: 0,
        });
      }
    }
    await fetchMacroStatus();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// IPC
ipcMain.handle("auth:get-user", async () => {
  const { data } = await supabase.auth.getUser();
  return data?.user ? { id: data.user.id, email: data.user.email } : null;
});

ipcMain.handle("auth:login", async (_e, { email, password }) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  store.set("session", {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  startMonitoring();
  return { user: { id: data.user.id, email: data.user.email } };
});

ipcMain.handle("auth:logout", async () => {
  await stopMonitoring();
  store.delete("session");
  await supabase.auth.signOut();
  return { ok: true };
});

ipcMain.handle("monitor:status", () => statusPayload());

// Controles de jornada acionados pelo app (clique explícito do usuário).
// Iniciar a jornada (sair de ENCERRADO/sem-sessão para ATIVO) exige a extensão
// do Chrome ativa — mesmo gate da web. Retomar de pausa/almoço/inativo NÃO passa
// pelo gate. As demais transições (pausa/almoço/retomar) seguem direto.
ipcMain.handle("session:transition", async (_e, { status, observacao }) => {
  const isStart = status === "ATIVO" && (macroStatus == null || macroStatus === "ENCERRADO");
  if (isStart) {
    const userId = await getUserId();
    const online = await isExtensaoOnline(userId);
    extOnline = online;
    if (!online) {
      sendStatus();
      return { error: "extension_offline" };
    }
  }
  return abrirRegistro(status, observacao);
});

ipcMain.handle("session:stop", async () => encerrarJornada());

// Popup "sessão perdida / voltar ao trabalho": retomar (INATIVO→ATIVO) ou
// reiniciar (sessão encerrada→ATIVO). Ambos abrem status ATIVO → passam pelo
// GATE de monitoração do backend (RPC abrir_registro exige extensão + desktop).
// Se faltar alguma fonte, a RPC recusa e devolvemos o erro para o popup exibir —
// é isso que impede retomar o expediente sem monitoração.
ipcMain.handle("alert:action", async () => {
  const r = await abrirRegistro("ATIVO");
  if (r?.ok) closeAlert();
  return r;
});

ipcMain.handle("alert:dismiss", async () => {
  closeAlert();
  return { ok: true };
});

// Auto-update: verificação manual (botão "Verificar atualizações").
ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) {
    updateStatus = "dev";
    lastUpdateError = "Atualização automática só funciona no app instalado.";
    sendStatus();
    return { status: updateStatus, error: lastUpdateError };
  }
  // No macOS não há assinatura → o apply automático falha; vamos direto ao
  // fallback manual em vez de tentar baixar/instalar e falhar silenciosamente.
  if (process.platform === "darwin") {
    try {
      const res = await autoUpdater.checkForUpdates();
      const remote = res?.updateInfo?.version;
      if (remote && remote !== app.getVersion()) {
        updateStatus = "manual";
        lastUpdateError = null;
        notifyManualUpdate(remote);
        refreshTrayMenu();
      } else {
        updateStatus = "none";
      }
    } catch (e) {
      updateStatus = "error";
      lastUpdateError = e?.message || String(e);
    }
    sendStatus();
    return { status: updateStatus, error: lastUpdateError };
  }
  try {
    updateStatus = "checking";
    lastUpdateError = null;
    sendStatus();
    await autoUpdater.checkForUpdates();
  } catch (e) {
    updateStatus = "error";
    lastUpdateError = e?.message || String(e);
    sendStatus();
  }
  return { status: updateStatus, error: lastUpdateError };
});

// Abre a página de releases (fallback manual de atualização — funciona em
// qualquer SO, inclusive macOS sem assinatura).
ipcMain.handle("update:open-releases", () => {
  shell.openExternal(RELEASES_URL);
  return { ok: true };
});

// Aplica a atualização baixada (Windows). No macOS isto não é exposto (sem
// assinatura o quitAndInstall falha) — lá o botão abre os releases.
ipcMain.handle("update:install", async () => {
  if (process.platform === "darwin" || !pendingUpdateVersion) {
    shell.openExternal(RELEASES_URL);
    return { ok: true, manual: true };
  }
  await installUpdateNow();
  return { ok: true };
});

ipcMain.handle("session:today", async () => {
  const userId = await getUserId();
  await refreshPanel(userId);
  sendStatus();
  return todayData;
});

ipcMain.handle("open:portal", () => {
  shell.openExternal(PORTAL_URL);
  return { ok: true };
});

ipcMain.handle("autolaunch:get", async () => {
  try {
    return await autoLauncher.isEnabled();
  } catch {
    return false;
  }
});
ipcMain.handle("autolaunch:set", async (_e, enabled) => {
  try {
    enabled ? await autoLauncher.enable() : await autoLauncher.disable();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// --- Auto-update (electron-updater + GitHub público) ---
// Baixa em background; NÃO instala sozinho durante o uso. O usuário decide pela
// notificação / item de bandeja. `autoInstallOnAppQuit` é rede de segurança:
// aplica no próximo Sair/desligamento, sem interromper o trabalho.
async function installUpdateNow() {
  try {
    // Fecha a sessão de app/jornada do desktop antes de reiniciar para instalar,
    // evitando linha órfã (o before-quit já cobre, mas isQuiting o curto-circuita).
    await closeCurrent();
    await closeMacroSessionIfOwned();
  } catch {
    /* noop */
  }
  app.isQuiting = true; // impede o before-quit de cancelar o quit
  autoUpdater.quitAndInstall();
}

// Notifica que há atualização para baixar manualmente (fallback). Usado no
// macOS (sem assinatura o apply automático falha) e em qualquer erro de apply.
function notifyManualUpdate(version) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: "Atualização disponível",
        body: `A versão ${version || "nova"} está pronta. Clique para baixar e instalar.`,
      });
      n.on("click", () => shell.openExternal(RELEASES_URL));
      n.show();
    }
  } catch {
    /* noop */
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) {
    updateStatus = "dev"; // em dev (npm start) o updater lança "no published versions"
    return;
  }

  // Visibilidade: antes os erros eram engolidos (.catch vazio) e não dava para
  // saber por que o update "não funcionava". Agora todo evento atualiza o estado
  // exposto na UI (statusPayload.update) e nos logs.
  autoUpdater.on("checking-for-update", () => {
    updateStatus = "checking";
    sendStatus();
  });
  autoUpdater.on("update-available", (info) => {
    updateStatus = "available";
    lastUpdateError = null;
    sendStatus();
    // macOS não assinado: não dá para aplicar via Squirrel → fallback manual.
    if (process.platform === "darwin") {
      updateStatus = "manual";
      notifyManualUpdate(info?.version);
      refreshTrayMenu();
      sendStatus();
    }
  });
  autoUpdater.on("update-not-available", () => {
    updateStatus = "none";
    sendStatus();
  });
  autoUpdater.on("download-progress", () => {
    updateStatus = "downloading";
    sendStatus();
  });
  autoUpdater.on("update-downloaded", (info) => {
    pendingUpdateVersion = info?.version || "nova";
    updateStatus = "downloaded";
    lastUpdateError = null;
    refreshTrayMenu();
    sendStatus();
    try {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: "Atualização disponível",
          body: `A versão ${pendingUpdateVersion} foi baixada. Clique para atualizar e reiniciar.`,
        });
        n.on("click", () => installUpdateNow());
        n.show();
      }
    } catch {
      /* noop */
    }
  });
  autoUpdater.on("error", (e) => {
    updateStatus = "error";
    lastUpdateError = e?.message || String(e);
    console.error("autoUpdater:", lastUpdateError);
    // Em erro de download/apply, oferece o caminho manual para não travar.
    refreshTrayMenu();
    sendStatus();
  });

  // No macOS evitamos o download automático (apply falha sem assinatura): só
  // checamos e, havendo versão nova, caímos no fallback manual.
  autoUpdater.autoDownload = process.platform !== "darwin";
  autoUpdater.autoInstallOnAppQuit = process.platform !== "darwin";
  autoUpdater.checkForUpdates().catch((e) => {
    updateStatus = "error";
    lastUpdateError = e?.message || String(e);
    sendStatus();
  });
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupAutoUpdate();
  // Se já tem sessão salva, começa a monitorar automaticamente
  const uid = await getUserId();
  if (uid) startMonitoring();
  else win.show();
});

app.on("window-all-closed", (e) => {
  e.preventDefault(); /* fica no tray */
});

app.on("before-quit", async (e) => {
  if (app.isQuiting) return;
  if ((current && current.id) || (desktopOwnsSession && macroSessionId)) {
    e.preventDefault();
    await closeCurrent();
    await closeMacroSessionIfOwned();
    app.isQuiting = true;
    app.quit();
  }
});

// Desligamento/restart da máquina: encerra o expediente em aberto, mas NÃO
// desloga. A sessão (login) persiste em electron-store e é restaurada no próximo
// boot — alinhado ao web/extensão, que também não forçam mais novo login no
// reinício. (Sem isso, o usuário precisaria relogar toda vez que ligava o PC, e
// o desktop ficaria offline para o gate de monitoração.)
powerMonitor.on("shutdown", async (e) => {
  e.preventDefault();
  await stopMonitoring();
  await closeMacroSessionIfOwned();
  app.isQuiting = true;
  app.quit();
});
