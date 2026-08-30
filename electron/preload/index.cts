import { contextBridge, ipcRenderer, webFrame } from "electron";

contextBridge.exposeInMainWorld("oscode", {
  platform: process.platform,
  setDirtyState: (dirty: boolean) => ipcRenderer.send("app:set-dirty", dirty),
  setAppAttentionBadge: (count: number, kind: string) =>
    ipcRenderer.invoke("app:set-attention-badge", count, kind),
  confirmDiscardChanges: (detail: string) =>
    ipcRenderer.invoke("dialog:confirm-discard", detail),
  ensureChatWorkspace: () => ipcRenderer.invoke("workspace:ensure"),
  listArtifacts: (kind?: string) => ipcRenderer.invoke("artifact:list", kind),
  readArtifact: (id: string) => ipcRenderer.invoke("artifact:read", id),
  saveArtifact: (artifact: unknown) =>
    ipcRenderer.invoke("artifact:save", artifact),
  deleteArtifact: (id: string) => ipcRenderer.invoke("artifact:delete", id),
  exportArtifact: (artifact: unknown, format: string) =>
    ipcRenderer.invoke("artifact:export", artifact, format),
  openProject: () => ipcRenderer.invoke("project:open"),
  openProjectPath: (path: string) =>
    ipcRenderer.invoke("project:open-path", path),
  closeProject: () => ipcRenderer.invoke("project:close"),
  refreshProject: () => ipcRenderer.invoke("project:refresh"),
  searchProject: (query: string) => ipcRenderer.invoke("project:search", query),
  listDirectory: (path: string) =>
    ipcRenderer.invoke("project:list-directory", path),
  createProjectItem: (directory: string, name: string, kind: string) =>
    ipcRenderer.invoke("project:create-item", directory, name, kind),
  renameProjectItem: (path: string, name: string) =>
    ipcRenderer.invoke("project:rename-item", path, name),
  trashProjectItem: (path: string, hasUnsavedChanges = false) =>
    ipcRenderer.invoke("project:trash-item", path, hasUnsavedChanges),
  loadPreferences: () => ipcRenderer.invoke("preferences:get"),
  savePreferences: (preferences: unknown) =>
    ipcRenderer.invoke("preferences:set", preferences),
  openSecureData: () => ipcRenderer.invoke("app:open-secure-data"),
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke("app:open-external-url", url),
  websiteIcon: (url: string) => ipcRenderer.invoke("web:site-icon", url),
  listMcpServers: () => ipcRenderer.invoke("mcp:list-servers"),
  saveMcpServer: (server: unknown) =>
    ipcRenderer.invoke("mcp:save-server", server),
  removeMcpServer: (id: string) => ipcRenderer.invoke("mcp:remove-server", id),
  onPreferencesChanged: (callback: (preferences: unknown) => void) => {
    const listener = (_event: unknown, preferences: unknown) =>
      callback(preferences);
    ipcRenderer.on("preferences:changed", listener);
    return () => ipcRenderer.removeListener("preferences:changed", listener);
  },
  appUpdateStatus: () => ipcRenderer.invoke("updates:status"),
  setAppAutoUpdate: (enabled: boolean) =>
    ipcRenderer.invoke("updates:set-enabled", enabled),
  checkForAppUpdate: () => ipcRenderer.invoke("updates:check"),
  downloadAppUpdate: () => ipcRenderer.invoke("updates:download"),
  installAppUpdate: () => ipcRenderer.invoke("updates:install"),
  onAppUpdateStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("updates:status-changed", listener);
    return () => ipcRenderer.removeListener("updates:status-changed", listener);
  },
  setZoomFactor: (factor: number) =>
    webFrame.setZoomFactor(Math.max(1, Math.min(1.7, Number(factor) || 1))),
  platformioState: () => ipcRenderer.invoke("platformio:state"),
  platformioBoards: (query?: string) =>
    ipcRenderer.invoke("platformio:boards", query),
  installPlatformio: () => ipcRenderer.invoke("platformio:install"),
  updatePlatformio: () => ipcRenderer.invoke("platformio:update"),
  setPlatformioAutoUpdate: (enabled: boolean) =>
    ipcRenderer.invoke("platformio:set-auto-update", enabled),
  initializePlatformio: (board: string, framework: string) =>
    ipcRenderer.invoke("platformio:initialize", board, framework),
  runPlatformio: (action: string, environment: string) =>
    ipcRenderer.invoke("platformio:run", action, environment),
  stopPlatformio: () => ipcRenderer.invoke("platformio:stop"),
  writePlatformio: (data: string) =>
    ipcRenderer.invoke("platformio:input", data),
  onPlatformioOutput: (callback: (data: string) => void) => {
    const listener = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on("platformio:output", listener);
    return () => ipcRenderer.removeListener("platformio:output", listener);
  },
  onPlatformioState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("platformio:state-changed", listener);
    return () =>
      ipcRenderer.removeListener("platformio:state-changed", listener);
  },
  listAiModels: () => ipcRenderer.invoke("ai:list-models"),
  aiHardwareProfile: () => ipcRenderer.invoke("ai:hardware-profile"),
  installAiCudaSupport: () => ipcRenderer.invoke("ai:install-cuda-support"),
  downloadOsCodeModel: (tier: string) =>
    ipcRenderer.invoke("ai:download-oscode-model", tier),
  aiAgentState: () => ipcRenderer.invoke("ai:agent-state"),
  createAiChat: (title?: string) => ipcRenderer.invoke("ai:create-chat", title),
  saveAiChat: (id: string, messages: unknown, contextSummary: string) =>
    ipcRenderer.invoke("ai:save-chat", id, messages, contextSummary),
  updateAiChatMetadata: (id: string, metadata: unknown) =>
    ipcRenderer.invoke("ai:update-chat-metadata", id, metadata),
  deleteAiChat: (id: string) => ipcRenderer.invoke("ai:delete-chat", id),
  setAiGoal: (chatId: string, text: string, automatic = false) =>
    ipcRenderer.invoke("ai:set-goal", chatId, text, automatic),
  completeAiGoal: (id: string) => ipcRenderer.invoke("ai:complete-goal", id),
  removeAiGoal: (id: string) => ipcRenderer.invoke("ai:remove-goal", id),
  addAiQueue: (chatId: string, prompt: string, runAt?: string) =>
    ipcRenderer.invoke("ai:add-queue", chatId, prompt, runAt),
  updateAiQueue: (id: string, status: string) =>
    ipcRenderer.invoke("ai:update-queue", id, status),
  prioritizeAiQueue: (id: string) =>
    ipcRenderer.invoke("ai:prioritize-queue", id),
  removeAiQueue: (id: string) => ipcRenderer.invoke("ai:remove-queue", id),
  addAiSchedule: (
    chatId: string,
    prompt: string,
    nextRunAt: string,
    cadence: string,
  ) =>
    ipcRenderer.invoke("ai:add-schedule", chatId, prompt, nextRunAt, cadence),
  removeAiSchedule: (id: string) =>
    ipcRenderer.invoke("ai:remove-schedule", id),
  collectDueAiSchedules: () => ipcRenderer.invoke("ai:collect-due"),
  grantAiPermission: (
    kind: string,
    scope: string,
    chatId: string,
    detail: string,
  ) => ipcRenderer.invoke("ai:grant-permission", kind, scope, chatId, detail),
  revokeAiPermission: (id: string) =>
    ipcRenderer.invoke("ai:revoke-permission", id),
  chooseAiModel: (engine: string, kind?: "file" | "folder" | "any") =>
    ipcRenderer.invoke("ai:choose-model", engine, kind),
  updateAiModelContext: (id: string, contextLimit: number) =>
    ipcRenderer.invoke("ai:update-model-context", id, contextLimit),
  removeAiModel: (id: string) => ipcRenderer.invoke("ai:remove-model", id),
  chooseAiExecutable: (engine: string) =>
    ipcRenderer.invoke("ai:choose-executable", engine),
  downloadAiModel: (engine: string, source: string) =>
    ipcRenderer.invoke("ai:download-model", engine, source),
  ollamaCliStatus: () => ipcRenderer.invoke("ai:ollama-cli-status"),
  installOllamaCli: () => ipcRenderer.invoke("ai:install-ollama-cli"),
  prepareAiEngine: (engine: string) =>
    ipcRenderer.invoke("ai:prepare-engine", engine),
  aiChat: (request: unknown) => ipcRenderer.invoke("ai:chat", request),
  stopAgentControl: () => ipcRenderer.invoke("agent:stop-control"),
  agentBrowserSnapshot: () => ipcRenderer.invoke("agent:browser-snapshot"),
  showAgentBrowser: () => ipcRenderer.invoke("agent:browser-show"),
  stopCurrentActivity: () => ipcRenderer.invoke("activity:stop"),
  onAgentActivity: (callback: (activity: unknown) => void) => {
    const listener = (_event: unknown, activity: unknown) => callback(activity);
    ipcRenderer.on("agent:activity", listener);
    return () => ipcRenderer.removeListener("agent:activity", listener);
  },
  onAiPipelineState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("ai:pipeline-state", listener);
    return () => ipcRenderer.removeListener("ai:pipeline-state", listener);
  },
  resolveAiEdits: (ids: string[], approve: boolean) =>
    ipcRenderer.invoke("ai:resolve-edits", ids, approve),
  listAiHistory: () => ipcRenderer.invoke("ai:list-history"),
  revertAiHistory: (id: string) => ipcRenderer.invoke("ai:revert-history", id),
  stopAi: () => ipcRenderer.invoke("ai:stop"),
  onAiStatus: (callback: (status: string) => void) => {
    const listener = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on("ai:status", listener);
    return () => ipcRenderer.removeListener("ai:status", listener);
  },
  onAiAction: (callback: (action: unknown) => void) => {
    const listener = (_event: unknown, action: unknown) => callback(action);
    ipcRenderer.on("ai:action", listener);
    return () => ipcRenderer.removeListener("ai:action", listener);
  },
  setSpellcheck: (enabled: boolean) =>
    ipcRenderer.invoke("spellcheck:set", enabled),
  onSpellcheckReplaceAll: (
    callback: (word: string, replacement: string) => void,
  ) => {
    const listener = (_event: unknown, word: string, replacement: string) =>
      callback(word, replacement);
    ipcRenderer.on("spellcheck:replace-all", listener);
    return () => ipcRenderer.removeListener("spellcheck:replace-all", listener);
  },
  exportDiagram: (action: string, format: string, data: string) =>
    ipcRenderer.invoke("diagram:export", action, format, data),
  readMarkdownImage: (markdownPath: string, source: string) =>
    ipcRenderer.invoke("markdown:read-image", markdownPath, source),
  openProjectFile: (path: string) => ipcRenderer.invoke("file:open", path),
  readFile: (path: string) => ipcRenderer.invoke("file:read", path),
  writeFile: (path: string, content: string, source = "manual") =>
    ipcRenderer.invoke("file:write", path, content, source),
  listSaveHistory: (path: string) =>
    ipcRenderer.invoke("file:history-list", path),
  restoreSaveHistory: (path: string, id: string) =>
    ipcRenderer.invoke("file:history-restore", path, id),
  onProjectFileChanged: (callback: (change: unknown) => void) => {
    const listener = (_event: unknown, change: unknown) => callback(change);
    ipcRenderer.on("project:file-changed", listener);
    return () => ipcRenderer.removeListener("project:file-changed", listener);
  },
  gitState: () => ipcRenderer.invoke("git:state"),
  gitRun: (action: string, payload?: string) =>
    ipcRenderer.invoke("git:run", action, payload),
  deleteRepository: () => ipcRenderer.invoke("git:delete-repository"),
  absorbSubmodule: (path: string) =>
    ipcRenderer.invoke("git:absorb-submodule", path),
  createTerminal: (id: string, interpreter?: string) =>
    ipcRenderer.invoke("terminal:create", id, interpreter),
  terminalWrite: (id: string, data: string) =>
    ipcRenderer.send("terminal:write", id, data),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("terminal:resize", id, cols, rows),
  terminalDispose: (id: string) => ipcRenderer.invoke("terminal:dispose", id),
  onTerminalData: (callback: (id: string, data: string) => void) => {
    const listener = (_event: unknown, id: string, data: string) =>
      callback(id, data);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  listPython: () => ipcRenderer.invoke("python:list"),
  getProjectPython: () => ipcRenderer.invoke("python:get-selection"),
  setProjectPython: (interpreter: string) =>
    ipcRenderer.invoke("python:set-selection", interpreter),
  choosePython: () => ipcRenderer.invoke("python:choose"),
  installPython: (version: string) =>
    ipcRenderer.invoke("python:install", version),
  createVenv: (interpreter: string, name?: string) =>
    ipcRenderer.invoke("python:create-venv", interpreter, name),
  listPythonPackages: (interpreter: string) =>
    ipcRenderer.invoke("python:list-packages", interpreter),
  installPythonPackage: (interpreter: string, packageSpec: string) =>
    ipcRenderer.invoke("python:install-package", interpreter, packageSpec),
  uninstallPythonPackage: (interpreter: string, packageName: string) =>
    ipcRenderer.invoke("python:uninstall-package", interpreter, packageName),
  runPython: (file: string, interpreter: string, debug?: boolean) =>
    ipcRenderer.invoke("python:run", file, interpreter, debug),
  stopPython: () => ipcRenderer.invoke("python:stop"),
  writePython: (data: string) => ipcRenderer.invoke("python:input", data),
  onRunData: (callback: (data: string) => void) => {
    const listener = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on("run:data", listener);
    return () => ipcRenderer.removeListener("run:data", listener);
  },
  onRunStopped: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("run:stopped", listener);
    return () => ipcRenderer.removeListener("run:stopped", listener);
  },
  onPythonEnvironmentChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("python:environment-changed", listener);
    return () =>
      ipcRenderer.removeListener("python:environment-changed", listener);
  },
  onMenuAction: (callback: (action: string) => void) => {
    const listener = (_event: unknown, action: string) => callback(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
});
