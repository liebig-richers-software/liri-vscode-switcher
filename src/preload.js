const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("switcher", {
    getConfig: () => ipcRenderer.invoke("get-config"),
    focusProject: (id) => ipcRenderer.invoke("focus-project", id),
    openConfig: () => ipcRenderer.invoke("open-config"),
    checkActiveWindow: () => ipcRenderer.invoke("check-active-window"),
    onActiveWindow: (cb) => ipcRenderer.on("active-window", (_, title) => cb(title)),
    onConfigUpdated: (cb) => ipcRenderer.on("config-updated", (_, cfg) => cb(cfg)),
    onFocusResult: (cb) => ipcRenderer.on("focus-result", (_, result) => cb(result)),
    setIgnoreMouse: (ignore) => ipcRenderer.send("set-ignore-mouse", ignore),
    moveWindow: (y) => ipcRenderer.send("move-window", y),
    saveWindowY: (y) => ipcRenderer.send("save-window-y", y),
    resizeWindow: (h) => ipcRenderer.send("resize-window", h),
    openConfigWindow: (prefill) => ipcRenderer.invoke("open-config-window", prefill),
    focusWindowByTitle: (title) => ipcRenderer.invoke("focus-window-by-title", title),
    moveToTop: () => ipcRenderer.send("move-to-top"),
});
