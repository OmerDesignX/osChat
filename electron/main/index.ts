import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  nativeImage,
  protocol,
  session,
  shell,
  type MenuItemConstructorOptions,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import path from "node:path";
import crypto from "node:crypto";
import { lstatSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import * as pty from "node-pty";
import type {
  AiChatMessage,
  AiChatResponse,
  AiEngine,
  AiModel,
  AiPipelineState,
  GitCommit,
  GitState,
  TreeEntry,
} from "../types.js";
import { LocalAiService } from "./ai.js";
import { AgentControlService } from "./agent-control.js";
import { parseGitStatus, parseTracking } from "./git-status.js";
import { PlatformioService } from "./platformio.js";
import { defaultPreferences, validPreferences } from "./preferences.js";
import { guardBrokenOutputPipe } from "./process-output.js";
import { AppUpdateService } from "./updater.js";
import { SaveHistoryStore } from "./save-history.js";
import { McpClientService } from "./mcp-client.js";
import { assertReceiveOnlyPublicUrl } from "./outbound-guard.js";
import { fetchPublicSiteIcon } from "./web-search.js";
import {
  appLocalKeyProtector,
  archiveLegacySecureStore,
  processKeyProtector,
  SecureDataStore,
  type KeyProtector,
} from "./secure-store.js";
import {
  setPythonSelection,
  validPythonSelections,
} from "./python-selections.js";
import {
  pythonBytecodeCacheRoot,
  pythonRuntimeEnvironment,
} from "./python-environment.js";
import {
  decodeTextFile,
  validateGitBranch,
  validateGitRemote,
  validateTerminalId,
  validateTerminalInput,
  validateTextContent,
  validTerminalSize,
} from "./security.js";
import {
  projectMediaType,
  validateProjectMedia,
  type ProjectMediaKind,
} from "./media-preview.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "oscode-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const exec = promisify(execFile);
guardBrokenOutputPipe(process.stdout);
guardBrokenOutputPipe(process.stderr);
let mainWindow: BrowserWindow | null = null;
let projectRoot = "";
type WindowContext = {
  projectRoot: string;
  dirty: boolean;
  restoreLastProject: boolean;
  allowClose: boolean;
  confirmOpen: boolean;
};
const windowContexts = new Map<number, WindowContext>();
const projectWatchers = new Map<number, FSWatcher>();
type MediaPreviewEntry = {
  file: string;
  root: string;
  ownerId: number;
  kind: ProjectMediaKind;
  mimeType: string;
  createdAt: number;
};
const mediaPreviewEntries = new Map<string, MediaPreviewEntry>();
type AppAttentionKind = "response" | "permission" | "input";
type AppAttentionBadge = { count: number; kind: AppAttentionKind };
const appAttentionBadges = new Map<number, AppAttentionBadge>();
let aiProjectRoot = "";
let aiExecutionOwner: WebContents | null = null;
let aiExecutionTail: Promise<void> = Promise.resolve();
type AiPipelineEntry = {
  id: number;
  senderId: number;
  projectRoot: string;
  projectName: string;
  chatId: string;
  state: "waiting" | "running";
};
let aiPipelineSequence = 0;
const aiPipelineEntries: AiPipelineEntry[] = [];
const aiProjectContexts = new AsyncLocalStorage<string>();
const terminals = new Map<string, pty.IPty>();
const terminalOwners = new Map<string, WebContents>();
const terminalDisposals = new Map<string, Promise<void>>();
let runningScript: ReturnType<typeof spawn> | null = null;
let runningScriptOwner: WebContents | null = null;
let aiService: LocalAiService;
let agentControlService: AgentControlService;
let platformioService: PlatformioService;
let appUpdateService: AppUpdateService;
let secureStore: SecureDataStore;
let saveHistoryStore: SaveHistoryStore;
let mcpClientService: McpClientService;
let runningDebug = false;
let quittingAfterCleanup = false;
let rendererHasUnsavedChanges = false;
let closeConfirmationOpen = false;
let spellcheckEnabled = true;
let aiDisposePromise: Promise<void> | null = null;
function sendToRenderer(channel: string, ...args: unknown[]) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  )
    return;
  mainWindow.webContents.send(channel, ...args);
}
function broadcastToRenderers(channel: string, ...args: unknown[]) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(channel, ...args);
  }
}
function broadcastToAiProject(
  targetRoot: string,
  channel: string,
  ...args: unknown[]
) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    const contextRoot = windowContexts.get(window.webContents.id)?.projectRoot;
    if (contextRoot === targetRoot) window.webContents.send(channel, ...args);
  }
}
function attentionOverlay(kind: AppAttentionKind, count: number) {
  const fill = kind === "permission" ? "#f4b860" : "#89cff0";
  const label = count > 9 ? "9+" : String(count);
  const fontSize = count > 9 ? 8 : 11;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fill}" stroke="#071b25" stroke-width="2"/><text x="16" y="20" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#071b25">${label}</text></svg>`;
  return nativeImage
    .createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    )
    .resize({ width: 16, height: 16 });
}
function updateApplicationAttentionBadge() {
  const entries = [...appAttentionBadges.values()].filter(
    (entry) => entry.count > 0,
  );
  const count = Math.min(
    99,
    entries.reduce((total, entry) => total + entry.count, 0),
  );
  const kind: AppAttentionKind = entries.some(
    (entry) => entry.kind === "permission",
  )
    ? "permission"
    : entries.some((entry) => entry.kind === "input")
      ? "input"
      : "response";
  if (process.platform === "win32") {
    const overlay = count ? attentionOverlay(kind, count) : null;
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed())
        window.setOverlayIcon(
          overlay,
          count ? `${count} osChat notification${count === 1 ? "" : "s"}` : "",
        );
    return;
  }
  try {
    app.setBadgeCount(count);
  } catch {
    if (process.platform === "darwin" && app.dock)
      app.dock.setBadge(count ? String(count) : "");
  }
}
function activateSender(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && !window.isDestroyed()) mainWindow = window;
  const context = windowContexts.get(event.sender.id);
  if (context) projectRoot = context.projectRoot;
  return context;
}
function setSenderProject(event: IpcMainInvokeEvent, root: string) {
  const context = activateSender(event);
  for (const [token, entry] of mediaPreviewEntries)
    if (entry.ownerId === event.sender.id) mediaPreviewEntries.delete(token);
  if (context) context.projectRoot = root;
  projectRoot = root;
  startProjectWatcher(event.sender, root);
}
function startProjectWatcher(sender: WebContents, root: string) {
  projectWatchers.get(sender.id)?.close();
  projectWatchers.delete(sender.id);
  if (!root || sender.isDestroyed()) return;
  const pending = new Map<string, NodeJS.Timeout>();
  try {
    const watcher = watch(root, { recursive: true }, (kind, filename) => {
      if (!filename || sender.isDestroyed()) return;
      const relative = String(filename).replace(/\\/g, "/");
      if (
        !relative ||
        relative
          .split("/")
          .some((part) =>
            [
              ".git",
              ".oscode",
              ".venv",
              "venv",
              "env",
              "__pycache__",
              "node_modules",
              "build",
              "coverage",
              "dist",
              "release",
            ].includes(part),
          )
      )
        return;
      const target = path.resolve(root, relative);
      const check = path.relative(root, target);
      if (check.startsWith("..") || path.isAbsolute(check)) return;
      const previous = pending.get(target);
      if (previous) clearTimeout(previous);
      pending.set(
        target,
        setTimeout(async () => {
          pending.delete(target);
          const exists = await fs
            .stat(target)
            .then((entry) => entry.isFile())
            .catch(() => false);
          if (!sender.isDestroyed())
            sender.send("project:file-changed", { path: target, kind, exists });
        }, 90),
      );
    });
    watcher.on("close", () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    });
    watcher.on("error", () => watcher.close());
    projectWatchers.set(sender.id, watcher);
  } catch {
    // Manual refresh remains available if a host filesystem cannot be watched.
  }
}
function currentAiProjectRoot() {
  return aiProjectContexts.getStore() || aiProjectRoot || projectRoot;
}
function withSenderAiProject<T>(event: IpcMainInvokeEvent, operation: () => T) {
  const context = activateSender(event);
  return aiProjectContexts.run(context?.projectRoot || "", operation);
}
function aiPipelineStateFor(senderId: number): AiPipelineState {
  const running = aiPipelineEntries.find((entry) => entry.state === "running");
  const waiting = aiPipelineEntries.filter(
    (entry) => entry.state === "waiting",
  );
  const senderRoot = windowContexts.get(senderId)?.projectRoot || "";
  const ownRunning =
    running &&
    (running.senderId === senderId ||
      (senderRoot !== "" && running.projectRoot === senderRoot))
      ? running
      : undefined;
  if (ownRunning)
    return {
      state: "running",
      label: `AI is working in ${ownRunning.projectName}`,
      position: 0,
      activeProject: ownRunning.projectName,
      activeChatId: ownRunning.chatId,
    };
  const ownRequest = waiting.find(
    (entry) =>
      entry.senderId === senderId ||
      (senderRoot !== "" && entry.projectRoot === senderRoot),
  );
  if (ownRequest) {
    const position = waiting.indexOf(ownRequest) + 1;
    return {
      state: "waiting",
      label: running
        ? `Waiting for AI in ${running.projectName} to finish · position ${position}`
        : `Waiting for the shared AI pipeline · position ${position}`,
      position,
      activeProject: running?.projectName || "",
      activeChatId: ownRequest.chatId,
    };
  }
  return {
    state: "idle",
    label: "",
    position: 0,
    activeProject: running?.projectName || "",
    activeChatId: "",
  };
}
function publishAiPipelineStates() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(
      "ai:pipeline-state",
      aiPipelineStateFor(window.webContents.id),
    );
  }
}
async function persistAiResponse(request: unknown, response: AiChatResponse) {
  if (!request || typeof request !== "object") return;
  const input = request as { chatId?: unknown; messages?: unknown };
  const chatId =
    typeof input.chatId === "string" ? input.chatId.trim().slice(0, 100) : "";
  if (!chatId) return;
  const retained = Array.isArray(response.retainedMessages)
    ? response.retainedMessages
    : Array.isArray(input.messages)
      ? (input.messages as AiChatMessage[])
      : [];
  const assistant: AiChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: response.content,
    thinking: response.thinking,
    actions: response.actions,
    createdAt: new Date().toISOString(),
  };
  await aiService.saveChat(
    chatId,
    [...retained, assistant],
    response.contextSummary,
  );
}
function queueAiRequest(event: IpcMainInvokeEvent, request: unknown) {
  const context = activateSender(event);
  const requestedRoot = context?.projectRoot || "";
  const projectName = requestedRoot ? path.basename(requestedRoot) : "project";
  const chatId =
    request &&
    typeof request === "object" &&
    typeof (request as { chatId?: unknown }).chatId === "string"
      ? (request as { chatId: string }).chatId.slice(0, 100)
      : "";
  const entry: AiPipelineEntry = {
    id: ++aiPipelineSequence,
    senderId: event.sender.id,
    projectRoot: requestedRoot,
    projectName,
    chatId,
    state: "waiting",
  };
  aiPipelineEntries.push(entry);
  publishAiPipelineStates();
  const run = aiExecutionTail.then(async () => {
    try {
      entry.state = "running";
      aiProjectRoot = requestedRoot;
      aiExecutionOwner = event.sender.isDestroyed() ? null : event.sender;
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      if (ownerWindow && !ownerWindow.isDestroyed()) mainWindow = ownerWindow;
      publishAiPipelineStates();
      const response = await aiProjectContexts.run(requestedRoot, () =>
        aiService.chat(request),
      );
      await persistAiResponse(request, response).catch((error) =>
        console.error("Could not persist the completed AI response", error),
      );
      broadcastToAiProject(requestedRoot, "ai:chat-complete", chatId);
      return response;
    } finally {
      aiProjectRoot = "";
      if (aiExecutionOwner?.id === entry.senderId) aiExecutionOwner = null;
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !focused.isDestroyed()) {
        mainWindow = focused;
        projectRoot =
          windowContexts.get(focused.webContents.id)?.projectRoot || "";
      }
      const index = aiPipelineEntries.findIndex((item) => item.id === entry.id);
      if (index >= 0) aiPipelineEntries.splice(index, 1);
      publishAiPipelineStates();
    }
  });
  aiExecutionTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
const managedPythonVersions = ["3.10", "3.11", "3.12", "3.13", "3.14"];
type ProductivityArtifactKind = "document" | "spreadsheet" | "presentation";
type ProductivityArtifact = {
  id: string;
  kind: ProductivityArtifactKind;
  title: string;
  folder: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  data: unknown;
};
const artifactKinds = new Set<ProductivityArtifactKind>([
  "document",
  "spreadsheet",
  "presentation",
]);
const artifactFolders: Record<ProductivityArtifactKind, string> = {
  document: "Documents",
  spreadsheet: "Spreadsheets",
  presentation: "Presentations",
};
function chatWorkspaceRoot() {
  return path.join(app.getPath("userData"), "workspace");
}
function artifactId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,80}$/.test(id))
    throw new Error("Invalid artifact identifier");
  return id;
}
function artifactKind(value: unknown) {
  if (!artifactKinds.has(value as ProductivityArtifactKind))
    throw new Error("Unsupported artifact type");
  return value as ProductivityArtifactKind;
}
function artifactTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "";
  return (title || "Untitled").replace(/[\u0000-\u001f]/g, "").slice(0, 160);
}
function artifactFolder(value: unknown) {
  return (typeof value === "string" ? value : "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 120);
}
function artifactFile(kind: ProductivityArtifactKind, id: string) {
  return path.join(
    chatWorkspaceRoot(),
    artifactFolders[kind],
    `${artifactId(id)}.oschat.json`,
  );
}
async function ensureChatWorkspaceFolders() {
  const root = chatWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  await Promise.all(
    Object.values(artifactFolders).map((folder) =>
      fs.mkdir(path.join(root, folder), { recursive: true }),
    ),
  );
  return fs.realpath(root);
}
async function readArtifactRecord(id: string) {
  const safeId = artifactId(id);
  for (const kind of artifactKinds) {
    const file = artifactFile(kind, safeId);
    const source = await fs.readFile(file, "utf8").catch(() => "");
    if (!source) continue;
    const parsed = JSON.parse(source) as ProductivityArtifact;
    if (parsed.id !== safeId || parsed.kind !== kind)
      throw new Error("Artifact metadata is invalid");
    return parsed;
  }
  throw new Error("That artifact no longer exists");
}
function plainArtifactText(value: unknown) {
  const source = typeof value === "string" ? value : "";
  return source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const smokeMarker = path.join(
  path.dirname(process.execPath),
  ".oschat-smoke-test",
);
const smokeMarkerReady = (() => {
  try {
    return lstatSync(smokeMarker).isFile();
  } catch {
    return false;
  }
})();
const smokeMode =
  smokeMarkerReady ||
  process.env.OSCODE_SMOKE_TEST === "1" ||
  process.argv.includes("smoke-test") ||
  process.argv.includes("--smoke-test") ||
  app.commandLine.hasSwitch("smoke-test");
if (smokeMode) {
  if (smokeMarkerReady) unlinkSync(smokeMarker);
  app.disableHardwareAcceleration();
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), `oschat-smoke-${process.pid}`),
  );
}
async function stopProjectProcesses() {
  for (const watcher of projectWatchers.values()) watcher.close();
  projectWatchers.clear();
  const child = runningScript;
  runningScript = null;
  runningScriptOwner = null;
  runningDebug = false;
  if (child) await terminateProcessTree(child);
  await aiService?.stop();
  await agentControlService?.stop();
  platformioService?.stop();
  await Promise.all([...terminals.keys()].map(disposeTerminal));
}

async function terminateProcessTree(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const terminator = spawn(
        "taskkill.exe",
        ["/pid", String(child.pid), "/t", "/f"],
        { stdio: "ignore", windowsHide: true },
      );
      terminator.once("error", () => {
        child.kill();
        resolve();
      });
      terminator.once("close", () => resolve());
    });
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 350)),
  ]);
  if (child.exitCode === null && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function disposeAiServiceSafely() {
  if (aiDisposePromise) return aiDisposePromise;
  aiDisposePromise = Promise.resolve()
    .then(() => aiService?.dispose())
    .catch(() => undefined);
  return aiDisposePromise;
}

async function disposeTerminal(id: string) {
  const pending = terminalDisposals.get(id);
  if (pending) {
    await pending;
    return;
  }
  const terminal = terminals.get(id);
  if (!terminal) return;
  const disposal = new Promise<void>((resolve) => {
    let forceTimeout: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimeout: ReturnType<typeof setTimeout> | undefined;
    let exited: ReturnType<typeof terminal.onExit> | undefined;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceTimeout) clearTimeout(forceTimeout);
      if (giveUpTimeout) clearTimeout(giveUpTimeout);
      exited?.dispose();
      resolve();
    };
    exited = terminal.onExit(finish);
    if (settled) exited?.dispose();
    try {
      terminal.write("exit\r");
    } catch {
      /* fall through to the forced shutdown */
    }
    forceTimeout = setTimeout(() => {
      try {
        terminal.kill();
      } catch {
        finish();
        return;
      }
      giveUpTimeout = setTimeout(finish, 500);
    }, 2_500);
  });
  terminalDisposals.set(id, disposal);
  try {
    await disposal;
    if (terminals.get(id) === terminal) {
      terminals.delete(id);
      terminalOwners.delete(id);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    terminalDisposals.delete(id);
  }
}

