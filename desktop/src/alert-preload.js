const { contextBridge, ipcRenderer } = require("electron");

// Bridge mínima para o popup "sessão perdida / voltar ao trabalho".
contextBridge.exposeInMainWorld("alertApi", {
  // Retomar/reiniciar o expediente (abre status ATIVO; passa pelo gate de
  // monitoração do backend). Retorna { ok } ou { error } para a UI exibir.
  action: () => ipcRenderer.invoke("alert:action"),
  // Fechar o popup sem agir.
  dismiss: () => ipcRenderer.invoke("alert:dismiss"),
  // Recebe o tipo do popup: "inactive" (retomar) | "lost" (reiniciar).
  onKind: (cb) => ipcRenderer.on("alert:kind", (_e, kind) => cb(kind)),
});
