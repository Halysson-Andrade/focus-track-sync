importScripts("config.js");

// IDLE_THRESHOLD_S vem de config.js (sincronizado com desktop/web).
let currentRow = null; // { id, url, domain, title, enteredAt, idleAccum, idleStart, focused, passive }
let lastSystemState = "active";
let idleWhitelistDomains = []; // domínios passivos (reunião/vídeo)
let macroStatus = null; // status da sessão macro (ATIVO/PAUSA/...) ou null
let trackingPaused = false; // true quando não devemos rastrear navegação

chrome.idle.setDetectionInterval(IDLE_THRESHOLD_S);

function isWhitelistedDomain(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return idleWhitelistDomains.some((d) => h === d || h.endsWith("." + d));
}

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  if (!session) return null;
  // refresh se faltar < 60s
  if (session.expires_at && session.expires_at - 60 < Math.floor(Date.now() / 1000)) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
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
    } catch {
      return session;
    }
  }
  return session;
}

async function api(path, method, body) {
  const session = await getSession();
  if (!session) return null;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isTrackable(url) {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

// Carrega os domínios passivos (reunião/vídeo): nesses sites a ausência de
// mouse/teclado NÃO conta como ociosidade.
async function loadWhitelist() {
  try {
    const res = await api(
      "monitor_idle_whitelist?tipo=eq.dominio&ativo=eq.true&select=identificador",
      "GET",
    );
    if (res && res.ok) {
      const rows = await res.json();
      idleWhitelistDomains = rows.map((r) => (r.identificador || "").toLowerCase());
    }
  } catch {}
}

// Lê o status da sessão macro (registros_atividade) e pausa/retoma o tracking.
async function fetchMacroStatus() {
  const session = await getSession();
  if (!session) return;
  try {
    const res = await api(
      `registros_atividade?usuario_id=eq.${session.user.id}&fim=is.null&select=status&order=inicio.desc&limit=1`,
      "GET",
    );
    if (!res || !res.ok) return;
    const [row] = await res.json();
    await applyMacroStatus(row ? row.status : null);
  } catch {}
}

async function applyMacroStatus(next) {
  macroStatus = next;
  const shouldTrack = next === "ATIVO";
  if (shouldTrack === !trackingPaused) return; // sem mudança de regime
  trackingPaused = !shouldTrack;
  if (trackingPaused) {
    await closeCurrent();
  } else {
    // Retomada: reabre a aba ativa atual (senão só reabriria na próxima troca).
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) await handleActive(tab);
    } catch {}
  }
}

// Fecha qualquer linha aberta que ficou "órfã" após o service worker reiniciar.
async function closeStaleRow() {
  try {
    const { openRow } = await chrome.storage.session.get("openRow");
    if (!openRow || (currentRow && currentRow.id === openRow.id)) return;
    await chrome.storage.session.remove("openRow");
    const now = Date.now();
    const dur = Math.max(0, (now - openRow.enteredAt) / 1000);
    await api(`navegacao_externa?id=eq.${openRow.id}`, "PATCH", {
      fim: new Date(now).toISOString(),
      duracao_segundos: dur,
    });
  } catch {}
}

// Sessões muito curtas (< 3s) são ruído de troca rápida de aba — descartamos
// para não inflar a tabela. Em vez de PATCH com fim, apagamos a linha.
const MIN_DURATION_S = 3;

async function closeCurrent() {
  if (!currentRow || !currentRow.id) {
    currentRow = null;
    await closeStaleRow();
    return;
  }
  const now = Date.now();
  const dur = (now - currentRow.enteredAt) / 1000;
  const idleNowMs = currentRow.idleStart ? now - currentRow.idleStart : 0;
  const idle = Math.min((currentRow.idleAccum + idleNowMs) / 1000, dur);
  const id = currentRow.id;
  currentRow = null;
  try {
    await chrome.storage.session.remove("openRow");
  } catch {}
  try {
    if (dur < MIN_DURATION_S) {
      await api(`navegacao_externa?id=eq.${id}`, "DELETE");
    } else {
      await api(`navegacao_externa?id=eq.${id}`, "PATCH", {
        fim: new Date(now).toISOString(),
        duracao_segundos: dur,
        inativo_segundos: idle,
      });
    }
  } catch {}
}


async function openRow(tab) {
  if (trackingPaused) return; // sessão macro não-ATIVA: não abre navegação
  const session = await getSession();
  if (!session) return;
  if (!isTrackable(tab.url)) return;
  const now = Date.now();
  const domain = domainOf(tab.url);
  currentRow = {
    id: null,
    url: tab.url,
    domain,
    title: tab.title || "",
    enteredAt: now,
    idleAccum: 0,
    idleStart: null,
    focused: true,
    passive: isWhitelistedDomain(domain),
  };
  try {
    const res = await api("navegacao_externa", "POST", {
      usuario_id: session.user.id,
      url: tab.url,
      domain: currentRow.domain,
      title: tab.title || "",
      inicio: new Date(now).toISOString(),
      janela_focada: true,
      user_agent: navigator.userAgent,
    });
    if (res && res.ok) {
      const [row] = await res.json();
      if (row && currentRow && currentRow.url === tab.url && !trackingPaused) {
        currentRow.id = row.id;
        try {
          await chrome.storage.session.set({ openRow: { id: row.id, enteredAt: now } });
        } catch {}
      } else if (row) {
        // currentRow mudou enquanto criávamos — fecha imediatamente
        try {
          await api(`navegacao_externa?id=eq.${row.id}`, "PATCH", {
            fim: new Date().toISOString(),
            duracao_segundos: 0,
          });
        } catch {}
      }
    }
  } catch {}
}

