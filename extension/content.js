// Content script: roda nas páginas do app, repassa heartbeats da extensão
// (que sabe se há atividade em outras abas / o sistema está ativo) para a
// página, evitando que o app marque inatividade indevida.
(function () {
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "EXT_HEARTBEAT") {
        window.postMessage(
          { source: "monitor-atividade", type: "HEARTBEAT", ts: Date.now() },
          window.location.origin
        );
      }
    });
    // Anuncia presença para o background empurrar um heartbeat imediato.
    chrome.runtime.sendMessage({ type: "PAGE_READY" });
  } catch (_) { /* contexto invalidado */ }
})();