async function confirmDiscardChanges(detail: string) {
  const options = {
    type: "warning" as const,
    title: "Unsaved changes",
    message: "Discard unsaved changes?",
    detail,
    buttons: ["Keep editing", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

const ignored = new Set([
  ".git",
  ".oscode",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "release",
  ".next",
  "__pycache__",
]);
async function tree(dir: string): Promise<TreeEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !ignored.has(e.name) && !e.isSymbolicLink())
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .map((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory()
        ? { name: e.name, path: full, kind: "directory" as const }
        : { name: e.name, path: full, kind: "file" as const };
    });
}

async function searchProject(queryValue: unknown) {
  if (!projectRoot) throw new Error("Open a project first");
  if (typeof queryValue !== "string") throw new Error("Search text is invalid");
  const query = queryValue
    .replace(/[\r\n\0]/g, " ")
    .trim()
    .slice(0, 200);
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const results: Array<{
    path: string;
    relativePath: string;
    line: number;
    preview: string;
  }> = [];
  let visited = 0;
  const visit = async (directory: string) => {
    if (results.length >= 250 || visited >= 2_500) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= 250 || visited >= 2_500) break;
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.size > 2_000_000) continue;
      let content = "";
      try {
        content = decodeTextFile(await fs.readFile(full));
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (
        let index = 0;
        index < lines.length && results.length < 250;
        index += 1
      ) {
        if (!lines[index].toLocaleLowerCase().includes(needle)) continue;
        results.push({
          path: full,
          relativePath: path.relative(projectRoot, full).replace(/\\/g, "/"),
          line: index + 1,
          preview: lines[index].trim().slice(0, 240),
        });
      }
    }
  };
  await visit(projectRoot);
  return results;
}
function withinRoot(target: string) {
  const relative = path.relative(projectRoot, target);
  return (
    projectRoot && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
async function safeProjectPath(target: string) {
  if (!projectRoot) throw new Error("Open a project first");
  const [root, resolved] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(target),
  ]);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path is outside the project");
  return resolved;
}
async function safePathWithinRoot(rootPath: string, target: string) {
  const [root, resolved] = await Promise.all([
    fs.realpath(rootPath),
    fs.realpath(target),
  ]);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path is outside the project");
  return { root, resolved };
}
function mediaPreviewUrl(entry: Omit<MediaPreviewEntry, "createdAt">) {
  const owned = [...mediaPreviewEntries.entries()]
    .filter(([, item]) => item.ownerId === entry.ownerId)
    .sort((left, right) => left[1].createdAt - right[1].createdAt);
  for (const [token] of owned.slice(0, Math.max(0, owned.length - 127)))
    mediaPreviewEntries.delete(token);
  const token = crypto.randomBytes(24).toString("hex");
  mediaPreviewEntries.set(token, { ...entry, createdAt: Date.now() });
  return `oscode-media://preview/${token}/${encodeURIComponent(path.basename(entry.file))}`;
}
function mediaProtocolError(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
async function handleMediaPreviewRequest(request: Request) {
  if (!["GET", "HEAD"].includes(request.method))
    return mediaProtocolError(405, "Method not allowed");
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return mediaProtocolError(400, "Invalid media preview address");
  }
  if (parsed.hostname !== "preview")
    return mediaProtocolError(404, "Media preview not found");
  const token = parsed.pathname.split("/").filter(Boolean)[0] || "";
  const entry = mediaPreviewEntries.get(token);
  if (!entry || !windowContexts.has(entry.ownerId))
    return mediaProtocolError(404, "Media preview expired");
  try {
    const { resolved } = await safePathWithinRoot(entry.root, entry.file);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return mediaProtocolError(404, "Media file not found");
    const media = validateProjectMedia(resolved, stat.size);
    if (media.kind !== entry.kind || media.mimeType !== entry.mimeType)
      return mediaProtocolError(409, "Media file type changed");
    const forwarded = new Headers();
    const range = request.headers.get("range");
    if (range) forwarded.set("Range", range);
    const response = await net.fetch(pathToFileURL(resolved).toString(), {
      method: request.method,
      headers: forwarded,
    });
    const headers = new Headers(response.headers);
    headers.set("Content-Type", entry.mimeType);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    return mediaProtocolError(
      404,
      error instanceof Error ? error.message : "Media preview unavailable",
    );
  }
}
async function projectPrivateDirectory(parts: string[], create: boolean) {
  if (!projectRoot) throw new Error("Open a project first");
  const root = await fs.realpath(projectRoot);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const item = await fs.lstat(current).catch(() => null);
    if (!item) {
      if (!create) return "";
      await fs.mkdir(current);
    } else if (!item.isDirectory() || item.isSymbolicLink()) {
      throw new Error(`Project storage “${part}” must be a regular folder`);
    }
    const resolved = await fs.realpath(current);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Project storage is outside the project");
    current = resolved;
  }
  return current;
}
function projectItemName(input: string) {
  const name = input.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name)
  )
    throw new Error("Use a simple cross-platform file or folder name");
  return name;
}
let resolvedGitExecutable = "";
async function gitExecutable() {
  if (resolvedGitExecutable) return resolvedGitExecutable;
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.resourcesPath, "git", "cmd", "git.exe"),
          process.env.LOCALAPPDATA
            ? path.join(
                process.env.LOCALAPPDATA,
                "Programs",
                "Git",
                "cmd",
                "git.exe",
              )
            : "",
          process.env.ProgramFiles
            ? path.join(process.env.ProgramFiles, "Git", "cmd", "git.exe")
            : "",
        ].filter(Boolean)
      : process.platform === "darwin"
        ? [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
            "/usr/bin/git",
            "git",
          ]
        : ["/usr/bin/git", "/usr/local/bin/git", "git"];
  for (const candidate of candidates) {
    if (candidate === "git") return (resolvedGitExecutable = candidate);
    try {
      await fs.access(candidate);
      return (resolvedGitExecutable = candidate);
    } catch {
      /* try the next known local Git location */
    }
  }
  return (resolvedGitExecutable = "git");
}
async function executeGit(args: string[], cwd: string) {
  try {
    return await exec(await gitExecutable(), args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/ENOENT|not recognized|not found/i.test(message))
      throw new Error(
        "Git is unavailable. Reinstall osChat or install Git for this operating system.",
      );
    throw error;
  }
}
async function git(args: string[]) {
  return (await executeGit(args, projectRoot)).stdout.trim();
}
async function gitRaw(args: string[]) {
  return (await executeGit(args, projectRoot)).stdout;
}
async function ensureLocalGitIdentity() {
  const [name, email] = await Promise.all([
    git(["config", "--get", "user.name"]).catch(() => ""),
    git(["config", "--get", "user.email"]).catch(() => ""),
  ]);
  if (name && email) return;
  const account =
    (os.userInfo().username || "Local user")
      .replace(/[\r\n\0<>]/g, "")
      .trim()
      .slice(0, 80) || "Local user";
  const slug =
    account
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local-user";
  if (!name) await git(["config", "--local", "user.name", account]);
  if (!email)
    await git([
      "config",
      "--local",
      "user.email",
      `${slug}@users.noreply.local`,
    ]);
}
function emptyGitState(): GitState {
  return {
    initialized: false,
    branch: "",
    branches: [],
    remote: "",
    ahead: 0,
    behind: 0,
    userName: "",
    userEmail: "",
    submodules: [],
    stashes: [],
    tags: [],
    files: [],
    commits: [],
  };
}
async function gitState(): Promise<GitState> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository/i.test(message)) return emptyGitState();
    throw error;
  }
  let repositoryDetails: string[];
  try {
    repositoryDetails = await Promise.all([
      git(["branch", "--show-current"]).catch(() => ""),
      git(["branch", "--format=%(refname:short)"]).catch(() => ""),
      git(["remote", "get-url", "origin"]).catch(() => ""),
      gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
      git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(
        () => "",
      ),
      git([
        "config",
        "-f",
        ".gitmodules",
        "--get-regexp",
        "^submodule\..*\.(path|url)$",
      ]).catch(() => ""),
      git(["config", "--local", "--get", "user.name"]).catch(() => ""),
      git(["config", "--local", "--get", "user.email"]).catch(() => ""),
      git(["stash", "list", "--format=%gd%x09%s"]).catch(() => ""),
      git(["tag", "--list"]).catch(() => ""),
      git(["log", "-30", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"]).catch(
        () => "",
      ),
      git(["rev-list", "@{upstream}..HEAD"]).catch(() => ""),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not a git repository|cannot change to|ENOENT|no such file/i.test(message)
    )
      return emptyGitState();
    throw error;
  }
  const [
    branch,
    branchesRaw,
    remote,
    raw,
    tracking,
    subRaw,
    userName,
    userEmail,
    stashRaw,
    tagsRaw,
    commitsRaw,
    unpushedRaw,
  ] = repositoryDetails;
  const { behind, ahead } = parseTracking(tracking);
  const submoduleMap = new Map<string, { path: string; url: string }>();
  for (const line of subRaw.split("\n").filter(Boolean)) {
    const separator = line.indexOf(" ");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    const match = key.match(/^submodule\.(.+)\.(path|url)$/);
    if (!match) continue;
    const item = submoduleMap.get(match[1]) || { path: "", url: "" };
    item[match[2] as "path" | "url"] = value;
    submoduleMap.set(match[1], item);
  }
  const submodules = [...submoduleMap.values()].filter((item) => item.path);
  const branches = branchesRaw.split("\n").filter(Boolean);
  if (branch && !branches.includes(branch)) branches.unshift(branch);
  const unpushed = new Set(unpushedRaw.split("\n").filter(Boolean));
  const commits: GitCommit[] = commitsRaw
    .split("\n")
    .filter(Boolean)
    .map((line): GitCommit => {
      const [id, shortId, author, date, ...subject] = line.split("\x1f");
      return {
        id,
        shortId,
        author,
        date,
        subject: subject.join("\x1f"),
        state: !remote ? "local" : unpushed.has(id) ? "unpushed" : "pushed",
      };
    })
    .filter((item) => item.id && item.shortId);
  return {
    initialized: true,
    branch: branch || "detached",
    branches,
    remote,
    ahead,
    behind,
    userName,
    userEmail,
    submodules,
    stashes: stashRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, ...rest] = line.split("\t");
        return { ref, message: rest.join("\t") || ref };
      }),
    tags: tagsRaw.split("\n").filter(Boolean),
    files: parseGitStatus(raw),
    commits,
  };
}
type PythonRuntimeRecord = {
  version: string;
  path: string;
  installed: boolean;
  scope?: "app" | "app-project" | "project" | "system";
};
type PythonPackageRecord = {
  name: string;
  version: string;
  editableProjectLocation?: string;
};
function validPythonPackageName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name))
    throw new Error("Select a valid installed Python package");
  return name;
}
function validPythonPackageSpec(value: unknown) {
  const packageSpec = typeof value === "string" ? value.trim() : "";
  if (
    !packageSpec ||
    packageSpec.length > 200 ||
    packageSpec.startsWith("-") ||
    /[\u0000-\u001f\u007f\s]/.test(packageSpec)
  )
    throw new Error(
      "Enter one package name or version, for example requests==2.32.5",
    );
  return packageSpec;
}
const secureStatePath = (name: string) =>
  path.join(secureStore.root, "state", `${name}.oscode-data`);
const legacyStatePath = (name: string) =>
  path.join(app.getPath("userData"), `${name}.json`);
