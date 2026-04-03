const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("configUI", {
    getConfig: () => ipcRenderer.invoke("get-config"),
    saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
    onConfigUpdated: (cb) => ipcRenderer.on("config-updated", (_, cfg) => cb(cfg)),
    onPrefillProject: (cb) => ipcRenderer.on("prefill-project", (_, data) => cb(data)),
    closeWindow: () => ipcRenderer.send("close-config-window"),
    selectFolder: () => ipcRenderer.invoke("select-folder"),
});
