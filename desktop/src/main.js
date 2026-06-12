const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  powerMonitor,
  shell,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const AutoLaunch = require("auto-launch");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const cfg = require("./config");
const { labelFor } = require("./app-labels");

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
let monitoring = false;
let pollTimer = null;
let flushTimer = null;
let current = null; // { id, process_name, app_label, executable_path, enteredAt, idleAccum, lastIdleStart }
let syncedCount = 0; // registros (uso_aplicativos) gravados com sucesso nesta sessão
let lastError = null; // último erro de sincronização (mostrado na UI para diagnóstico)
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
    width: 460,
    height: 620,
    resizable: false,
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
  const menu = Menu.buildFromTemplate([
    {
      label: "Abrir painel",
      click: () => {
        win.show();
      },
    },
    {
      label: "Abrir app web",
      click: () => shell.openExternal("https://focus-track-sync.lovable.app"),
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
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
  const id = current.id;
  current = null;
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
    const info = await activeWin();
    const idleSec = powerMonitor.getSystemIdleTime();
    const rawIdle = idleSec >= cfg.IDLE_THRESHOLD_S;

    const procName =
      info && info.owner ? (info.owner.name || info.owner.path || "").toString() : "";
    // App passivo (reunião/vídeo/leitura): ausência de input não é ociosidade.
    const passive = procName ? idleWhitelist.has(procName.toLowerCase()) : false;
    const isIdle = rawIdle && !passive;

    if (current) {
      if (isIdle && !current.lastIdleStart) {
        // getSystemIdleTime() já é o tempo contínuo sem input — retroage o
        // início do ócio em vez de marcar "agora", senão perdemos os
        // IDLE_THRESHOLD_S iniciais. Clampa ao início da janela do app.
        current.lastIdleStart = Math.max(current.enteredAt, Date.now() - idleSec * 1000);
      } else if (!isIdle && current.lastIdleStart) {
        current.idleAccum += Date.now() - current.lastIdleStart;
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

// Cria uma sessão ATIVO quando não há nenhuma aberta (aba web fechada) e há
// atividade local. O desktop assume a posse para gerenciar INATIVO/retomada.
async function autoStartSession(userId) {
  try {
    const { data, error } = await supabase
      .from("registros_atividade")
      .insert({ usuario_id: userId, status: "ATIVO", inicio: new Date().toISOString() })
      .select("id")
      .single();
    if (error) return; // corrida (índice único): web abriu primeiro — próximo poll reconcilia
    macroStatus = "ATIVO";
    macroSessionId = data.id;
    desktopOwnsSession = true;
  } catch (e) {
    console.error("autoStart:", e.message);
  }
}

// Fecha a linha aberta e abre outra com novo status (espelha o transition do web).
// Usado só quando o desktop é dono da sessão (aba web fechada).
async function macroTransition(userId, openId, next, observacao) {
  const nowIso = new Date().toISOString();
  try {
    const { data: row } = await supabase
      .from("registros_atividade")
      .select("inicio")
      .eq("id", openId)
      .single();
    const dur = row ? (Date.now() - new Date(row.inicio).getTime()) / 60000 : 0;
    await supabase
      .from("registros_atividade")
      .update({ fim: nowIso, duracao_minutos: dur })
      .eq("id", openId);
    const { data, error } = await supabase
      .from("registros_atividade")
      .insert({ usuario_id: userId, status: next, inicio: nowIso, observacao: observacao ?? null })
      .select("id")
      .single();
    if (error) return; // corrida — próximo poll reconcilia
    macroStatus = next;
    macroSessionId = data.id;
    desktopOwnsSession = true;
  } catch (e) {
    console.error("macroTransition:", e.message);
  }
}

// Reconcilia o estado local com a linha aberta de registros_atividade.
async function reconcileMacro(userId, row) {
  const idleSec = powerMonitor.getSystemIdleTime();
  const localActive = idleSec < cfg.IDLE_THRESHOLD_S;
  const longIdle = idleSec * 1000 >= cfg.INACTIVITY_LIMIT_MS;

  // Se a linha aberta mudou e não foi o desktop que criou, o web é o dono.
  if (row && row.id !== macroSessionId) desktopOwnsSession = false;

  if (!row) {
    macroStatus = null;
    macroSessionId = null;
    desktopOwnsSession = false;
    if (localActive) await autoStartSession(userId);
    await applyTrackingGate();
    return;
  }

  macroStatus = row.status;
  macroSessionId = row.id;

  // INATIVO/retomada automáticos só quando o desktop é dono (aba web fechada).
  // Com a aba aberta, o web é o autor e o desktop apenas converge.
  if (desktopOwnsSession) {
    if (row.status === "ATIVO" && longIdle) {
      await macroTransition(userId, row.id, "INATIVO", "Inatividade automática (desktop)");
    } else if (row.status === "INATIVO" && localActive) {
      await macroTransition(userId, row.id, "ATIVO");
    }
  }
  await applyTrackingGate();
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
  await reconcileMacro(userId, row);
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

function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  pollTimer = setInterval(tick, cfg.POLL_INTERVAL_MS);
  flushTimer = setInterval(flush, cfg.FLUSH_INTERVAL_MS);
  macroPollTimer = setInterval(fetchMacroStatus, cfg.MACRO_POLL_MS);
  whitelistTimer = setInterval(loadWhitelist, cfg.WHITELIST_REFRESH_MS);
  loadWhitelist();
  fetchMacroStatus();
  tick();
  sendStatus();
}

async function stopMonitoring() {
  monitoring = false;
  if (pollTimer) clearInterval(pollTimer);
  if (flushTimer) clearInterval(flushTimer);
  if (macroPollTimer) clearInterval(macroPollTimer);
  if (whitelistTimer) clearInterval(whitelistTimer);
  pollTimer = flushTimer = macroPollTimer = whitelistTimer = null;
  await closeCurrent();
  sendStatus();
}

function sendStatus() {
  if (!win) return;
  win.webContents.send("status", {
    monitoring,
    current: current ? { label: current.app_label, process: current.process_name } : null,
    synced: syncedCount,
    lastError,
  });
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

ipcMain.handle("monitor:start", () => {
  startMonitoring();
  return { ok: true };
});
ipcMain.handle("monitor:stop", async () => {
  await stopMonitoring();
  return { ok: true };
});
ipcMain.handle("monitor:status", () => ({
  monitoring,
  current: current ? { label: current.app_label, process: current.process_name } : null,
  synced: syncedCount,
  lastError,
}));

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

app.whenReady().then(async () => {
  createWindow();
  createTray();
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

// Desligamento/restart da máquina: fecha sessão (mesmo padrão da extensão/web)
powerMonitor.on("shutdown", async (e) => {
  e.preventDefault();
  await stopMonitoring();
  await closeMacroSessionIfOwned();
  store.delete("session");
  try {
    await supabase.auth.signOut();
  } catch {
    /* noop */
  }
  app.isQuiting = true;
  app.quit();
});
