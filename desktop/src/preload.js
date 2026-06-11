const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getUser: () => ipcRenderer.invoke("auth:get-user"),
  login: (email, password) => ipcRenderer.invoke("auth:login", { email, password }),
  logout: () => ipcRenderer.invoke("auth:logout"),
  start: () => ipcRenderer.invoke("monitor:start"),
  stop: () => ipcRenderer.invoke("monitor:stop"),
  status: () => ipcRenderer.invoke("monitor:status"),
  getAutoLaunch: () => ipcRenderer.invoke("autolaunch:get"),
  setAutoLaunch: (v) => ipcRenderer.invoke("autolaunch:set", v),
  onStatus: (cb) => ipcRenderer.on("status", (_e, s) => cb(s)),
});
