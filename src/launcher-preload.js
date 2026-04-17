const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
    getConfig: () => ipcRenderer.invoke("get-config"),
    checkActiveWindow: () => ipcRenderer.invoke("check-active-window"),
    launchProject: (id) => ipcRenderer.invoke("launch-project", id),
    focusProject: (id) => ipcRenderer.invoke("focus-project", id),
    close: () => ipcRenderer.send("close-launcher-window"),
    onActiveWindow: (cb) => ipcRenderer.on("active-window", (_, data) => cb(data)),
    onConfigUpdated: (cb) => ipcRenderer.on("config-updated", (_, cfg) => cb(cfg)),
});
