const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getUser: () => ipcRenderer.invoke("auth:get-user"),
  login: (email, password) => ipcRenderer.invoke("auth:login", { email, password }),
  logout: () => ipcRenderer.invoke("auth:logout"),
  status: () => ipcRenderer.invoke("monitor:status"),
  // Controles de jornada (a monitoração é sempre ligada enquanto logado).
  transition: (status, observacao) =>
    ipcRenderer.invoke("session:transition", { status, observacao }),
  stopJourney: () => ipcRenderer.invoke("session:stop"),
  today: () => ipcRenderer.invoke("session:today"),
  openPortal: () => ipcRenderer.invoke("open:portal"),
  getAutoLaunch: () => ipcRenderer.invoke("autolaunch:get"),
  setAutoLaunch: (v) => ipcRenderer.invoke("autolaunch:set", v),
  onStatus: (cb) => ipcRenderer.on("status", (_e, s) => cb(s)),
});
