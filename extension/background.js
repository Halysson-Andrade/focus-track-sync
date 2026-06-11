importScripts("config.js");

const IDLE_THRESHOLD_S = 60; // sistema considerado ocioso
let currentRow = null; // { id, url, domain, title, enteredAt, idleAccum, lastFocusGap, focused }
let lastSystemState = "active";

chrome.idle.setDetectionInterval(IDLE_THRESHOLD_S);

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  if (!session) return null;
  // refresh se faltar < 60s
  if (session.expires_at && session.expires_at - 60 < Math.floor(Date.now() / 1000)) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (res.ok) {
        const data = await res.json();
        const next = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
          user: data.user || session.user,
        };
        await chrome.storage.local.set({ session: next });
        return next;
      } else {
        await chrome.storage.local.remove("session");
        return null;
      }
    } catch { return session; }
  }
  return session;
}

async function api(path, method, body) {
  const session = await getSession();
  if (!session) return null;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function domainOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function isTrackable(url) {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

async function closeCurrent() {
  if (!currentRow || !currentRow.id) { currentRow = null; return; }
  const now = Date.now();
  const dur = (now - currentRow.enteredAt) / 1000;
  const idle = currentRow.idleAccum / 1000;
  const id = currentRow.id;
  currentRow = null;
  try {
    await api(`navegacao_externa?id=eq.${id}`, "PATCH", {
      fim: new Date(now).toISOString(),
      duracao_segundos: dur,
      inativo_segundos: idle,
    });
  } catch {}
}

async function openRow(tab) {
  const session = await getSession();
  if (!session) return;
  if (!isTrackable(tab.url)) return;
  const now = Date.now();
  currentRow = {
    id: null, url: tab.url, domain: domainOf(tab.url), title: tab.title || "",
    enteredAt: now, idleAccum: 0, idleStart: null, focused: true,
  };
  try {
    const res = await api("navegacao_externa", "POST", {
      usuario_id: session.user.id,
      url: tab.url, domain: currentRow.domain, title: tab.title || "",
      inicio: new Date(now).toISOString(),
      janela_focada: true,
      user_agent: navigator.userAgent,
    });
    if (res && res.ok) {
      const [row] = await res.json();
      if (row && currentRow && currentRow.url === tab.url) currentRow.id = row.id;
    }
  } catch {}
}

async function handleActive(tab) {
  if (!tab) return;
  if (currentRow && currentRow.url === tab.url) {
    // título pode ter mudado
    if (tab.title && currentRow.title !== tab.title && currentRow.id) {
      currentRow.title = tab.title;
      try { await api(`navegacao_externa?id=eq.${currentRow.id}`, "PATCH", { title: tab.title }); } catch {}
    }
    return;
  }
  await closeCurrent();
  await openRow(tab);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { const tab = await chrome.tabs.get(tabId); await handleActive(tab); } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.title) await handleActive(tab);
});

chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) {
    // perdeu foco — encerra como saída da janela
    if (currentRow && currentRow.id) {
      try {
        await api(`navegacao_externa?id=eq.${currentRow.id}`, "PATCH", { janela_focada: false });
      } catch {}
    }
    await closeCurrent();
  } else {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
      if (tab) await handleActive(tab);
    } catch {}
  }
});

chrome.idle.onStateChanged.addListener(async (state) => {
  lastSystemState = state;
  if (!currentRow) return;
  if (state === "idle" || state === "locked") {
    currentRow.idleStart = Date.now();
  } else if (state === "active" && currentRow.idleStart) {
    currentRow.idleAccum += Date.now() - currentRow.idleStart;
    currentRow.idleStart = null;
  }
});

// Heartbeat: atualiza linha aberta periodicamente (caso o SW reinicie)
chrome.alarms.create("heartbeat", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "heartbeat" || !currentRow || !currentRow.id) return;
  const now = Date.now();
  const idleNow = currentRow.idleStart ? (now - currentRow.idleStart) : 0;
  try {
    await api(`navegacao_externa?id=eq.${currentRow.id}`, "PATCH", {
      duracao_segundos: (now - currentRow.enteredAt) / 1000,
      inativo_segundos: (currentRow.idleAccum + idleNow) / 1000,
    });
  } catch {}
});

const APP_URL_PATTERNS = [
  "https://focus-track-sync.lovable.app/*",
  "https://*.lovable.app/*",
  "https://*.lovableproject.com/*",
];

async function broadcastHeartbeat() {
  // Só envia se o sistema está ativo — não queremos manter sessão "viva"
  // enquanto o usuário está realmente ocioso/com a máquina bloqueada.
  if (lastSystemState !== "active") return;
  try {
    const tabs = await chrome.tabs.query({ url: APP_URL_PATTERNS });
    for (const t of tabs) {
      try { await chrome.tabs.sendMessage(t.id, { type: "EXT_HEARTBEAT" }); } catch {}
    }
  } catch {}
}

// Heartbeat frequente para o app (1 min). Combinado com qualquer troca de
// aba abaixo, o app não marca inatividade enquanto a extensão estiver vendo
// atividade em outras abas/janelas.
chrome.alarms.create("appHeartbeat", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "appHeartbeat") await broadcastHeartbeat();
});

// Troca de aba / mudança de URL / foco de janela = sinal de atividade.
chrome.tabs.onActivated.addListener(() => { broadcastHeartbeat(); });
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.title) broadcastHeartbeat();
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId !== chrome.windows.WINDOW_ID_NONE) broadcastHeartbeat();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "LOGGED_OUT") { closeCurrent(); }
  if (msg.type === "LOGGED_IN") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => { if (tab) handleActive(tab); });
  }
  if (msg.type === "PAGE_READY" && sender.tab?.id) {
    // Empurra um heartbeat imediato para a aba que acabou de carregar o app.
    try { chrome.tabs.sendMessage(sender.tab.id, { type: "EXT_HEARTBEAT" }); } catch {}
  }
});

chrome.runtime.onStartup.addListener(async () => {
  // Máquina/navegador foi reiniciado: derruba a sessão da extensão para
  // forçar novo login, alinhado com o comportamento do app web.
  try { await chrome.storage.local.remove("session"); } catch {}
  currentRow = null;
});
chrome.runtime.onInstalled.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) handleActive(tab);
});

