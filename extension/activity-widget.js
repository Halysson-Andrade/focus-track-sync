// Content script de APONTAMENTO DE ATIVIDADE (estilo Time Doctor).
//
// Roda nos sites integrados (Trello, Azure DevOps, Gmail, Outlook), reconhece o
// item aberto (card/work item/e-mail), injeta um widget flutuante com play/stop
// e fala com o background, que chama as RPCs iniciar_atividade/parar_atividade.
//
// O estado do timer vive no BANCO (apontamento aberto). O widget só reflete:
// consulta ACTIVITY_STATE ao carregar/focar/navegar e renderiza play vs stop.
// Por isso sobrevive a reload da aba e à hibernação do service worker.
(function () {
  "use strict";

  // ---- Adapters: extraem { fonte, external_id, external_url, titulo, contexto }
  // a partir da URL + DOM. Retornam null quando não há item reconhecível.
  function txt(sel) {
    const el = document.querySelector(sel);
    const t = el && (el.value || el.textContent);
    return t ? t.trim() : "";
  }

  function cleanTitle(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // Slug estável p/ servir de external_id quando o site não expõe um id na URL.
  function slugId(s) {
    return cleanTitle(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function detectTrello() {
    // Card aberto: /c/<shortlink>/<num>-<slug>
    const m = location.pathname.match(/^\/c\/([a-zA-Z0-9]+)/);
    if (!m) return null;
    const titulo =
      cleanTitle(
        txt('[data-testid="card-back-title-input"]') ||
          txt(".window-title h2") ||
          document.title.replace(/\s*\|\s*Trello\s*$/i, "").replace(/\s+on\s+.+$/i, ""),
      ) || "Card do Trello";
    return {
      fonte: "trello",
      external_id: m[1],
      external_url: location.origin + location.pathname,
      titulo,
      contexto: cleanTitle(txt(".board-header-btn-name")) || null,
    };
  }

  function detectAzure() {
    // Work item: /_workitems/edit/<id> (ou query ?workitem=<id> em boards).
    const m =
      location.pathname.match(/_workitems\/edit\/(\d+)/) ||
      location.search.match(/[?&]workitem=(\d+)/);
    if (!m) return null;
    const titulo =
      cleanTitle(
        txt(".work-item-title-textfield input") ||
          txt("input[aria-label='Title field']") ||
          document.title.replace(/\s*-\s*Boards\b.*$/i, ""),
      ) || ("Work item #" + m[1]);
    return {
      fonte: "azure",
      external_id: m[1],
      external_url: location.href,
      titulo,
      contexto: null,
    };
  }

  function detectGmail() {
    // Thread aberta: hash #inbox/<id>, #label/<x>/<id>, #search/<x>/<id> etc.
    const hash = location.hash.replace(/^#/, "");
    const parts = hash.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    // Ids de thread do Gmail são longos e alfanuméricos; ignora seções (inbox...).
    if (parts.length < 2 || last.length < 12) return null;
    const titulo = cleanTitle(txt("h2.hP") || txt("[data-thread-perm-id] h2")) || "E-mail";
    return {
      fonte: "gmail",
      external_id: last,
      external_url: location.href,
      titulo,
      contexto: null,
    };
  }

  function detectOutlook() {
    // Leitura de e-mail: assunto no heading do painel. Id estável nem sempre
    // existe na URL → cai para um slug do assunto.
    const titulo = cleanTitle(
      txt("[role='main'] [role='heading']") ||
        txt("div[aria-label='Reading Pane'] [role='heading']"),
    );
    if (!titulo) return null;
    const idm = location.hash.match(/id\/([^/?&]+)/i) || location.pathname.match(/id\/([^/?&]+)/i);
    return {
      fonte: "outlook",
      external_id: idm ? decodeURIComponent(idm[1]).slice(0, 120) : slugId(titulo),
      external_url: location.href,
      titulo,
      contexto: null,
    };
  }

  function detectItem() {
    const host = location.host;
    try {
      if (host.endsWith("trello.com")) return detectTrello();
      if (host === "dev.azure.com" || host.endsWith("visualstudio.com")) return detectAzure();
      if (host === "mail.google.com") return detectGmail();
      if (host.startsWith("outlook.")) return detectOutlook();
    } catch (_) {
      /* DOM ainda não pronto / seletor ausente */
    }
    return null;
  }

  // ---- Estado do widget --------------------------------------------------
  let current = null; // item detectado na página agora
  let running = null; // { atividade_id, fonte, external_id, titulo, inicio } ou null
  let tickTimer = null;

  function sameItem(a, b) {
    return a && b && a.fonte === b.fonte && a.external_id === b.external_id;
  }

  function fmtElapsed(sinceIso) {
    const ms = Date.now() - new Date(sinceIso).getTime();
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return (h > 0 ? h + ":" : "") + pad(m) + ":" + pad(ss);
  }

  // ---- UI (Shadow DOM p/ isolar estilos do site hospedeiro) --------------
  let root = null;
  let els = null;

  function ensureUI() {
    if (root) return;
    const host = document.createElement("div");
    host.id = "wt-activity-host";
    host.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;";
    (document.body || document.documentElement).appendChild(host);
    const sh = host.attachShadow({ mode: "open" });
    sh.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
        .box { width: 256px; background:#111827; color:#f9fafb; border-radius:12px;
               box-shadow:0 8px 24px rgba(0,0,0,.35); padding:10px 12px; font-size:12px; }
        .row { display:flex; align-items:center; gap:8px; }
        .src { font-size:10px; text-transform:uppercase; letter-spacing:.04em; opacity:.6; }
        .title { font-weight:600; line-height:1.25; max-height:2.6em; overflow:hidden;
                 display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .timer { font-variant-numeric:tabular-nums; font-weight:700; font-size:14px; }
        .btn { border:0; cursor:pointer; border-radius:8px; padding:7px 10px; font-weight:700;
               font-size:12px; color:#fff; flex:1; }
        .play { background:#16a34a; } .stop { background:#dc2626; }
        .muted { opacity:.6; } .warn { color:#fca5a5; font-size:11px; margin-top:6px; }
        .hint { opacity:.7; font-size:11px; }
        .switch { background:#374151; }
        .hide { display:none; }
      </style>
      <div class="box">
        <div class="row" style="justify-content:space-between;">
          <span class="src" id="src">Atividade</span>
          <span class="timer hide" id="timer">00:00</span>
        </div>
        <div class="title" id="title">—</div>
        <div class="row" style="margin-top:8px;">
          <button class="btn play hide" id="play">▶ Iniciar</button>
          <button class="btn switch hide" id="switch">▶ Trocar p/ esta</button>
          <button class="btn stop hide" id="stop">■ Parar</button>
        </div>
        <div class="warn hide" id="warn"></div>
        <div class="hint hide" id="hint"></div>
      </div>`;
    els = {
      src: sh.getElementById("src"),
      timer: sh.getElementById("timer"),
      title: sh.getElementById("title"),
      play: sh.getElementById("play"),
      switch: sh.getElementById("switch"),
      stop: sh.getElementById("stop"),
      warn: sh.getElementById("warn"),
      hint: sh.getElementById("hint"),
    };
    els.play.addEventListener("click", () => startCurrent());
    els.switch.addEventListener("click", () => startCurrent());
    els.stop.addEventListener("click", () => stopRunning());
    root = host;
  }

  const SRC_LABEL = { trello: "Trello", azure: "Azure DevOps", gmail: "Gmail", outlook: "Outlook" };

  function render() {
    ensureUI();
    const show = (el, on) => el.classList.toggle("hide", !on);
    els.warn.classList.add("hide");

    const runningHere = sameItem(running, current);
    // Título exibido: o que está rodando (se houver) tem prioridade visual.
    const display = running || current;
    els.src.textContent = display ? SRC_LABEL[display.fonte] || "Atividade" : "Atividade";
    els.title.textContent = display ? display.titulo : "Abra um card ou e-mail";

    show(els.timer, !!running);
    show(els.stop, !!running);
    show(els.play, !running && !!current);
    // Rodando OUTRO item e há item detectável aqui → oferecer troca.
    show(els.switch, !!running && !runningHere && !!current);

    if (running && !runningHere && current) {
      els.hint.textContent = "Cronometrando outra atividade.";
      show(els.hint, true);
    } else if (!running && !current) {
      els.hint.textContent = "Nenhum item reconhecido nesta tela.";
      show(els.hint, true);
    } else {
      show(els.hint, false);
    }

    if (running) els.timer.textContent = fmtElapsed(running.inicio);
  }

  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (running) els.timer.textContent = fmtElapsed(running.inicio);
      else stopTick();
    }, 1000);
  }
  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function showWarn(msg) {
    ensureUI();
    els.warn.textContent = msg;
    els.warn.classList.remove("hide");
  }

  // ---- Comunicação com o background -------------------------------------
  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          void chrome.runtime.lastError; // ignora "context invalidated"
          resolve(resp || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function refreshState() {
    const resp = await send({ type: "ACTIVITY_STATE" });
    running = resp && resp.running ? resp.running : null;
    if (running) startTick();
    else stopTick();
    render();
  }

  async function startCurrent() {
    if (!current) return;
    showWarn(""); // limpa
    els.warn.classList.add("hide");
    const resp = await send({ type: "ACTIVITY_START", payload: current });
    if (resp && resp.ok && resp.running) {
      running = resp.running;
      startTick();
      render();
    } else {
      const msg = (resp && resp.error) || "Falha ao iniciar.";
      showWarn(/ativo/i.test(msg) ? "Inicie o expediente (ATIVO) para apontar." : msg);
    }
  }

  async function stopRunning() {
    const resp = await send({ type: "ACTIVITY_STOP" });
    if (!resp || resp.ok) {
      running = null;
      stopTick();
      render();
    }
  }

  // ---- Detecção de navegação SPA (re-detecta o item) ---------------------
  function rescan() {
    const next = detectItem();
    // Só re-renderiza quando o item muda (evita churn em mutações de DOM).
    if (sameItem(next, current) && !!next === !!current) {
      if (next && current && next.titulo === current.titulo) return;
    }
    current = next;
    render();
  }

  let rescanTimer = null;
  function scheduleRescan() {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(rescan, 400);
  }

  function hookHistory() {
    const wrap = (name) => {
      const orig = history[name];
      history[name] = function () {
        const r = orig.apply(this, arguments);
        scheduleRescan();
        return r;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", scheduleRescan);
    window.addEventListener("hashchange", scheduleRescan);
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }
    ensureUI();
    rescan();
    refreshState();
    hookHistory();
    // Conteúdo dos SPAs carrega tarde — observa o DOM para atualizar o título.
    const mo = new MutationObserver(scheduleRescan);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("focus", refreshState);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshState();
    });
  }

  init();
})();
