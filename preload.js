const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
    expandWindow: () => ipcRenderer.send("panel:expand"),
    collapseWindow: () => ipcRenderer.send("panel:collapse"),
    resizeWindowBy: (delta) => ipcRenderer.send("panel:resize-by", delta),
    onPanelState: (callback) => ipcRenderer.on("panel:state", (_event, state) => callback(state)),
    movePanelBy: (delta) => ipcRenderer.send("panel:move-by", delta),
    showContextMenu: () => ipcRenderer.send("panel:context-menu"),
    showPanel: () => ipcRenderer.send("panel:show"),
    hidePanel: () => ipcRenderer.send("panel:hide"),
    scanApps: () => ipcRenderer.invoke("apps:scan"),
    classifyApps: (apps) => ipcRenderer.invoke("ai:classify-apps", apps),
    planTodos: (todos) => ipcRenderer.invoke("ai:plan-todos", todos),
    getAIConfig: () => ipcRenderer.invoke("ai:get-config"),
    saveAIConfig: (config) => ipcRenderer.invoke("ai:save-config", config),
    testAIConfig: (config) => ipcRenderer.invoke("ai:test-config", config),
    todoChat: (payload) => ipcRenderer.invoke("ai:todo-chat", payload),
    launchApp: (target) => ipcRenderer.invoke("apps:launch", target),
    openStartupFolder: () => ipcRenderer.invoke("startup:open"),
    getStartupEnabled: () => ipcRenderer.invoke("startup:get"),
    setStartupEnabled: (enabled) => ipcRenderer.invoke("startup:set", enabled)
    ,chooseDocument: () => ipcRenderer.invoke("document:choose")
    ,openDocument: (filePath) => ipcRenderer.invoke("document:open", filePath)
    ,loadTodoFile: () => ipcRenderer.invoke("todos:load-file")
    ,saveTodoFile: (payload) => ipcRenderer.invoke("todos:save-file", payload)
    ,openTodoFile: () => ipcRenderer.invoke("todos:open-file")
    ,openTodoViewer: () => ipcRenderer.send("todos:open-viewer")
    ,quit: () => ipcRenderer.send("panel:quit")
});
