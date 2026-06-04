const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiawd", {
  connect: (config) => ipcRenderer.invoke("aiawd:connect", config),
  disconnect: () => ipcRenderer.invoke("aiawd:disconnect"),
  listTargets: () => ipcRenderer.invoke("aiawd:listTargets"),
  listRooms: () => ipcRenderer.invoke("aiawd:listRooms"),
  createRoom: (room) => ipcRenderer.invoke("aiawd:createRoom", room),
  joinRoom: (request) => ipcRenderer.invoke("aiawd:joinRoom", request),
  startMatch: (request) => ipcRenderer.invoke("aiawd:startMatch", request),
  markTargetReady: (request) => ipcRenderer.invoke("aiawd:markTargetReady", request),
  markAgentReady: (request) => ipcRenderer.invoke("aiawd:markAgentReady", request),
  submitFlag: (request) => ipcRenderer.invoke("aiawd:submitFlag", request),
  runTargetAction: (request) => ipcRenderer.invoke("aiawd:targetAction", request),
  snapshot: () => ipcRenderer.invoke("aiawd:snapshot"),
  onMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("aiawd:message", listener);
    return () => ipcRenderer.removeListener("aiawd:message", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("aiawd:status", listener);
    return () => ipcRenderer.removeListener("aiawd:status", listener);
  },
});