async function readPreferences() {
  return validPreferences(
    await secureStore.readJson(
      secureStatePath("preferences"),
      defaultPreferences,
      "preferences",
      legacyStatePath("preferences"),
    ),
  );
}
async function writePreferences(value: unknown) {
  const preferences = validPreferences(value);
  await secureStore.writeJson(
    secureStatePath("preferences"),
    preferences,
    "preferences",
  );
  return preferences;
}
async function inspectPython(requested: string) {
  if (!path.isAbsolute(requested))
    throw new Error("Select an absolute Python interpreter path");
  const executable = path.resolve(requested);
  if (!(await fs.stat(executable)).isFile())
    throw new Error("The Python interpreter is not a file");
  const marker = "__OSCODE_PYTHON__";
  const { stdout } = await exec(
    executable,
    [
      "-c",
      `import json,sys;print(${JSON.stringify(marker)}+json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable}))`,
    ],
    {
      timeout: 10_000,
      env: pythonRuntimeEnvironment(app.getPath("userData")),
    },
  );
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(marker));
  if (!line) throw new Error("The selected file is not a Python 3 interpreter");
  const details = JSON.parse(line.slice(marker.length)) as {
    version?: unknown;
    executable?: unknown;
  };
  if (
    !Array.isArray(details.version) ||
    details.version.length < 3 ||
    details.version[0] !== 3 ||
    details.version.some((part) => !Number.isInteger(part))
  )
    throw new Error(
      "The selected file is not a supported Python 3 interpreter",
    );
  const reported =
    typeof details.executable === "string" &&
    path.isAbsolute(details.executable)
      ? path.resolve(details.executable)
      : executable;
  await fs.access(reported);
  return {
    path: reported,
    fullVersion: details.version.slice(0, 3).join("."),
  };
}
async function customPythonList(): Promise<PythonRuntimeRecord[]> {
  const parsed = await secureStore.readJson<unknown>(
    secureStatePath("python-runtimes"),
    [],
    "python-runtimes",
    legacyStatePath("python-runtimes"),
  );
  if (!Array.isArray(parsed)) return [];
  const valid: PythonRuntimeRecord[] = [];
  for (const item of parsed) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.version !== "string" ||
      typeof item.path !== "string" ||
      !path.isAbsolute(item.path)
    )
      continue;
    try {
      const executable = await fs.realpath(item.path);
      valid.push({
        version: item.version,
        path: executable,
        installed: true,
        scope: "system",
      });
    } catch {
      /* ignore interpreters that were moved or removed */
    }
  }
  return valid;
}
async function saveCustomPython(runtimes: PythonRuntimeRecord[]) {
  await secureStore.writeJson(
    secureStatePath("python-runtimes"),
    runtimes,
    "python-runtimes",
  );
}
const managedPythonRoot = () => path.join(app.getPath("userData"), "python");
const uvCacheRoot = () => path.join(app.getPath("userData"), "uv-cache");
function uvEnvironment(extra: NodeJS.ProcessEnv = {}) {
  return {
    ...pythonRuntimeEnvironment(app.getPath("userData")),
    UV_CACHE_DIR: uvCacheRoot(),
    UV_LINK_MODE: "copy",
    UV_PYTHON_INSTALL_DIR: managedPythonRoot(),
    ...extra,
  };
}
function bundledToolPath(tool: "uv" | "python") {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, tool)
    : path.join(app.getAppPath(), "vendor", tool);
  return path.join(root, `${process.platform}-${process.arch}`);
}
async function executableFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const visit = async (directory: string, depth: number) => {
    if (depth > 6) return;
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate, depth + 1);
      else if (
        entry.isFile() &&
        (process.platform === "win32"
          ? /^python(?:3(?:\.\d+)?)?\.exe$/i.test(entry.name)
          : /^python3(?:\.\d+)?$/.test(entry.name))
      )
        results.push(candidate);
    }
  };
  await visit(root, 0);
  return results;
}
async function containedPythonList() {
  const results = new Map<string, PythonRuntimeRecord>();
  for (const root of [bundledToolPath("python"), managedPythonRoot()]) {
    for (const candidate of await executableFiles(root)) {
      try {
        const inspected = await inspectPython(candidate);
        const version = inspected.fullVersion.split(".").slice(0, 2).join(".");
        if (!results.has(version))
          results.set(version, {
            version,
            path: inspected.path,
            installed: true,
            scope: "app",
          });
      } catch {
        /* ignore helper executables and incomplete downloads */
      }
    }
  }
  return results;
}
async function uvExecutable() {
  const name = process.platform === "win32" ? "uv.exe" : "uv";
  const find = async (directory: string, depth = 0): Promise<string> => {
    if (depth > 3) return "";
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return "";
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === name) return candidate;
      if (entry.isDirectory()) {
        const nested = await find(candidate, depth + 1);
        if (nested) return nested;
      }
    }
    return "";
  };
  return (await find(bundledToolPath("uv"))) || "uv";
}
async function appProjectEnvironmentRoot(project = projectRoot) {
  if (!project) throw new Error("Open a project first");
  const root = await fs.realpath(project);
  const id = crypto
    .createHash("sha256")
    .update(root)
    .digest("hex")
    .slice(0, 32);
  return path.join(managedPythonRoot(), "project-environments", id);
}
async function appProjectEnvironmentInterpreter(project = projectRoot) {
  return path.join(
    await appProjectEnvironmentRoot(project),
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}
async function ownedProjectPythonEnvironment(
  interpreter: string,
  project = projectRoot,
) {
  if (!project) throw new Error("Open a project first");
  const inspected = await inspectPython(interpreter);
  const binaryDirectory = path.dirname(inspected.path);
  if (
    !["scripts", "bin"].includes(path.basename(binaryDirectory).toLowerCase())
  )
    throw new Error("Select a project environment before installing packages");
  const [root, environment, appEnvironment] = await Promise.all([
    fs.realpath(project),
    fs.realpath(path.dirname(binaryDirectory)),
    appProjectEnvironmentRoot(project),
  ]);
  const relative = path.relative(root, environment);
  const insideProject =
    !relative.startsWith("..") && !path.isAbsolute(relative);
  const insideAppData =
    path.resolve(environment) === path.resolve(appEnvironment);
  if (!insideProject && !insideAppData)
    throw new Error(
      "Select this project's app environment or a project-local environment",
    );
  return {
    inspected,
    environment,
    location: insideProject ? ("project" as const) : ("app" as const),
  };
}
async function projectEnvironmentInterpreters(project = projectRoot) {
  if (!project) return [];
  const root = await fs.realpath(project);
  const executable =
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const candidates = [
    path.join(root, ".venv", executable),
    path.join(root, "venv", executable),
    path.join(root, "env", executable),
  ];
  const namedRoot = path.join(root, ".oscode", "envs");
  const named = await fs
    .readdir(namedRoot, { withFileTypes: true })
    .catch(() => []);
  for (const entry of named
    .filter((item) => item.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name)))
    candidates.push(path.join(namedRoot, entry.name, executable));
  return candidates;
}
async function existingProjectPythonEnvironment(
  interpreter = "",
  project = projectRoot,
) {
  if (interpreter) {
    try {
      return await ownedProjectPythonEnvironment(interpreter, project);
    } catch {
      // A bundled or system interpreter is a valid base, but not the place
      // where a project's packages should be installed.
    }
  }
  const candidates = [await appProjectEnvironmentInterpreter(project)];
  if (!interpreter)
    candidates.push(...(await projectEnvironmentInterpreters(project)));
  for (const candidate of candidates) {
    try {
      return await ownedProjectPythonEnvironment(candidate, project);
    } catch {
      /* continue through common and named project environments */
    }
  }
  return null;
}
async function rememberProjectPython(
  interpreter: string,
  project = projectRoot,
) {
  if (!project) return;
  const root = await fs.realpath(project);
  await savePythonSelections(
    setPythonSelection(await readPythonSelections(), root, interpreter),
  );
}
async function createProjectPythonEnvironment(
  baseInterpreter: string,
  destination: string,
  project = projectRoot,
) {
  if (!project) throw new Error("Open a project first");
  const base = await inspectPython(baseInterpreter);
  await fs.mkdir(uvCacheRoot(), { recursive: true });
  await exec(
    await uvExecutable(),
    ["venv", "--python", base.path, "--seed", destination],
    {
      cwd: project,
      timeout: 10 * 60_000,
      env: uvEnvironment({ UV_PYTHON_DOWNLOADS: "never" }),
    },
  );
  const python = path.join(
    destination,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  return ownedProjectPythonEnvironment(python, project);
}
async function ensureProjectPythonEnvironment(
  interpreter: string,
  project = projectRoot,
) {
  const existing = await existingProjectPythonEnvironment(interpreter, project);
  if (existing) {
    await rememberProjectPython(existing.inspected.path, project);
    return { ...existing, created: false };
  }
  if (!project) throw new Error("Open a project first");
  if (!interpreter)
    throw new Error("Select an installed or bundled Python interpreter first");
  const destination = await appProjectEnvironmentRoot(project);
  if (await fs.lstat(destination).catch(() => null))
    throw new Error(
      "The app-managed environment is incomplete. Rename it from application data before trying again.",
    );
  try {
    const created = await createProjectPythonEnvironment(
      interpreter,
      destination,
      project,
    );
    await rememberProjectPython(created.inspected.path, project);
    return { ...created, location: "app" as const, created: true };
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}
async function preferredProjectPythonInterpreter(project = projectRoot) {
  if (!project) throw new Error("Open a project first");
  const root = await fs.realpath(project);
  const selected = (await readPythonSelections())[root];
  if (selected) {
    try {
      return (await inspectPython(selected)).path;
    } catch {
      // Fall back to the bundled runtime if the saved interpreter moved.
    }
  }
  const contained = await containedPythonList();
  const bundled =
    contained.get("3.12")?.path || [...contained.values()][0]?.path;
  if (!bundled) throw new Error("The bundled Python runtime is unavailable");
  return bundled;
}
async function installProjectPythonPackages(
  interpreter: string,
  requestedPackages: unknown[],
  project = projectRoot,
) {
  if (!requestedPackages.length || requestedPackages.length > 16)
    throw new Error("Choose between 1 and 16 Python packages to install");
  const packages = requestedPackages.map(validPythonPackageSpec);
  const baseInterpreter =
    interpreter || (await preferredProjectPythonInterpreter(project));
  const { inspected, environment, created } =
    await ensureProjectPythonEnvironment(baseInterpreter, project);
  await fs.mkdir(uvCacheRoot(), { recursive: true });
  const result = await exec(
    await uvExecutable(),
    ["pip", "install", "--python", inspected.path, ...packages],
    {
      cwd: project,
      timeout: 10 * 60_000,
      env: uvEnvironment({
        VIRTUAL_ENV: environment,
        UV_PROJECT_ENVIRONMENT: environment,
      }),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return {
    packages,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
    interpreter: inspected.path,
    createdEnvironment: created,
  };
}
async function readPythonSelections() {
  return validPythonSelections(
    await secureStore.readJson(
      secureStatePath("python-selections"),
      {},
      "python-selections",
      legacyStatePath("python-selections"),
    ),
  );
}
async function savePythonSelections(selections: Record<string, string>) {
  await secureStore.writeJson(
    secureStatePath("python-selections"),
    selections,
    "python-selections",
  );
}
function createWindow(show = true, restoreLastProject = true) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return mainWindow;
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: process.platform !== "darwin",
    show,
    backgroundColor: "#171819",
    icon: app.isPackaged
      ? undefined
      : path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  const webContentsId = window.webContents.id;
  mainWindow = window;
  windowContexts.set(webContentsId, {
    projectRoot: "",
    dirty: false,
    restoreLastProject,
    allowClose: false,
    confirmOpen: false,
  });
  window.on("focus", () => {
    mainWindow = window;
    projectRoot = windowContexts.get(webContentsId)?.projectRoot || "";
    if (process.platform === "win32") window.flashFrame(false);
  });
  window.webContents.session.setSpellCheckerLanguages(["en-US"]);
  // Never let an inherited environment variable redirect a packaged build.
  // Development URLs are accepted only while Electron itself is unpackaged.
  const devUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && agentControlService?.isActive()) {
      event.preventDefault();
      void agentControlService.stop();
    }
  });
  window.webContents.on("context-menu", (_event, params) => {
    if (!spellcheckEnabled || !params.misspelledWord) return;
    const word = params.misspelledWord;
    const suggestions = params.dictionarySuggestions.slice(0, 8);
    const template: MenuItemConstructorOptions[] = suggestions.map(
      (suggestion) => ({
        label: suggestion,
        click: () => window.webContents.replaceMisspelling(suggestion),
      }),
    );
    if (!suggestions.length)
      template.push({ label: "No suggestions", enabled: false });
    template.push(
      { type: "separator" },
      {
        label: "Replace all",
        enabled: suggestions.length > 0,
        submenu: suggestions.map((suggestion) => ({
          label: suggestion,
          click: () =>
            window.webContents.send("spellcheck:replace-all", word, suggestion),
        })),
      },
      {
        label: "Add to dictionary",
        click: () =>
          window.webContents.session.addWordToSpellCheckerDictionary(word),
      },
    );
    Menu.buildFromTemplate(template).popup({ window });
  });
  if (process.env.OSCODE_DEBUG_RENDERER === "1") {
    window.webContents.on("console-message", (_event, level, message) =>
      console.error(`[renderer:${level}] ${message}`),
    );
    window.webContents.on("did-fail-load", (_event, code, description) =>
      console.error(`[renderer-load:${code}] ${description}`),
    );
  }
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.on("close", (event) => {
    const context = windowContexts.get(webContentsId);
    if (
      process.platform === "darwin" &&
      !quittingAfterCleanup &&
      !context?.allowClose
    ) {
      event.preventDefault();
      window.hide();
      return;
    }
    if (quittingAfterCleanup || context?.allowClose || !context?.dirty) return;
    event.preventDefault();
    if (!context || context.confirmOpen) return;
    context.confirmOpen = true;
    void confirmDiscardChanges(
      "Closing osChat now will discard changes that have not been saved.",
    ).then((discard) => {
      context.confirmOpen = false;
      if (!discard || window.isDestroyed()) return;
      context.dirty = false;
      context.allowClose = true;
      window.close();
    });
  });
  window.on("closed", () => {
    const ownerId = webContentsId;
    for (const [token, entry] of mediaPreviewEntries)
      if (entry.ownerId === ownerId) mediaPreviewEntries.delete(token);
    projectWatchers.get(ownerId)?.close();
    projectWatchers.delete(ownerId);
    windowContexts.delete(ownerId);
    appAttentionBadges.delete(ownerId);
    updateApplicationAttentionBadge();
    rendererHasUnsavedChanges = [...windowContexts.values()].some(
      (item) => item.dirty,
    );
    for (const [id, owner] of terminalOwners) {
      if (owner.id === ownerId) void disposeTerminal(id);
    }
    if (runningScriptOwner?.id === ownerId) {
      if (runningScript) void terminateProcessTree(runningScript);
      runningScript = null;
      runningScriptOwner = null;
      runningDebug = false;
    }
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}
async function runLegacyIdeSmokeTest(window: BrowserWindow) {
  const configuredSmokeTimeout = Number(process.env.OSCODE_SMOKE_TIMEOUT_MS);
  const smokeTimeout =
    Number.isFinite(configuredSmokeTimeout) && configuredSmokeTimeout >= 120_000
      ? configuredSmokeTimeout
      : 120_000;
  const timeout = setTimeout(() => {
    console.error("osCode smoke failed: renderer startup timed out");
    app.exit(1);
  }, smokeTimeout);
  const smokeProject = path.join(app.getPath("userData"), "smoke-project");
  const smokeRemote = path.join(app.getPath("userData"), "smoke-remote.git");
  const smokeModuleSource = path.join(
    app.getPath("userData"),
    "smoke-module-source",
  );
  try {
    await fs.mkdir(smokeProject, { recursive: true });
    await fs.writeFile(
      path.join(smokeProject, "smoke.py"),
      "message = 'smoke_ready'\nprint(message)\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "README.md"),
      "# Smoke preview\n\n```mermaid\nflowchart LR\n  Edit --> Preview\n```\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "SmokeView.swift"),
      'import SwiftUI\n\nstruct SmokeView: View {\n  var body: some View { Text("SwiftUI ready") }\n}\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "agent-preview.html"),
      "<!doctype html><html><body><label>Test value<input placeholder=\"Test value\"></label><button onclick=\"document.querySelector('output').textContent='Browser test passed'\">Run test</button><output></output></body></html>",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "preview.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const smokeWav = Buffer.alloc(44 + 800);
    smokeWav.write("RIFF", 0);
    smokeWav.writeUInt32LE(smokeWav.length - 8, 4);
    smokeWav.write("WAVEfmt ", 8);
    smokeWav.writeUInt32LE(16, 16);
    smokeWav.writeUInt16LE(1, 20);
    smokeWav.writeUInt16LE(1, 22);
    smokeWav.writeUInt32LE(8_000, 24);
    smokeWav.writeUInt32LE(16_000, 28);
    smokeWav.writeUInt16LE(2, 32);
    smokeWav.writeUInt16LE(16, 34);
    smokeWav.write("data", 36);
    smokeWav.writeUInt32LE(800, 40);
    await fs.writeFile(path.join(smokeProject, "preview.wav"), smokeWav);
    await fs.writeFile(
      path.join(smokeProject, "preview.mp4"),
      Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex"),
    );
    const smokeGit = (args: string[]) => executeGit(args, smokeProject);
    try {
      await smokeGit(["init", "-b", "main"]);
    } catch {
      await smokeGit(["init"]);
      await smokeGit(["branch", "-M", "main"]);
    }
    await smokeGit(["config", "user.name", "osCode Smoke"]);
    await smokeGit(["config", "user.email", "smoke@oscode.local"]);
    await smokeGit(["add", "--", "smoke.py", "README.md", "SmokeView.swift"]);
    await smokeGit(["commit", "-m", "Initial smoke project"]);
    const moduleRoot = path.join(smokeProject, "vendor", "sample-module");
    await fs.mkdir(smokeModuleSource, { recursive: true });
    await fs.writeFile(
      path.join(smokeModuleSource, "module.py"),
      "value = 'absorbed'\n",
      "utf8",
    );
    const moduleGit = (args: string[]) => executeGit(args, smokeModuleSource);
    await moduleGit(["init"]);
    await moduleGit(["config", "user.name", "osCode Smoke"]);
    await moduleGit(["config", "user.email", "smoke@oscode.local"]);
    await moduleGit(["add", "--", "module.py"]);
    await moduleGit(["commit", "-m", "Create smoke module"]);
    const moduleCommit = (await moduleGit(["rev-parse", "HEAD"])).stdout.trim();
    await smokeGit(["fetch", smokeModuleSource, "HEAD"]);
    await fs.mkdir(path.dirname(moduleRoot), { recursive: true });
    await executeGit(["clone", smokeModuleSource, moduleRoot], smokeProject);
    const managedModuleGit = path.join(
      smokeProject,
      ".git",
      "modules",
      "vendor",
      "sample-module",
    );
    await fs.mkdir(path.dirname(managedModuleGit), { recursive: true });
    await fs.rename(path.join(moduleRoot, ".git"), managedModuleGit);
    await fs.writeFile(
      path.join(moduleRoot, ".git"),
      "gitdir: ../../.git/modules/vendor/sample-module\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, ".gitmodules"),
      '[submodule "vendor/sample-module"]\n\tpath = vendor/sample-module\n\turl = https://example.invalid/sample-module.git\n',
      "utf8",
    );
    await smokeGit(["add", "--", ".gitmodules"]);
    await smokeGit([
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      moduleCommit,
      "vendor/sample-module",
    ]);
    await smokeGit(["commit", "-m", "Add smoke submodule"]);
    await executeGit(["init", "--bare", smokeRemote], smokeProject);
    const smokeRemoteUrl = pathToFileURL(smokeRemote).toString();
    const contents = window.webContents;
    if (contents.isLoadingMainFrame()) {
      await new Promise<void>((resolve, reject) => {
        const loaded = () => {
          contents.removeListener("did-fail-load", failed);
          resolve();
        };
        const failed = (
          _event: Electron.Event,
          code: number,
          description: string,
        ) => {
          contents.removeListener("did-finish-load", loaded);
          reject(new Error(`renderer load failed (${code}): ${description}`));
        };
        contents.once("did-finish-load", loaded);
        contents.once("did-fail-load", failed);
      });
    }
    const result = (await contents.executeJavaScript(`(async () => {
      const waitFor = async (check, label, timeout = 60000) => {
        // A cold Intel package can need extra time to initialize Monaco under Rosetta.
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = check();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const openAiPopup = async (buttonLabel, check, label) => {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const button = document.querySelector(
            '[aria-label="' + buttonLabel + '"]'
          );
          if (!button) throw new Error('Missing ' + buttonLabel + ' button');
          button.click();
          try {
            return await waitFor(check, label, 5000);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      };
      const clickIconCenter = (root, label) => {
        const button = root.querySelector('[aria-label="' + label + '"]');
        const icon = button?.querySelector('svg');
        if (!button || !icon) throw new Error('Missing ' + label + ' icon');
        const bounds = icon.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2
        );
        const hitButton = hit?.closest?.('button');
        if (hitButton !== button)
          throw new Error(
            label +
              ' icon center is not inside its button target; hit=' +
              (hit?.tagName || 'none') +
              ':' +
              (hit?.getAttribute?.('aria-label') || hit?.className || '') +
              '; bounds=' +
              JSON.stringify({
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height
              })
          );
        hitButton.click();
        return true;
      };
      const bridgeReady =
        typeof window.oscode?.platform === 'string' &&
        typeof window.oscode?.confirmDiscardChanges === 'function' &&
        typeof window.oscode?.setDirtyState === 'function' &&
        typeof window.oscode?.openProject === 'function' &&
        typeof window.oscode?.createTerminal === 'function' &&
        typeof window.oscode?.gitRun === 'function' &&
        typeof window.oscode?.deleteRepository === 'function' &&
        typeof window.oscode?.listPython === 'function' &&
        typeof window.oscode?.getProjectPython === 'function' &&
        typeof window.oscode?.setProjectPython === 'function' &&
        typeof window.oscode?.loadPreferences === 'function' &&
        typeof window.oscode?.savePreferences === 'function' &&
        typeof window.oscode?.listSaveHistory === 'function' &&
        typeof window.oscode?.restoreSaveHistory === 'function' &&
        typeof window.oscode?.listMcpServers === 'function' &&
        typeof window.oscode?.saveMcpServer === 'function' &&
        typeof window.oscode?.removeMcpServer === 'function' &&
        typeof window.oscode?.onProjectFileChanged === 'function' &&
        typeof window.oscode?.appUpdateStatus === 'function' &&
        typeof window.oscode?.setAppAutoUpdate === 'function' &&
        typeof window.oscode?.checkForAppUpdate === 'function' &&
        typeof window.oscode?.downloadAppUpdate === 'function' &&
        typeof window.oscode?.installAppUpdate === 'function' &&
        typeof window.oscode?.listAiModels === 'function' &&
        typeof window.oscode?.removeAiModel === 'function' &&
        typeof window.oscode?.exportDiagram === 'function' &&
        typeof window.oscode?.openProjectFile === 'function' &&
        typeof window.oscode?.platformioState === 'function' &&
        typeof window.oscode?.installPlatformio === 'function' &&
        typeof window.oscode?.runPlatformio === 'function' &&
        typeof window.oscode?.stopPlatformio === 'function' &&
        typeof window.oscode?.aiChat === 'function' &&
        typeof window.oscode?.resolveAiEdits === 'function' &&
        typeof window.oscode?.stopAi === 'function' &&
        typeof window.oscode?.stopAgentControl === 'function' &&
        typeof window.oscode?.agentBrowserSnapshot === 'function' &&
        typeof window.oscode?.onAgentActivity === 'function' &&
        typeof window.oscode?.listPythonPackages === 'function' &&
        typeof window.oscode?.uninstallPythonPackage === 'function' &&
        typeof window.oscode?.closeProject === 'function';
      const keepUpdatesOff = await waitFor(
        () => [...document.querySelectorAll('.notification-choice button')].find(
          item => item.textContent.trim() === "Don't show again"
        ),
        'automatic update opt-in prompt'
      );
      keepUpdatesOff.click();
      const autoUpdatePromptReady = await waitFor(
        () => !document.querySelector('.notification-row.update-prompt'),
        'remember automatic update choice'
      );
      const aiHiddenAtBoot = !document.querySelector('.ai-panel');
      const pythonControlsBeforeFile = Boolean(
        document.querySelector('[aria-label="Python interpreter"]')
      );
      let file = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'smoke.py'
      );
      if (!file) {
        const startupControl = await waitFor(
          () => document.querySelector('[aria-label="Project folder path"]') ||
            [...document.querySelectorAll('.tree-row')].find(
              item => item.textContent.trim() === 'smoke.py'
            ),
          'project startup'
        );
        if (startupControl.matches?.('[aria-label="Project folder path"]')) {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
          ).set;
          setter.call(startupControl, ${JSON.stringify(smokeProject)});
          startupControl.dispatchEvent(new Event('input', { bubbles: true }));
          const open = [...document.querySelectorAll('button')].find(
            item => item.textContent.trim() === 'Open path'
          );
          open.click();
        }
        file = await waitFor(
          () => [...document.querySelectorAll('.tree-row')].find(
            item => item.textContent.trim() === 'smoke.py'
          ),
          'smoke project file'
        );
      }
      file.click();
      const editor = await waitFor(
        () => document.querySelector('.local-editor-host[data-oscode-ready="true"]'),
        'local Monaco editor'
      );
      const swiftFile = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'SmokeView.swift'
      );
      swiftFile.click();
      const swiftReady = await waitFor(
        () => editor.dataset.oscodeLanguage === 'swift',
        'Swift language detection'
      );
      const readme = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'README.md'
      );
      readme.click();
      const proseWrapDefault = await waitFor(
        () => editor.dataset.oscodeWordWrap === 'on',
        'default prose wrapping'
      );
      const markdownPreview = await waitFor(
        () => document.querySelector('.markdown-preview'),
        'Markdown preview'
      );
      const mermaidDiagram = await waitFor(
        () => markdownPreview.querySelector('.markdown-diagram-canvas svg'),
        'Mermaid diagram'
      );
      const markdownReady =
        Boolean(mermaidDiagram) &&
        [...markdownPreview.querySelectorAll('button')].some(
          button => button.textContent.trim() === 'Copy SVG'
        );
      const imageFile = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'preview.png'
      );
      imageFile.click();
      const previewImage = await waitFor(
        () => document.querySelector('.media-preview img'),
        'project image preview'
      );
      const imageMediaReady = await waitFor(
        () => previewImage.complete && previewImage.naturalWidth === 1,
        'decoded project image'
      );
      const audioMedia = await window.oscode.openProjectFile(
        ${JSON.stringify(path.join(smokeProject, "preview.wav"))}
      );
      const videoMedia = await window.oscode.openProjectFile(
        ${JSON.stringify(path.join(smokeProject, "preview.mp4"))}
      );
      const streamedMediaReady =
        audioMedia.kind === 'media' &&
        audioMedia.media.kind === 'audio' &&
        audioMedia.media.url.startsWith('oscode-media://preview/') &&
        videoMedia.kind === 'media' &&
        videoMedia.media.kind === 'video' &&
        videoMedia.media.url.startsWith('oscode-media://preview/');
      file.click();
      await waitFor(
        () => document.querySelector('[aria-label="Python interpreter"]'),
        'Python controls after Markdown preview'
      );
      const editorTabs = document.querySelector('.tabs');
      const tabCountBeforeClose = editorTabs.querySelectorAll('.tab').length;
      const fileTabCloseHitReady = clickIconCenter(
        editorTabs,
        'Close SmokeView.swift'
      );
      const fileTabCloseReady = await waitFor(
        () =>
          !document.querySelector('[aria-label="Close SmokeView.swift"]') &&
          editorTabs.querySelectorAll('.tab').length === tabCountBeforeClose - 1,
        'file tab close'
      );
      const gitBeforeAbsorb = await window.oscode.gitState();
      if (!gitBeforeAbsorb.submodules.some(
        item => item.path === 'vendor/sample-module'
      )) {
        throw new Error(
          'Smoke submodule was not detected: ' + JSON.stringify(gitBeforeAbsorb)
        );
      }
      const gitAfterAbsorb = await window.oscode.absorbSubmodule(
        'vendor/sample-module'
      );
      await window.oscode.gitRun('addAll');
      await window.oscode.gitRun('commit', 'Absorb smoke submodule');
      await window.oscode.gitRun('branchCreate', 'feature/smoke-controls');
      await window.oscode.createProjectItem(
        ${JSON.stringify(smokeProject)},
        'branch-smoke.txt',
        'file'
      );
      await window.oscode.writeFile(
        ${JSON.stringify(path.join(smokeProject, "branch-smoke.txt"))},
        'branch controls ready\\n'
      );
      const saveHistoryReady = (
        await window.oscode.listSaveHistory(
          ${JSON.stringify(path.join(smokeProject, "branch-smoke.txt"))}
        )
      ).length === 1;
      await window.oscode.gitRun('addAll');
      await window.oscode.gitRun('commit', 'Exercise branch controls');
      await window.oscode.gitRun('branchSwitch', 'main');
      await window.oscode.gitRun('merge', 'feature/smoke-controls');
      const branchState = await window.oscode.gitRun(
        'branchDelete',
        'feature/smoke-controls'
      );
      const gitWithRemote = await window.oscode.gitRun(
        'remote',
        ${JSON.stringify(smokeRemoteUrl)}
      );
      await window.oscode.gitRun('push');
      await window.oscode.gitRun('pull');
      const gitAfterSync = await window.oscode.gitState();
      const runtimeSelect = await waitFor(
        () => {
          const select = document.querySelector(
            '[aria-label="Python interpreter"]'
          );
          if (!select) return null;
          const options = [...select.options];
          const bundled = ['3.10', '3.11', '3.12'].every(version =>
            options.some(
              option =>
                option.textContent.includes(version) &&
                !option.value.startsWith('download:')
            )
          );
          const downloads = options.filter(option =>
            option.value.startsWith('download:')
          );
          return bundled && downloads.length >= 2 ? select : null;
        },
        'loaded Python controls'
      );
      const projectSelectionReady =
        typeof (await window.oscode.getProjectPython()) === 'string';
      const downloadOptions = [...runtimeSelect.options].filter(option =>
        option.value.startsWith('download:')
      );
      const containedBaseRuntimes = ['3.10', '3.11', '3.12'].every(version =>
        [...runtimeSelect.options].some(option =>
          option.textContent.includes(version) &&
          !option.value.startsWith('download:')
        )
      );
      const advancedButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Advanced'
      );
      advancedButton.click();
      const advancedDock = await waitFor(
        () => document.querySelector('.advanced-dock'),
        'advanced mode'
      );
      const mcpButton = [...advancedDock.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'MCP'
      );
      mcpButton.click();
      const mcpSettings = await waitFor(
        () => document.querySelector('.mcp-settings'),
        'MCP settings'
      );
      const savedMcp = await window.oscode.saveMcpServer({
        name: 'Smoke MCP',
        command: 'node',
        args: ['fixture.mjs'],
        enabled: false
      });
      const mcpServers = await window.oscode.listMcpServers();
      const mcpReady =
        mcpSettings.innerText.includes('local stdio MCP servers') &&
        mcpServers.some(server => server.id === savedMcp.id);
      await window.oscode.removeMcpServer(savedMcp.id);
      const advancedPanelWidth = advancedDock.getBoundingClientRect().width;
      const advancedCloseHitReady = clickIconCenter(
        advancedDock,
        'Close Advanced'
      );
      await waitFor(
        () => !document.querySelector('.advanced-dock'),
        'Advanced icon close'
      );
      const settingsButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Settings'
      );
      settingsButton.click();
      const settingsDock = await waitFor(
        () => document.querySelector('.settings-dock'),
        'settings panel'
      );
      const settingsPanelWidth = settingsDock.getBoundingClientRect().width;
      const themeLabels = [...settingsDock.querySelectorAll('.theme-choice button')]
        .map(button => button.textContent.trim());
      const themeChoicesReady =
        themeLabels.length === 3 &&
        ['Gunmetal + blue', 'Blue dark', 'Blue light'].every(label =>
          themeLabels.includes(label)
        );
      const proseWrapToggle = [...settingsDock.querySelectorAll('label')].find(
        item => item.querySelector('span')?.textContent.trim() === 'Wrap prose files'
      )?.querySelector('input');
      const proseWrapSettingReady =
        Boolean(proseWrapDefault) && Boolean(proseWrapToggle?.checked);
      const autosaveSettingReady = Boolean(
        [...settingsDock.querySelectorAll('label')].find(
          item => item.querySelector('span')?.textContent.trim() ===
            'Autosave edited files'
        )?.querySelector('input')?.checked
      );
      proseWrapToggle.click();
      await waitFor(() => !proseWrapToggle.checked, 'disable prose wrapping');
      proseWrapToggle.click();
      await waitFor(() => proseWrapToggle.checked, 'enable prose wrapping');
      const chatButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Chat'
      );
      chatButton.click();
      const aiPanel = await waitFor(
        () => document.querySelector('.ai-panel'),
        'AI panel after Chat is enabled'
      );
      const aiCapabilitiesDefaultOff = [
        'File access: off',
        'Web access: off',
        'Dedicated agent browser: off',
        'Terminal access: ask first',
        'Computer Control: off'
      ].every(label => aiPanel.querySelector('[aria-label="' + label + '"]'));
      const layoutSelect = [...settingsDock.querySelectorAll('label')].find(
        item => item.querySelector('span')?.textContent.trim() === 'Project and AI layout'
      )?.querySelector('select');
      layoutSelect.value = 'right';
      layoutSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const aiSwapReady = await waitFor(
        () => document.querySelector('.workspace.ai-left.sidebar-right'),
        'AI column swap'
      );
      layoutSelect.value = 'left';
      layoutSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const lightButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Blue light'
      );
      lightButton.click();
      const lightThemeReady = await waitFor(
        () => document.querySelector('.app.blue-light'),
        'light theme'
      );
      const platformioButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'PlatformIO'
      );
      platformioButton.click();
      const platformioDock = await waitFor(
        () => document.querySelector('.platformio-dock'),
        'PlatformIO panel'
      );
      const platformioState = await window.oscode.platformioState();
      const platformioReady =
        platformioState.telemetry === false &&
        platformioDock.innerText.includes('Install Core');
      platformioDock.querySelector('[aria-label="Close PlatformIO"]').click();
      settingsButton.click();
      const reopenedSettingsDock = await waitFor(
        () => document.querySelector('.settings-dock'),
        'reopened settings panel'
      );
      const settingsCloseHitReady = clickIconCenter(
        reopenedSettingsDock,
        'Close settings'
      );
      await waitFor(
        () => !document.querySelector('.settings-dock'),
        'settings icon close'
      );
      await openAiPopup(
        'Chats and tasks',
        () => document.querySelector('.ai-agent-popover'),
        'chat workspace popup'
      );
      await openAiPopup(
        'AI changes',
        () =>
          document.querySelector('.ai-history-popover') &&
          !document.querySelector('.ai-agent-popover'),
        'exclusive AI history popup'
      );
      await openAiPopup(
        'Permissions',
        () =>
          document.querySelector('.ai-permission-popover') &&
          !document.querySelector('.ai-history-popover'),
        'exclusive AI permissions popup'
      );
      const aiSettings = await openAiPopup(
        'AI settings',
        () => {
          const manager = document.querySelector('.ai-model-manager');
          return manager && !document.querySelector('.ai-permission-popover')
            ? manager
            : null;
        },
        'exclusive AI settings popup'
      );
      const aiSettingsPopover = aiSettings.closest('.ai-model-popover');
      const aiSettingsPanelWidth =
        aiSettingsPopover?.getBoundingClientRect().width || 0;
      const contextSelect = [...aiSettings.querySelectorAll('label')].find(
        item => item.querySelector('span')?.textContent.trim() === 'Context'
      )?.querySelector('select');
      const aiContextReady =
        Number(contextSelect?.value || 0) >= 8192 &&
        [...contextSelect.options].some(option => option.value === '262144');
      const aiModelSelected = await waitFor(
        () => document.querySelector('[data-ai-selected-model]')?.textContent.trim(),
        'automatic local model selection'
      );
      const aiSettingsCloseHitReady = clickIconCenter(
        aiSettingsPopover,
        'Close AI settings'
      );
      const aiPopupsExclusive = await waitFor(
        () =>
          !document.querySelector(
            '.ai-agent-popover, .ai-history-popover, .ai-permission-popover, .ai-model-manager'
          ),
        'AI popup close'
      );
      const terminalToggle = document.querySelector('.terminal-toggle');
      terminalToggle.click();
      const terminalPanel = await waitFor(
        () => document.querySelector('.terminal-panel'),
        'terminal panel'
      );
      const terminalPanelHeight = terminalPanel.getBoundingClientRect().height;
      const packageManagerButton = [...terminalPanel.querySelectorAll('button')]
        .find(item => item.textContent.trim() === 'Packages');
      packageManagerButton.click();
      const pythonPackageManagerReady = Boolean(await waitFor(
        () => document.querySelector('.python-package-manager'),
        'Python package manager'
      ));
      const packageInput = document.querySelector('[aria-label="Package to install"]');
      const packageAddButton = [...document.querySelectorAll('.python-package-manager button')]
        .find(item => item.textContent.trim() === 'Add');
      const packageList = document.querySelector('.python-package-list');
      const packageManagerText = document.querySelector('.python-package-manager')?.textContent || '';
      const pythonPackageInputReady = Boolean(
        packageInput && !packageInput.disabled && packageAddButton
      );
      const pythonPackageListReady = Boolean(
        packageList &&
        getComputedStyle(packageList).display === 'flex' &&
        getComputedStyle(packageList).flexDirection === 'column' &&
        getComputedStyle(packageList).overflowY === 'auto'
      );
      const pythonEnvironmentLocationReady =
        packageManagerText.includes('outside project') &&
        packageManagerText.includes('Create project .venv');
      if (packageInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        valueSetter?.call(packageInput, 'smoke-package');
        packageInput.dispatchEvent(new Event('input', { bubbles: true }));
        packageInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const pythonPackageAddReady = Boolean(await waitFor(
        () => packageAddButton && !packageAddButton.disabled,
        'Python package add control'
      ));
      const uvHelpButton = [...terminalPanel.querySelectorAll('button')]
        .find(item => item.textContent.trim() === 'UV help');
      uvHelpButton.click();
      const uvHelpbook = await waitFor(
        () => document.querySelector('.uv-helpbook'),
        'UV helpbook'
      );
      const uvEntries = [...uvHelpbook.querySelectorAll('article')];
      const uvBounds = uvHelpbook.getBoundingClientRect();
      const terminalBounds = terminalPanel.getBoundingClientRect();
      const uvHelpbookReady = Boolean(
        getComputedStyle(uvHelpbook).position === 'absolute' &&
        uvHelpbook.getBoundingClientRect().width >= 380 &&
        uvEntries.length >= 3 &&
        uvEntries[1].getBoundingClientRect().top > uvEntries[0].getBoundingClientRect().top &&
        uvBounds.top >= terminalBounds.top &&
        uvBounds.bottom <= terminalBounds.bottom
      );
      terminalToggle.click();
      await waitFor(
        () => !document.querySelector('.terminal-panel'),
        'terminal panel close'
      );
      await new Promise(resolve => setTimeout(resolve, 1200));
      const terminalId = 'smoke-' + Date.now();
      let terminalOutput = '';
      const stopListening = window.oscode.onTerminalData((id, data) => {
        if (id === terminalId) terminalOutput += data;
      });
      try {
        await window.oscode.createTerminal(terminalId);
        const command = window.oscode.platform === 'win32'
          ? 'Write-Output OSCODE_TERMINAL_READY\\r'
          : "printf 'OSCODE_TERMINAL_READY\\\\n'\\r";
        window.oscode.terminalWrite(terminalId, command);
        await waitFor(
          () => terminalOutput.includes('OSCODE_TERMINAL_READY'),
          'native terminal command'
        );
        window.oscode.terminalWrite(terminalId, 'exit\\r');
        await waitFor(
          () => terminalOutput.includes('[process exited'),
          'native terminal exit'
        );
      } finally {
        await window.oscode.terminalDispose(terminalId);
        stopListening();
      }
      return {
        title: document.title,
        rootReady: Boolean(document.querySelector('#root')?.children.length),
        brandReady: document.body.innerText.includes('osCode'),
        bridgeReady,
        autoUpdatePromptReady: Boolean(autoUpdatePromptReady),
        pythonControlsBeforeFile,
        projectReady: document.body.innerText.includes('smoke-project'),
        sidebarWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width || 0,
        editorReady: Boolean(editor),
        fileTabCloseReady: Boolean(
          fileTabCloseHitReady && fileTabCloseReady
        ),
        editorCommandsReady: (() => {
          const bar = document.querySelector('.editor-command-bar');
          const buttons = [...(bar?.querySelectorAll('button') || [])];
          if (!bar || buttons.length < 5) return false;
          const bounds = bar.getBoundingClientRect();
          return (
            getComputedStyle(bar).overflowX === 'auto' &&
            buttons.every(button => {
              const box = button.getBoundingClientRect();
              return box.height >= 32 && box.width >= 34;
            }) &&
            buttons[0].getBoundingClientRect().left >= bounds.left
          );
        })(),
        editorModelLength: Number(editor.dataset.oscodeModelLength || 0),
        markdownReady,
        imageMediaReady: Boolean(imageMediaReady),
        streamedMediaReady,
        swiftReady: Boolean(swiftReady),
        proseWrapSettingReady,
        pythonControlsReady: Boolean(runtimeSelect),
        projectSelectionReady,
        containedBaseRuntimes,
        directRuntimeDownloads: downloadOptions.length >= 2 && downloadOptions.every(
          option => !option.disabled
        ),
        gitSubmoduleDetected: gitBeforeAbsorb.submodules.some(
          item =>
            item.path === 'vendor/sample-module' &&
            item.url === 'https://example.invalid/sample-module.git'
        ),
        gitSubmoduleAbsorbed:
          gitAfterAbsorb.submodules.length === 0 &&
          gitAfterAbsorb.files.some(file =>
            file.path === 'vendor/sample-module/module.py'
          ),
        gitLocalIdentityReady:
          Boolean(gitAfterSync.userName) && Boolean(gitAfterSync.userEmail),
        gitBranchesReady:
          branchState.branch === 'main' &&
          !branchState.branches.includes('feature/smoke-controls'),
        gitRemoteReady: gitWithRemote.remote === ${JSON.stringify(smokeRemoteUrl)},
        gitSyncReady:
          gitAfterSync.files.length === 0 &&
          gitAfterSync.ahead === 0 &&
          gitAfterSync.behind === 0,
        advancedReady: Boolean(advancedDock),
        mcpReady,
        settingsReady: Boolean(settingsDock),
        utilityPanelGeometryReady:
          advancedPanelWidth >= 480 &&
          settingsPanelWidth >= 480 &&
          aiSettingsPanelWidth >= 480 &&
          Math.abs(advancedPanelWidth - settingsPanelWidth) <= 2 &&
          Math.abs(settingsPanelWidth - aiSettingsPanelWidth) <= 2,
        closeIconHitTargetsReady:
          advancedCloseHitReady &&
          settingsCloseHitReady &&
          aiSettingsCloseHitReady,
        autosaveSettingReady,
        saveHistoryReady,
        themeChoicesReady,
        platformioReady,
        aiPanelReady:
          Boolean(aiPanel) &&
          aiPanel.getBoundingClientRect().width >= 280 &&
          Boolean(aiSwapReady) &&
          (await window.oscode.listAiModels()).length >= 0,
        aiHiddenAtBoot,
        aiCapabilitiesDefaultOff,
        aiPopupsExclusive: Boolean(aiPopupsExclusive),
        aiContextReady: Boolean(aiContextReady),
        aiModelSelected: Boolean(aiModelSelected),
        lightThemeReady: Boolean(lightThemeReady),
        terminalPanelHeight,
        pythonPackageManagerReady,
        pythonPackageInputReady,
        pythonPackageAddReady,
        pythonPackageListReady,
        pythonEnvironmentLocationReady,
        uvHelpbookReady,
        terminalReady: terminalOutput.includes('OSCODE_TERMINAL_READY')
      };
    })().catch(error => ({
      smokeError: String(error?.stack || error)
    }))`)) as Record<string, unknown>;
    sendToRenderer("agent:activity", {
      kind: "computer",
      label: "Computer Control · test app · accessibility · Esc to stop",
      active: true,
      network: false,
      target: "test app",
      mode: "background",
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    result.globalSearchLayout = await contents.executeJavaScript(`(async () => {
      const toggle = document.querySelector('[aria-label="Open search"]');
      toggle?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const search = document.querySelector('.global-search')?.getBoundingClientRect();
      const status = document.querySelector('.top-status')?.getBoundingClientRect();
      const bar = document.querySelector('.topbar')?.getBoundingClientRect();
      const actions = document.querySelector('.top-actions')?.getBoundingClientRect();
      const activityStrip = document.querySelector(
        '.global-activity-strip[data-horizontal-menu]'
      );
      const nonDownloadProgressHidden = Boolean(
        status && !document.querySelector('.top-status [role="progressbar"]')
      );
      const actionControl = document
        .querySelector('.top-actions .runtime-select, .top-actions .icon-button')
        ?.getBoundingClientRect();
      const controlHeights = [
        ...document.querySelectorAll('.top-actions .icon-button, .top-actions .runtime-select'),
        ...document.querySelectorAll('.editor-command-bar button'),
        ...document.querySelectorAll('.terminal-tabs button')
      ].map(item => Math.round(item.getBoundingClientRect().height)).filter(Boolean);
      const terminalSessionHeights = [...document.querySelectorAll('.terminal-session-control')]
        .map(item => Math.round(item.getBoundingClientRect().height));
      const horizontalMenu = document.querySelector('.top-actions[data-horizontal-menu]');
      let globalActivityScrollReady = false;
      if (activityStrip instanceof HTMLElement) {
        const originalWidth = activityStrip.style.width;
        const originalMaxWidth = activityStrip.style.maxWidth;
        const originalScrollBehavior = activityStrip.style.scrollBehavior;
        activityStrip.style.width = '360px';
        activityStrip.style.maxWidth = '360px';
        activityStrip.style.scrollBehavior = 'auto';
        activityStrip.scrollLeft = 0;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const activityOverflows =
          activityStrip.scrollWidth > activityStrip.clientWidth + 1;
        activityStrip.scrollLeft = 160;
        await new Promise(resolve => requestAnimationFrame(resolve));
        globalActivityScrollReady = Boolean(
          activityOverflows &&
          activityStrip.scrollLeft > 0 &&
          getComputedStyle(activityStrip).overflowX === 'auto'
        );
        activityStrip.style.width = originalWidth;
        activityStrip.style.maxWidth = originalMaxWidth;
        activityStrip.style.scrollBehavior = originalScrollBehavior;
        activityStrip.scrollLeft = 0;
      }
      let horizontalMenuScrollReady = false;
      if (horizontalMenu instanceof HTMLElement) {
        const originalWidth = horizontalMenu.style.width;
        const originalMaxWidth = horizontalMenu.style.maxWidth;
        const originalScrollBehavior = horizontalMenu.style.scrollBehavior;
        horizontalMenu.style.width = '300px';
        horizontalMenu.style.maxWidth = '300px';
        horizontalMenu.style.scrollBehavior = 'auto';
        horizontalMenu.scrollLeft = 0;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const menuControlHeights = [...horizontalMenu.querySelectorAll('button')]
          .map(item => Math.round(item.getBoundingClientRect().height));
        const menuOverflows = horizontalMenu.scrollWidth > horizontalMenu.clientWidth + 1;
        horizontalMenu.scrollLeft = 140;
        await new Promise(resolve => requestAnimationFrame(resolve));
        horizontalMenuScrollReady = Boolean(
          menuOverflows &&
          horizontalMenu.scrollLeft > 0 &&
          getComputedStyle(horizontalMenu).overflowX === 'auto' &&
          menuControlHeights.length >= 4 &&
          menuControlHeights.every(height => height >= 40)
        );
        horizontalMenu.style.width = originalWidth;
        horizontalMenu.style.maxWidth = originalMaxWidth;
        horizontalMenu.style.scrollBehavior = originalScrollBehavior;
        horizontalMenu.scrollLeft = 0;
      }
      return {
        ready: Boolean(
        toggle && search && status && actions && actionControl && bar &&
        bar.height >= 64 && bar.height <= 76 &&
        search.width >= 96 &&
        search.height >= 40 &&
        status.width >= 140 && status.height >= 40 &&
        actionControl.height >= 40 &&
        Math.abs(search.top - status.top) <= 4 &&
        Math.abs(search.top - actionControl.top) <= 4 &&
        search.right <= status.left + 2 &&
        search.left >= bar.left &&
        globalActivityScrollReady &&
        nonDownloadProgressHidden
        ),
        balancedControls: Boolean(
          controlHeights.length >= 10 &&
          controlHeights.every(height => height >= 38 && height <= 46) &&
          Math.max(...controlHeights) - Math.min(...controlHeights) <= 4
        ),
        terminalSessionControlsBalanced: Boolean(
          terminalSessionHeights.length === 0 ||
          (
            terminalSessionHeights.length === 2 &&
            terminalSessionHeights.every(height => height >= 40) &&
            Math.max(...terminalSessionHeights) - Math.min(...terminalSessionHeights) <= 1
          )
        ),
        globalActivityScrollReady,
        nonDownloadProgressHidden,
        horizontalMenuScrollReady,
        search: search ? { top: search.top, bottom: search.bottom, width: search.width } : null,
        status: status ? { top: status.top, right: status.right, width: status.width } : null,
        actions: actions ? {
          top: actions.top,
          right: actions.right,
          width: actions.width,
          controlTop: actionControl?.top,
          controlHeight: actionControl?.height
        } : null,
        bar: bar ? { left: bar.left, right: bar.right, height: bar.height } : null
      };
    })()`);
    result.globalSearchWithActivityReady = Boolean(
      (result.globalSearchLayout as { ready?: boolean } | undefined)?.ready,
    );
    result.globalActivityScrollReady = Boolean(
      (
        result.globalSearchLayout as
          { globalActivityScrollReady?: boolean } | undefined
      )?.globalActivityScrollReady,
    );
    result.nonDownloadProgressHidden = Boolean(
      (
        result.globalSearchLayout as
          { nonDownloadProgressHidden?: boolean } | undefined
      )?.nonDownloadProgressHidden,
    );
    result.balancedControlSizing = Boolean(
      (result.globalSearchLayout as { balancedControls?: boolean } | undefined)
        ?.balancedControls,
    );
    result.terminalSessionControlsBalanced = Boolean(
      (
        result.globalSearchLayout as
          { terminalSessionControlsBalanced?: boolean } | undefined
      )?.terminalSessionControlsBalanced,
    );
    result.horizontalMenuScrollReady = Boolean(
      (
        result.globalSearchLayout as
          { horizontalMenuScrollReady?: boolean } | undefined
      )?.horizontalMenuScrollReady,
    );
    result.computerControlBannerReady =
      await contents.executeJavaScript(`(() => {
      const banner = document.querySelector('.computer-control-banner');
      const stop = banner?.querySelector('button[aria-label="Stop Computer Control"]');
      const stopStyle = stop ? getComputedStyle(stop) : null;
      return Boolean(
        banner && stop &&
        stop.classList.contains('computer-control-stop') &&
        /Esc/.test(banner.textContent || '') &&
        getComputedStyle(banner).backgroundColor === 'rgb(137, 207, 240)' &&
        stopStyle?.backgroundColor !== 'rgb(255, 255, 255)' &&
        stopStyle?.backgroundColor !== 'rgb(229, 245, 252)' &&
        banner.getBoundingClientRect().height >= 48 &&
        stop.getBoundingClientRect().height >= 36
      );
    })()`);
    sendToRenderer("agent:activity", {
      kind: "computer",
      label: "Computer Control stopped",
      active: false,
      network: false,
    });
    try {
      const computerTargets = JSON.parse(
        await agentControlService.listComputerTargets(),
      ) as { applications?: unknown[] };
      result.nativeComputerControlReady =
        process.platform === "linux" ||
        Array.isArray(computerTargets.applications);
      await agentControlService.openBrowser(
        "'file:///Users/runneradmin/Code/example/agent-preview.html'",
      );
      sendToRenderer("agent:activity", {
        kind: "browser",
        label: "Browser · agent-preview.html",
        active: true,
        network: false,
        target: "agent-preview.html",
      });
      await new Promise((resolve) => setTimeout(resolve, 180));
      result.agentBrowserViewReady =
        await contents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 10000;
        const view = [...document.querySelectorAll('button')].find(
          item => item.textContent.trim() === 'Agent Browser'
        );
        if (!view) return false;
        view.click();
        while (Date.now() < deadline) {
          const preview = document.querySelector('.agent-browser-view img');
          if (preview?.src.startsWith('data:image/png;base64,')) return true;
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        return false;
      })()`);
      result.agentBrowserButtonsReady =
        await contents.executeJavaScript(`(() => {
        const toolbar = document.querySelector('.agent-browser-toolbar');
        const buttons = [...document.querySelectorAll('.agent-browser-actions button')];
        if (!toolbar || buttons.length !== 2) return false;
        const bounds = toolbar.getBoundingClientRect();
        return buttons.every(button => {
          const box = button.getBoundingClientRect();
          return (
            box.height >= 32 &&
            box.left >= bounds.left &&
            box.right <= bounds.right + 1 &&
            getComputedStyle(button).whiteSpace === 'nowrap'
          );
        });
      })()`);
      const browserBefore = JSON.parse(
        await agentControlService.inspectBrowser(),
      ) as { controls?: Array<{ label?: string }> };
      await agentControlService.typeBrowser("Test value", "local only");
      await agentControlService.clickBrowser("Run test");
      const browserAfter = JSON.parse(
        await agentControlService.inspectBrowser(),
      ) as { text?: string };
      const browserSnapshot = await agentControlService.browserSnapshot();
      const computerBefore = JSON.parse(
        await agentControlService.inspectComputer(),
      ) as { controls?: Array<{ label?: string }> };
      result.computerEmergencyStopReady = globalShortcut.isRegistered("Esc");
      await agentControlService.clickComputer("Notifications");
      const computerAfter = JSON.parse(
        await agentControlService.inspectComputer(),
      ) as { text?: string };
      const computerSnapshot = await agentControlService.computerSnapshot();
      result.agentBrowserReady =
        browserBefore.controls?.some((item) => item.label === "Run test") ===
          true &&
        /Browser test passed/.test(browserAfter.text || "") &&
        browserSnapshot?.imageDataUrl.startsWith("data:image/png;base64,") ===
          true;
      result.computerControlReady =
        computerBefore.controls?.some(
          (item) => item.label === "Notifications",
        ) === true &&
        /Notifications/.test(computerAfter.text || "") &&
        computerSnapshot.scope === "oscode" &&
        computerSnapshot.dataUrl.startsWith("data:image/png;base64,");
    } catch (error) {
      result.agentControlError =
        error instanceof Error ? error.message : String(error);
    } finally {
      await agentControlService.stop();
    }
    if (result.smokeError)
      throw new Error(`renderer checks threw: ${String(result.smokeError)}`);
    if (
      result.title !== "osCode" ||
      result.rootReady !== true ||
      result.brandReady !== true ||
      result.bridgeReady !== true ||
      result.autoUpdatePromptReady !== true ||
      result.pythonControlsBeforeFile !== false ||
      result.projectReady !== true ||
      Number(result.sidebarWidth) < 470 ||
      Number(result.sidebarWidth) > 490 ||
      result.editorReady !== true ||
      result.fileTabCloseReady !== true ||
      result.editorCommandsReady !== true ||
      result.markdownReady !== true ||
      result.imageMediaReady !== true ||
      result.streamedMediaReady !== true ||
      result.swiftReady !== true ||
      result.proseWrapSettingReady !== true ||
      result.pythonControlsReady !== true ||
      result.projectSelectionReady !== true ||
      result.containedBaseRuntimes !== true ||
      result.directRuntimeDownloads !== true ||
      result.gitSubmoduleDetected !== true ||
      result.gitSubmoduleAbsorbed !== true ||
      result.gitLocalIdentityReady !== true ||
      result.gitBranchesReady !== true ||
      result.gitRemoteReady !== true ||
      result.gitSyncReady !== true ||
      result.advancedReady !== true ||
      result.mcpReady !== true ||
      result.settingsReady !== true ||
      result.utilityPanelGeometryReady !== true ||
      result.closeIconHitTargetsReady !== true ||
      result.autosaveSettingReady !== true ||
      result.saveHistoryReady !== true ||
      result.themeChoicesReady !== true ||
      result.platformioReady !== true ||
      result.aiPanelReady !== true ||
      result.aiHiddenAtBoot !== true ||
      result.aiCapabilitiesDefaultOff !== true ||
      result.agentBrowserReady !== true ||
      result.agentBrowserViewReady !== true ||
      result.agentBrowserButtonsReady !== true ||
      result.computerControlReady !== true ||
      result.nativeComputerControlReady !== true ||
      result.computerControlBannerReady !== true ||
      result.computerEmergencyStopReady !== true ||
      result.aiPopupsExclusive !== true ||
      result.aiContextReady !== true ||
      result.aiModelSelected !== true ||
      result.globalSearchWithActivityReady !== true ||
      result.globalActivityScrollReady !== true ||
      result.nonDownloadProgressHidden !== true ||
      result.balancedControlSizing !== true ||
      result.terminalSessionControlsBalanced !== true ||
      result.horizontalMenuScrollReady !== true ||
      result.lightThemeReady !== true ||
      result.pythonPackageManagerReady !== true ||
      result.pythonPackageInputReady !== true ||
      result.pythonPackageAddReady !== true ||
      result.pythonPackageListReady !== true ||
      result.pythonEnvironmentLocationReady !== true ||
      result.uvHelpbookReady !== true ||
      Number(result.terminalPanelHeight) < 150 ||
      result.terminalReady !== true ||
      Number(result.editorModelLength) < 20
    )
      throw new Error(`renderer checks failed: ${JSON.stringify(result)}`);
    console.log(`osCode smoke passed: ${JSON.stringify(result)}`);
    await stopProjectProcesses();
    projectRoot = "";
    const cleanupOptions = {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    } as const;
    await fs.rm(smokeProject, cleanupOptions);
    await fs.rm(smokeRemote, cleanupOptions);
    await fs.rm(smokeModuleSource, cleanupOptions);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    await stopProjectProcesses();
    projectRoot = "";
    const cleanupOptions = {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    } as const;
    await fs.rm(smokeProject, cleanupOptions).catch(() => {});
    await fs.rm(smokeRemote, cleanupOptions).catch(() => {});
    await fs.rm(smokeModuleSource, cleanupOptions).catch(() => {});
    clearTimeout(timeout);
    console.error(
      `osCode smoke failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
  }
}
async function runSmokeTest(window: BrowserWindow) {
  const configuredSmokeTimeout = Number(process.env.OSCODE_SMOKE_TIMEOUT_MS);
  const smokeTimeout =
    Number.isFinite(configuredSmokeTimeout) && configuredSmokeTimeout >= 45_000
      ? configuredSmokeTimeout
      : 90_000;
  const timeout = setTimeout(() => {
    console.error("osChat smoke failed: renderer startup timed out");
    app.exit(1);
  }, smokeTimeout);
  const smokeArtifactId = `smoke-${crypto.randomUUID()}`;
  try {
    if (window.webContents.isLoading())
      await new Promise<void>((resolve) =>
        window.webContents.once("did-finish-load", () => resolve()),
      );
    let shellReady = false;
    const rendererDeadline =
      Date.now() + Math.min(smokeTimeout - 5_000, 60_000);
    while (!shellReady && Date.now() < rendererDeadline) {
      shellReady = await window.webContents
        .executeJavaScript(
          "Boolean(document.querySelector('[data-oschat-ready=\"true\"]'))",
          true,
        )
        .catch(() => false);
      if (!shellReady) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!shellReady) throw new Error("chat shell did not become ready");

    const qaScreenshotPath = process.env.OSCHAT_QA_SCREENSHOT;
    const qaView = process.env.OSCHAT_QA_VIEW;
    if (qaScreenshotPath && !qaView) {
      // The readiness marker is committed before Chromium necessarily presents
      // the next composited frame. Let the real shell paint before native QA
      // captures it so the screenshot cannot retain the loading surface.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const image = await window.webContents.capturePage();
      await fs.writeFile(qaScreenshotPath, image.toPNG());
    }

    const renderer = (await window.webContents.executeJavaScript(
      `(() => {
        const text = document.body.innerText;
        return {
          title: document.title,
          branded: text.includes("osChat"),
          chats: text.includes("Chats"),
          notes: text.includes("Notes"),
          secureBridge: typeof window.oscode?.ensureChatWorkspace === "function",
          developerTerminalVisible: Boolean(document.querySelector(".terminal-panel, .terminal-dock")),
        };
      })()`,
      true,
    )) as Record<string, unknown>;
    if (
      renderer.title !== "osChat" ||
      !renderer.branded ||
      !renderer.chats ||
      !renderer.notes ||
      !renderer.secureBridge ||
      renderer.developerTerminalVisible
    )
      throw new Error("chat-first renderer assertions failed");

    const artifactResult = (await window.webContents.executeJavaScript(
      `(async () => {
        const createdAt = new Date().toISOString();
        const artifact = {
          id: ${JSON.stringify(smokeArtifactId)},
          kind: "document",
          title: "Smoke document",
          createdAt,
          updatedAt: createdAt,
          data: { html: "<h1>Smoke ready</h1>", plainText: "Smoke ready", page: "letter", zoom: 1 },
        };
        const workspace = await window.oscode.ensureChatWorkspace();
        const saved = await window.oscode.saveArtifact(artifact);
        const read = await window.oscode.readArtifact(artifact.id);
        const listed = await window.oscode.listArtifacts("document");
        const chat = await window.oscode.createAiChat("Smoke chat");
        const state = await window.oscode.aiAgentState();
        return {
          workspace: workspace.name,
          saved: saved.id === artifact.id,
          read: read.title === "Smoke document" && read.data?.plainText === "Smoke ready",
          listed: listed.some((item) => item.id === artifact.id),
          chat: state.chats.some((item) => item.id === chat.id),
        };
      })()`,
      true,
    )) as Record<string, unknown>;
    if (
      artifactResult.workspace !== "osChat Workspace" ||
      !artifactResult.saved ||
      !artifactResult.read ||
      !artifactResult.listed ||
      !artifactResult.chat
    )
      throw new Error("native workspace bridge assertions failed");

    if (
      qaScreenshotPath &&
      ["document", "spreadsheet", "presentation"].includes(qaView || "")
    ) {
      await window.webContents.executeJavaScript(
        `(async () => {
          const label = ${JSON.stringify(qaView)} === "document" ? "Documents" : ${JSON.stringify(qaView)} === "spreadsheet" ? "Spreadsheets" : "Presentations";
          const notes = [...document.querySelectorAll(".workspace-nav > button")].find((button) => button.textContent?.trim().startsWith("Notes"));
          notes?.click();
          await new Promise((resolve) => setTimeout(resolve, 200));
          const navigation = [...document.querySelectorAll(".notes-kind-nav button")].find((button) => button.textContent?.includes(label));
          navigation?.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          document.querySelector(".artifact-create-icon")?.click();
          await new Promise((resolve) => setTimeout(resolve, 700));
        })()`,
        true,
      );
      const image = await window.webContents.capturePage();
      await fs.writeFile(qaScreenshotPath, image.toPNG());
    }

    await fs.rm(artifactFile("document", smokeArtifactId), { force: true });
    clearTimeout(timeout);
    console.log("osChat native smoke passed");
    app.exit(0);
  } catch (error) {
    await fs
      .rm(artifactFile("document", smokeArtifactId), { force: true })
      .catch(() => undefined);
    clearTimeout(timeout);
    console.error(
      `osChat smoke failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
  }
}
function createApplicationMenu() {
  const send = (action: string) => () =>
    mainWindow?.webContents.send("menu:action", action);
  const about = async () => {
    const options = {
      type: "info" as const,
      title: "About osChat",
      message: `osChat ${app.getVersion()}`,
      detail:
        "A private, local-first AI chat and productivity workspace. osChat includes no telemetry or analytics.",
      buttons: ["OK"],
      defaultId: 0,
      noLink: true,
    };
    if (mainWindow) await dialog.showMessageBox(mainWindow, options);
    else await dialog.showMessageBox(options);
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: send("new-chat"),
        },
        {
          label: "New Document",
          accelerator: "CmdOrCtrl+Shift+D",
          click: send("new-document"),
        },
        {
          label: "New Spreadsheet",
          accelerator: "CmdOrCtrl+Shift+S",
          click: send("new-spreadsheet"),
        },
        {
          label: "New Presentation",
          accelerator: "CmdOrCtrl+Shift+P",
          click: send("new-presentation"),
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Theme",
          accelerator: "CmdOrCtrl+Shift+L",
          click: send("toggle-theme"),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(!app.isPackaged
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : []),
      ],
    },
    ...(process.platform === "darwin"
      ? []
      : [
          {
            label: "Help",
            submenu: [{ label: "About osChat", click: about }],
          },
        ]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function registerIpc() {
  ipcMain.handle(
    "app:set-attention-badge",
    (event, rawCount: unknown, rawKind: unknown) => {
      activateSender(event);
      const count = Math.max(
        0,
        Math.min(99, Math.floor(Number(rawCount) || 0)),
      );
      const kind: AppAttentionKind = [
        "response",
        "permission",
        "input",
      ].includes(String(rawKind))
        ? (rawKind as AppAttentionKind)
        : "response";
      const hadAttention =
        (appAttentionBadges.get(event.sender.id)?.count || 0) > 0;
      if (count) appAttentionBadges.set(event.sender.id, { count, kind });
      else appAttentionBadges.delete(event.sender.id);
      updateApplicationAttentionBadge();
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (count && !hadAttention && owner && !owner.isFocused())
        owner.flashFrame(true);
      return true;
    },
  );
  ipcMain.on("app:set-dirty", (event, dirty: unknown) => {
    if (typeof dirty !== "boolean") return;
    const context = windowContexts.get(event.sender.id);
    if (context) context.dirty = dirty;
    rendererHasUnsavedChanges = [...windowContexts.values()].some(
      (item) => item.dirty,
    );
  });
  ipcMain.handle(
    "dialog:confirm-discard",
    async (_event, rawDetail: unknown) => {
      const detail =
        typeof rawDetail === "string" && rawDetail.length <= 300
          ? rawDetail
          : "Continuing will discard changes that have not been saved.";
      return confirmDiscardChanges(detail);
    },
  );
  ipcMain.handle("preferences:get", async (event) => {
    const preferences = await readPreferences();
    const context = windowContexts.get(event.sender.id);
    return context?.restoreLastProject === false
      ? { ...preferences, lastProject: "" }
      : preferences;
  });
  ipcMain.handle("app:open-secure-data", async () => {
    await secureStore.ready();
    const result = await shell.openPath(secureStore.root);
    if (result) throw new Error(result);
    return secureStore.root;
  });
  ipcMain.handle("app:open-external-url", async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== "string") throw new Error("Invalid website address");
    const url = assertReceiveOnlyPublicUrl(rawUrl).toString();
    await shell.openExternal(url, { activate: true });
    return url;
  });
  ipcMain.handle("web:site-icon", async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== "string" || rawUrl.length > 2_000)
      throw new Error("Invalid website address");
    return fetchPublicSiteIcon(rawUrl);
  });
  ipcMain.handle("mcp:list-servers", () => mcpClientService.listServers());
  ipcMain.handle("mcp:save-server", (_event, server: unknown) => {
    if (!server || typeof server !== "object")
      throw new Error("Enter an MCP server");
    return mcpClientService.saveServer(
      server as {
        id?: string;
        name: string;
        command: string;
        args: string[];
        enabled: boolean;
      },
    );
  });
  ipcMain.handle("mcp:remove-server", (_event, id: unknown) =>
    mcpClientService.removeServer(id),
  );
  ipcMain.handle("platformio:state", async (event) => {
    activateSender(event);
    const state = await platformioService.state(projectRoot);
    if (state.autoUpdate) {
      void platformioService
        .maybeAutoUpdate()
        .then(async (updated) => {
          if (updated)
            sendToRenderer(
              "platformio:state-changed",
              await platformioService.state(projectRoot),
            );
        })
        .catch((error) =>
          sendToRenderer(
            "platformio:output",
            `Automatic update could not complete: ${error instanceof Error ? error.message : String(error)}\n`,
          ),
        );
    }
    return state;
  });
  ipcMain.handle("platformio:boards", (_event, query: unknown) =>
    platformioService.boards(
      typeof query === "string" ? query.slice(0, 120) : "",
    ),
  );
  ipcMain.handle("platformio:install", async (event) => {
    activateSender(event);
    await platformioService.install(false);
    return platformioService.state(projectRoot);
  });
  ipcMain.handle("platformio:update", async (event) => {
    activateSender(event);
    await platformioService.install(true);
    return platformioService.state(projectRoot);
  });
  ipcMain.handle(
    "platformio:set-auto-update",
    async (event, enabled: unknown) => {
      activateSender(event);
      if (typeof enabled !== "boolean")
        throw new Error("Invalid update preference");
      await platformioService.setAutoUpdate(enabled);
      return platformioService.state(projectRoot);
    },
  );
  ipcMain.handle(
    "platformio:initialize",
    async (event, board: unknown, framework: unknown) => {
      activateSender(event);
      if (typeof board !== "string" || typeof framework !== "string")
        throw new Error("Invalid PlatformIO project settings");
      return platformioService.initialize(
        projectRoot,
        board.trim(),
        framework.trim(),
      );
    },
  );
  ipcMain.handle(
    "platformio:run",
    async (event, action: unknown, environment: unknown) => {
      activateSender(event);
      const allowed = ["build", "upload", "clean", "test", "monitor"] as const;
      if (
        !allowed.includes(action as (typeof allowed)[number]) ||
        typeof environment !== "string"
      )
        throw new Error("Invalid PlatformIO task");
      try {
        return await platformioService.run(
          action as (typeof allowed)[number],
          environment.trim(),
          projectRoot,
        );
      } finally {
        const state = await platformioService.state(projectRoot);
        broadcastToRenderers("platformio:state-changed", state);
      }
    },
  );
  ipcMain.handle("platformio:stop", async () => platformioService.stop());
  ipcMain.handle("platformio:input", async (_event, data: unknown) => {
    if (typeof data !== "string") throw new Error("Invalid PlatformIO input");
    return platformioService.write(data);
  });
  ipcMain.handle(
    "diagram:export",
    async (
      _event,
      rawAction: unknown,
      rawFormat: unknown,
      rawData: unknown,
    ) => {
      const action =
        rawAction === "copy" || rawAction === "save" ? rawAction : "";
      const format =
        rawFormat === "svg" || rawFormat === "png" ? rawFormat : "";
      if (
        !action ||
        !format ||
        typeof rawData !== "string" ||
        rawData.length > 16_000_000
      )
        throw new Error("Diagram export is invalid");
      const data =
        format === "svg"
          ? Buffer.from(rawData, "utf8")
          : Buffer.from(
              rawData.replace(/^data:image\/png;base64,/, ""),
              "base64",
            );
      if (!data.length || data.length > 12_000_000)
        throw new Error("Diagram is too large to export");
      if (action === "copy") {
        if (format === "svg") clipboard.writeText(rawData);
        else {
          const image = nativeImage.createFromBuffer(data);
          if (image.isEmpty())
            throw new Error("Diagram image could not be copied");
          clipboard.writeImage(image);
        }
        return true;
      }
      const result = await dialog.showSaveDialog({
        title: `Save diagram as ${format.toUpperCase()}`,
        defaultPath: `diagram.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, data);
      return true;
    },
  );
  ipcMain.handle("preferences:set", async (_e, value: unknown) => {
    const preferences = await writePreferences(value);
    if (appUpdateService?.isEnabled() !== preferences.autoUpdateEnabled)
      await appUpdateService?.setEnabled(preferences.autoUpdateEnabled);
    broadcastToRenderers("preferences:changed", preferences);
    return true;
  });
  ipcMain.handle("updates:status", () => appUpdateService.getStatus());
  ipcMain.handle("updates:set-enabled", async (_event, enabled: unknown) => {
    const current = await readPreferences();
    const preferences = await writePreferences({
      ...current,
      autoUpdateEnabled: enabled === true,
      autoUpdatePromptAnswered: true,
    });
    return appUpdateService.setEnabled(preferences.autoUpdateEnabled);
  });
  ipcMain.handle("updates:check", () => appUpdateService.check(true));
  ipcMain.handle("updates:download", () =>
    appUpdateService.downloadAvailable(),
  );
  ipcMain.handle("updates:install", () =>
    appUpdateService.installReadyUpdate(),
  );
  ipcMain.handle("ai:list-models", () => aiService.listModels());
  ipcMain.handle("ai:pipeline-current", (event) => {
    activateSender(event);
    return aiPipelineStateFor(event.sender.id);
  });
  ipcMain.handle("ai:hardware-profile", () => aiService.hardwareProfile());
  ipcMain.handle("ai:install-cuda-support", () =>
    aiService.installCudaSupport(),
  );
  ipcMain.handle("ai:download-oscode-model", (_event, tier: unknown) =>
    aiService.downloadOsCodeModel(tier),
  );
  ipcMain.handle("ai:agent-state", (event) =>
    withSenderAiProject(event, () => aiService.getAgentState()),
  );
  ipcMain.handle(
    "ai:create-chat",
    (event, title: unknown, reuseEmpty: unknown) =>
      withSenderAiProject(event, () =>
        aiService.createChat(title, reuseEmpty === true),
      ),
  );
  ipcMain.handle(
    "ai:save-chat",
    (event, id: unknown, messages: unknown, contextSummary: unknown) =>
      withSenderAiProject(event, () =>
        aiService.saveChat(id, messages, contextSummary),
      ),
  );
  ipcMain.handle("ai:delete-chat", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.deleteChat(id)),
  );
  ipcMain.handle(
    "ai:update-chat-metadata",
    (event, id: unknown, metadata: unknown) =>
      withSenderAiProject(event, () =>
        aiService.updateChatMetadata(id, metadata),
      ),
  );
  ipcMain.handle(
    "ai:set-goal",
    (event, chatId: unknown, text: unknown, automatic: unknown) =>
      withSenderAiProject(event, () =>
        aiService.setGoal(chatId, text, automatic),
      ),
  );
  ipcMain.handle("ai:complete-goal", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.completeGoal(id)),
  );
  ipcMain.handle("ai:remove-goal", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.removeGoal(id)),
  );
  ipcMain.handle(
    "ai:add-queue",
    (event, chatId: unknown, prompt: unknown, runAt: unknown) =>
      withSenderAiProject(event, () =>
        aiService.addQueue(chatId, prompt, runAt),
      ),
  );
  ipcMain.handle("ai:update-queue", (event, id: unknown, status: unknown) =>
    withSenderAiProject(event, () => aiService.updateQueue(id, status)),
  );
  ipcMain.handle("ai:prioritize-queue", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.prioritizeQueue(id)),
  );
  ipcMain.handle("ai:remove-queue", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.removeQueue(id)),
  );
  ipcMain.handle(
    "ai:add-schedule",
    (
      event,
      chatId: unknown,
      prompt: unknown,
      nextRunAt: unknown,
      cadence: unknown,
    ) =>
      withSenderAiProject(event, () =>
        aiService.addSchedule(chatId, prompt, nextRunAt, cadence),
      ),
  );
  ipcMain.handle("ai:remove-schedule", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.removeSchedule(id)),
  );
  ipcMain.handle("ai:collect-due", (event) =>
    withSenderAiProject(event, () => aiService.collectDueSchedules()),
  );
  ipcMain.handle(
    "ai:grant-permission",
    (event, kind: unknown, scope: unknown, chatId: unknown, detail: unknown) =>
      withSenderAiProject(event, () =>
        aiService.grantPermission(kind, scope, chatId, detail),
      ),
  );
  ipcMain.handle("ai:revoke-permission", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.revokePermission(id)),
  );
  ipcMain.handle("ai:remove-model", (_event, id: unknown) =>
    aiService.removeModel(id),
  );
  ipcMain.handle(
    "ai:update-model-context",
    (_event, id: unknown, contextLimit: unknown) =>
      aiService.updateModelContext(id, contextLimit),
  );
  ipcMain.handle(
    "ai:choose-model",
    async (_event, rawEngine: unknown, rawKind: unknown) => {
      const engine = rawEngine as AiEngine;
      if (!["llamacpp", "pytorch", "mlx"].includes(engine)) return null;
      let kind = rawKind === "folder" ? "folder" : "file";
      if (
        engine === "llamacpp" &&
        !["file", "folder"].includes(String(rawKind))
      ) {
        const choice = await dialog.showMessageBox({
          type: "question",
          title: "Add a GGUF model",
          message: "Choose a GGUF file or a folder of GGUF files.",
          detail: "Multi-file model shards are detected automatically.",
          buttons: ["Choose file", "Choose folder", "Cancel"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (choice.response === 2) return [];
        kind = choice.response === 1 ? "folder" : "file";
      }
      const chooseFolder = engine !== "llamacpp" || kind === "folder";
      const result = await dialog.showOpenDialog({
        title:
          engine === "llamacpp" && !chooseFolder
            ? "Choose a GGUF model file"
            : engine === "llamacpp"
              ? "Choose a folder containing GGUF models"
              : `Choose a local ${engine === "mlx" ? "MLX" : "PyTorch"} model folder`,
        buttonLabel: chooseFolder ? "Add folder" : "Add model",
        properties: chooseFolder
          ? ["openDirectory"]
          : ["openFile", "multiSelections"],
        filters:
          engine === "llamacpp" && !chooseFolder
            ? [{ name: "GGUF model", extensions: ["gguf"] }]
            : undefined,
      });
      if (result.canceled) return [];
      let selectedPaths = await Promise.all(
        result.filePaths.map((item) => fs.realpath(item)),
      );
      if (engine === "llamacpp" && chooseFolder) {
        const found: string[] = [];
        const visit = async (directory: string, depth: number) => {
          if (depth > 5 || found.length >= 2000) return;
          const entries = await fs.readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            if (found.length >= 2000 || entry.isSymbolicLink()) continue;
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(full, depth + 1);
            else if (
              entry.isFile() &&
              entry.name.toLowerCase().endsWith(".gguf")
            )
              found.push(await fs.realpath(full));
          }
        };
        await visit(selectedPaths[0], 0);
        selectedPaths = found;
      }
      if (engine === "llamacpp") {
        const shard = /^(.*?)-(\d{5})-of-(\d{5})\.gguf$/i;
        const grouped = new Map<string, { path: string; count: number }>();
        for (const selected of selectedPaths) {
          const match = path.basename(selected).match(shard);
          if (!match) {
            grouped.set(selected, { path: selected, count: 1 });
            continue;
          }
          const key = path.join(path.dirname(selected), match[1].toLowerCase());
          const current = grouped.get(key);
          if (!current || Number(match[2]) === 1)
            grouped.set(key, { path: selected, count: Number(match[3]) });
        }
        selectedPaths = [...grouped.values()].map((item) => item.path);
      }
      const added: AiModel[] = [];
      for (const selected of selectedPaths) {
        const shard = path
          .basename(selected)
          .match(/^(.*?)-00001-of-(\d{5})\.gguf$/i);
        added.push(
          await aiService.registerModel({
            id: `${engine}:${selected}`,
            name: shard
              ? `${shard[1]} (${Number(shard[2])} shards)`
              : path.basename(selected),
            engine,
            path: selected,
            source: "local",
          }),
        );
      }
      return added;
    },
  );
  ipcMain.handle("ai:choose-executable", async (_event, rawEngine: unknown) => {
    const engine = rawEngine as AiEngine;
    if (engine !== "llamacpp") return "";
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "llama.cpp command line", extensions: ["exe"] }]
          : undefined,
    });
    if (result.canceled) return "";
    const selected = await fs.realpath(result.filePaths[0]);
    if (!/llama-(?:cli|app)(?:\.exe)?$/i.test(path.basename(selected)))
      throw new Error("Choose llama-cli or the unified llama app executable");
    return selected;
  });
  ipcMain.handle(
    "ai:download-model",
    (_event, engine: unknown, source: unknown) =>
      aiService.downloadModel(engine, source),
  );
  ipcMain.handle("ai:ollama-cli-status", () => aiService.ollamaCliStatus());
  ipcMain.handle("ai:install-ollama-cli", () => aiService.installOllamaCli());
  ipcMain.handle("ai:prepare-engine", (_event, engine: unknown) =>
    aiService.prepareEngine(engine),
  );
  ipcMain.handle("ai:chat", async (event, request: unknown) => {
    try {
      return await queueAiRequest(event, request);
    } finally {
      if (!event.sender.isDestroyed())
        event.sender.send("ai:status", "Ready · local only");
    }
  });
  ipcMain.handle("ai:resolve-edits", (event, ids: unknown, approve: unknown) =>
    withSenderAiProject(event, () => aiService.resolveEdits(ids, approve)),
  );
  ipcMain.handle("ai:list-history", (event) =>
    withSenderAiProject(event, () => aiService.listHistory()),
  );
  ipcMain.handle("ai:revert-history", (event, id: unknown) =>
    withSenderAiProject(event, () => aiService.revertHistory(id)),
  );
  ipcMain.handle("ai:stop", (event) => {
    const senderRoot = windowContexts.get(event.sender.id)?.projectRoot || "";
    return aiExecutionOwner?.id === event.sender.id ||
      (senderRoot !== "" && senderRoot === aiProjectRoot)
      ? aiService.stop()
      : false;
  });
  ipcMain.handle("agent:stop-control", () => agentControlService.stop());
  ipcMain.handle("agent:browser-snapshot", () =>
    agentControlService.browserSnapshot(),
  );
  ipcMain.handle("agent:browser-show", () => agentControlService.showBrowser());
  ipcMain.handle("activity:stop", async () => {
    const script = runningScript;
    const scriptOwner = runningScriptOwner;
    runningScript = null;
    runningScriptOwner = null;
    runningDebug = false;
    const stopped = [
      aiService.stopDownload(),
      platformioService.stop(),
      await agentControlService.stop(),
      await aiService.stopProjectCommand(),
      Boolean(script),
    ];
    if (script) {
      await terminateProcessTree(script);
      if (scriptOwner && !scriptOwner.isDestroyed()) {
        scriptOwner.send("run:data", "\r\nProcess stopped\r\n");
        scriptOwner.send("run:stopped");
      }
    }
    return stopped.some(Boolean);
  });
  ipcMain.handle("spellcheck:set", (_event, enabled: unknown) => {
    spellcheckEnabled = enabled !== false;
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.session.spellCheckerEnabled = spellcheckEnabled;
    return spellcheckEnabled;
  });
  ipcMain.handle("workspace:ensure", async (event) => {
    const root = await ensureChatWorkspaceFolders();
    setSenderProject(event, root);
    return { root, name: "osChat Workspace", tree: await tree(root) };
  });
  ipcMain.handle("artifact:list", async (_event, rawKind: unknown) => {
    await ensureChatWorkspaceFolders();
    const kinds = rawKind ? [artifactKind(rawKind)] : [...artifactKinds];
    const records: Array<Omit<ProductivityArtifact, "data">> = [];
    for (const kind of kinds) {
      const directory = path.join(chatWorkspaceRoot(), artifactFolders[kind]);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.slice(0, 2_000)) {
        if (!entry.isFile() || !entry.name.endsWith(".oschat.json")) continue;
        try {
          const parsed = JSON.parse(
            await fs.readFile(path.join(directory, entry.name), "utf8"),
          ) as ProductivityArtifact;
          if (
            parsed.kind !== kind ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,80}$/.test(parsed.id)
          )
            continue;
          records.push({
            id: parsed.id,
            kind,
            title: artifactTitle(parsed.title),
            folder: artifactFolder(parsed.folder),
            favorite: parsed.favorite === true,
            createdAt: String(parsed.createdAt || parsed.updatedAt || ""),
            updatedAt: String(parsed.updatedAt || parsed.createdAt || ""),
          });
        } catch {
          // A malformed local artifact is ignored rather than blocking others.
        }
      }
    }
    return records
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      )
      .slice(0, 2_000);
  });
  ipcMain.handle("artifact:read", async (_event, rawId: unknown) =>
    readArtifactRecord(artifactId(rawId)),
  );
  ipcMain.handle("artifact:save", async (_event, raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid artifact");
    await ensureChatWorkspaceFolders();
    const input = raw as Partial<ProductivityArtifact>;
    const id = artifactId(input.id);
    const kind = artifactKind(input.kind);
    const now = new Date().toISOString();
    const existing = await readArtifactRecord(id).catch(() => null);
    if (existing && existing.kind !== kind)
      throw new Error("Artifact type cannot be changed");
    const artifact: ProductivityArtifact = {
      id,
      kind,
      title: artifactTitle(input.title),
      folder: artifactFolder(input.folder),
      favorite: input.favorite === true,
      createdAt: existing?.createdAt || String(input.createdAt || now),
      updatedAt: now,
      data: input.data ?? {},
    };
    const json = `${JSON.stringify(artifact, null, 2)}\n`;
    if (Buffer.byteLength(json) > 20 * 1024 * 1024)
      throw new Error("This artifact is too large to save safely");
    const target = artifactFile(kind, id);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, json, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
    return {
      id,
      kind,
      title: artifact.title,
      folder: artifact.folder,
      favorite: artifact.favorite,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    };
  });
  ipcMain.handle("artifact:delete", async (_event, rawId: unknown) => {
    const artifact = await readArtifactRecord(artifactId(rawId));
    const result = await dialog.showMessageBox({
      type: "warning",
      title: "Move artifact to Trash?",
      message: `Move “${artifact.title}” to ${process.platform === "win32" ? "the Recycle Bin" : "Trash"}?`,
      detail:
        "The artifact can normally be restored from your operating system Trash.",
      buttons: ["Cancel", "Move to Trash"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return false;
    await shell.trashItem(artifactFile(artifact.kind, artifact.id));
    return true;
  });
  ipcMain.handle(
    "artifact:export",
    async (_event, raw: unknown, rawFormat: unknown) => {
      if (!raw || typeof raw !== "object") throw new Error("Invalid artifact");
      const input = raw as ProductivityArtifact;
      const id = artifactId(input.id);
      const kind = artifactKind(input.kind);
      const title = artifactTitle(input.title);
      const data = (input.data || {}) as Record<string, unknown>;
      const formats = {
        document: ["docx", "html", "markdown", "txt"],
        spreadsheet: ["xlsx", "csv", "tsv", "json"],
        presentation: ["pptx", "html-slides", "json"],
      } as const;
      const requested = typeof rawFormat === "string" ? rawFormat : "";
      const format = formats[kind].includes(requested as never)
        ? requested
        : formats[kind][0];
      const extension =
        format === "markdown"
          ? "md"
          : format === "html-slides"
            ? "html"
            : format;
      const formatNames: Record<string, string> = {
        docx: "Word document",
        html: "Web page",
        markdown: "Markdown",
        txt: "Plain text",
        xlsx: "Excel workbook",
        csv: "CSV table",
        tsv: "Tab-separated table",
        json: "JSON data",
        pptx: "PowerPoint presentation",
        "html-slides": "Interactive HTML slides",
      };
      const result = await dialog.showSaveDialog({
        title: `Export ${title}`,
        defaultPath: `${title.replace(/[^a-z0-9 _.-]/gi, "").trim() || id}.${extension}`,
        filters: [
          {
            name: formatNames[format] || "Export",
            extensions: [extension],
          },
        ],
      });
      if (result.canceled || !result.filePath) return "";
      if (kind === "document" && format === "docx") {
        const { Document, HeadingLevel, Packer, Paragraph, TextRun } =
          await import("docx");
        const plain = plainArtifactText(data.html || data.plainText || "");
        const paragraphs = plain.split(/\n+/).filter(Boolean);
        const document = new Document({
          sections: [
            {
              properties: {},
              children: [
                new Paragraph({
                  text: title,
                  heading: HeadingLevel.TITLE,
                }),
                ...paragraphs.map(
                  (paragraph) =>
                    new Paragraph({ children: [new TextRun(paragraph)] }),
                ),
              ],
            },
          ],
        });
        await fs.writeFile(result.filePath, await Packer.toBuffer(document));
      } else if (kind === "document") {
        const plain = plainArtifactText(data.html || data.plainText || "");
        if (format === "html") {
          const body = String(data.html || "")
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "");
          await fs.writeFile(
            result.filePath,
            `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g, "")}</title><style>body{max-width:52rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.7 system-ui;color:#202326}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccd2d5;padding:.5rem}</style></head><body>${body}</body></html>`,
            "utf8",
          );
        } else await fs.writeFile(result.filePath, plain, "utf8");
      } else if (kind === "spreadsheet" && format === "xlsx") {
        const XLSX = await import("xlsx");
        const workbook = XLSX.utils.book_new();
        const sheets = Array.isArray(data.sheets) ? data.sheets : [];
        for (const [index, sheet] of sheets.slice(0, 32).entries()) {
          const record = sheet as { name?: unknown; cells?: unknown };
          const rows = Array.isArray(record.cells) ? record.cells : [];
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet(rows),
            artifactTitle(record.name || `Sheet ${index + 1}`).slice(0, 31),
          );
        }
        if (!workbook.SheetNames.length)
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([]),
            "Sheet 1",
          );
        XLSX.writeFile(workbook, result.filePath, { compression: true });
      } else if (kind === "spreadsheet") {
        const sheets = Array.isArray(data.sheets) ? data.sheets : [];
        if (format === "json") {
          await fs.writeFile(
            result.filePath,
            `${JSON.stringify({ title, sheets }, null, 2)}\n`,
            "utf8",
          );
        } else {
          const first = (sheets[0] || {}) as { cells?: unknown };
          const rows = Array.isArray(first.cells) ? first.cells : [];
          const delimiter = format === "tsv" ? "\t" : ",";
          const serialized = rows
            .map((row) =>
              (Array.isArray(row) ? row : [])
                .map((cell) => {
                  const value = String(cell ?? "");
                  return delimiter === ","
                    ? `"${value.replace(/"/g, '""')}"`
                    : value.replace(/[\t\r\n]/g, " ");
                })
                .join(delimiter),
            )
            .join("\n");
          await fs.writeFile(result.filePath, `${serialized}\n`, "utf8");
        }
      } else if (format === "json") {
        await fs.writeFile(
          result.filePath,
          `${JSON.stringify({ title, ...data }, null, 2)}\n`,
          "utf8",
        );
      } else if (format === "html-slides") {
        const slides = Array.isArray(data.slides) ? data.slides : [];
        const escape = (value: unknown) =>
          String(value ?? "").replace(
            /[&<>"']/g,
            (character) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[character] || character,
          );
        const percent = (value: unknown, fallback: number) => {
          const parsed = Number(value);
          return Number.isFinite(parsed)
            ? Math.max(0, Math.min(100, parsed))
            : fallback;
        };
        const color = (value: unknown, fallback: string) =>
          /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
        const sections = slides
          .map((value, index) => {
            const slide = value as {
              title?: unknown;
              body?: unknown;
              background?: unknown;
              elements?: unknown;
            };
            const background = /^#[0-9a-f]{6}$/i.test(String(slide.background))
              ? String(slide.background)
              : "#20262a";
            const elements = Array.isArray(slide.elements)
              ? slide.elements
              : [];
            const content = elements.length
              ? elements
                  .slice(0, 250)
                  .map((rawElement) => {
                    const element = rawElement as Record<string, unknown>;
                    const left = percent(element.x, 10);
                    const top = percent(element.y, 10);
                    const width = percent(element.width, 40);
                    const height = percent(element.height, 20);
                    const fill = color(element.fill, "transparent");
                    const foreground = color(element.color, "#f7f8f8");
                    const fontSize = Math.max(
                      8,
                      Math.min(120, Number(element.fontSize) || 20),
                    );
                    const align = ["left", "center", "right"].includes(
                      String(element.align),
                    )
                      ? String(element.align)
                      : "left";
                    const borderRadius =
                      element.variant === "circle" ? "999px" : "4px";
                    const common = `left:${left}%;top:${top}%;width:${width}%;height:${height}%;background:${fill};color:${foreground};font-size:${fontSize}px;font-weight:${element.bold ? 700 : 400};text-align:${align};border-radius:${borderRadius}`;
                    if (
                      element.type === "image" &&
                      typeof element.src === "string" &&
                      /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(
                        element.src,
                      )
                    ) {
                      return `<div class="object image" style="${common}"><img src="${element.src}" alt="${escape(element.text)}"></div>`;
                    }
                    if (element.type === "shape")
                      return `<div class="object shape" style="${common}"></div>`;
                    return `<div class="object text" style="${common}">${escape(element.text)}</div>`;
                  })
                  .join("")
              : `<h1>${escape(slide.title || `Slide ${index + 1}`)}</h1><p>${escape(slide.body)}</p>`;
            return `<section style="background:${background}">${content}</section>`;
          })
          .join("");
        await fs.writeFile(
          result.filePath,
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#0d0f10;color:#fff;font-family:system-ui;scroll-snap-type:y mandatory;overflow-y:auto}section{position:relative;height:100vh;overflow:hidden;padding:8vw;display:flex;flex-direction:column;justify-content:center;scroll-snap-align:start}.object{position:absolute;display:flex;align-items:center;overflow:hidden;white-space:pre-wrap}.object.image img{width:100%;height:100%;object-fit:contain}.object.shape{display:block}h1{font:700 clamp(2rem,6vw,5rem)/1.1 Georgia}p{max-width:70ch;white-space:pre-wrap;font-size:clamp(1rem,2.4vw,2rem);line-height:1.5}</style></head><body>${sections}</body></html>`,
          "utf8",
        );
      } else {
        const module = await import("pptxgenjs");
        const PptxGenJS = module.default;
        const deck = new PptxGenJS();
        deck.layout = "LAYOUT_WIDE";
        deck.author = "osChat";
        deck.subject = title;
        deck.title = title;
        const slides = Array.isArray(data.slides) ? data.slides : [];
        for (const [index, value] of slides.slice(0, 250).entries()) {
          const slideData = value as {
            title?: unknown;
            body?: unknown;
            notes?: unknown;
            background?: unknown;
            elements?: unknown;
          };
          const slide = deck.addSlide();
          const background = String(slideData.background || "1F2529").replace(
            /^#/,
            "",
          );
          slide.background = {
            color: /^[0-9a-f]{6}$/i.test(background) ? background : "1F2529",
          };
          const elements = Array.isArray(slideData.elements)
            ? slideData.elements.slice(0, 250)
            : [];
          if (elements.length) {
            const coordinate = (
              value: unknown,
              scale: number,
              fallback: number,
            ) => {
              const parsed = Number(value);
              return (
                ((Number.isFinite(parsed)
                  ? Math.max(0, Math.min(100, parsed))
                  : fallback) /
                  100) *
                scale
              );
            };
            const pptColor = (value: unknown, fallback: string) => {
              const parsed = String(value || "").replace(/^#/, "");
              return /^[0-9a-f]{6}$/i.test(parsed) ? parsed : fallback;
            };
            for (const rawElement of elements) {
              const element = rawElement as Record<string, unknown>;
              const x = coordinate(element.x, 13.333, 10);
              const y = coordinate(element.y, 7.5, 10);
              const w = Math.max(0.2, coordinate(element.width, 13.333, 40));
              const h = Math.max(0.12, coordinate(element.height, 7.5, 20));
              if (
                element.type === "image" &&
                typeof element.src === "string" &&
                /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(
                  element.src,
                )
              ) {
                slide.addImage({ data: element.src, x, y, w, h });
              } else if (element.type === "shape") {
                const variant = String(element.variant);
                const shape =
                  variant === "circle"
                    ? deck.ShapeType.ellipse
                    : variant === "line"
                      ? deck.ShapeType.line
                      : deck.ShapeType.rect;
                slide.addShape(shape, {
                  x,
                  y,
                  w,
                  h,
                  fill:
                    variant === "line"
                      ? {
                          color: pptColor(element.fill, "7DD3FC"),
                          transparency: 100,
                        }
                      : { color: pptColor(element.fill, "7DD3FC") },
                  line: {
                    color: pptColor(element.fill, "7DD3FC"),
                    width: variant === "line" ? 2 : 1,
                  },
                });
              } else {
                slide.addText(String(element.text || ""), {
                  x,
                  y,
                  w,
                  h,
                  fontFace:
                    element.role === "title" ? "Aptos Display" : "Aptos",
                  fontSize: Math.max(
                    8,
                    Math.min(72, Number(element.fontSize) || 20),
                  ),
                  bold: Boolean(element.bold),
                  color: pptColor(element.color, "F5F7F8"),
                  align: ["left", "center", "right"].includes(
                    String(element.align),
                  )
                    ? (String(element.align) as "left" | "center" | "right")
                    : "left",
                  valign: "middle",
                  margin: 0.02,
                  breakLine: false,
                });
              }
            }
          } else {
            slide.addText(String(slideData.title || `Slide ${index + 1}`), {
              x: 0.7,
              y: 0.55,
              w: 11.9,
              h: 0.7,
              fontFace: "Aptos Display",
              fontSize: 28,
              bold: true,
              color: "F5F7F8",
              margin: 0,
            });
            slide.addText(plainArtifactText(slideData.body || ""), {
              x: 0.75,
              y: 1.55,
              w: 11.7,
              h: 5.1,
              fontFace: "Aptos",
              fontSize: 19,
              color: "D6DEE3",
              breakLine: false,
              valign: "top",
              margin: 0.08,
            });
          }
          if (slideData.notes) slide.addNotes(String(slideData.notes));
        }
        if (!slides.length) deck.addSlide();
        await deck.writeFile({ fileName: result.filePath });
      }
      return result.filePath;
    },
  );
  ipcMain.handle("project:open", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner || undefined, {
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    const nextRoot = await fs.realpath(result.filePaths[0]);
    setSenderProject(event, nextRoot);
    return {
      root: nextRoot,
      name: path.basename(nextRoot),
      tree: await tree(nextRoot),
    };
  });
  ipcMain.handle("project:open-path", async (event, requestedPath: string) => {
    const resolved = path.resolve(requestedPath.trim());
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error("That path is not a folder");
    const nextRoot = await fs.realpath(resolved);
    setSenderProject(event, nextRoot);
    return {
      root: nextRoot,
      name: path.basename(nextRoot),
      tree: await tree(nextRoot),
    };
  });
  ipcMain.handle("project:close", async (event) => {
    setSenderProject(event, "");
    return true;
  });
  ipcMain.handle("project:refresh", async (event) => {
    activateSender(event);
    return projectRoot ? tree(projectRoot) : [];
  });
  ipcMain.handle("project:search", (event, query: unknown) => {
    activateSender(event);
    return searchProject(query);
  });
  ipcMain.handle("project:list-directory", async (event, target: string) => {
    activateSender(event);
    return tree(await safeProjectPath(target));
  });
  ipcMain.handle(
    "project:create-item",
    async (_e, directory: string, requestedName: string, kind: string) => {
      if (kind !== "file" && kind !== "folder")
        throw new Error("Unsupported project item type");
      const parent = await safeProjectPath(directory);
      if (!(await fs.stat(parent)).isDirectory())
        throw new Error("Select a folder for the new item");
      const name = projectItemName(requestedName);
      const destination = path.join(parent, name);
      if (!withinRoot(destination))
        throw new Error("Path is outside the project");
      if (kind === "folder") await fs.mkdir(destination);
      else {
        const handle = await fs.open(destination, "wx");
        await handle.close();
      }
      return {
        tree: await tree(projectRoot),
        item: {
          name,
          path: destination,
          kind: kind === "folder" ? "directory" : "file",
        },
      };
    },
  );
  ipcMain.handle(
    "project:rename-item",
    async (_e, target: string, requestedName: string) => {
      const current = await safeProjectPath(target);
      const root = await fs.realpath(projectRoot);
      if (current === root)
        throw new Error("The project root cannot be renamed here");
      const name = projectItemName(requestedName);
      const destination = path.join(path.dirname(current), name);
      if (!withinRoot(destination))
        throw new Error("Path is outside the project");
      if (await fs.lstat(destination).catch(() => null))
        throw new Error("An item with that name already exists");
      await fs.rename(current, destination);
      return { tree: await tree(projectRoot), newPath: destination, name };
    },
  );
  ipcMain.handle(
    "project:trash-item",
    async (_e, target: string, rawUnsaved: unknown) => {
      const current = await safeProjectPath(target);
      const root = await fs.realpath(projectRoot);
      if (current === root)
        throw new Error("The project root cannot be removed here");
      const options = {
        type: "warning" as const,
        title: "Move project item to Trash?",
        message: `Move “${path.basename(current)}” to ${process.platform === "win32" ? "the Recycle Bin" : "Trash"}?`,
        detail:
          rawUnsaved === true
            ? "Unsaved editor changes inside this item will be lost. The saved files can normally be restored from Trash."
            : "This removes it from the project, but it can normally be restored.",
        buttons: ["Cancel", "Move to Trash"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
      if (result.response !== 1)
        return { deleted: false, tree: await tree(projectRoot) };
      await shell.trashItem(current);
      return { deleted: true, tree: await tree(projectRoot) };
    },
  );
  ipcMain.handle(
    "markdown:read-image",
    async (event, rawMarkdownPath: unknown, rawSource: unknown) => {
      activateSender(event);
      if (typeof rawMarkdownPath !== "string" || typeof rawSource !== "string")
        throw new Error("Invalid Markdown image");
      const source = rawSource.split(/[?#]/, 1)[0];
      if (
        !source ||
        /^[a-z][a-z0-9+.-]*:/i.test(source) ||
        path.isAbsolute(source)
      )
        throw new Error("Only project-relative images can be loaded");
      let decoded = source;
      try {
        decoded = decodeURIComponent(source);
      } catch {
        throw new Error("Invalid Markdown image path");
      }
      const markdownFile = await safeProjectPath(rawMarkdownPath);
      const imageFile = await safeProjectPath(
        path.resolve(path.dirname(markdownFile), decoded),
      );
      const extension = path.extname(imageFile).toLowerCase();
      const mime = new Map([
        [".png", "image/png"],
        [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"],
        [".gif", "image/gif"],
        [".webp", "image/webp"],
      ]).get(extension);
      if (!mime) throw new Error("Unsupported Markdown image format");
      const stat = await fs.stat(imageFile);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
        throw new Error("Markdown image is too large");
      return `data:${mime};base64,${(await fs.readFile(imageFile)).toString("base64")}`;
    },
  );
  ipcMain.handle("file:open", async (event, target: string) => {
    const context = activateSender(event);
    if (!context?.projectRoot) throw new Error("Open a project first");
    const file = await safeProjectPath(target);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Only regular files can be opened");
    const media = projectMediaType(file);
    if (!media) {
      return {
        kind: "text" as const,
        content: decodeTextFile(await fs.readFile(file)),
      };
    }
    validateProjectMedia(file, stat.size);
    const root = await fs.realpath(context.projectRoot);
    return {
      kind: "media" as const,
      media: {
        ...media,
        bytes: stat.size,
        url: mediaPreviewUrl({
          file,
          root,
          ownerId: event.sender.id,
          ...media,
        }),
      },
    };
  });
  ipcMain.handle("file:read", async (event, target: string) => {
    activateSender(event);
    const file = await safeProjectPath(target);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Only regular files can be opened");
    return decodeTextFile(await fs.readFile(file));
  });
  ipcMain.handle(
    "file:write",
    async (event, target: string, content: unknown, rawSource: unknown) => {
      activateSender(event);
      const file = await safeProjectPath(target);
      const next = validateTextContent(content);
      const source = ["manual", "autosave", "agent", "restore"].includes(
        String(rawSource),
      )
        ? (rawSource as "manual" | "autosave" | "agent" | "restore")
        : "manual";
      const root = await fs.realpath(projectRoot);
      const relative = path.relative(root, file).replace(/\\/g, "/");
      const before = decodeTextFile(await fs.readFile(file));
      if (before !== next)
        await saveHistoryStore.record(root, relative, before, source);
      await fs.writeFile(file, next, "utf8");
      return true;
    },
  );
  ipcMain.handle("file:history-list", async (event, target: unknown) => {
    activateSender(event);
    if (typeof target !== "string") throw new Error("Invalid file path");
    const file = await safeProjectPath(target);
    const root = await fs.realpath(projectRoot);
    return saveHistoryStore.list(
      root,
      path.relative(root, file).replace(/\\/g, "/"),
    );
  });
  ipcMain.handle(
    "file:history-restore",
    async (event, target: unknown, rawId: unknown) => {
      activateSender(event);
      if (typeof target !== "string" || typeof rawId !== "string")
        throw new Error("Invalid saved version");
      const file = await safeProjectPath(target);
      const root = await fs.realpath(projectRoot);
      const relative = path.relative(root, file).replace(/\\/g, "/");
      const current = decodeTextFile(await fs.readFile(file));
      const restored = await saveHistoryStore.content(root, relative, rawId);
      if (current !== restored) {
        await saveHistoryStore.record(root, relative, current, "restore");
        await fs.writeFile(file, restored, "utf8");
      }
      return restored;
    },
  );
  ipcMain.handle("git:state", (event) => {
    activateSender(event);
    return gitState();
  });
  ipcMain.handle("git:run", async (event, action: string, payload?: string) => {
    activateSender(event);
    const remote = action === "remote" ? validateGitRemote(payload) : "";
    const commitReference = async (value: unknown) => {
      const reference = String(value || "").trim();
      if (!/^[a-f0-9]{7,40}$/i.test(reference))
        throw new Error("Choose a valid commit");
      return (
        await git(["rev-parse", "--verify", `${reference}^{commit}`])
      ).trim();
    };
    const commitTarget = async () => {
      let value: { name?: unknown; reference?: unknown };
      try {
        value = JSON.parse(String(payload || "")) as typeof value;
      } catch {
        throw new Error("Choose a valid commit action");
      }
      return {
        name: validateGitBranch(value.name),
        reference: await commitReference(value.reference),
      };
    };
    if (["fetch", "pull", "push"].includes(action)) {
      const state = await gitState();
      if (!state.remote)
        throw new Error("Add a remote destination before syncing");
    }
    const commands: Record<string, string[]> = {
      addAll: ["add", "-A"],
      fetch: ["fetch", "origin"],
      pull: ["pull"],
      push: ["push", "-u", "origin", "HEAD"],
    };
    if (action === "init") {
      try {
        await git(["init", "-b", "main"]);
      } catch {
        await git(["init"]);
      }
      await ensureLocalGitIdentity();
    } else if (["stage", "unstage"].includes(action)) {
      const state = await gitState();
      const file = state.files.find((entry) => entry.path === payload);
      if (!file) throw new Error("That changed file is no longer available");
      const paths = file.originalPath
        ? [file.originalPath, file.path]
        : [file.path];
      if (action === "stage") await git(["add", "-A", "--", ...paths]);
      else {
        try {
          await git(["restore", "--staged", "--", ...paths]);
        } catch {
          await git(["rm", "--cached", "--ignore-unmatch", "--", ...paths]);
        }
      }
    } else if (action === "commit") {
      const state = await gitState();
      const staged = state.files.some(
        (entry) => entry.index !== " " && entry.index !== "?",
      );
      if (!staged)
        throw new Error(
          state.files.length
            ? "Stage at least one changed file before committing"
            : "There are no changes to commit",
        );
      await ensureLocalGitIdentity();
      await git(["commit", "-m", payload || "Update project"]);
    } else if (action === "remote") {
      try {
        await git(["remote", "set-url", "origin", remote]);
      } catch {
        await git(["remote", "add", "origin", remote]);
      }
    } else if (action === "remoteRemove")
      await git(["remote", "remove", "origin"]);
    else if (action === "branchRename") {
      const branch = validateGitBranch(payload);
      await git(["branch", "-m", branch]);
    } else if (action === "stashCreate") {
      await git([
        "stash",
        "push",
        "-u",
        "-m",
        (payload || "osChat checkpoint").slice(0, 160),
      ]);
    } else if (["stashApply", "stashPop", "stashDrop"].includes(action)) {
      if (!/^stash@\{\d+\}$/.test(payload || ""))
        throw new Error("Invalid stash selection");
      const command =
        action === "stashApply"
          ? "apply"
          : action === "stashPop"
            ? "pop"
            : "drop";
      await git(["stash", command, payload!]);
    } else if (action === "tagCreate") {
      const tag = validateGitBranch(payload);
      await git(["tag", tag]);
    } else if (action === "tagDelete") {
      const tag = validateGitBranch(payload);
      await git(["tag", "-d", tag]);
    } else if (action === "branchCreateAt") {
      const target = await commitTarget();
      const state = await gitState();
      if (state.branches.includes(target.name))
        throw new Error("That branch already exists");
      await git(["switch", "-c", target.name, target.reference]);
    } else if (action === "tagCreateAt") {
      const target = await commitTarget();
      await git(["tag", target.name, target.reference]);
    } else if (action === "cherryPick" || action === "revertCommit") {
      const reference = await commitReference(payload);
      await ensureLocalGitIdentity();
      await git(
        action === "cherryPick"
          ? ["cherry-pick", reference]
          : ["revert", "--no-edit", reference],
      );
    } else if (action === "checkoutDetached") {
      const reference = await commitReference(payload);
      await git(["switch", "--detach", reference]);
    } else if (
      ["branchCreate", "branchSwitch", "branchDelete", "merge"].includes(action)
    ) {
      const branch = validateGitBranch(payload);
      await git(["check-ref-format", "--branch", branch]);
      const state = await gitState();
      if (action === "branchCreate") {
        if (state.branches.includes(branch))
          throw new Error("That branch already exists");
        await git(["switch", "-c", branch]);
      } else {
        if (!state.branches.includes(branch))
          throw new Error("That local branch no longer exists");
        if (action === "branchSwitch") await git(["switch", branch]);
        else if (action === "branchDelete") {
          if (branch === state.branch)
            throw new Error("Switch branches before deleting this one");
          const options = {
            type: "warning" as const,
            title: "Delete local branch?",
            message: `Delete “${branch}”?`,
            detail:
              "Git will refuse if the branch contains unmerged work. Remote branches are not changed.",
            buttons: ["Cancel", "Delete local branch"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          };
          const result = smokeMode
            ? { response: 1 }
            : mainWindow
              ? await dialog.showMessageBox(mainWindow, options)
              : await dialog.showMessageBox(options);
          if (result.response !== 1) return state;
          await git(["branch", "-d", branch]);
        } else {
          if (branch === state.branch)
            throw new Error("Choose another branch to merge");
          await git(["merge", "--no-edit", branch]);
        }
      }
    } else if (commands[action]) await git(commands[action]);
    else throw new Error("Unsupported Git action");
    return gitState();
  });
  ipcMain.handle("git:delete-repository", async (event) => {
    activateSender(event);
    if (!projectRoot) throw new Error("Open a project first");
    const state = await gitState();
    if (!state.initialized) return state;
    const root = await fs.realpath(projectRoot);
    const metadata = path.join(root, ".git");
    const item = await fs.lstat(metadata).catch(() => null);
    if (!item || item.isSymbolicLink())
      throw new Error("The repository metadata could not be removed safely");
    const options = {
      type: "warning" as const,
      title: "Remove local Git repository?",
      message: "Remove Git history from this project?",
      detail:
        "Your project files stay in place. The local .git metadata will be moved to Trash, and any remote link will be removed with it.",
      buttons: ["Cancel", "Remove local repository"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) return state;
    await shell.trashItem(metadata);
    return gitState();
  });
  ipcMain.handle("git:absorb-submodule", async (event, sub: string) => {
    activateSender(event);
    const state = await gitState();
    if (
      !state.submodules.some((item) => item.path === sub) ||
      !withinRoot(path.join(projectRoot, sub))
    )
      throw new Error("Invalid submodule path");
    const submoduleRoot = await safeProjectPath(path.join(projectRoot, sub));
    const nestedGit = path.join(submoduleRoot, ".git");
    const nestedGitStat = await fs.lstat(nestedGit).catch(() => null);
    if (nestedGitStat?.isDirectory())
      throw new Error(
        "The nested repository has its own Git directory and was left unchanged",
      );
    const moduleConfig = await git([
      "config",
      "-f",
      ".gitmodules",
      "--get-regexp",
      "^submodule\..*\.path$",
    ]);
    const entry = moduleConfig
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(" ");
        return {
          key: line.slice(0, separator),
          value: line.slice(separator + 1).trim(),
        };
      })
      .find((item) => item.value === sub);
    if (!entry)
      throw new Error("Submodule metadata could not be matched safely");
    await git(["rm", "-f", "--cached", "--", sub]);
    if (nestedGitStat?.isFile()) await fs.rm(nestedGit);
    await git([
      "config",
      "-f",
      ".gitmodules",
      "--remove-section",
      entry.key.slice(0, -".path".length),
    ]);
    const gitmodules = path.join(projectRoot, ".gitmodules");
    if ((await fs.readFile(gitmodules, "utf8")).trim())
      await git(["add", "--", ".gitmodules"]);
    else {
      await fs.rm(gitmodules);
      await git(["rm", "--cached", "--ignore-unmatch", "--", ".gitmodules"]);
    }
    await git(["add", "--", sub]);
    return gitState();
  });
  ipcMain.handle(
    "terminal:create",
    async (event, rawId: string, interpreter = "") => {
      activateSender(event);
      const id = validateTerminalId(rawId);
      if (!terminals.has(id) && terminals.size >= 8)
        throw new Error("Close a terminal before opening another one");
      const isWin = process.platform === "win32";
      const command = isWin
        ? "powershell.exe"
        : process.env.SHELL || "/bin/bash";
      const terminalEnv: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const pathKey =
        Object.keys(terminalEnv).find((key) => key.toLowerCase() === "path") ||
        "PATH";
      const uv = await uvExecutable();
      terminalEnv.UV_CACHE_DIR = uvCacheRoot();
      terminalEnv.UV_LINK_MODE = "copy";
      terminalEnv.UV_PYTHON_INSTALL_DIR = managedPythonRoot();
      terminalEnv.PYTHONPYCACHEPREFIX = pythonBytecodeCacheRoot(
        app.getPath("userData"),
      );
      if (path.isAbsolute(uv))
        terminalEnv[pathKey] =
          `${path.dirname(uv)}${path.delimiter}${terminalEnv[pathKey] || ""}`;
      if (interpreter) {
        const inspected = await inspectPython(interpreter);
        const binaryDir = path.dirname(inspected.path);
        const parent = path.dirname(binaryDir);
        const looksLikeVenv = ["scripts", "bin"].includes(
          path.basename(binaryDir).toLowerCase(),
        );
        if (looksLikeVenv) {
          terminalEnv.VIRTUAL_ENV = parent;
          terminalEnv.UV_PROJECT_ENVIRONMENT = parent;
          delete terminalEnv.PYTHONHOME;
          terminalEnv[pathKey] =
            `${binaryDir}${path.delimiter}${terminalEnv[pathKey] || ""}`;
        }
      }
      terminals.get(id)?.kill();
      const terminal = pty.spawn(
        command,
        isWin
          ? ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]
          : ["-l"],
        {
          cwd: projectRoot || app.getPath("home"),
          env: terminalEnv,
          cols: 100,
          rows: 30,
          name: "xterm-256color",
        },
      );
      terminals.set(id, terminal);
      terminalOwners.set(id, event.sender);
      terminal.onData((data) => {
        const owner = terminalOwners.get(id);
        if (owner && !owner.isDestroyed())
          owner.send("terminal:data", id, data);
      });
      terminal.onExit(({ exitCode }) => {
        if (terminals.get(id) !== terminal) return;
        terminals.delete(id);
        const owner = terminalOwners.get(id);
        terminalOwners.delete(id);
        if (owner && !owner.isDestroyed())
          owner.send("terminal:data", id, `\r\n[process exited ${exitCode}]`);
      });
      return { shell: path.basename(command) };
    },
  );
  ipcMain.on("terminal:write", (_e, rawId: string, rawData: string) => {
    try {
      const id = validateTerminalId(rawId);
      terminals.get(id)?.write(validateTerminalInput(rawData));
    } catch {
      /* ignore malformed fire-and-forget terminal events */
    }
  });
  ipcMain.on(
    "terminal:resize",
    (_e, rawId: string, cols: number, rows: number) => {
      try {
        const id = validateTerminalId(rawId);
        if (validTerminalSize(cols, rows))
          terminals.get(id)?.resize(cols, rows);
      } catch {
        /* ignore malformed fire-and-forget terminal events */
      }
    },
  );
  ipcMain.handle("terminal:dispose", async (_e, rawId: string) => {
    const id = validateTerminalId(rawId);
    await disposeTerminal(id);
    return true;
  });
  ipcMain.handle("python:list", async (event) => {
    activateSender(event);
    const contained = await containedPythonList();
    const discovered = await Promise.all(
      managedPythonVersions.map(async (version) => {
        const local = contained.get(version);
        if (local) return local;
        const systemCommand =
          process.platform === "win32" ? "py" : `python${version}`;
        const systemArgs =
          process.platform === "win32"
            ? [`-${version}`, "-c", "import sys;print(sys.executable)"]
            : ["-c", "import sys;print(sys.executable)"];
        try {
          const { stdout } = await exec(systemCommand, systemArgs);
          return {
            version,
            path: stdout.trim(),
            installed: true,
            scope: "system" as const,
          };
        } catch {
          try {
            const { stdout } = await exec(
              await uvExecutable(),
              ["python", "find", version],
              {
                env: {
                  ...process.env,
                  UV_PYTHON_INSTALL_DIR: managedPythonRoot(),
                },
              },
            );
            return {
              version,
              path: stdout.trim(),
              installed: true,
              scope: "app" as const,
            };
          } catch {
            return {
              version,
              path: "",
              installed: false,
              scope: "app" as const,
            };
          }
        }
      }),
    );
    const custom = await customPythonList();
    const knownPaths = new Set(
      discovered
        .filter((item) => item.path)
        .map((item) =>
          process.platform === "win32" ? item.path.toLowerCase() : item.path,
        ),
    );
    discovered.unshift(
      ...custom.filter(
        (item) =>
          !knownPaths.has(
            process.platform === "win32" ? item.path.toLowerCase() : item.path,
          ),
      ),
    );
    const projectRuntimes: PythonRuntimeRecord[] = [];
    if (projectRoot) {
      const root = await fs.realpath(projectRoot);
      const knownProjectPaths = new Set<string>();
      for (const python of [
        await appProjectEnvironmentInterpreter(),
        ...(await projectEnvironmentInterpreters()),
      ]) {
        try {
          const owned = await ownedProjectPythonEnvironment(python);
          const inspected = owned.inspected;
          const normalized =
            process.platform === "win32"
              ? inspected.path.toLowerCase()
              : inspected.path;
          if (knownProjectPaths.has(normalized)) continue;
          knownProjectPaths.add(normalized);
          const relativeEnvironment = path
            .relative(root, owned.environment)
            .replace(/\\/g, "/");
          const environmentName =
            relativeEnvironment === ".venv"
              ? ".venv"
              : relativeEnvironment.startsWith(".oscode/envs/")
                ? `env “${path.basename(relativeEnvironment)}”`
                : relativeEnvironment;
          projectRuntimes.push({
            version:
              owned.location === "app"
                ? `App environment · ${inspected.fullVersion}`
                : `Project ${environmentName} · ${inspected.fullVersion}`,
            path: inspected.path,
            installed: true,
            scope: owned.location === "app" ? "app-project" : "project",
          });
        } catch {
          /* ignore incomplete environment */
        }
      }
    }
    return [...projectRuntimes, ...discovered];
  });
  ipcMain.handle("python:get-selection", async (event) => {
    activateSender(event);
    if (!projectRoot) return "";
    const root = await fs.realpath(projectRoot);
    const selections = await readPythonSelections();
    const selected = selections[root];
    if (!selected) return "";
    try {
      return (await inspectPython(selected)).path;
    } catch {
      await savePythonSelections(setPythonSelection(selections, root, ""));
      return "";
    }
  });
  ipcMain.handle("python:set-selection", async (event, interpreter: string) => {
    activateSender(event);
    if (!projectRoot) return false;
    if (typeof interpreter !== "string")
      throw new Error("Invalid Python interpreter selection");
    const root = await fs.realpath(projectRoot);
    const selected = interpreter ? (await inspectPython(interpreter)).path : "";
    const selections = setPythonSelection(
      await readPythonSelections(),
      root,
      selected,
    );
    await savePythonSelections(selections);
    return true;
  });
  ipcMain.handle("python:choose", async (event) => {
    activateSender(event);
    const selected = await dialog.showOpenDialog({
      title: "Choose a Python interpreter",
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "Python executable", extensions: ["exe"] }]
          : undefined,
    });
    if (selected.canceled) return null;
    const inspected = await inspectPython(selected.filePaths[0]);
    const executable = inspected.path;
    const runtime = {
      version: `Local ${inspected.fullVersion}`,
      path: executable,
      installed: true,
      scope: "system" as const,
    };
    const existing = await customPythonList();
    const normalized =
      process.platform === "win32" ? executable.toLowerCase() : executable;
    await saveCustomPython([
      runtime,
      ...existing.filter(
        (item) =>
          (process.platform === "win32"
            ? item.path.toLowerCase()
            : item.path) !== normalized,
      ),
    ]);
    return runtime;
  });
  ipcMain.handle(
    "python:create-venv",
    async (event, interpreter: string, requestedName = "") => {
      activateSender(event);
      if (!projectRoot) throw new Error("Open a project first");
      if (!interpreter) throw new Error("Select a Python interpreter first");
      const name = requestedName.trim();
      if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(name))
        throw new Error(
          "Environment names may use letters, numbers, dashes, and underscores",
        );
      const destination = name
        ? path.join(
            await projectPrivateDirectory([".oscode", "envs"], true),
            name,
          )
        : path.join(await fs.realpath(projectRoot), ".venv");
      if (!withinRoot(destination))
        throw new Error("Environment path is outside the project");
      if (await fs.lstat(destination).catch(() => null))
        throw new Error(
          name
            ? `Environment “${name}” already exists`
            : "Project .venv already exists",
        );
      const base = await inspectPython(interpreter);
      try {
        await fs.mkdir(uvCacheRoot(), { recursive: true });
        await exec(
          await uvExecutable(),
          ["venv", "--python", base.path, "--seed", destination],
          {
            cwd: projectRoot,
            timeout: 10 * 60_000,
            env: uvEnvironment({ UV_PYTHON_DOWNLOADS: "never" }),
          },
        );
        const python = path.join(
          destination,
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        );
        const created = await inspectPython(python);
        return {
          version: name
            ? `Project env “${name}” · ${created.fullVersion}`
            : `Project .venv · ${created.fullVersion}`,
          path: created.path,
          installed: true,
          scope: "project" as const,
        };
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true });
        throw error;
      }
    },
  );
  ipcMain.handle(
    "python:install-package",
    async (event, interpreter: string, requestedPackage: string) => {
      activateSender(event);
      const installed = await installProjectPythonPackages(interpreter, [
        requestedPackage,
      ]);
      return {
        package: installed.packages[0],
        output: installed.output,
        interpreter: installed.interpreter,
        createdEnvironment: installed.createdEnvironment,
      };
    },
  );
  ipcMain.handle("python:list-packages", async (event, interpreter: string) => {
    activateSender(event);
    const selected = await existingProjectPythonEnvironment(interpreter);
    if (!selected)
      return {
        interpreter: "",
        environment: "",
        location: "",
        packages: [],
        error:
          "No Python environment was found for this project. Add a package to create an app-managed environment, or create a project .venv.",
      };
    await rememberProjectPython(selected.inspected.path);
    const result = await exec(
      await uvExecutable(),
      [
        "pip",
        "list",
        "--python",
        selected.inspected.path,
        "--format",
        "json",
        "--color",
        "never",
      ],
      {
        cwd: projectRoot,
        timeout: 60_000,
        env: uvEnvironment({
          VIRTUAL_ENV: selected.environment,
          UV_PROJECT_ENVIRONMENT: selected.environment,
        }),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const parsed = JSON.parse(result.stdout) as unknown;
    const packages: PythonPackageRecord[] = Array.isArray(parsed)
      ? parsed.flatMap((item) => {
          if (
            !item ||
            typeof item !== "object" ||
            !("name" in item) ||
            typeof item.name !== "string" ||
            !("version" in item) ||
            typeof item.version !== "string"
          )
            return [];
          const editable =
            "editable_project_location" in item &&
            typeof item.editable_project_location === "string"
              ? item.editable_project_location
              : undefined;
          return [
            {
              name: item.name,
              version: item.version,
              ...(editable ? { editableProjectLocation: editable } : {}),
            },
          ];
        })
      : [];
    packages.sort((left, right) => left.name.localeCompare(right.name));
    return {
      interpreter: selected.inspected.path,
      environment: selected.environment,
      location: selected.location,
      packages,
    };
  });
  ipcMain.handle(
    "python:uninstall-package",
    async (event, interpreter: string, requestedPackage: string) => {
      activateSender(event);
      const packageName = validPythonPackageName(requestedPackage);
      const selected = await existingProjectPythonEnvironment(interpreter);
      if (!selected)
        throw new Error("This project does not have a Python environment yet");
      const result = await exec(
        await uvExecutable(),
        ["pip", "uninstall", "--python", selected.inspected.path, packageName],
        {
          cwd: projectRoot,
          timeout: 10 * 60_000,
          env: uvEnvironment({
            VIRTUAL_ENV: selected.environment,
            UV_PROJECT_ENVIRONMENT: selected.environment,
          }),
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      return {
        package: packageName,
        output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
        interpreter: selected.inspected.path,
      };
    },
  );
  ipcMain.handle("python:install", async (_e, version: string) => {
    if (!managedPythonVersions.includes(version))
      throw new Error("Invalid Python version");
    try {
      await fs.mkdir(managedPythonRoot(), { recursive: true });
      await exec(
        await uvExecutable(),
        ["python", "install", "--install-dir", managedPythonRoot(), version],
        {
          timeout: 10 * 60_000,
          env: uvEnvironment({
            UV_PYTHON_NO_REGISTRY: "1",
            UV_PYTHON_INSTALL_BIN: "0",
          }),
        },
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/ENOENT|not recognized|not found/i.test(message)) return false;
      throw error;
    }
  });
  ipcMain.handle(
    "python:run",
    async (event, file: string, interpreter: string, debug = false) => {
      activateSender(event);
      if (runningScript) {
        broadcastToRenderers("agent:activity", {
          kind: "queue",
          label: "Another project is already running Python",
          active: true,
          network: false,
          cancellable: false,
        });
        throw new Error(
          "Another project is already running Python. Stop it or wait for it to finish.",
        );
      }
      if (aiService.isProjectCommandRunning())
        throw new Error(
          "The agent is already running Python in the shared Run terminal. Stop it before starting another Python process.",
        );
      const script = await safeProjectPath(file);
      if (path.extname(script) !== ".py")
        throw new Error("Select a Python file in the current project");
      if (!interpreter) throw new Error("Select a Python interpreter first");
      const inspected = await inspectPython(interpreter);
      runningDebug = debug;
      const command = inspected.path;
      const scriptArgs = debug ? ["-m", "pdb", script] : [script];
      const args = scriptArgs;
      let runEnvironment: NodeJS.ProcessEnv = pythonRuntimeEnvironment(
        app.getPath("userData"),
      );
      try {
        const owned = await ownedProjectPythonEnvironment(inspected.path);
        const binaryDirectory = path.dirname(owned.inspected.path);
        const pathKey = process.platform === "win32" ? "Path" : "PATH";
        runEnvironment = {
          ...runEnvironment,
          VIRTUAL_ENV: owned.environment,
          [pathKey]: `${binaryDirectory}${path.delimiter}${runEnvironment[pathKey] || ""}`,
        };
        delete runEnvironment.PYTHONHOME;
      } catch {
        // A system interpreter runs directly without virtual-environment vars.
      }
      const child = spawn(command, args, {
        cwd: projectRoot,
        env: runEnvironment,
        detached: process.platform !== "win32",
      });
      runningScript = child;
      runningScriptOwner = event.sender;
      const sendRun = (channel: string, ...values: unknown[]) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, ...values);
      };
      sendRun(
        "run:data",
        `› ${path.basename(command)} ${path.basename(script)}\r\n`,
      );
      child.stdout?.on("data", (data) => sendRun("run:data", data.toString()));
      child.stderr?.on("data", (data) => sendRun("run:data", data.toString()));
      child.on("error", (error) => {
        if (runningScript !== child) return;
        sendRun(
          "run:data",
          `\r\nProcess could not start: ${error.message}\r\n`,
        );
        sendRun("run:stopped");
        runningScript = null;
        runningScriptOwner = null;
        runningDebug = false;
      });
      child.on("exit", (code) => {
        if (runningScript !== child) return;
        sendRun(
          "run:data",
          `\r\nProcess finished with exit code ${code ?? "unknown"}\r\n`,
        );
        sendRun("run:stopped");
        runningScript = null;
        runningScriptOwner = null;
        runningDebug = false;
      });
      return true;
    },
  );
  ipcMain.handle("python:stop", async () => {
    const child = runningScript;
    runningScript = null;
    runningDebug = false;
    if (child) {
      await terminateProcessTree(child);
      if (runningScriptOwner && !runningScriptOwner.isDestroyed()) {
        runningScriptOwner.send("run:data", "\r\nProcess stopped\r\n");
        runningScriptOwner.send("run:stopped");
      }
      runningScriptOwner = null;
      return true;
    }
    return aiService.stopProjectCommand();
  });
  ipcMain.handle("python:input", (_e, data: string) => {
    if (typeof data !== "string" || data.length === 0 || data.length > 10_000)
      throw new Error("Invalid process input");
    if (!runningScript?.stdin?.writable) {
      if (aiService.writeProjectCommandInput(data)) return true;
      throw new Error("No Python process is accepting input");
    }
    runningScript.stdin.write(data);
    return true;
  });
}
const ownsSingleInstance = app.requestSingleInstanceLock();
if (!ownsSingleInstance) app.quit();
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (ownsSingleInstance)
  app.whenReady().then(async () => {
    await protocol.handle("oscode-media", handleMediaPreviewRequest);
    const userData = app.getPath("userData");
    if (!smokeMode) {
      try {
        await archiveLegacySecureStore(userData);
      } catch (error) {
        dialog.showErrorBox(
          "Encrypted storage unavailable",
          `osChat could not prepare its app-managed encrypted storage: ${error instanceof Error ? error.message : String(error)}`,
        );
        app.quit();
        return;
      }
    }
    const osKeyProtector: KeyProtector = smokeMode
      ? processKeyProtector(userData)
      : appLocalKeyProtector();
    secureStore = new SecureDataStore(userData, osKeyProtector);
    saveHistoryStore = new SaveHistoryStore(secureStore);
    mcpClientService = new McpClientService(secureStore, userData);
    try {
      await secureStore.ready();
      await secureStore.purgeLegacyPromptData();
    } catch (error) {
      dialog.showErrorBox(
        "Secure storage unavailable",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return;
    }
    appUpdateService = new AppUpdateService(
      (status) => sendToRenderer("updates:status-changed", status),
      () => app.quit(),
    );
    const developmentOrigin =
      !app.isPackaged && process.env.VITE_DEV_SERVER_URL
        ? new URL(process.env.VITE_DEV_SERVER_URL).origin
        : "";
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) => {
        let allowDevelopmentRenderer = false;
        if (developmentOrigin) {
          try {
            allowDevelopmentRenderer =
              new URL(details.url).origin === developmentOrigin;
          } catch {
            allowDevelopmentRenderer = false;
          }
        }
        callback({ cancel: !allowDevelopmentRenderer });
      },
    );
    agentControlService = new AgentControlService(
      () => mainWindow,
      currentAiProjectRoot,
      (activity) => broadcastToRenderers("agent:activity", activity),
      false,
    );
    aiService = new LocalAiService({
      userData: app.getPath("userData"),
      modelsRoot: path.join(app.getPath("userData"), "models"),
      secureStore,
      llamaRoot: app.isPackaged
        ? path.join(process.resourcesPath, "llama")
        : path.join(app.getAppPath(), "vendor", "llama"),
      getProjectRoot: currentAiProjectRoot,
      getUv: uvExecutable,
      installPythonPackages: async (packages) => {
        const installed = await installProjectPythonPackages(
          "",
          packages,
          currentAiProjectRoot(),
        );
        broadcastToRenderers("python:environment-changed");
        return installed;
      },
      projectRunData: (data) => {
        if (aiExecutionOwner && !aiExecutionOwner.isDestroyed())
          aiExecutionOwner.send("run:data", data);
      },
      projectRunStopped: () => {
        if (aiExecutionOwner && !aiExecutionOwner.isDestroyed())
          aiExecutionOwner.send("run:stopped");
      },
      projectRunBusy: () => Boolean(runningScript),
      getProjectPython: () =>
        preferredProjectPythonInterpreter(currentAiProjectRoot()),
      getPython: async () => {
        const runtimes = await containedPythonList();
        const python =
          runtimes.get("3.12")?.path || [...runtimes.values()][0]?.path;
        if (!python)
          throw new Error("The bundled Python runtime is unavailable");
        return python;
      },
      status: (message) => broadcastToRenderers("ai:status", message),
      modelOutput: (output) =>
        broadcastToAiProject(currentAiProjectRoot(), "ai:model-output", output),
      checkpoint: (root, relative, before) =>
        saveHistoryStore.record(root, relative, before, "agent").then(() => {}),
      action: (action) =>
        broadcastToAiProject(currentAiProjectRoot(), "ai:action", action),
      activity: (activity) => broadcastToRenderers("agent:activity", activity),
      platformioState: () => platformioService.state(currentAiProjectRoot()),
      platformioInstall: async () => {
        await platformioService.install(false);
        return platformioService.state(currentAiProjectRoot());
      },
      platformioRun: async (action, environment) => {
        const root = currentAiProjectRoot();
        try {
          return await platformioService.run(action, environment, root);
        } finally {
          const state = await platformioService.state(root);
          broadcastToRenderers("platformio:state-changed", state);
        }
      },
      platformioBoards: (query) => platformioService.boards(query),
      platformioInitialize: (board, framework) =>
        platformioService.initialize(currentAiProjectRoot(), board, framework),
      platformioMonitor: (environment, durationMs) =>
        platformioService.monitorSnapshot(
          currentAiProjectRoot(),
          environment,
          durationMs,
        ),
      trashProjectPath: async (target) => {
        const root = await fs.realpath(currentAiProjectRoot());
        const resolved = await fs.realpath(target);
        const relative = path.relative(root, resolved);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error("The project item cannot be moved to Trash");
        await shell.trashItem(resolved);
      },
      browserOpen: (url) => agentControlService.openBrowser(url),
      browserInspect: () => agentControlService.inspectBrowser(),
      browserClick: (query) => agentControlService.clickBrowser(query),
      browserType: (query, text) =>
        agentControlService.typeBrowser(query, text),
      browserClose: () => agentControlService.closeBrowser(),
      webMcpList: () => agentControlService.listWebMcpTools(),
      webMcpCall: (name, argumentsValue) =>
        agentControlService.callWebMcpTool(name, argumentsValue),
      mcpList: (serverId) => mcpClientService.listTools(serverId),
      mcpCall: (serverId, name, argumentsValue) =>
        mcpClientService.callReadOnlyTool(serverId, name, argumentsValue),
      computerList: () => agentControlService.listComputerTargets(),
      computerInspect: (target) => agentControlService.inspectComputer(target),
      computerSnapshot: (target) =>
        agentControlService.computerSnapshot(target),
      computerClick: (query, target) =>
        agentControlService.clickComputer(query, target),
      computerType: (query, text, target) =>
        agentControlService.typeComputer(query, text, target),
    });
    platformioService = new PlatformioService(
      path.join(app.getPath("userData"), "platformio"),
      async () => {
        const runtimes = await containedPythonList();
        const python =
          runtimes.get("3.12")?.path || [...runtimes.values()][0]?.path;
        if (!python)
          throw new Error("The bundled Python runtime is unavailable");
        return python;
      },
      (data) => sendToRenderer("platformio:output", data),
      secureStore,
      (activity) => broadcastToRenderers("agent:activity", activity),
    );
    registerIpc();
    createWindow(!smokeMode);
    createApplicationMenu();
    void readPreferences().then((preferences) => {
      spellcheckEnabled = preferences.spellcheck;
      appUpdateService.initialize(preferences.autoUpdateEnabled);
    });
    if (smokeMode && mainWindow) void runSmokeTest(mainWindow);
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  appUpdateService?.dispose();
  if (quittingAfterCleanup) {
    return;
  }
  platformioService?.stop();
  if (rendererHasUnsavedChanges) {
    event.preventDefault();
    if (closeConfirmationOpen) return;
    closeConfirmationOpen = true;
    void confirmDiscardChanges(
      "Quitting osChat now will discard changes that have not been saved.",
    ).then(async (discard) => {
      closeConfirmationOpen = false;
      if (!discard) return;
      rendererHasUnsavedChanges = false;
      for (const context of windowContexts.values()) context.allowClose = true;
      quittingAfterCleanup = true;
      await stopProjectProcesses();
      await disposeAiServiceSafely();
      app.quit();
    });
    return;
  }
  if (
    !runningScript &&
    terminals.size === 0 &&
    !agentControlService?.isActive()
  ) {
    quittingAfterCleanup = true;
    void disposeAiServiceSafely();
    return;
  }
  event.preventDefault();
  quittingAfterCleanup = true;
  void stopProjectProcesses()
    .then(() => disposeAiServiceSafely())
    .finally(() => app.quit());
});
app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
