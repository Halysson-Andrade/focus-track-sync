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
  const idleNow = current.lastIdleStart ? (now - current.lastIdleStart) / 1000 : 0;
  const idle = current.idleAccum + idleNow;
  const id = current.id;
  current = null;
  try {
    await supabase
      .from("uso_aplicativos")
      .update({
        fim: new Date(now).toISOString(),
        duracao_segundos: dur,
        inativo_segundos: Math.min(idle, dur),
      })
      .eq("id", id);
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
  try {
    const activeWin = await getActiveWin();
    const info = await activeWin();
    const idleSec = powerMonitor.getSystemIdleTime();
    const isIdle = idleSec >= cfg.IDLE_THRESHOLD_S;

    if (current) {
      if (isIdle && !current.lastIdleStart) {
        current.lastIdleStart = Date.now();
      } else if (!isIdle && current.lastIdleStart) {
        current.idleAccum += Date.now() - current.lastIdleStart;
        current.lastIdleStart = null;
      }
    }

    // Presença para o painel (evita falso INATIVO enquanto trabalha em app nativo)
    if (!isIdle && Date.now() - lastPresenceAt >= 30000) {
      lastPresenceAt = Date.now();
      sendPresence();
    }

    if (!info || !info.owner) return;
    const procName = (info.owner.name || info.owner.path || "").toString();
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
  const idleNow = current.lastIdleStart ? (now - current.lastIdleStart) / 1000 : 0;
  try {
    await supabase
      .from("uso_aplicativos")
      .update({
        duracao_segundos: dur,
        inativo_segundos: Math.min(current.idleAccum / 1000 + idleNow, dur),
      })
      .eq("id", current.id);
  } catch (e) {
    console.error("flush:", e.message);
  }
}

function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  pollTimer = setInterval(tick, cfg.POLL_INTERVAL_MS);
  flushTimer = setInterval(flush, cfg.FLUSH_INTERVAL_MS);
  tick();
  sendStatus();
}

async function stopMonitoring() {
  monitoring = false;
  if (pollTimer) clearInterval(pollTimer);
  if (flushTimer) clearInterval(flushTimer);
  pollTimer = flushTimer = null;
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
  if (current && current.id) {
    e.preventDefault();
    await closeCurrent();
    app.isQuiting = true;
    app.quit();
  }
});

// Desligamento/restart da máquina: fecha sessão (mesmo padrão da extensão/web)
powerMonitor.on("shutdown", async (e) => {
  e.preventDefault();
  await stopMonitoring();
  store.delete("session");
  try {
    await supabase.auth.signOut();
  } catch {
    /* noop */
  }
  app.isQuiting = true;
  app.quit();
});