async function handleActive(tab) {
  if (!tab) return;
  if (currentRow && currentRow.url === tab.url) {
    // título pode ter mudado
    if (tab.title && currentRow.title !== tab.title && currentRow.id) {
      currentRow.title = tab.title;
      try {
        await api(`navegacao_externa?id=eq.${currentRow.id}`, "PATCH", { title: tab.title });
      } catch {}
    }
    return;
  }
  await closeCurrent();
  await openRow(tab);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await handleActive(tab);
  } catch {}
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
  if (currentRow.passive) return; // app/site passivo: ausência de input não conta
  if (state === "idle" || state === "locked") {
    if (!currentRow.idleStart) {
      // chrome.idle só dispara após IDLE_THRESHOLD_S sem input — retroage o
      // início para "idle" (não subcontar esse intervalo). "locked" manual usa
      // agora; idle->locked preserva o idleStart anterior. Clampa ao início.
      const back = state === "idle" ? IDLE_THRESHOLD_S * 1000 : 0;
      currentRow.idleStart = Math.max(currentRow.enteredAt, Date.now() - back);
    }
  } else if (state === "active" && currentRow.idleStart) {
    currentRow.idleAccum += Date.now() - currentRow.idleStart;
    currentRow.idleStart = null;
  }
});

// Heartbeat: atualiza linha aberta periodicamente (caso o SW reinicie)
let heartbeatTicks = 0;
chrome.alarms.create("heartbeat", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "heartbeat") return;
  // Lê o status macro p/ pausar/retomar o tracking; precisa rodar mesmo sem
  // linha aberta (durante pausa currentRow é null) para detectar a retomada.
  await fetchMacroStatus();
  heartbeatTicks += 1;
  if (heartbeatTicks % 5 === 1) await loadWhitelist(); // ~a cada 5 min
  if (!currentRow || !currentRow.id) {
    // SW reiniciou e perdeu a referência — fecha a linha órfã para não
    // continuar contando tempo de uma aba que pode nem estar mais em foco.
    await closeStaleRow();
    return;
  }
  const now = Date.now();
  const dur = (now - currentRow.enteredAt) / 1000;
  const idleNowMs = currentRow.idleStart ? now - currentRow.idleStart : 0;
  try {
    await api(`navegacao_externa?id=eq.${currentRow.id}`, "PATCH", {
      duracao_segundos: dur,
      inativo_segundos: Math.min((currentRow.idleAccum + idleNowMs) / 1000, dur),
    });
  } catch {}
});

const APP_URL_PATTERNS = [
  "https://focus-track-sync.lovable.app/*",
  "https://*.lovable.app/*",
  "https://*.lovableproject.com/*",
];

async function broadcastHeartbeat() {
  // Envia se o sistema está ativo OU se a aba atual é um site passivo
  // (reunião/vídeo no navegador) — senão o app marcaria falso INATIVO.
  // Não envia com o sistema ocioso fora de site passivo (máquina bloqueada).
  if (lastSystemState !== "active" && !(currentRow && currentRow.passive)) return;
  try {
    const tabs = await chrome.tabs.query({ url: APP_URL_PATTERNS });
    for (const t of tabs) {
      try {
        await chrome.tabs.sendMessage(t.id, { type: "EXT_HEARTBEAT" });
      } catch {}
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
chrome.tabs.onActivated.addListener(() => {
  broadcastHeartbeat();
});
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.title) broadcastHeartbeat();
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId !== chrome.windows.WINDOW_ID_NONE) broadcastHeartbeat();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "LOGGED_OUT") {
    closeCurrent();
  }
  if (msg.type === "LOGGED_IN") {
    trackingPaused = false;
    macroStatus = null;
    loadWhitelist();
    fetchMacroStatus();
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
      if (tab) handleActive(tab);
    });
  }
  if (msg.type === "PAGE_READY" && sender.tab?.id) {
    // Empurra um heartbeat imediato para a aba que acabou de carregar o app.
    try {
      chrome.tabs.sendMessage(sender.tab.id, { type: "EXT_HEARTBEAT" });
    } catch {}
  }
});

chrome.runtime.onStartup.addListener(async () => {
  // Máquina/navegador foi reiniciado: derruba a sessão da extensão para
  // forçar novo login, alinhado com o comportamento do app web.
  try {
    await chrome.storage.local.remove("session");
  } catch {}
  try {
    await chrome.storage.session.remove("openRow");
  } catch {}
  currentRow = null;
});
chrome.runtime.onInstalled.addListener(async () => {
  await closeStaleRow();
  await loadWhitelist();
  await fetchMacroStatus();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) handleActive(tab);
});

// SW pode reiniciar a qualquer momento: ao acordar, fecha linha órfã e
// recarrega whitelist/status (o SW perde o estado em memória ao hibernar).
closeStaleRow();
loadWhitelist();
fetchMacroStatus();
