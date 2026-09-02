import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FeatherIcon } from "./FeatherIcon";
import { IconButton } from "./IconButton";
import { AiMessageContent, type ChatArtifactPayload } from "./AiMessageContent";
import { publicAssistantText } from "../lib/public-assistant-text";
import osChatIcon from "../assets/oschat-icon.png";
import type {
  AiActionEntry,
  AiAgentState,
  AiAttention,
  AiChatAttachment,
  AiChatMessage,
  AiChatThread,
  AiEditMode,
  AiEngine,
  AiHardwareProfile,
  AiInferenceHardware,
  AiHistoryEntry,
  AiModel,
  AiModelOutput,
  AiModelTier,
  AiPipelineState,
  AiPermissionKind,
  AiPermissionRequest,
  AiPermissionScope,
  AiQueueItem,
  AiSchedule,
  AiTerminalMode,
  OllamaCliStatus,
} from "../types";

type Props = {
  engine: AiEngine;
  model: string;
  executable: string;
  editMode: AiEditMode;
  terminalMode: AiTerminalMode;
  fileAccess: boolean;
  webAccess: boolean;
  browserAccess: boolean;
  computerAccess: boolean;
  contextLimit: number;
  hardwarePreference: AiInferenceHardware;
  thinkingEnabled: boolean;
  width: number;
  side: "left" | "right";
  projectName: string;
  projectKey?: string;
  openChatId?: string;
  workspaceMode?: boolean;
  hideTerminalControl?: boolean;
  assistantName?: string;
  controlsPortalId?: string;
  onOpenArtifact?: (artifact: ChatArtifactPayload) => void;
  onEngine: (engine: AiEngine) => void;
  onModel: (model: string) => void;
  onEditMode: (mode: AiEditMode) => void;
  onTerminalMode: (mode: AiTerminalMode) => void;
  onFileAccess: (enabled: boolean) => void;
  onWebAccess: (enabled: boolean) => void;
  onBrowserAccess: (enabled: boolean) => void;
  onComputerAccess: (enabled: boolean) => void;
  onContextLimit: (limit: number) => void;
  onHardwarePreference: (hardware: AiInferenceHardware) => void;
  onChanged: (files: string[]) => Promise<void>;
  onNotice: (message: string) => void;
  onChatOpened?: (chatId?: string) => void;
  onAttentionChange?: (
    attention: AiAttention | null,
    completePermission?: (() => Promise<void>) | null,
  ) => void;
};

const labels: Record<AiEngine, string> = {
  llamacpp: "llama.cpp",
  ollama: "Ollama",
  pytorch: "PyTorch",
  mlx: "MLX",
};

type StoredChatTabs = {
  openChatIds: string[];
  pinnedChatIds: string[];
  activeChatId: string;
};

function chatTabsStorageKey(scope: string) {
  return `oschat:open-chat-tabs:v1:${encodeURIComponent(scope || "default")}`;
}

function readStoredChatTabs(key: string): StoredChatTabs {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "{}") as
      Partial<StoredChatTabs> | undefined;
    return {
      openChatIds: Array.isArray(parsed?.openChatIds)
        ? parsed.openChatIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      pinnedChatIds: Array.isArray(parsed?.pinnedChatIds)
        ? parsed.pinnedChatIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      activeChatId:
        typeof parsed?.activeChatId === "string" ? parsed.activeChatId : "",
    };
  } catch {
    return { openChatIds: [], pinnedChatIds: [], activeChatId: "" };
  }
}

function uniqueChatIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function responseDownloadName(content: string) {
  const label =
    content
      .replace(/```[\s\S]*?```/g, "")
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
      .find(Boolean) || "osChat response";
  const safe = label
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .slice(0, 80)
    .trim();
  return `${safe || "osChat response"}.md`;
}
const permissionLabels: Record<AiPermissionKind, string> = {
  "project.read": "Read project files",
  "project.write": "Edit project files",
  "project.delete": "Move a project item to Trash",
  "terminal.run": "Run terminal commands",
  "packages.install": "Install packages",
  "debug.run": "Run and debug code",
  "web.search": "Search the web",
  "attachments.external": "Share private attachment context",
  "network.request": "Send this web request",
  "browser.control": "Control the agent browser",
  "computer.control": "Control a visible application",
  "computer.external": "Use another desktop application",
  "computer.system": "Finish operating-system permission setup",
  "mcp.call": "Call an MCP tool",
  "platformio.install": "Install PlatformIO Core",
  "platformio.run": "Control PlatformIO",
};
const oneShotPermissionKinds = new Set<AiPermissionKind>([
  "project.delete",
  "attachments.external",
  "network.request",
  "computer.external",
  "computer.system",
  "mcp.call",
  "platformio.install",
]);
const permissionKinds = (
  Object.keys(permissionLabels) as AiPermissionKind[]
).filter((kind) => !oneShotPermissionKinds.has(kind));
const emptyAgentState: AiAgentState = {
  chats: [],
  goals: [],
  queue: [],
  schedules: [],
  permissions: [],
};
const contextChoices = [8_192, 16_384, 32_768, 65_536, 131_072, 262_144];
const attachmentAccept = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/*",
  "video/*",
  ".pdf",
  ".docx",
  ".rtf",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".swift",
  ".sh",
  ".yaml",
  ".yml",
  ".toml",
].join(",");

function attachmentKind(file: File): AiChatAttachment["kind"] | "" {
  const mime = file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime))
    return "image";
  if (
    mime.startsWith("audio/") ||
    [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].includes(extension)
  )
    return "audio";
  if (
    mime.startsWith("video/") ||
    [".m4v", ".mov", ".mp4", ".ogv", ".webm"].includes(extension)
  )
    return "video";
  if (
    mime.startsWith("text/") ||
    [
      ".c",
      ".cc",
      ".conf",
      ".cpp",
      ".cs",
      ".css",
      ".csv",
      ".docx",
      ".go",
      ".h",
      ".hpp",
      ".html",
      ".ini",
      ".java",
      ".js",
      ".json",
      ".jsx",
      ".kt",
      ".log",
      ".md",
      ".mjs",
      ".pdf",
      ".py",
      ".rb",
      ".rs",
      ".rtf",
      ".sh",
      ".sql",
      ".swift",
      ".toml",
      ".ts",
      ".tsx",
      ".txt",
      ".xml",
      ".yaml",
      ".yml",
    ].includes(extension)
  )
    return "document";
  return "";
}

function attachmentIcon(kind: AiChatAttachment["kind"]) {
  if (kind === "audio") return "volume-2";
  if (kind === "video") return "video";
  if (kind === "image") return "image";
  return "file-text";
}

function cleanStoredAiContent(content: string) {
  return content
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*llama_[a-z0-9_]+\s*:/i.test(line) &&
        !/[\\/]prompt-cache[\\/].*\.bin['"]?\s*$/i.test(line) &&
        !/^\s*session file\s*$/i.test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanStoredMessages(messages: AiChatMessage[]) {
  return messages.map((message) => ({
    ...message,
    content: cleanStoredAiContent(message.content),
  }));
}

function mergeActionEntries(...groups: AiActionEntry[][]) {
  const merged = new Map<string, AiActionEntry>();
  for (const group of groups)
    for (const action of group) merged.set(action.id, action);
  return [...merged.values()]
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    )
    .slice(-500);
}

function contentWithSources(content: string, actions: AiActionEntry[]) {
  const websites = [
    ...new Set(
      actions
        .filter((action) => action.status === "completed")
        .flatMap((action) => action.websites || [])
        .filter((website) => /^https:\/\//i.test(website)),
    ),
  ].slice(0, 12);
  if (!websites.length) return content;
  return `${content.trim()}\n\n### Sources used\n${websites
    .map((website) => `- [${websiteLabel(website)}](${website})`)
    .join("\n")}`;
}

function actionIcon(kind: AiActionEntry["kind"]) {
  if (kind === "web") return "globe";
  if (kind === "browser") return "compass";
  if (kind === "computer") return "monitor";
  if (kind === "files") return "file-text";
  if (kind === "command") return "terminal";
  if (kind === "permission") return "shield";
  if (kind === "goal") return "target";
  if (kind === "plan") return "list";
  return "check-circle";
}

function actionKindLabel(kind: AiActionEntry["kind"]) {
  if (kind === "web") return "Web";
  if (kind === "browser") return "Browser";
  if (kind === "computer") return "Device";
  if (kind === "files") return "Project";
  if (kind === "command") return "Command";
  if (kind === "permission") return "Permission";
  if (kind === "goal") return "Goal";
  if (kind === "plan") return "Plan";
  return "Result";
}

function publicAiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (
    /llama|backend init|access violation|0\.\d+\.\d+|traceback/i.test(message)
  )
    return "The selected model could not start. Try the Small model or check the local AI engine.";
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
    .replace(/\s+/g, " ")
    .slice(0, 320);
}

function inferredTier(model: AiModel) {
  if (model.tier && model.tier !== "custom") return model.tier;
  const label = `${model.name} ${model.path}`;
  if (/\bmedium\b/i.test(label)) return "medium";
  if (/\bsmall\b/i.test(label)) return "small";
  if (/\blarge\b/i.test(label)) return "large";
  return "custom";
}

function osCodeGgufTier(model: AiModel): Exclude<AiModelTier, "custom"> | null {
  if (model.engine !== "llamacpp") return null;
  if (
    ["bundled", "downloaded", "available"].includes(model.source) &&
    model.tier &&
    model.tier !== "custom"
  )
    return model.tier;
  const label = `${model.name} ${model.path}`;
  const match = label.match(
    /oscode[-_\s]+gguf[-_\s]+(small|medium|large)(?:[-_\s.]|$)/i,
  );
  return (match?.[1]?.toLowerCase() as Exclude<AiModelTier, "custom">) || null;
}

function preferredTier(_hardware: AiHardwareProfile | null) {
  return "small";
}

function recommendedActiveContext(
  model: AiModel,
  _hardware: AiHardwareProfile | null,
) {
  if (osCodeGgufTier(model))
    return Math.min(
      model.preferredContext || 8_192,
      model.contextLimit || 8_192,
    );
  if (
    model.engine === "mlx" &&
    ["bundled", "downloaded", "available"].includes(model.source) &&
    model.tier &&
    model.tier !== "custom"
  )
    return model.contextLimit || 262_144;
  return Math.min(model.preferredContext || 8_192, model.contextLimit || 8_192);
}

function recommendedModel(
  models: AiModel[],
  hardware: AiHardwareProfile | null,
) {
  const tier = preferredTier(hardware);
  return (
    models.find(
      (item) =>
        osCodeGgufTier(item) === tier &&
        item.installed !== false &&
        item.supported !== false,
    ) ||
    models.find(
      (item) =>
        /oscode/i.test(`${item.name} ${item.path}`) &&
        inferredTier(item) === tier &&
        item.installed !== false &&
        item.supported !== false,
    ) ||
    models.find(
      (item) =>
        item.source === "bundled" &&
        item.installed !== false &&
        inferredTier(item) === tier &&
        item.supported !== false,
    ) ||
    models.find(
      (item) => item.source === "bundled" && item.supported !== false,
    ) ||
    models.find((item) => item.installed !== false && item.supported !== false)
  );
}

export function AiPanel({
  engine,
  model,
  executable,
  editMode,
  terminalMode,
  fileAccess,
  webAccess,
  browserAccess,
  computerAccess,
  contextLimit,
  hardwarePreference,
  thinkingEnabled,
  width,
  side,
  projectName,
  projectKey,
  openChatId,
  workspaceMode = false,
  hideTerminalControl = false,
  assistantName = "osChat",
  controlsPortalId,
  onOpenArtifact,
  onEngine,
  onModel,
  onEditMode,
  onTerminalMode,
  onFileAccess,
  onWebAccess,
  onBrowserAccess,
  onComputerAccess,
  onContextLimit,
  onHardwarePreference,
  onChanged,
  onNotice,
  onChatOpened,
  onAttentionChange,
}: Props) {
  const [controlsTarget, setControlsTarget] = useState<HTMLElement | null>(
    null,
  );
  const permissionsToggleRef = useRef<HTMLButtonElement>(null);
  const [permissionsPopoverPosition, setPermissionsPopoverPosition] = useState({
    left: 16,
    bottom: 84,
    width: 560,
    maxHeight: 420,
  });
  const [models, setModels] = useState<AiModel[]>([]);
  const [hardware, setHardware] = useState<AiHardwareProfile | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [agentState, setAgentState] = useState<AiAgentState>(emptyAgentState);
  const [chatId, setChatId] = useState("");
  const [openChatIds, setOpenChatIds] = useState<string[]>([]);
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>([]);
  const [chatTabMenuId, setChatTabMenuId] = useState("");
  const [chatTabMenuPosition, setChatTabMenuPosition] = useState({
    top: 0,
    left: 0,
  });
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AiChatAttachment[]>([]);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveModelOutput, setLiveModelOutput] = useState<{
    chatId: string;
    reasoning: string;
    answer: string;
  }>({ chatId: "", reasoning: "", answer: "" });
  const [cudaBusy, setCudaBusy] = useState(false);
  const [downloadingTier, setDownloadingTier] = useState<
    Exclude<AiModelTier, "custom"> | ""
  >("");
  const [status, setStatus] = useState("Ready · local only");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [tierPickerOpen, setTierPickerOpen] = useState(false);
  const [permissionsDrawerOpen, setPermissionsDrawerOpen] = useState(
    () => !workspaceMode,
  );
  const [pipelineState, setPipelineState] = useState<AiPipelineState>({
    state: "idle",
    label: "",
    position: 0,
    activeProject: "",
    activeChatId: "",
  });
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [ollamaPickerOpen, setOllamaPickerOpen] = useState(false);
  const [ollamaCli, setOllamaCli] = useState<OllamaCliStatus | null>(null);
  const [ollamaCliBusy, setOllamaCliBusy] = useState(false);
  const [customListOpen, setCustomListOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState<
    "all" | "web" | "device" | "project"
  >("all");
  const [liveActions, setLiveActions] = useState<AiActionEntry[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<
    "goal" | "queue" | "schedules"
  >("goal");
  const [history, setHistory] = useState<AiHistoryEntry[]>([]);
  const [review, setReview] = useState<AiHistoryEntry | null>(null);
  const [pendingEdits, setPendingEdits] = useState<
    Array<{ id: string; path: string }>
  >([]);
  const [permissionRequest, setPermissionRequest] =
    useState<AiPermissionRequest | null>(null);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [goalMenuOpen, setGoalMenuOpen] = useState(false);
  const [queueDraft, setQueueDraft] = useState("");
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleCadence, setScheduleCadence] =
    useState<AiSchedule["cadence"]>("once");
  const [contextSummary, setContextSummary] = useState("");
  const [usage, setUsage] = useState({
    used: 0,
    limit: contextLimit,
    compacted: false,
  });
  const conversationRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const previousBusyRef = useRef(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const steeringRef = useRef(false);
  const stoppingRef = useRef(false);
  const touchBarActionsRef = useRef<Record<string, () => void>>({});
  const requestEpochRef = useRef(0);
  const tierPickerInitialized = useRef(false);
  const chatTabsReadyRef = useRef(false);
  const storedChatTabsKey = useMemo(
    () => chatTabsStorageKey(projectKey || projectName),
    [projectKey, projectName],
  );

  type AiPopup =
    "workspace" | "activity" | "history" | "permissions" | "models" | "ollama";
  const closeAiPopups = () => {
    setWorkspaceOpen(false);
    setActivityOpen(false);
    setHistoryOpen(false);
    setPermissionOpen(false);
    setModelsOpen(false);
    setAddMenuOpen(false);
    setOllamaPickerOpen(false);
    setCustomListOpen(false);
    setSource("");
  };
  const openAiPopup = (popup: AiPopup) => {
    closeAiPopups();
    if (popup === "workspace") setWorkspaceOpen(true);
    if (popup === "activity") setActivityOpen(true);
    if (popup === "history") setHistoryOpen(true);
    if (popup === "permissions") setPermissionOpen(true);
    if (popup === "models") setModelsOpen(true);
    if (popup === "ollama") setOllamaPickerOpen(true);
  };
  const toggleAiPopup = (popup: AiPopup) => {
    const isOpen =
      (popup === "workspace" && workspaceOpen) ||
      (popup === "activity" && activityOpen) ||
      (popup === "history" && historyOpen) ||
      (popup === "permissions" && permissionOpen) ||
      (popup === "models" && modelsOpen) ||
      (popup === "ollama" && ollamaPickerOpen);
    const shouldOpen = !isOpen;
    setWorkspaceOpen(shouldOpen && popup === "workspace");
    setActivityOpen(shouldOpen && popup === "activity");
    setHistoryOpen(shouldOpen && popup === "history");
    setPermissionOpen(shouldOpen && popup === "permissions");
    setModelsOpen(shouldOpen && popup === "models");
    setOllamaPickerOpen(shouldOpen && popup === "ollama");
    setAddMenuOpen(false);
    setCustomListOpen(false);
    setSource("");
  };
  const messagesRef = useRef<AiChatMessage[]>([]);
  const busyRef = useRef(false);
  const chatIdRef = useRef("");
  const liveActionsRef = useRef<AiActionEntry[]>([]);
  const permissionContinuation = useRef<{
    messages: AiChatMessage[];
    contextSummary: string;
  } | null>(null);
  const temporaryPermissionIds = useRef<string[]>([]);
  const manualEngine = useRef<AiEngine | null>(null);
  const capabilityRef = useRef({
    editMode,
    terminalMode,
    fileAccess,
    webAccess,
    browserAccess,
    computerAccess,
  });

  const tierModels = useMemo(
    () => models.filter((item) => osCodeGgufTier(item) !== null),
    [models],
  );
  const customModels = useMemo(
    () => models.filter((item) => osCodeGgufTier(item) === null),
    [models],
  );
  const engineModels = useMemo(
    () => customModels.filter((item) => item.engine === engine),
    [engine, customModels],
  );
  const ollamaModels = useMemo(
    () =>
      customModels.filter(
        (item) =>
          item.engine === "ollama" &&
          (!source.trim() ||
            item.name.toLowerCase().includes(source.trim().toLowerCase())),
      ),
    [customModels, source],
  );
  const activeChat = agentState.chats.find((item) => item.id === chatId);
  const orderedOpenChatIds = useMemo(() => {
    const open = uniqueChatIds(openChatIds);
    const pinned = new Set(pinnedChatIds);
    return [
      ...open.filter((id) => pinned.has(id)),
      ...open.filter((id) => !pinned.has(id)),
    ];
  }, [openChatIds, pinnedChatIds]);
  const openChatTabs = useMemo(
    () =>
      orderedOpenChatIds
        .map((id) => agentState.chats.find((chat) => chat.id === id))
        .filter((chat): chat is AiChatThread => Boolean(chat)),
    [agentState.chats, orderedOpenChatIds],
  );
  const chatTabMenuChat = agentState.chats.find(
    (chat) => chat.id === chatTabMenuId,
  );
  const pipelineOccupied = pipelineState.state !== "idle";
  const anotherChatIsRunning =
    pipelineOccupied &&
    Boolean(pipelineState.activeChatId) &&
    pipelineState.activeChatId !== chatId;
  const runningChatTitle =
    agentState.chats.find((chat) => chat.id === pipelineState.activeChatId)
      ?.title || "another chat";
  const selectedModel = models.find((item) => item.path === model);
  const activeGoal = agentState.goals.find(
    (item) => item.chatId === chatId && item.status === "active",
  );
  const chatGoals = useMemo(
    () => agentState.goals.filter((item) => item.chatId === chatId),
    [agentState.goals, chatId],
  );
  const chatQueue = useMemo(
    () => agentState.queue.filter((item) => item.chatId === chatId),
    [agentState.queue, chatId],
  );
  const pendingChatQueue = useMemo(
    () => chatQueue.filter((item) => item.status === "queued"),
    [chatQueue],
  );
  const chatSchedules = useMemo(
    () => agentState.schedules.filter((item) => item.chatId === chatId),
    [agentState.schedules, chatId],
  );
  const activityEntries = useMemo(
    () =>
      mergeActionEntries(
        messages.flatMap((message) => message.actions || []),
        liveActions,
      ),
    [messages, liveActions],
  );
  const filteredActivityEntries = useMemo(
    () =>
      activityEntries.filter((entry) => {
        if (activityFilter === "all") return true;
        if (activityFilter === "web")
          return entry.kind === "web" || entry.kind === "browser";
        if (activityFilter === "device") return entry.kind === "computer";
        return entry.kind === "files" || entry.kind === "command";
      }),
    [activityEntries, activityFilter],
  );

  const refreshModels = async () => {
    const [nextModels, profile] = await Promise.all([
      window.oscode.listAiModels(),
      window.oscode.aiHardwareProfile(),
    ]);
    setModels(nextModels);
    setHardware(profile);
    setModelsReady(true);
    const current = nextModels.find(
      (item) =>
        item.path === model &&
        item.installed !== false &&
        item.supported !== false,
    );
    const selected =
      current ||
      (manualEngine.current
        ? undefined
        : recommendedModel(nextModels, profile));
    if (selected && selected.engine !== engine) {
      onEngine(selected.engine);
      onModel(selected.path);
    }
    if (selected && !current) {
      onModel(selected.path);
      onContextLimit(recommendedActiveContext(selected, profile));
      setStatus("osChat model ready");
    }
  };

  const refreshOllamaCli = async () => {
    const next = await window.oscode.ollamaCliStatus();
    setOllamaCli(next);
    return next;
  };

  const installOllamaCli = async () => {
    setOllamaCliBusy(true);
    try {
      const next = await window.oscode.installOllamaCli();
      setOllamaCli(next);
      setStatus("Ollama CLI ready · local only");
      onNotice("Ollama CLI is ready");
    } catch (error) {
      onNotice(publicAiError(error, "Ollama CLI setup failed"));
    } finally {
      setOllamaCliBusy(false);
    }
  };

  const refreshAgentState = async () => {
    if (!projectName) {
      setAgentState(emptyAgentState);
      return emptyAgentState;
    }
    let next = await window.oscode.aiAgentState();
    if (!next.chats.length) {
      const created = await window.oscode.createAiChat(undefined, true);
      next = await window.oscode.aiAgentState();
      chatIdRef.current = created.id;
      messagesRef.current = [];
      setChatId(created.id);
      setMessages([]);
      setContextSummary("");
    }
    setAgentState(next);
    return next;
  };

  const refreshHistory = async (showLatest = false) => {
    if (!projectName) return;
    const entries = await window.oscode.listAiHistory();
    setHistory(entries);
    if (showLatest) setReview(entries.at(-1) || null);
  };

  const chooseChat = (chat: AiChatThread, closeWorkspace = true) => {
    const cleanMessages = cleanStoredMessages(chat.messages);
    liveActionsRef.current = [];
    setLiveActions([]);
    chatIdRef.current = chat.id;
    messagesRef.current = cleanMessages;
    setChatId(chat.id);
    setMessages(cleanMessages);
    setInput("");
    setAttachments([]);
    setPermissionRequest(null);
    setLiveModelOutput({ chatId: "", reasoning: "", answer: "" });
    setGoalMenuOpen(false);
    setContextSummary(chat.contextSummary);
    setUsage({ used: 0, limit: contextLimit, compacted: false });
    setGoalDraft(
      agentState.goals.find(
        (item) => item.chatId === chat.id && item.status === "active",
      )?.text || "",
    );
    setQueueDraft("");
    setSchedulePrompt("");
    setScheduleAt("");
    setOpenChatIds((current) =>
      current.includes(chat.id) ? current : [...current, chat.id],
    );
    onChatOpened?.(chat.id);
    if (closeWorkspace) setWorkspaceOpen(false);
    queueTimer.current = setTimeout(() => void runNextQueued(), 150);
  };

  const closeChatTab = (closingId: string) => {
    const closingIndex = orderedOpenChatIds.indexOf(closingId);
    const remaining = orderedOpenChatIds.filter((id) => id !== closingId);
    setOpenChatIds(remaining);
    setPinnedChatIds((current) => current.filter((id) => id !== closingId));
    setChatTabMenuId("");
    if (closingId !== chatIdRef.current) return;
    const fallbackId =
      remaining[Math.min(Math.max(0, closingIndex), remaining.length - 1)] ||
      agentState.chats
        .slice()
        .reverse()
        .find((chat) => chat.id !== closingId)?.id;
    const fallback = agentState.chats.find((chat) => chat.id === fallbackId);
    if (fallback) chooseChat(fallback, false);
    else {
      // A project always keeps one active chat. With no alternative, closing
      // the sole tab simply collapses the tab strip instead of losing context.
      setOpenChatIds([closingId]);
    }
  };

  const toggleChatTabMenu = (
    targetChatId: string,
    trigger: HTMLButtonElement,
  ) => {
    if (chatTabMenuId === targetChatId) {
      setChatTabMenuId("");
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 190;
    setChatTabMenuPosition({
      top: Math.min(rect.bottom + 8, window.innerHeight - 176),
      left: Math.max(
        10,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 10),
      ),
    });
    setChatTabMenuId(targetChatId);
  };

  const togglePinnedChat = (targetChatId: string) => {
    setOpenChatIds((current) =>
      current.includes(targetChatId) ? current : [...current, targetChatId],
    );
    setPinnedChatIds((current) =>
      current.includes(targetChatId)
        ? current.filter((id) => id !== targetChatId)
        : [...current, targetChatId],
    );
    setChatTabMenuId("");
  };

  const toggleFavoriteChat = async (chat: AiChatThread) => {
    await window.oscode.updateAiChatMetadata(chat.id, {
      favorite: !chat.favorite,
    });
    await refreshAgentState();
    setChatTabMenuId("");
    setStatus(chat.favorite ? "Removed from favorites" : "Added to favorites");
  };

  useEffect(() => {
    void refreshModels().catch(() => undefined);
    void window.oscode
      .aiPipelineState()
      .then(setPipelineState)
      .catch(() => undefined);
    const offStatus = window.oscode.onAiStatus(setStatus);
    const offModelOutput = window.oscode.onAiModelOutput(
      (output: AiModelOutput) => {
        if (output.chatId !== chatIdRef.current) return;
        setLiveModelOutput((current) => {
          const base =
            output.reset || current.chatId !== output.chatId
              ? { chatId: output.chatId, reasoning: "", answer: "" }
              : current;
          if (!output.delta) return base;
          return output.phase === "reasoning"
            ? {
                ...base,
                reasoning: `${base.reasoning}${output.delta}`.slice(-40_000),
              }
            : {
                ...base,
                answer: `${base.answer}${output.delta}`.slice(-100_000),
              };
        });
      },
    );
    const offAction = window.oscode.onAiAction((action) => {
      if (action.chatId !== chatIdRef.current) return;
      const next = mergeActionEntries(liveActionsRef.current, [action]);
      liveActionsRef.current = next;
      setLiveActions(next);
    });
    const offPipeline = window.oscode.onAiPipelineState(setPipelineState);
    const offComplete = window.oscode.onAiChatComplete((completedChatId) => {
      void refreshAgentState()
        .then((next) => {
          if (completedChatId !== chatIdRef.current) return;
          const chat = next.chats.find((item) => item.id === completedChatId);
          if (!chat) return;
          const cleanMessages = cleanStoredMessages(chat.messages);
          messagesRef.current = cleanMessages;
          setMessages(cleanMessages);
          setContextSummary(chat.contextSummary);
          setBusy(false);
          busyRef.current = false;
          setLiveModelOutput({ chatId: "", reasoning: "", answer: "" });
        })
        .catch(() => undefined);
    });
    return () => {
      offStatus();
      offModelOutput();
      offAction();
      offPipeline();
      offComplete();
    };
  }, []);
  useEffect(() => {
    if (!chatId) return;
    const activeChatBusy =
      pipelineState.activeChatId === chatId && pipelineState.state !== "idle";
    busyRef.current = activeChatBusy;
    setBusy(activeChatBusy);
  }, [chatId, pipelineState.activeChatId, pipelineState.state]);
  useEffect(() => {
    if (!workspaceMode || !permissionsDrawerOpen) return;

    const placePermissionsPopover = () => {
      const anchor = permissionsToggleRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(520, Math.max(300, viewportWidth - 32));
      const left = Math.min(
        Math.max(16, rect.right - width),
        Math.max(16, viewportWidth - width - 16),
      );

      setPermissionsPopoverPosition({
        left,
        bottom: Math.max(16, viewportHeight - rect.top + 10),
        width,
        maxHeight: Math.max(210, Math.min(400, rect.top - 26)),
      });
    };

    placePermissionsPopover();
    window.addEventListener("resize", placePermissionsPopover);
    window.addEventListener("scroll", placePermissionsPopover, true);
    return () => {
      window.removeEventListener("resize", placePermissionsPopover);
      window.removeEventListener("scroll", placePermissionsPopover, true);
    };
  }, [permissionsDrawerOpen, workspaceMode]);
  useEffect(() => {
    if (!modelsReady || tierPickerInitialized.current) return;
    tierPickerInitialized.current = true;
    const configured = models.some(
      (item) =>
        item.path === model &&
        item.installed !== false &&
        item.supported !== false,
    );
    setTierPickerOpen(!configured);
  }, [modelsReady, models, model]);
  useEffect(() => {
    if (
      selectedModel &&
      selectedModel.installed !== false &&
      selectedModel.supported !== false
    )
      setTierPickerOpen(false);
  }, [selectedModel?.path]);
  useEffect(() => {
    if (ollamaPickerOpen) void refreshOllamaCli().catch(() => undefined);
  }, [ollamaPickerOpen]);
  useEffect(() => {
    setHistory([]);
    setReview(null);
    liveActionsRef.current = [];
    setLiveActions([]);
    setChatId("");
    setMessages([]);
    setContextSummary("");
    setPermissionsDrawerOpen(false);
    setChatTabMenuId("");
    setOpenChatIds([]);
    setPinnedChatIds([]);
    chatTabsReadyRef.current = false;
    if (projectName)
      void refreshAgentState()
        .then((next) => {
          const stored = readStoredChatTabs(storedChatTabsKey);
          const available = new Set(next.chats.map((chat) => chat.id));
          const restoredOpenIds = uniqueChatIds(
            stored.openChatIds.filter((id) => available.has(id)),
          );
          const restoredPinnedIds = uniqueChatIds(
            stored.pinnedChatIds.filter((id) => available.has(id)),
          );
          const latest = next.chats.at(-1);
          const restoredActive = next.chats.find(
            (chat) => chat.id === stored.activeChatId,
          );
          const target = restoredActive || latest;
          if (target) {
            setOpenChatIds(
              restoredOpenIds.includes(target.id)
                ? restoredOpenIds
                : [...restoredOpenIds, target.id],
            );
            setPinnedChatIds(restoredPinnedIds);
            chooseChat(target);
          }
          chatTabsReadyRef.current = true;
        })
        .catch(() => undefined);
  }, [projectName, storedChatTabsKey]);

  useEffect(() => {
    if (!projectName || !chatTabsReadyRef.current) return;
    const available = new Set(agentState.chats.map((chat) => chat.id));
    const open = uniqueChatIds(
      [...openChatIds, chatId].filter((id) => available.has(id)),
    );
    const pinned = uniqueChatIds(
      pinnedChatIds.filter((id) => open.includes(id)),
    );
    window.localStorage.setItem(
      storedChatTabsKey,
      JSON.stringify({
        openChatIds: open,
        pinnedChatIds: pinned,
        activeChatId: available.has(chatId) ? chatId : "",
      } satisfies StoredChatTabs),
    );
  }, [
    agentState.chats,
    chatId,
    openChatIds,
    pinnedChatIds,
    projectName,
    storedChatTabsKey,
  ]);
  useEffect(() => {
    const wasBusy = previousBusyRef.current;
    previousBusyRef.current = busy;
    if (busy && !followConversationRef.current) return;
    if (!busy && wasBusy) followConversationRef.current = true;
    const frame = requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (!conversation) return;
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: !busy && wasBusy ? "smooth" : "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, liveActions.length, busy]);
  useEffect(() => {
    messagesRef.current = messages;
    setUsage((current) => ({
      ...current,
      used: Math.min(
        current.limit,
        Math.ceil(JSON.stringify({ messages, contextSummary }).length / 4),
      ),
    }));
  }, [messages, contextSummary]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(
    () =>
      window.oscode.onMenuAction((action) =>
        touchBarActionsRef.current[action]?.(),
      ),
    [],
  );
  useEffect(() => {
    if (window.oscode.platform !== "darwin") return;
    void window.oscode.setTouchBarState({
      busy,
      canAttach: Boolean(projectName && attachments.length < 6),
      canSend: Boolean(
        projectName &&
        model &&
        (input.trim().length > 0 || attachments.length > 0),
      ),
      canRetry: Boolean(
        !busy &&
        !permissionRequest &&
        pendingEdits.length === 0 &&
        messages.at(-1)?.role === "assistant" &&
        messages.some((message) => message.role === "user"),
      ),
    });
  }, [
    attachments.length,
    busy,
    input,
    messages,
    model,
    pendingEdits.length,
    permissionRequest,
    projectName,
  ]);
  useEffect(() => {
    capabilityRef.current = {
      editMode,
      terminalMode,
      fileAccess,
      webAccess,
      browserAccess,
      computerAccess,
    };
  }, [
    editMode,
    terminalMode,
    fileAccess,
    webAccess,
    browserAccess,
    computerAccess,
  ]);
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);
  useEffect(() => {
    setGoalDraft(activeGoal?.text || "");
  }, [chatId, activeGoal?.id, activeGoal?.text]);
  useEffect(
    () => setUsage((current) => ({ ...current, limit: contextLimit })),
    [contextLimit],
  );
  useEffect(() => {
    if (!selectedModel) return;
    const intended = recommendedActiveContext(selectedModel, hardware);
    if (contextLimit !== intended) onContextLimit(intended);
  }, [
    selectedModel?.path,
    selectedModel?.contextLimit,
    selectedModel?.preferredContext,
  ]);
  useEffect(() => {
    if (!modelsReady) return;
    const current = models.find(
      (item) =>
        item.path === model &&
        item.installed !== false &&
        item.supported !== false,
    );
    if (current) return;
    if (manualEngine.current === engine) return;
    const selected = recommendedModel(models, hardware);
    if (!selected) return;
    onEngine(selected.engine);
    onModel(selected.path);
    onContextLimit(recommendedActiveContext(selected, hardware));
    setStatus(`${selected.name} selected automatically`);
  }, [modelsReady, models, model, hardware]);
  useEffect(() => {
    if (!projectName) return;
    const collect = () => {
      void window.oscode
        .collectDueAiSchedules()
        .then((count) => {
          if (count) {
            setStatus(
              `${count} scheduled task${count === 1 ? "" : "s"} queued`,
            );
            void refreshAgentState().then(() => {
              queueTimer.current = setTimeout(() => void runNextQueued(), 100);
            });
          }
        })
        .catch(() => undefined);
    };
    collect();
    const timer = setInterval(collect, 30_000);
    return () => clearInterval(timer);
  }, [projectName]);
  useEffect(
    () => () => {
      if (queueTimer.current) clearTimeout(queueTimer.current);
    },
    [],
  );
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (browserAccess || computerAccess)
        void window.oscode.stopAgentControl();
      setWorkspaceOpen(false);
      setActivityOpen(false);
      setHistoryOpen(false);
      setPermissionOpen(false);
      setModelsOpen(false);
      setAddMenuOpen(false);
      setOllamaPickerOpen(false);
      setCustomListOpen(false);
      setChatTabMenuId("");
      if (expanded) setExpanded(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [browserAccess, computerAccess, expanded]);
  useEffect(() => {
    if (!chatTabMenuId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".ai-chat-tab-menu, .ai-chat-tab-more")) return;
      setChatTabMenuId("");
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [chatTabMenuId]);
  useEffect(() => {
    const openRequestedChat = (event: Event) => {
      const requested = (event as CustomEvent<string>).detail;
      const chat = agentState.chats.find((item) => item.id === requested);
      if (chat) chooseChat(chat);
    };
    window.addEventListener("oscode:open-ai-chat", openRequestedChat);
    return () =>
      window.removeEventListener("oscode:open-ai-chat", openRequestedChat);
  }, [agentState.chats]);
  useEffect(() => {
    if (!openChatId) return;
    let cancelled = false;
    void (async () => {
      let chat = agentState.chats.find((item) => item.id === openChatId);
      if (!chat) {
        const next = await window.oscode.aiAgentState();
        if (cancelled) return;
        chat = next.chats.find((item) => item.id === openChatId);
        if (chat) setAgentState(next);
      }
      if (!chat || chat.id === chatIdRef.current) return;
      chooseChat(chat, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [openChatId, agentState.chats]);

  const chooseLocal = async (
    targetEngine: Exclude<AiEngine, "ollama">,
    kind: "file" | "folder" | "any" = targetEngine === "llamacpp"
      ? "any"
      : "folder",
  ) => {
    try {
      const selected = await window.oscode.chooseAiModel(targetEngine, kind);
      if (!selected.length) return;
      await refreshModels();
      const preferred = recommendedModel(selected, hardware) || selected[0];
      manualEngine.current = null;
      onEngine(preferred.engine);
      onModel(preferred.path);
      onContextLimit(recommendedActiveContext(preferred, hardware));
      setAddMenuOpen(false);
      setTierPickerOpen(false);
      setStatus(
        `${selected.length} custom model${selected.length === 1 ? "" : "s"} ready`,
      );
    } catch (error) {
      onNotice(publicAiError(error, "Model could not be added"));
    }
  };

  const pullOllama = async () => {
    if (!source.trim()) return;
    setBusy(true);
    try {
      const added = await window.oscode.downloadAiModel(
        "ollama",
        source.trim(),
      );
      await refreshModels();
      manualEngine.current = null;
      onEngine("ollama");
      onModel(added.path);
      onContextLimit(recommendedActiveContext(added, hardware));
      setSource("");
      setOllamaPickerOpen(false);
      setModelsOpen(false);
      setAddMenuOpen(false);
      setCustomListOpen(false);
      setTierPickerOpen(false);
      setStatus(`${added.name} is ready`);
      onNotice(`${added.name} is ready and selected`);
    } catch (error) {
      onNotice(publicAiError(error, "Ollama pull failed"));
    } finally {
      setBusy(false);
    }
  };

  const chooseEngine = (nextEngine: AiEngine) => {
    manualEngine.current = nextEngine;
    onEngine(nextEngine);
    const available = models.find(
      (item) =>
        item.engine === nextEngine &&
        item.installed !== false &&
        item.supported !== false,
    );
    if (!available) {
      onModel("");
      if (nextEngine !== "llamacpp") onContextLimit(8_192);
      return;
    }
    manualEngine.current = null;
    onModel(available.path);
    onContextLimit(recommendedActiveContext(available, hardware));
  };

  const chooseOllamaModel = (item: AiModel) => {
    manualEngine.current = null;
    onEngine("ollama");
    onModel(item.path);
    onContextLimit(recommendedActiveContext(item, hardware));
    setSource("");
    setOllamaPickerOpen(false);
    setModelsOpen(false);
    setAddMenuOpen(false);
    setCustomListOpen(false);
    setTierPickerOpen(false);
    setStatus(`${item.name} selected`);
    onNotice(`${item.name} is ready and selected`);
  };

  const remove = async (item: AiModel) => {
    if (
      (item.engine === "ollama" || osCodeGgufTier(item)) &&
      !window.confirm(`Remove ${item.name} and its downloaded model files?`)
    )
      return;
    try {
      await window.oscode.removeAiModel(item.id);
      if (model === item.path) onModel("");
      await refreshModels();
      setStatus(
        item.engine === "ollama" || osCodeGgufTier(item)
          ? `${item.name} removed`
          : `${item.name} reference removed`,
      );
    } catch (error) {
      onNotice(publicAiError(error, "Model could not be removed"));
    }
  };

  const addAttachments = async (files: FileList | File[]) => {
    const accepted = Array.from(files).flatMap((file) => {
      const kind = attachmentKind(file);
      if (!kind) {
        onNotice(
          `${file.name || "This file"} is not a supported local attachment`,
        );
        return [];
      }
      return [{ file, kind }];
    });
    const remaining = Math.max(0, 6 - attachments.length);
    const currentBytes = attachments.reduce(
      (total, attachment) => total + (attachment.size || 0),
      0,
    );
    let pendingBytes = 0;
    const next = await Promise.all(
      accepted.slice(0, remaining).map(
        ({ file, kind }) =>
          new Promise<AiChatAttachment | null>((resolve) => {
            if (file.size > 12 * 1024 * 1024) {
              onNotice(`${file.name} is larger than the 12 MB local limit`);
              resolve(null);
              return;
            }
            if (currentBytes + pendingBytes + file.size > 24 * 1024 * 1024) {
              onNotice("Attachments are limited to 24 MB per message");
              resolve(null);
              return;
            }
            pendingBytes += file.size;
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result || "");
              const mimeType =
                dataUrl.match(/^data:([^;]+);base64,/)?.[1] ||
                file.type ||
                "application/octet-stream";
              resolve({
                id: globalThis.crypto.randomUUID(),
                name: file.name || `Pasted ${kind}`,
                kind,
                mimeType,
                dataUrl,
                size: file.size,
              });
            };
            reader.onerror = () => {
              onNotice(
                `${file.name || "Attachment"} could not be read locally`,
              );
              resolve(null);
            };
            reader.readAsDataURL(file);
          }),
      ),
    );
    setAttachments((current) => [
      ...current,
      ...(next.filter(Boolean) as AiChatAttachment[]),
    ]);
  };

  const saveConversation = async (
    nextMessages: AiChatMessage[],
    nextSummary: string,
    targetChatId = chatIdRef.current,
  ) => {
    if (!targetChatId) return;
    await window.oscode.saveAiChat(targetChatId, nextMessages, nextSummary);
    await refreshAgentState();
  };

  const resolveLatestPermissionAction = async (
    status: "completed" | "denied",
    detail: string,
  ) => {
    const next = messagesRef.current.map((message) => ({
      ...message,
      actions: message.actions?.map((action) => ({ ...action })),
    }));
    let resolved = false;
    let resolvedActionId = "";
    for (
      let messageIndex = next.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const chatMessage = next[messageIndex];
      if (chatMessage.role !== "assistant" || !chatMessage.actions?.length)
        continue;
      for (
        let actionIndex = chatMessage.actions.length - 1;
        actionIndex >= 0;
        actionIndex -= 1
      ) {
        const action = chatMessage.actions[actionIndex];
        if (action.status !== "waiting") continue;
        chatMessage.actions[actionIndex] = {
          ...action,
          status,
          title:
            status === "denied"
              ? `${permissionRequest?.title || "Permission"} denied`
              : `${permissionRequest?.title || "Permission"} granted`,
          detail,
          completedAt: new Date().toISOString(),
        };
        resolvedActionId = action.id;
        resolved = true;
        break;
      }
      if (resolved) break;
    }
    if (!resolved) return;
    messagesRef.current = next;
    setMessages(next);
    followConversationRef.current = true;
    if (resolvedActionId) {
      const remainingLiveActions = liveActionsRef.current.filter(
        (action) => action.id !== resolvedActionId,
      );
      liveActionsRef.current = remainingLiveActions;
      setLiveActions(remainingLiveActions);
    }
    if (permissionContinuation.current)
      permissionContinuation.current = {
        ...permissionContinuation.current,
        messages: next,
      };
    await saveConversation(next, contextSummary);
  };

  const ensureCapabilityPermissions = async (
    currentChatId: string,
    capabilities: typeof capabilityRef.current,
  ) => {
    const desired: Array<{ kind: AiPermissionKind; detail: string }> = [];
    if (capabilities.fileAccess) {
      desired.push({
        kind: "project.read",
        detail: "Files is enabled for this project",
      });
      if (capabilities.editMode !== "read-only")
        desired.push({
          kind: "project.write",
          detail: "Edits is enabled for this project",
        });
    }
    if (capabilities.webAccess)
      desired.push({
        kind: "web.search",
        detail: "Web is enabled for this chat",
      });
    if (capabilities.browserAccess)
      desired.push({
        kind: "browser.control",
        detail: "Browser is enabled for this chat",
      });
    if (capabilities.terminalMode === "auto")
      desired.push({
        kind: "terminal.run",
        detail: "Terminal is automatic for this chat",
      });
    if (capabilities.computerAccess)
      desired.push({
        kind: "computer.control",
        detail: "Control is enabled for this chat",
      });
    if (!desired.length) return;
    const state = await window.oscode.aiAgentState();
    if (!state.chats.some((item) => item.id === currentChatId)) return;
    let granted = false;
    for (const permission of desired) {
      const exists = state.permissions.some(
        (item) =>
          item.kind === permission.kind &&
          (item.scope === "always" || item.chatId === currentChatId),
      );
      if (exists) continue;
      await window.oscode.grantAiPermission(
        permission.kind,
        "conversation",
        currentChatId,
        permission.detail,
      );
      granted = true;
    }
    if (granted) await refreshAgentState();
  };

  const revokeAutomaticTerminal = async (currentChatId: string) => {
    const state = await window.oscode.aiAgentState();
    const grants = state.permissions.filter(
      (permission) =>
        permission.kind === "terminal.run" &&
        (permission.scope === "always" || permission.chatId === currentChatId),
    );
    await Promise.all(
      grants.map((permission) =>
        window.oscode.revokeAiPermission(permission.id),
      ),
    );
    if (grants.length) await refreshAgentState();
  };

  const applyCapabilities = (
    next: typeof capabilityRef.current,
    statusMessage: string,
  ) => {
    const previous = capabilityRef.current;
    capabilityRef.current = next;
    onEditMode(next.editMode);
    onTerminalMode(next.terminalMode);
    onFileAccess(next.fileAccess);
    onWebAccess(next.webAccess);
    onBrowserAccess(next.browserAccess);
    onComputerAccess(next.computerAccess);
    setStatus(statusMessage);
    const currentChatId = chatIdRef.current;
    if (!currentChatId) return;
    const permissions =
      previous.terminalMode === "auto" && next.terminalMode === "ask"
        ? revokeAutomaticTerminal(currentChatId)
        : ensureCapabilityPermissions(currentChatId, next);
    void permissions
      .then(() => setStatus(`${statusMessage} · model updated`))
      .catch((error) =>
        setStatus(publicAiError(error, "Capability permission could not save")),
      );
  };

  const scheduleQueueRun = (delay = 150) => {
    if (queueTimer.current) clearTimeout(queueTimer.current);
    queueTimer.current = setTimeout(() => {
      queueTimer.current = null;
      void runNextQueued();
    }, delay);
  };

  const runPrompt = async (
    text: string,
    queueId?: string,
    promptAttachments: AiChatAttachment[] = [],
    continuation?: {
      messages: AiChatMessage[];
      contextSummary: string;
    },
    capabilityOverride?: typeof capabilityRef.current,
  ) => {
    const executionChatId = chatIdRef.current;
    if ((!text.trim() && !continuation) || busyRef.current || !executionChatId)
      return;
    const requestEpoch = ++requestEpochRef.current;
    if (!continuation) {
      permissionContinuation.current = null;
      onAttentionChange?.(null, null);
    }
    const next = continuation
      ? continuation.messages
      : [
          ...messagesRef.current,
          {
            id: globalThis.crypto.randomUUID(),
            role: "user" as const,
            content: text.trim(),
            createdAt: new Date().toISOString(),
            attachments: promptAttachments,
          },
        ];
    messagesRef.current = next;
    setMessages(next);
    followConversationRef.current = true;
    setInput("");
    liveActionsRef.current = [];
    setLiveActions([]);
    stoppingRef.current = false;
    setBusy(true);
    busyRef.current = true;
    setLiveModelOutput({
      chatId: executionChatId,
      reasoning: "",
      answer: "",
    });
    if (queueId) await window.oscode.updateAiQueue(queueId, "running");
    let failed = false;
    try {
      const activeCapabilities = capabilityOverride || capabilityRef.current;
      const requestSummary = continuation?.contextSummary ?? contextSummary;
      await saveConversation(next, requestSummary, executionChatId);
      await ensureCapabilityPermissions(executionChatId, activeCapabilities);
      const response = await window.oscode.aiChat({
        chatId: executionChatId,
        engine,
        model,
        executable,
        messages: next,
        editMode: activeCapabilities.editMode,
        terminalMode: activeCapabilities.terminalMode,
        fileAccess: activeCapabilities.fileAccess,
        webAccess: activeCapabilities.webAccess,
        browserAccess: activeCapabilities.browserAccess,
        computerAccess: activeCapabilities.computerAccess,
        resumePermission: Boolean(continuation),
        contextLimit,
        hardware: hardwarePreference,
        thinkingEnabled,
        contextSummary: requestSummary,
        goal: activeGoal?.text || "",
      });
      if (requestEpoch !== requestEpochRef.current) {
        failed = true;
        return;
      }
      const responseActions = mergeActionEntries(
        liveActionsRef.current,
        response.actions,
      );
      const assistant: AiChatMessage = {
        id: globalThis.crypto.randomUUID(),
        role: "assistant",
        content: contentWithSources(response.content, responseActions),
        thinking: response.thinking,
        actions: responseActions,
        createdAt: new Date().toISOString(),
        assistantName:
          selectedModel && osCodeGgufTier(selectedModel)
            ? "osChat"
            : "Custom Model",
      };
      const retained = response.retainedMessages || next;
      const completed = [...retained, assistant];
      if (chatIdRef.current === executionChatId) {
        messagesRef.current = completed;
        setMessages(completed);
      }
      liveActionsRef.current = [];
      setLiveActions([]);
      if (response.changedFiles.length) await onChanged(response.changedFiles);
      if (response.changedFiles.length) await refreshHistory(true);
      if (chatIdRef.current === executionChatId) {
        setPendingEdits(response.pendingEdits);
        setPermissionRequest(response.permissionRequest || null);
        permissionContinuation.current = response.permissionRequest
          ? { messages: completed, contextSummary: response.contextSummary }
          : null;
        setContextSummary(response.contextSummary);
        setUsage(response.usage);
      }
      await saveConversation(
        completed,
        response.contextSummary,
        executionChatId,
      );
      if (
        !response.permissionRequest &&
        temporaryPermissionIds.current.length
      ) {
        await Promise.all(
          temporaryPermissionIds.current.map((id) =>
            window.oscode.revokeAiPermission(id),
          ),
        );
        temporaryPermissionIds.current = [];
      }
      setStatus(
        response.permissionRequest
          ? "Waiting for permission"
          : response.usage.compacted
            ? "Conversation compacted · ready"
            : response.toolSteps.length
              ? `${response.toolSteps.length} local step${response.toolSteps.length === 1 ? "" : "s"}`
              : "Ready · local only",
      );
      if (!response.permissionRequest) {
        const responseText = response.content.trim();
        const needsInput =
          /\?\s*$/.test(responseText) ||
          /(?:please (?:choose|confirm|tell me)|which (?:option|file|approach)|waiting for your (?:input|answer)|what would you like)/i.test(
            responseText.slice(-500),
          );
        onAttentionChange?.(
          {
            kind: needsInput ? "input" : "response",
            chatId: executionChatId,
            title: needsInput
              ? "osChat needs your input"
              : "osChat finished responding",
            detail:
              responseText.replace(/\s+/g, " ").slice(0, 180) ||
              "The local agent completed its response.",
          },
          null,
        );
      }
    } catch (error) {
      failed = true;
      if (steeringRef.current) {
        setStatus("Steering…");
      } else if (stoppingRef.current) {
        liveActionsRef.current = [];
        setLiveActions([]);
        setStatus("Stopped");
      } else {
        const message = publicAiError(error, "Local AI request failed");
        const failureMessage: AiChatMessage = {
          id: globalThis.crypto.randomUUID(),
          role: "assistant",
          content: `I couldn't complete that request. ${message}`,
          actions:
            liveActionsRef.current.length > 0
              ? liveActionsRef.current.map((action) =>
                  action.status === "running"
                    ? {
                        ...action,
                        status: "failed" as const,
                        detail: `${action.detail ? `${action.detail} · ` : ""}Request stopped`,
                        completedAt: new Date().toISOString(),
                      }
                    : action,
                )
              : [
                  {
                    id: globalThis.crypto.randomUUID(),
                    chatId: executionChatId,
                    kind: "result" as const,
                    status: "failed" as const,
                    title: "Request stopped",
                    detail: message,
                    createdAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                  },
                ],
          createdAt: new Date().toISOString(),
          assistantName:
            selectedModel && osCodeGgufTier(selectedModel)
              ? "osChat"
              : "Custom Model",
        };
        const completed = [...next, failureMessage];
        if (chatIdRef.current === executionChatId) {
          messagesRef.current = completed;
          setMessages(completed);
        }
        liveActionsRef.current = [];
        setLiveActions([]);
        await saveConversation(
          completed,
          continuation?.contextSummary ?? contextSummary,
          executionChatId,
        ).catch(() => undefined);
        onNotice(message);
        onAttentionChange?.(
          {
            kind: "response",
            chatId: executionChatId,
            title: "osChat request stopped",
            detail: message,
          },
          null,
        );
        setStatus("Stopped");
      }
    } finally {
      if (queueId)
        await window.oscode.updateAiQueue(
          queueId,
          failed ? "failed" : "complete",
        );
      setBusy(false);
      busyRef.current = false;
      setLiveModelOutput({ chatId: "", reasoning: "", answer: "" });
      steeringRef.current = false;
      stoppingRef.current = false;
      await refreshAgentState().catch(() => undefined);
      scheduleQueueRun();
    }
  };

  const runBackgroundQueued = async (
    chat: AiChatThread,
    item: AiQueueItem,
    goal: string,
  ) => {
    if (busyRef.current) return;
    const userMessage: AiChatMessage = {
      id: globalThis.crypto.randomUUID(),
      role: "user",
      content: item.prompt,
      createdAt: new Date().toISOString(),
    };
    const next = [...chat.messages, userMessage];
    setBusy(true);
    busyRef.current = true;
    setLiveModelOutput({ chatId: chat.id, reasoning: "", answer: "" });
    setStatus(`Running scheduled work in ${chat.title}`);
    await window.oscode.updateAiQueue(item.id, "running");
    let failed = false;
    try {
      const response = await window.oscode.aiChat({
        chatId: chat.id,
        engine,
        model,
        executable,
        messages: next,
        editMode,
        terminalMode,
        fileAccess,
        webAccess,
        browserAccess,
        computerAccess,
        resumePermission: false,
        contextLimit,
        hardware: hardwarePreference,
        thinkingEnabled,
        contextSummary: chat.contextSummary,
        goal,
      });
      const assistant: AiChatMessage = {
        id: globalThis.crypto.randomUUID(),
        role: "assistant",
        content: contentWithSources(response.content, response.actions),
        thinking: response.thinking,
        actions: response.actions,
        createdAt: new Date().toISOString(),
        assistantName:
          selectedModel && osCodeGgufTier(selectedModel)
            ? "osChat"
            : "Custom Model",
      };
      await window.oscode.saveAiChat(
        chat.id,
        [...(response.retainedMessages || next), assistant],
        response.contextSummary,
      );
      if (response.changedFiles.length) await onChanged(response.changedFiles);
      if (response.permissionRequest) {
        failed = true;
        onAttentionChange?.(
          {
            kind: "permission",
            chatId: chat.id,
            title: response.permissionRequest.title,
            detail: response.permissionRequest.detail,
            permissionKind: response.permissionRequest.kind,
          },
          null,
        );
        onNotice(
          `${chat.title} needs permission before scheduled work can continue`,
        );
      }
    } catch (error) {
      failed = true;
      onNotice(publicAiError(error, `Scheduled work failed in ${chat.title}`));
    } finally {
      await window.oscode.updateAiQueue(
        item.id,
        failed ? "failed" : "complete",
      );
      setBusy(false);
      busyRef.current = false;
      setLiveModelOutput({ chatId: "", reasoning: "", answer: "" });
      setStatus(
        failed ? "Scheduled work needs attention" : "Ready · local only",
      );
      await refreshAgentState().catch(() => undefined);
      scheduleQueueRun();
    }
  };

  const runNextQueued = async () => {
    const currentPipeline = await window.oscode.aiPipelineState();
    setPipelineState(currentPipeline);
    if (busyRef.current || currentPipeline.state !== "idle") {
      scheduleQueueRun(250);
      return;
    }
    const nextState = await refreshAgentState();
    const next = nextState.queue.find(
      (item) =>
        item.status === "queued" &&
        (!item.runAt || new Date(item.runAt).getTime() <= Date.now()),
    );
    if (next) {
      const nextChat = nextState.chats.find((chat) => chat.id === next.chatId);
      if (!nextChat) {
        await window.oscode.removeAiQueue(next.id);
      } else if (nextChat.id === chatIdRef.current) {
        await runPrompt(next.prompt, next.id);
      } else {
        const goal = nextState.goals.find(
          (item) => item.chatId === nextChat.id && item.status === "active",
        );
        await runBackgroundQueued(nextChat, next, goal?.text || "");
      }
    }
  };

  const steerQueued = async (item: AiQueueItem) => {
    if (!(await window.oscode.prioritizeAiQueue(item.id))) return;
    if (busyRef.current) {
      steeringRef.current = true;
      requestEpochRef.current += 1;
      await window.oscode.stopAi();
    }
    setStatus("Steering…");
    await refreshAgentState();
    scheduleQueueRun(50);
  };

  const deleteQueued = async (item: AiQueueItem) => {
    await window.oscode.removeAiQueue(item.id);
    await refreshAgentState();
    setStatus("Queued message removed");
  };

  const editQueued = async (item: AiQueueItem) => {
    await window.oscode.removeAiQueue(item.id);
    setInput(item.prompt);
    await refreshAgentState();
    setStatus("Queued message returned to the composer");
    requestAnimationFrame(() => {
      const composer = composerInputRef.current;
      composer?.focus();
      composer?.setSelectionRange(item.prompt.length, item.prompt.length);
    });
  };

  const handleCommand = async (text: string) => {
    if (text === "/new") {
      const chat = await window.oscode.createAiChat(undefined, true);
      await refreshAgentState();
      chooseChat(chat);
      return true;
    }
    if (text === "/clear") {
      setMessages([]);
      setContextSummary("");
      await saveConversation([], "");
      return true;
    }
    if (text === "/compact") {
      const current = messagesRef.current;
      if (current.length <= 6) {
        setInput("");
        setStatus("The conversation is already compact");
        return true;
      }
      const older = current.slice(0, -6);
      const recent = current.slice(-6);
      const summary = [
        contextSummary,
        ...older.map(
          (message) =>
            `${message.role}: ${message.content.replace(/\s+/g, " ").slice(0, 700)}`,
        ),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(-64_000);
      messagesRef.current = recent;
      setMessages(recent);
      setContextSummary(summary);
      setUsage({
        used: Math.ceil(JSON.stringify(recent).length / 4),
        limit: contextLimit,
        compacted: true,
      });
      setInput("");
      await saveConversation(recent, summary);
      setStatus("Conversation compacted locally");
      return true;
    }
    if (text === "/permissions") {
      openAiPopup("permissions");
      return true;
    }
    if (text.startsWith("/goal ")) {
      await window.oscode.setAiGoal(chatId, text.slice(6).trim());
      await refreshAgentState();
      setInput("");
      return true;
    }
    if (text.startsWith("/queue ")) {
      await window.oscode.addAiQueue(chatId, text.slice(7).trim());
      await refreshAgentState();
      setInput("");
      scheduleQueueRun(100);
      return true;
    }
    return false;
  };

  const stopResponse = () => {
    stoppingRef.current = true;
    requestEpochRef.current += 1;
    liveActionsRef.current = [];
    setLiveActions([]);
    busyRef.current = false;
    setBusy(false);
    setStatus("Stopped");
    void window.oscode.stopAi();
  };

  const retryLastResponse = async () => {
    const currentPipeline = await window.oscode
      .aiPipelineState()
      .catch(() => pipelineState);
    setPipelineState(currentPipeline);
    if (busyRef.current || currentPipeline.state !== "idle") {
      const blockingTitle =
        agentState.chats.find(
          (chat) => chat.id === currentPipeline.activeChatId,
        )?.title || "another chat";
      setStatus(`Wait for ${blockingTitle} to finish before retrying`);
      return;
    }
    const current = messagesRef.current;
    if (current.at(-1)?.role !== "assistant") return;
    let userIndex = -1;
    for (let index = current.length - 1; index >= 0; index -= 1) {
      if (current[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;
    const prompt = current[userIndex];
    const prior = current.slice(0, userIndex);
    messagesRef.current = prior;
    setMessages(prior);
    setPermissionRequest(null);
    setPendingEdits([]);
    permissionContinuation.current = null;
    liveActionsRef.current = [];
    setLiveActions([]);
    setStatus("Regenerating response…");
    await runPrompt(prompt.content, undefined, prompt.attachments || []);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text =
      input.trim() ||
      (attachments.length ? "Review the attached files locally." : "");
    if (!text) return;
    if (await handleCommand(text)) return;
    const currentPipeline = await window.oscode
      .aiPipelineState()
      .catch(() => pipelineState);
    setPipelineState(currentPipeline);
    if (busyRef.current || currentPipeline.state !== "idle") {
      const blockingTitle =
        agentState.chats.find(
          (chat) => chat.id === currentPipeline.activeChatId,
        )?.title || "another chat";
      await window.oscode.addAiQueue(chatId, text);
      setInput("");
      setAttachments([]);
      setPermissionsDrawerOpen(false);
      setStatus(
        currentPipeline.activeChatId && currentPipeline.activeChatId !== chatId
          ? `Waiting for ${blockingTitle} to finish · message queued`
          : "Message queued",
      );
      await refreshAgentState();
      scheduleQueueRun();
      return;
    }
    const sentAttachments = attachments;
    setAttachments([]);
    setPermissionsDrawerOpen(false);
    await runPrompt(text, undefined, sentAttachments);
  };

  const steer = async () => {
    const text = input.trim();
    if (!busy || !text) return;
    const item = await window.oscode.addAiQueue(chatId, text);
    await window.oscode.prioritizeAiQueue(item.id);
    steeringRef.current = true;
    requestEpochRef.current += 1;
    await window.oscode.stopAi();
    setInput("");
    setAttachments([]);
    setStatus("Steering next");
    await refreshAgentState();
    scheduleQueueRun(50);
  };

  touchBarActionsRef.current = {
    "chat-attach": () => attachmentInputRef.current?.click(),
    "chat-send": () => composerInputRef.current?.form?.requestSubmit(),
    "chat-stop": stopResponse,
    "chat-retry": () => void retryLastResponse(),
  };

  const grantPermission = async (scope: AiPermissionScope) => {
    if (!permissionRequest || !chatId) return;
    if (permissionRequest.kind === "computer.system") {
      await resolveLatestPermissionAction(
        "completed",
        `${permissionRequest.title} completed by the user; checking access now`,
      );
      const continuation = permissionContinuation.current;
      setPermissionRequest(null);
      onAttentionChange?.(null, null);
      setStatus("Checking operating-system permission…");
      await refreshAgentState();
      if (continuation)
        await runPrompt("", undefined, [], continuation, capabilityRef.current);
      return;
    }
    if (oneShotPermissionKinds.has(permissionRequest.kind)) scope = "once";
    const grant = await window.oscode.grantAiPermission(
      permissionRequest.kind,
      scope,
      chatId,
      permissionRequest.detail,
    );
    if (scope === "once") temporaryPermissionIds.current.push(grant.id);
    await resolveLatestPermissionAction(
      "completed",
      `${permissionRequest.title} granted · ${scope === "once" ? "once" : scope === "conversation" ? "this chat" : "always"}`,
    );
    const continuation = permissionContinuation.current;
    const nextCapabilities = { ...capabilityRef.current };
    if (
      permissionRequest.kind === "project.read" ||
      permissionRequest.kind === "project.write" ||
      permissionRequest.kind === "project.delete" ||
      permissionRequest.kind === "platformio.install" ||
      permissionRequest.kind === "platformio.run"
    )
      nextCapabilities.fileAccess = true;
    if (
      permissionRequest.kind === "project.write" &&
      nextCapabilities.editMode === "read-only"
    )
      nextCapabilities.editMode = "ask";
    if (permissionRequest.kind === "web.search")
      nextCapabilities.webAccess = true;
    if (permissionRequest.kind === "browser.control")
      nextCapabilities.browserAccess = true;
    if (permissionRequest.kind === "terminal.run" && scope !== "once")
      nextCapabilities.terminalMode = "auto";
    if (permissionRequest.kind === "computer.control")
      nextCapabilities.computerAccess = true;
    if (scope !== "once") {
      capabilityRef.current = nextCapabilities;
      onFileAccess(nextCapabilities.fileAccess);
      onEditMode(nextCapabilities.editMode);
      onTerminalMode(nextCapabilities.terminalMode);
      onWebAccess(nextCapabilities.webAccess);
      onBrowserAccess(nextCapabilities.browserAccess);
      onComputerAccess(nextCapabilities.computerAccess);
    }
    setPermissionRequest(null);
    onAttentionChange?.(null, null);
    await refreshAgentState();
    if (continuation)
      await runPrompt("", undefined, [], continuation, nextCapabilities);
  };

  useEffect(() => {
    if (!permissionRequest) return;
    onAttentionChange?.(
      {
        kind: "permission",
        chatId,
        title: permissionRequest.title,
        detail: permissionRequest.detail,
        permissionKind: permissionRequest.kind,
      },
      permissionRequest.kind === "computer.system"
        ? () => grantPermission("once")
        : null,
    );
  }, [permissionRequest?.id]);

  const selectBundledTier = async (tier: Exclude<AiModelTier, "custom">) => {
    const selected =
      tierModels.find(
        (item) => osCodeGgufTier(item) === tier && item.supported !== false,
      ) || tierModels.find((item) => osCodeGgufTier(item) === tier);
    if (!selected || selected.supported === false) return;
    if (selected.installed === false || selected.source === "available") {
      setDownloadingTier(tier);
      setStatus(`Starting ${tier} model download…`);
      try {
        const downloaded = await window.oscode.downloadOsCodeModel(tier);
        await refreshModels();
        onEngine(downloaded.engine);
        onModel(downloaded.path);
        onContextLimit(recommendedActiveContext(downloaded, hardware));
        setStatus(`${downloaded.name} ready`);
        setTierPickerOpen(false);
      } catch (error) {
        onNotice(publicAiError(error, "Model download failed"));
      } finally {
        setDownloadingTier("");
      }
      return;
    }
    onEngine(selected.engine);
    onModel(selected.path);
    onContextLimit(recommendedActiveContext(selected, hardware));
    setStatus(`${selected.name} selected`);
    setTierPickerOpen(false);
  };

  useEffect(() => {
    if (!controlsPortalId) {
      setControlsTarget(null);
      return;
    }
    setControlsTarget(document.getElementById(controlsPortalId));
  }, [controlsPortalId]);

  const headActions = (
    <div
      className="ai-head-actions horizontal-menu-scroll"
      data-horizontal-menu
      aria-label="AI tools"
    >
      {!workspaceMode && (
        <IconButton
          icon="message-square"
          label="Chats and tasks"
          active={workspaceOpen}
          onClick={() => toggleAiPopup("workspace")}
        />
      )}
      <IconButton
        icon="activity"
        label="Agent activity"
        active={activityOpen}
        onClick={() => toggleAiPopup("activity")}
      />
      <IconButton
        icon="clock"
        label="AI changes"
        active={historyOpen}
        onClick={() => {
          toggleAiPopup("history");
          void refreshHistory().catch(() => undefined);
        }}
      />
      <IconButton
        icon="shield"
        label="Permissions"
        active={permissionOpen}
        onClick={() => {
          toggleAiPopup("permissions");
          void refreshAgentState();
        }}
      />
      <IconButton
        icon="menu"
        label="AI settings"
        active={modelsOpen}
        onClick={() => toggleAiPopup("models")}
      />
      {!workspaceMode && (
        <IconButton
          icon={expanded ? "minimize-2" : "maximize-2"}
          label={expanded ? "Exit full-window chat" : "Open full-window chat"}
          active={expanded}
          onClick={() => {
            closeAiPopups();
            setExpanded((current) => !current);
          }}
        />
      )}
    </div>
  );

  const popoverStyle = expanded
    ? {
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
        zIndex: 95,
      }
    : side === "right"
      ? { right: width + 16 }
      : { left: width + 16 };

  const renderModelToggle = (controlsId: string) => (
    <button
      className="ai-tier-toggle"
      type="button"
      aria-expanded={tierPickerOpen}
      aria-controls={controlsId}
      onClick={() => {
        setTierPickerOpen((current) => !current);
        setCustomListOpen(false);
        setGoalMenuOpen(false);
        setPermissionsDrawerOpen(false);
      }}
    >
      <FeatherIcon icon="cpu" size="18" />
      <span className="ai-footer-label">
        <b>{selectedModel?.name || "Choose a local model"}</b>
        <small>
          {selectedModel?.installed === false
            ? "Download required"
            : selectedModel
              ? "Ready"
              : "Small, Medium, Large, or Custom"}
        </small>
      </span>
      <FeatherIcon
        icon={tierPickerOpen ? "chevron-up" : "chevron-down"}
        size="18"
      />
    </button>
  );

  const renderTierPicker = (id: string) => (
    <div id={id} className="ai-tier-picker" aria-label="osChat model size">
      {(["small", "medium", "large"] as const).map((tier) => {
        const item =
          tierModels.find(
            (entry) =>
              osCodeGgufTier(entry) === tier && entry.supported !== false,
          ) || tierModels.find((entry) => osCodeGgufTier(entry) === tier);
        return (
          <button
            key={tier}
            className={item?.path === model ? "active" : ""}
            disabled={
              !item ||
              item.supported === false ||
              Boolean(downloadingTier) ||
              busy
            }
            title={item?.supportReason || `${item?.name || tier} model`}
            onClick={() => void selectBundledTier(tier)}
          >
            <b>{tier[0].toUpperCase() + tier.slice(1)}</b>
            <span>
              {item?.supported === false ? (
                "Not supported"
              ) : item?.installed ? (
                "Ready"
              ) : downloadingTier === tier ? (
                "Downloading…"
              ) : (
                <>
                  <FeatherIcon icon="download" size="12" /> Download
                </>
              )}
            </span>
          </button>
        );
      })}
      <button
        className={
          selectedModel && osCodeGgufTier(selectedModel) === null
            ? "active"
            : ""
        }
        onClick={() => {
          const willOpen = !customListOpen;
          closeAiPopups();
          setCustomListOpen(willOpen);
        }}
      >
        <b>Custom</b>
        <span>
          {customModels.length ? `${customModels.length} added` : "Add model"}
        </span>
      </button>
    </div>
  );

  return (
    <aside
      className={`ai-panel${expanded ? " expanded" : ""}${workspaceMode ? " workspace-mode" : ""}`}
      aria-label="Local AI chat"
      style={expanded || workspaceMode ? undefined : { width }}
    >
      <div className="ai-head">
        <h2>{assistantName}</h2>
        {!controlsTarget && headActions}
      </div>
      {controlsTarget && createPortal(headActions, controlsTarget)}

      {openChatTabs.length > 1 && (
        <div
          className="ai-chat-tab-strip horizontal-menu-scroll"
          data-horizontal-menu
          role="tablist"
          aria-label="Open chats"
        >
          {openChatTabs.map((chat) => {
            const pinned = pinnedChatIds.includes(chat.id);
            return (
              <div
                className={`ai-chat-tab${chat.id === chatId ? " active" : ""}`}
                key={chat.id}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={chat.id === chatId}
                  title={chat.title}
                  onClick={() => chooseChat(chat, false)}
                >
                  {pinned && <FeatherIcon icon="bookmark" size="13" />}
                  <span>{chat.title || "New chat"}</span>
                </button>
                <button
                  type="button"
                  className="ai-chat-tab-more"
                  aria-label={`Chat options for ${chat.title || "New chat"}`}
                  aria-expanded={chatTabMenuId === chat.id}
                  onClick={(event) =>
                    toggleChatTabMenu(chat.id, event.currentTarget)
                  }
                >
                  <FeatherIcon icon="more-horizontal" size="15" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {chatTabMenuChat &&
        createPortal(
          <div
            className="ai-chat-tab-menu"
            role="menu"
            aria-label={`Options for ${chatTabMenuChat.title || "New chat"}`}
            style={chatTabMenuPosition}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => togglePinnedChat(chatTabMenuChat.id)}
            >
              <FeatherIcon icon="bookmark" size="16" />
              {pinnedChatIds.includes(chatTabMenuChat.id)
                ? "Unpin chat"
                : "Pin chat"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void toggleFavoriteChat(chatTabMenuChat)}
            >
              <FeatherIcon icon="star" size="16" />
              {chatTabMenuChat.favorite ? "Remove favorite" : "Favorite"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => closeChatTab(chatTabMenuChat.id)}
            >
              <FeatherIcon icon="x" size="16" /> Close chat
            </button>
          </div>,
          document.querySelector(".app") || document.body,
        )}

      {!workspaceMode && renderModelToggle("ai-model-size-picker")}

      {tierPickerOpen &&
        !workspaceMode &&
        renderTierPicker("ai-model-size-picker")}
      {pipelineState.state === "waiting" && !anotherChatIsRunning && (
        <div className="ai-pipeline-banner" role="status" aria-live="polite">
          <FeatherIcon icon="clock" size="17" />
          <span>{pipelineState.label}</span>
        </div>
      )}
      {anotherChatIsRunning && (
        <div className="ai-pipeline-banner" role="status" aria-live="polite">
          <FeatherIcon icon="clock" size="17" />
          <span>
            {runningChatTitle} is finishing. Messages sent here stay queued.
          </span>
        </div>
      )}
      <span className="sr-only" data-ai-selected-model aria-live="polite">
        {selectedModel?.name || "Selecting a local model"}
      </span>

      {customListOpen && (
        <div className="ai-custom-list">
          <div className="ai-custom-list-head">
            <b>Custom models</b>
            <button
              aria-label="Close custom models"
              onClick={() => setCustomListOpen(false)}
            >
              <FeatherIcon icon="x" size="17" />
            </button>
          </div>
          {customModels.map((item) => (
            <button
              key={item.id}
              className={item.path === model ? "active" : ""}
              onClick={() => {
                onEngine(item.engine);
                onModel(item.path);
                onContextLimit(recommendedActiveContext(item, hardware));
                setCustomListOpen(false);
                setTierPickerOpen(false);
              }}
            >
              <span>
                <b>{item.name}</b>
                <small>{labels[item.engine]}</small>
              </span>
              {item.path === model && <FeatherIcon icon="check" size="18" />}
            </button>
          ))}
          <button
            className="ai-custom-add"
            onClick={() => {
              closeAiPopups();
              setAddMenuOpen(true);
            }}
          >
            <FeatherIcon icon="plus" size="18" /> Add custom model
          </button>
        </div>
      )}

      {addMenuOpen && (
        <div
          className="ai-add-menu"
          role="menu"
          aria-label="Add a custom model"
        >
          <button onClick={() => void chooseLocal("llamacpp", "any")}>
            <FeatherIcon icon="box" size="18" />
            <span>
              <b>GGUF model</b>
              <small>Add a file or folder; shards are detected</small>
            </span>
          </button>
          {hardware?.engine === "mlx" && (
            <button onClick={() => void chooseLocal("mlx")}>
              <FeatherIcon icon="folder" size="18" />
              <span>
                <b>MLX folder</b>
                <small>Apple silicon model</small>
              </span>
            </button>
          )}
          <button onClick={() => void chooseLocal("pytorch")}>
            <FeatherIcon icon="folder" size="18" />
            <span>
              <b>PyTorch folder</b>
              <small>Local Transformers model</small>
            </span>
          </button>
          <button
            onClick={() => {
              chooseEngine("ollama");
              openAiPopup("ollama");
            }}
          >
            <FeatherIcon icon="box" size="18" />
            <span>
              <b>Ollama</b>
              <small>Search installed models or pull one by name</small>
            </span>
          </button>
          <button onClick={() => setAddMenuOpen(false)}>
            <FeatherIcon icon="x" size="18" />
            <span>
              <b>Close</b>
            </span>
          </button>
        </div>
      )}

      {ollamaPickerOpen && (
        <div
          className="ai-ollama-picker"
          role="dialog"
          aria-label="Add an Ollama model"
        >
          <div className="ai-custom-list-head">
            <b>Ollama models</b>
            <button
              aria-label="Close Ollama models"
              onClick={() => {
                setSource("");
                setOllamaPickerOpen(false);
              }}
            >
              <FeatherIcon icon="x" size="17" />
            </button>
          </div>
          <div className="ai-ollama-cli-status">
            <div>
              <b>{ollamaCli?.installed ? "Ollama CLI ready" : "Ollama CLI"}</b>
              <small>
                {ollamaCli?.installed
                  ? "Command line only · local service"
                  : "Command line only · no desktop app"}
              </small>
            </div>
            {!ollamaCli?.installed && (
              <button
                className="primary"
                disabled={ollamaCliBusy || busy}
                onClick={() => void installOllamaCli()}
              >
                <FeatherIcon icon="download" size="17" />
                {ollamaCliBusy ? "Downloading…" : "Download CLI"}
              </button>
            )}
          </div>
          <label className="ai-ollama-search">
            <FeatherIcon icon="search" size="17" />
            <input
              autoFocus
              value={source}
              onChange={(event) => setSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && source.trim() && !busy)
                  void pullOllama();
              }}
              placeholder="Search or enter a model name"
            />
          </label>
          {ollamaModels.length > 0 && (
            <div
              className="ai-ollama-results"
              aria-label="Installed Ollama models"
            >
              {ollamaModels.map((item) => (
                <button key={item.id} onClick={() => chooseOllamaModel(item)}>
                  <FeatherIcon icon="check-circle" size="17" />
                  <span>
                    <b>{item.name}</b>
                    <small>Installed</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            className="primary ai-ollama-pull-button"
            disabled={!source.trim() || busy}
            onClick={() => void pullOllama()}
          >
            <FeatherIcon icon="download" size="17" />
            {busy
              ? "Pulling…"
              : `Pull${source.trim() ? ` ${source.trim()}` : " model"}`}
          </button>
        </div>
      )}

      {!workspaceMode &&
        workspaceOpen &&
        createPortal(
          <div className="ai-agent-popover" style={popoverStyle}>
            <PopoverTitle
              title="Chats and tasks"
              close={() => setWorkspaceOpen(false)}
            />
            <div className="ai-chat-workspace-layout">
              <aside className="ai-chat-selector" aria-label="Chats">
                <label className="ai-chat-search">
                  <FeatherIcon icon="search" size="17" />
                  <input
                    type="search"
                    value={chatSearch}
                    placeholder="Search chats"
                    aria-label="Search chats"
                    onChange={(event) => setChatSearch(event.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={!projectName}
                  title={projectName ? "New chat" : "Open a project first"}
                  onClick={async () => {
                    try {
                      const chat = await window.oscode.createAiChat(
                        undefined,
                        true,
                      );
                      await refreshAgentState();
                      chooseChat(chat, false);
                    } catch (error) {
                      onNotice(
                        publicAiError(error, "The chat could not be created."),
                      );
                    }
                  }}
                >
                  <FeatherIcon icon="plus" size="17" /> New chat
                </button>
                <div className="ai-chat-list">
                  {agentState.chats
                    .slice()
                    .reverse()
                    .filter((chat) =>
                      `${chat.title} ${chat.messages.map((message) => message.content).join(" ")}`
                        .toLowerCase()
                        .includes(chatSearch.trim().toLowerCase()),
                    )
                    .map((chat) => {
                      const goalCount = agentState.goals.filter(
                        (item) =>
                          item.chatId === chat.id && item.status === "active",
                      ).length;
                      const queueCount = agentState.queue.filter(
                        (item) =>
                          item.chatId === chat.id &&
                          ["queued", "running"].includes(item.status),
                      ).length;
                      const scheduleCount = agentState.schedules.filter(
                        (item) => item.chatId === chat.id && item.enabled,
                      ).length;
                      return (
                        <div
                          className={`ai-chat-choice ${chat.id === chatId ? "active" : ""}`}
                          key={chat.id}
                        >
                          <button onClick={() => chooseChat(chat, false)}>
                            <b>{chat.title}</b>
                            <span className="ai-chat-counts">
                              {goalCount} goal · {queueCount} queued ·{" "}
                              {scheduleCount} scheduled
                            </span>
                            <small>
                              {new Date(chat.updatedAt).toLocaleString()}
                            </small>
                          </button>
                          <IconButton
                            icon="trash-2"
                            label={`Delete ${chat.title}`}
                            onClick={async () => {
                              if (!window.confirm(`Delete “${chat.title}”?`))
                                return;
                              const wasActive = chat.id === chatId;
                              await window.oscode.deleteAiChat(chat.id);
                              const next = await refreshAgentState();
                              if (wasActive) {
                                const fallback =
                                  next.chats.at(-1) ||
                                  (await window.oscode.createAiChat(
                                    undefined,
                                    true,
                                  ));
                                chooseChat(fallback, false);
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              </aside>

              <section className="ai-chat-detail">
                {activeChat ? (
                  <>
                    <header className="ai-chat-detail-head">
                      <span>THIS CHAT</span>
                      <h3>{activeChat.title}</h3>
                    </header>
                    <div
                      className="ai-agent-tabs horizontal-menu-scroll"
                      data-horizontal-menu
                    >
                      {(["goal", "queue", "schedules"] as const).map((tab) => (
                        <button
                          className={workspaceTab === tab ? "active" : ""}
                          key={tab}
                          onClick={() => setWorkspaceTab(tab)}
                        >
                          {tab === "schedules" ? "Schedule" : tab}
                          <span>
                            {tab === "goal"
                              ? chatGoals.length
                              : tab === "queue"
                                ? chatQueue.length
                                : chatSchedules.length}
                          </span>
                        </button>
                      ))}
                    </div>

                    {workspaceTab === "goal" && (
                      <div className="ai-agent-form">
                        <label>
                          Active goal
                          <textarea
                            value={goalDraft}
                            onChange={(event) =>
                              setGoalDraft(event.target.value)
                            }
                            placeholder="What should this chat finish?"
                          />
                        </label>
                        <button
                          className="primary"
                          disabled={!goalDraft.trim()}
                          onClick={async () => {
                            await window.oscode.setAiGoal(
                              chatId,
                              goalDraft.trim(),
                            );
                            await refreshAgentState();
                          }}
                        >
                          {activeGoal ? "Update goal" : "Set goal"}
                        </button>
                        <div className="ai-agent-list-heading">
                          <b>Goals for this chat</b>
                          <span>{chatGoals.length}</span>
                        </div>
                        {chatGoals.length === 0 ? (
                          <p>No goals yet.</p>
                        ) : (
                          chatGoals
                            .slice()
                            .reverse()
                            .map((goal) => (
                              <div
                                className="ai-agent-row ai-agent-row-actions"
                                key={goal.id}
                              >
                                <div>
                                  <b>{goal.text}</b>
                                  <span>
                                    {goal.status} ·{" "}
                                    {goal.automatic
                                      ? "set by agent"
                                      : "set by you"}
                                  </span>
                                </div>
                                <div
                                  className="ai-row-actions horizontal-menu-scroll"
                                  data-horizontal-menu
                                >
                                  {goal.status === "active" && (
                                    <IconButton
                                      icon="check"
                                      label="Mark goal complete"
                                      onClick={async () => {
                                        await window.oscode.completeAiGoal(
                                          goal.id,
                                        );
                                        setGoalDraft("");
                                        await refreshAgentState();
                                      }}
                                    />
                                  )}
                                  <IconButton
                                    icon="trash-2"
                                    label="Delete goal"
                                    onClick={async () => {
                                      await window.oscode.removeAiGoal(goal.id);
                                      if (goal.id === activeGoal?.id)
                                        setGoalDraft("");
                                      await refreshAgentState();
                                    }}
                                  />
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    )}

                    {workspaceTab === "queue" && (
                      <div className="ai-agent-form">
                        <label>
                          Add work to this chat
                          <textarea
                            value={queueDraft}
                            onChange={(event) =>
                              setQueueDraft(event.target.value)
                            }
                            placeholder="Describe the next task"
                          />
                        </label>
                        <button
                          className="primary"
                          disabled={!queueDraft.trim()}
                          onClick={async () => {
                            await window.oscode.addAiQueue(
                              chatId,
                              queueDraft.trim(),
                            );
                            setQueueDraft("");
                            await refreshAgentState();
                            queueTimer.current = setTimeout(
                              () => void runNextQueued(),
                              100,
                            );
                          }}
                        >
                          <FeatherIcon icon="plus" size="16" /> Add to queue
                        </button>
                        <div className="ai-agent-list-heading">
                          <b>Queue for this chat</b>
                          <span>{chatQueue.length}</span>
                        </div>
                        {chatQueue.length === 0 ? (
                          <p>No queued work.</p>
                        ) : (
                          chatQueue
                            .slice()
                            .reverse()
                            .map((item) => (
                              <div className="ai-agent-row" key={item.id}>
                                <div>
                                  <b>{item.prompt}</b>
                                  <span>
                                    {item.status} ·{" "}
                                    {item.automatic
                                      ? "added by agent"
                                      : "added by you"}
                                  </span>
                                </div>
                                <div
                                  className="ai-row-actions horizontal-menu-scroll"
                                  data-horizontal-menu
                                >
                                  {item.status === "queued" && (
                                    <IconButton
                                      icon="edit-2"
                                      label="Edit queued work"
                                      onClick={() => void editQueued(item)}
                                    />
                                  )}
                                  <IconButton
                                    icon="x"
                                    label="Remove queued work"
                                    onClick={async () => {
                                      await window.oscode.removeAiQueue(
                                        item.id,
                                      );
                                      await refreshAgentState();
                                    }}
                                  />
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    )}

                    {workspaceTab === "schedules" && (
                      <div className="ai-agent-form">
                        <label>
                          Task for this chat
                          <textarea
                            value={schedulePrompt}
                            onChange={(event) =>
                              setSchedulePrompt(event.target.value)
                            }
                            placeholder="Describe the scheduled task"
                          />
                        </label>
                        <div className="ai-schedule-fields">
                          <label>
                            Run at
                            <input
                              type="datetime-local"
                              value={scheduleAt}
                              onChange={(event) =>
                                setScheduleAt(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Repeat
                            <select
                              value={scheduleCadence}
                              onChange={(event) =>
                                setScheduleCadence(
                                  event.target.value as AiSchedule["cadence"],
                                )
                              }
                            >
                              <option value="once">Once</option>
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                            </select>
                          </label>
                        </div>
                        <button
                          className="primary"
                          disabled={!schedulePrompt.trim() || !scheduleAt}
                          onClick={async () => {
                            await window.oscode.addAiSchedule(
                              chatId,
                              schedulePrompt.trim(),
                              new Date(scheduleAt).toISOString(),
                              scheduleCadence,
                            );
                            setSchedulePrompt("");
                            setScheduleAt("");
                            await refreshAgentState();
                          }}
                        >
                          Schedule task
                        </button>
                        <div className="ai-agent-list-heading">
                          <b>Schedule for this chat</b>
                          <span>{chatSchedules.length}</span>
                        </div>
                        {chatSchedules.length === 0 ? (
                          <p>No scheduled work.</p>
                        ) : (
                          chatSchedules
                            .slice()
                            .reverse()
                            .map((item) => (
                              <div className="ai-agent-row" key={item.id}>
                                <div>
                                  <b>{item.prompt}</b>
                                  <span>
                                    {item.enabled
                                      ? new Date(
                                          item.nextRunAt,
                                        ).toLocaleString()
                                      : "Finished"}{" "}
                                    · {item.cadence} ·{" "}
                                    {item.automatic
                                      ? "set by agent"
                                      : "set by you"}
                                  </span>
                                </div>
                                <IconButton
                                  icon="trash-2"
                                  label="Delete schedule"
                                  onClick={async () => {
                                    await window.oscode.removeAiSchedule(
                                      item.id,
                                    );
                                    await refreshAgentState();
                                  }}
                                />
                              </div>
                            ))
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="ai-agent-empty">
                    <FeatherIcon icon="message-square" size="22" />
                    <p>Choose a chat to see its work.</p>
                  </div>
                )}
              </section>
            </div>
          </div>,
          document.querySelector(".app") || document.body,
        )}

      {historyOpen &&
        createPortal(
          <div
            className="ai-history-popover"
            style={popoverStyle}
            aria-label="AI change history"
          >
            <PopoverTitle
              title="AI changes"
              close={() => setHistoryOpen(false)}
            />
            {review ? (
              <div className="ai-review">
                <div className="ai-review-head">
                  <b>{review.path}</b>
                  <div>
                    <button onClick={() => setReview(null)}>Back</button>
                    <button
                      className="danger-text"
                      onClick={async () => {
                        const files = await window.oscode.revertAiHistory(
                          review.id,
                        );
                        setReview(null);
                        await refreshHistory();
                        if (files.length) await onChanged(files);
                        setStatus("AI changes reverted");
                      }}
                    >
                      Revert to here
                    </button>
                  </div>
                </div>
                <div className="ai-diff" aria-label="Code changes">
                  {lineDiff(review.before || "", review.after).map(
                    (line, index) => (
                      <code className={line.kind} key={`${index}-${line.text}`}>
                        <span>
                          {line.kind === "add"
                            ? "+"
                            : line.kind === "remove"
                              ? "−"
                              : " "}
                        </span>
                        {line.text || " "}
                      </code>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="ai-history">
                {history.length === 0 ? (
                  <p>No model edits yet.</p>
                ) : (
                  history
                    .slice()
                    .reverse()
                    .map((entry) => (
                      <button key={entry.id} onClick={() => setReview(entry)}>
                        <span>{entry.summary}</span>
                        <small>
                          {new Date(entry.createdAt).toLocaleString()}
                        </small>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>,
          document.querySelector(".app") || document.body,
        )}

      {activityOpen &&
        createPortal(
          <div
            className="ai-activity-popover"
            style={popoverStyle}
            aria-label="Agent activity history"
          >
            <PopoverTitle
              title="Agent activity"
              close={() => setActivityOpen(false)}
            />
            <div className="ai-activity-body">
              <div className="ai-activity-overview">
                <div>
                  <span>
                    <b>{activityEntries.length}</b>
                    <small>actions</small>
                  </span>
                  <span>
                    <b>
                      {
                        activityEntries.filter(
                          (entry) => entry.tool === "web_search",
                        ).length
                      }
                    </b>
                    <small>searches</small>
                  </span>
                  <span>
                    <b>
                      {
                        new Set(
                          activityEntries.flatMap(
                            (entry) => entry.websites || [],
                          ),
                        ).size
                      }
                    </b>
                    <small>websites</small>
                  </span>
                </div>
                <p>
                  A local record of model tools, public-web sources,
                  permissions, and visible device actions. Typed text and file
                  contents are not recorded.
                </p>
              </div>
              <div className="ai-activity-filters" aria-label="Filter activity">
                {(["all", "web", "device", "project"] as const).map(
                  (filter) => (
                    <button
                      key={filter}
                      className={activityFilter === filter ? "active" : ""}
                      onClick={() => setActivityFilter(filter)}
                    >
                      {filter[0].toUpperCase() + filter.slice(1)}
                    </button>
                  ),
                )}
              </div>
              <ActionTimeline
                actions={filteredActivityEntries.slice().reverse()}
                empty="No matching agent actions in this chat yet."
              />
            </div>
          </div>,
          document.querySelector(".app") || document.body,
        )}

      {permissionOpen &&
        createPortal(
          <div className="ai-permission-popover" style={popoverStyle}>
            <PopoverTitle
              title="Permissions"
              close={() => setPermissionOpen(false)}
            />
            <div className="ai-permission-body">
              <div
                className="ai-permission-tools horizontal-menu-scroll"
                data-horizontal-menu
              >
                <label>
                  <FeatherIcon icon="search" size="17" />
                  <input
                    value={permissionSearch}
                    onChange={(event) =>
                      setPermissionSearch(event.target.value)
                    }
                    placeholder="Search permissions"
                  />
                </label>
                <button
                  onClick={async () => {
                    for (const kind of permissionKinds)
                      await window.oscode.grantAiPermission(
                        kind,
                        "conversation",
                        chatId,
                        "All capabilities for this chat",
                      );
                    await refreshAgentState();
                  }}
                >
                  Allow all for this chat
                </button>
              </div>
              <div className="ai-permission-list">
                {agentState.permissions.filter((grant) =>
                  `${permissionLabels[grant.kind]} ${grant.detail} ${grant.scope}`
                    .toLowerCase()
                    .includes(permissionSearch.toLowerCase()),
                ).length === 0 ? (
                  <p>No saved permissions.</p>
                ) : (
                  agentState.permissions
                    .filter((grant) =>
                      `${permissionLabels[grant.kind]} ${grant.detail} ${grant.scope}`
                        .toLowerCase()
                        .includes(permissionSearch.toLowerCase()),
                    )
                    .map((grant) => (
                      <div className="ai-permission-row" key={grant.id}>
                        <FeatherIcon icon="shield" size="18" />
                        <div>
                          <b>{permissionLabels[grant.kind]}</b>
                          <span>
                            {grant.scope === "conversation"
                              ? "This chat"
                              : grant.scope}
                            {grant.detail ? ` · ${grant.detail}` : ""}
                          </span>
                        </div>
                        <IconButton
                          icon="x"
                          label="Revoke permission"
                          onClick={async () => {
                            await window.oscode.revokeAiPermission(grant.id);
                            await refreshAgentState();
                          }}
                        />
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>,
          document.querySelector(".app") || document.body,
        )}

      {modelsOpen &&
        createPortal(
          <div className="ai-model-popover" style={popoverStyle}>
            <PopoverTitle
              title="AI settings"
              close={() => setModelsOpen(false)}
            />
            <div className="ai-model-manager">
              <div className="ai-hardware-note">
                <FeatherIcon icon="cpu" size="18" />
                <span>
                  {hardware
                    ? `${Math.round(hardware.memoryBytes / 1024 ** 3)} GB memory · ${labels[hardware.engine]}${hardware.accelerator !== "none" ? ` · ${hardware.accelerator === "cuda" ? `CUDA${hardware.acceleratorVersion ? ` ${hardware.acceleratorVersion}` : ""}` : hardware.accelerator[0].toUpperCase() + hardware.accelerator.slice(1)}` : ""} · ${hardware.recommendedTier} recommended`
                    : "Checking this computer…"}
                </span>
              </div>
              {hardware?.cudaMessage && (
                <div className="ai-engine-note">
                  <FeatherIcon
                    icon={
                      hardware.accelerator === "cuda" ? "check-circle" : "info"
                    }
                    size="17"
                  />
                  <span>{hardware.cudaMessage}</span>
                  {hardware.nvidiaDetected &&
                    hardware.accelerator !== "cuda" &&
                    hardware.cudaInstallSupported && (
                      <button
                        disabled={cudaBusy}
                        onClick={async () => {
                          setCudaBusy(true);
                          try {
                            const profile =
                              await window.oscode.installAiCudaSupport();
                            setHardware(profile);
                            setStatus("CUDA is ready");
                          } catch (error) {
                            onNotice(publicAiError(error, "CUDA setup failed"));
                          } finally {
                            setCudaBusy(false);
                          }
                        }}
                      >
                        <FeatherIcon icon="download" size="17" />
                        {cudaBusy ? "Downloading…" : "Add CUDA support"}
                      </button>
                    )}
                </div>
              )}
              {engine === "pytorch" && hardware?.pytorchCudaMessage && (
                <div className="ai-engine-note">
                  <FeatherIcon icon="info" size="17" />
                  <span>{hardware.pytorchCudaMessage}</span>
                </div>
              )}
              <label className="ai-setting-row">
                <span>Inference hardware</span>
                <select
                  value={hardwarePreference}
                  onChange={(event) =>
                    onHardwarePreference(
                      event.target.value as AiInferenceHardware,
                    )
                  }
                >
                  <option value="auto">
                    Auto
                    {hardware?.gpuAvailable
                      ? ` · ${hardware.accelerator === "cuda" ? `CUDA${hardware.acceleratorVersion ? ` ${hardware.acceleratorVersion}` : ""}` : "GPU"}`
                      : " · CPU"}
                  </option>
                  <option value="gpu" disabled={!hardware?.gpuAvailable}>
                    GPU
                    {hardware?.gpuAvailable && hardware.accelerator !== "none"
                      ? ` · ${hardware.accelerator === "cuda" ? `CUDA${hardware.acceleratorVersion ? ` ${hardware.acceleratorVersion}` : ""}` : hardware.accelerator[0].toUpperCase() + hardware.accelerator.slice(1)}`
                      : ""}
                    {hardware?.gpuAvailable && hardware.gpuName
                      ? ` · ${hardware.gpuName}`
                      : " · not detected"}
                    {(hardware?.gpuCount || 0) > 1
                      ? ["cuda", "vulkan"].includes(
                          hardware?.accelerator || "none",
                        )
                        ? ` · ${hardware?.gpuCount} GPUs · automatic split`
                        : ` · ${hardware?.gpuCount} GPUs detected`
                      : ""}
                  </option>
                  <option value="cpu">CPU</option>
                </select>
              </label>
              <label className="ai-setting-row">
                <span>Custom engine</span>
                <select
                  value={engine}
                  onChange={(event) => {
                    const nextEngine = event.target.value as AiEngine;
                    chooseEngine(nextEngine);
                    if (nextEngine === "ollama") openAiPopup("ollama");
                  }}
                >
                  <option value="llamacpp">llama.cpp</option>
                  <option value="ollama">Ollama</option>
                  <option value="pytorch">PyTorch</option>
                  <option value="mlx" disabled={hardware?.engine !== "mlx"}>
                    MLX · Apple silicon · macOS 14+
                  </option>
                </select>
              </label>
              <label className="ai-setting-row">
                <span>File edits</span>
                <select
                  value={editMode}
                  onChange={(event) =>
                    onEditMode(event.target.value as AiEditMode)
                  }
                >
                  <option value="ask">Ask before saving</option>
                  <option value="auto">Use saved permissions</option>
                  <option value="read-only">Read only</option>
                </select>
              </label>
              <label className="ai-setting-row">
                <span>Context</span>
                <select
                  value={contextLimit}
                  onChange={async (event) => {
                    const next = Number(event.target.value);
                    onContextLimit(next);
                    if (selectedModel && !osCodeGgufTier(selectedModel)) {
                      try {
                        await window.oscode.updateAiModelContext(
                          selectedModel.id,
                          next,
                        );
                        await refreshModels();
                      } catch (error) {
                        onNotice(
                          publicAiError(
                            error,
                            "The model context could not be saved.",
                          ),
                        );
                      }
                    }
                  }}
                >
                  {contextChoices
                    .filter(
                      (limit) =>
                        !selectedModel?.contextLimit ||
                        limit <= selectedModel.contextLimit,
                    )
                    .map((limit) => (
                      <option value={limit} key={limit}>
                        {Math.round(limit / 1024)}k tokens
                        {limit === selectedModel?.contextLimit
                          ? " · model maximum"
                          : ""}
                      </option>
                    ))}
                </select>
              </label>
              <div
                className="ai-manager-actions horizontal-menu-scroll"
                data-horizontal-menu
              >
                <button
                  onClick={() => {
                    closeAiPopups();
                    setAddMenuOpen(true);
                  }}
                >
                  <FeatherIcon icon="plus" size="17" /> Add custom model
                </button>
                <button
                  onClick={async () => {
                    try {
                      setStatus(await window.oscode.prepareAiEngine(engine));
                    } catch (error) {
                      onNotice(publicAiError(error, "Engine setup failed"));
                    }
                  }}
                >
                  <FeatherIcon icon="cpu" size="17" /> Check engine
                </button>
              </div>
              {engine === "ollama" && (
                <div className="ai-ollama-pull">
                  <button
                    className="primary"
                    onClick={() => openAiPopup("ollama")}
                  >
                    <FeatherIcon icon="search" size="17" /> Choose an Ollama
                    model
                  </button>
                </div>
              )}
              <div className="ai-model-table">
                <b>Downloaded shared models</b>
                {tierModels.filter((item) => item.installed).length === 0 ? (
                  <p>No shared models downloaded yet.</p>
                ) : (
                  tierModels
                    .filter((item) => item.installed)
                    .map((item) => (
                      <div className="ai-model-row" key={item.id}>
                        <div>
                          <strong>{item.name}</strong>
                          <span>
                            {labels[item.engine]} · stored in application data
                          </span>
                        </div>
                        <IconButton
                          icon="trash-2"
                          label={`Delete ${item.name}`}
                          onClick={() => void remove(item)}
                        />
                      </div>
                    ))
                )}
              </div>
              <div className="ai-model-table">
                <b>Custom models</b>
                {engineModels.length === 0 ? (
                  <p>No custom {labels[engine]} models.</p>
                ) : (
                  engineModels.map((item) => (
                    <div className="ai-model-row" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <span title={item.path}>
                          {item.engine === "ollama"
                            ? "Managed by Ollama"
                            : item.path}
                        </span>
                        <small>
                          {Math.round((item.preferredContext || 8192) / 1024)}k
                          context
                        </small>
                      </div>
                      <IconButton
                        icon="trash-2"
                        label={`Remove ${item.name}`}
                        onClick={() => void remove(item)}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.querySelector(".app") || document.body,
        )}

      <div
        className="ai-conversation"
        ref={conversationRef}
        onWheel={(event) => {
          if (event.deltaY < 0) followConversationRef.current = false;
        }}
        onTouchStart={() => {
          followConversationRef.current = false;
        }}
        onScroll={() => {
          const conversation = conversationRef.current;
          if (!conversation) return;
          const distanceFromBottom =
            conversation.scrollHeight -
            conversation.scrollTop -
            conversation.clientHeight;
          followConversationRef.current = distanceFromBottom < 72;
        }}
      >
        {!messages.length && (
          <div className="ai-empty">
            {workspaceMode ? (
              <div className="ai-empty-brand" aria-label="osChat">
                <img src={osChatIcon} alt="" />
                <div className="ai-empty-wordmark">
                  <span>os</span>
                  <strong>Chat</strong>
                </div>
              </div>
            ) : (
              <FeatherIcon icon="message-square" size="28" />
            )}
            <b>
              {workspaceMode
                ? "Let’s build things…"
                : projectName
                  ? `Ask about ${projectName}`
                  : "Start a conversation"}
            </b>
            {workspaceMode && (
              <div
                className="ai-starter-grid"
                aria-label="Conversation starters"
              >
                {[
                  [
                    "file-text",
                    "Draft a document",
                    "Draft a polished document about ",
                  ],
                  [
                    "grid",
                    "Build a table",
                    "Create a useful table that compares ",
                  ],
                  [
                    "monitor",
                    "Plan a presentation",
                    "Create a presentation outline about ",
                  ],
                ].map(([icon, label, prompt]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      setInput(prompt);
                      requestAnimationFrame(() =>
                        composerInputRef.current?.focus(),
                      );
                    }}
                  >
                    <FeatherIcon icon={icon} size="17" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((message, messageIndex) => (
          <article
            className={`ai-message ${message.role}`}
            key={message.id || `${message.role}-${message.createdAt}`}
          >
            <header
              className={`ai-message-author ${message.role === "user" ? "user-only" : ""}`}
              aria-label={message.role === "user" ? "You" : undefined}
            >
              {message.role === "user" ? (
                <FeatherIcon icon="user" size="16" />
              ) : (
                <>
                  <i>O</i>
                  <span>
                    {message.assistantName ||
                      (selectedModel && osCodeGgufTier(selectedModel)
                        ? assistantName
                        : "Custom Model")}
                  </span>
                </>
              )}
            </header>
            {thinkingEnabled && message.thinking && (
              <details
                className="ai-reasoning"
                open={messageIndex === messages.length - 1}
              >
                <summary>
                  <span>
                    <FeatherIcon icon="cpu" size="14" />
                    Model reasoning notes
                  </span>
                  <small>Expand</small>
                </summary>
                <AiMessageContent
                  content={publicAssistantText(message.thinking)}
                />
              </details>
            )}
            {!!message.actions?.length && (
              <details className="ai-response-actions">
                <summary>
                  <span>
                    <FeatherIcon icon="activity" size="14" />
                    Work log
                  </span>
                  <small>
                    {message.actions.length} step
                    {message.actions.length === 1 ? "" : "s"}
                  </small>
                </summary>
                <ActionTimeline actions={message.actions} compact />
              </details>
            )}
            {message.role === "assistant" ? (
              <AiMessageContent
                content={publicAssistantText(message.content)}
                onOpenArtifact={onOpenArtifact}
              />
            ) : (
              <p>{message.content}</p>
            )}
            {message.role === "assistant" && (
              <footer className="ai-message-output-actions">
                <button
                  type="button"
                  onClick={() =>
                    void window.oscode
                      .copyChatOutput(publicAssistantText(message.content))
                      .then(() => setStatus("Response copied"))
                      .catch((error) =>
                        onNotice(
                          publicAiError(error, "Response could not be copied"),
                        ),
                      )
                  }
                >
                  <FeatherIcon icon="copy" size="14" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void window.oscode
                      .downloadChatOutput(
                        responseDownloadName(message.content),
                        publicAssistantText(message.content),
                      )
                      .then((saved) => {
                        if (saved) setStatus("Response downloaded");
                      })
                      .catch((error) =>
                        onNotice(
                          publicAiError(
                            error,
                            "Response could not be downloaded",
                          ),
                        ),
                      )
                  }
                >
                  <FeatherIcon icon="download" size="14" />
                  Download
                </button>
              </footer>
            )}
            {!!message.attachments?.length && (
              <div
                className="ai-message-images"
                aria-label="Message attachments"
              >
                {message.attachments.map((attachment) =>
                  attachment.kind === "image" ? (
                    <img
                      key={attachment.id}
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      title={attachment.name}
                    />
                  ) : (
                    <span
                      className="ai-message-file"
                      key={attachment.id}
                      title={attachment.name}
                    >
                      <FeatherIcon
                        icon={attachmentIcon(attachment.kind)}
                        size="15"
                      />
                      <span>{attachment.name}</span>
                    </span>
                  ),
                )}
              </div>
            )}
          </article>
        ))}
        {!busy &&
          !permissionRequest &&
          pendingEdits.length === 0 &&
          messages.at(-1)?.role === "assistant" &&
          messages.some((message) => message.role === "user") && (
            <div className="ai-response-retry-row">
              <button
                type="button"
                disabled={pipelineOccupied}
                onClick={() => void retryLastResponse()}
              >
                <FeatherIcon icon="refresh-cw" size="14" />
                Retry response
              </button>
            </div>
          )}
        {busy &&
          liveModelOutput.chatId === chatId &&
          (liveModelOutput.reasoning || liveModelOutput.answer) && (
            <article
              className="ai-message assistant ai-live-model-output"
              aria-live="polite"
            >
              <header className="ai-message-author">
                <i>O</i>
                <span>
                  {selectedModel && osCodeGgufTier(selectedModel)
                    ? assistantName
                    : "Custom Model"}
                </span>
                <small>Live</small>
              </header>
              {thinkingEnabled && liveModelOutput.reasoning && (
                <details className="ai-reasoning ai-live-reasoning" open>
                  <summary>
                    <span>
                      <FeatherIcon icon="cpu" size="14" />
                      Model thinking
                    </span>
                    <small>Live</small>
                  </summary>
                  <AiMessageContent
                    content={publicAssistantText(liveModelOutput.reasoning)}
                  />
                </details>
              )}
              {liveModelOutput.answer && (
                <AiMessageContent
                  content={publicAssistantText(liveModelOutput.answer)}
                  onOpenArtifact={onOpenArtifact}
                />
              )}
            </article>
          )}
        {busy && (
          <div className="ai-live-work" role="status" aria-live="polite">
            <div className="ai-thinking">
              <span className="ai-phase-dots">
                <i />
                <i />
                <i />
              </span>
              <span>
                <b>Current step</b>
                <small>{status}</small>
              </span>
            </div>
            {!!liveActions.length && (
              <ActionTimeline actions={liveActions.slice(-4)} compact />
            )}
            <button
              type="button"
              className="ai-stop-button"
              onClick={stopResponse}
            >
              <FeatherIcon icon="square" size="13" />
              Stop
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {permissionRequest && (
        <div
          className="ai-permission-request"
          role="alertdialog"
          aria-label="Agent permission request"
        >
          <div>
            <FeatherIcon icon="shield" size="20" />
            <span>
              <b>{permissionRequest.title}</b>
              <small>{permissionRequest.detail}</small>
            </span>
          </div>
          <div>
            <button
              onClick={() =>
                void (async () => {
                  await resolveLatestPermissionAction(
                    "denied",
                    `${permissionRequest.title} denied by the user`,
                  );
                  setPermissionRequest(null);
                  onAttentionChange?.(null, null);
                  permissionContinuation.current = null;
                  await Promise.all(
                    temporaryPermissionIds.current.map((id) =>
                      window.oscode.revokeAiPermission(id),
                    ),
                  );
                  temporaryPermissionIds.current = [];
                  await window.oscode.stopAi();
                  setStatus("Permission denied");
                })()
              }
            >
              Deny
            </button>
            {permissionRequest.kind === "computer.system" ? (
              <button
                className="primary"
                onClick={() => void grantPermission("once")}
              >
                Completed — retry
              </button>
            ) : (
              <button onClick={() => void grantPermission("once")}>Once</button>
            )}
            {permissionRequest.kind !== "computer.system" &&
              permissionRequest.kind !== "packages.install" &&
              !oneShotPermissionKinds.has(permissionRequest.kind) && (
                <button onClick={() => void grantPermission("conversation")}>
                  This chat
                </button>
              )}
            {permissionRequest.kind !== "computer.system" &&
              !oneShotPermissionKinds.has(permissionRequest.kind) && (
                <button
                  className="primary"
                  onClick={() => void grantPermission("always")}
                >
                  {permissionRequest.kind === "packages.install"
                    ? "Always allow"
                    : "Always"}
                </button>
              )}
          </div>
        </div>
      )}

      {pendingEdits.length > 0 && (
        <div className="ai-approval" role="alert">
          <b>
            Approve {pendingEdits.length} file
            {pendingEdits.length === 1 ? "" : "s"}?
          </b>
          <span>{pendingEdits.map((edit) => edit.path).join(", ")}</span>
          <div>
            <button
              onClick={async () => {
                const files = await window.oscode.resolveAiEdits(
                  pendingEdits.map((edit) => edit.id),
                  false,
                );
                setPendingEdits([]);
                if (files.length) await onChanged(files);
                setStatus("Edits discarded");
              }}
            >
              Reject
            </button>
            <button
              className="primary"
              onClick={async () => {
                const files = await window.oscode.resolveAiEdits(
                  pendingEdits.map((edit) => edit.id),
                  true,
                );
                setPendingEdits([]);
                if (files.length) await onChanged(files);
                setStatus(
                  `${files.length} file${files.length === 1 ? "" : "s"} saved`,
                );
              }}
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {pendingChatQueue.length > 0 && (
        <section className="ai-queue-stack" aria-label="Queued messages">
          <header>
            <b>Queued messages</b>
            <span>{pendingChatQueue.length}</span>
          </header>
          <div>
            {pendingChatQueue.map((item, index) => (
              <article key={item.id}>
                <span className="ai-queue-number">{index + 1}</span>
                <p title={item.prompt}>{item.prompt}</p>
                <button
                  type="button"
                  className="ai-queue-edit"
                  title="Edit this queued message in the composer"
                  onClick={() => void editQueued(item)}
                >
                  <FeatherIcon icon="edit-2" size="15" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  className="ai-queue-steer"
                  title="Stop the current reply and run this message next"
                  onClick={() => void steerQueued(item)}
                >
                  <FeatherIcon icon="corner-up-left" size="15" />
                  <span>Steer</span>
                </button>
                <button
                  type="button"
                  className="ai-queue-delete"
                  title="Delete this queued message"
                  onClick={() => void deleteQueued(item)}
                >
                  <FeatherIcon icon="trash-2" size="15" />
                  <span>Delete</span>
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <div
        className={`ai-composer-controls${workspaceMode ? " workspace" : ""}`}
        aria-label={workspaceMode ? "Chat controls" : undefined}
      >
        {workspaceMode &&
          tierPickerOpen &&
          renderTierPicker("ai-workspace-model-size-picker")}
        {workspaceMode && renderModelToggle("ai-workspace-model-size-picker")}
        <section className="ai-capability-drawer">
          <button
            ref={permissionsToggleRef}
            type="button"
            className="ai-capability-toggle"
            aria-expanded={permissionsDrawerOpen}
            aria-controls="ai-capability-controls"
            onClick={() => {
              setPermissionsDrawerOpen((current) => !current);
              setTierPickerOpen(false);
              setGoalMenuOpen(false);
            }}
          >
            <span>
              <FeatherIcon icon="shield" size="16" />
              <span className="ai-footer-label">
                <b>Permissions</b>
                <small>
                  {
                    [
                      fileAccess,
                      fileAccess && editMode !== "read-only",
                      webAccess,
                      browserAccess,
                      !hideTerminalControl && terminalMode === "auto",
                      computerAccess,
                    ].filter(Boolean).length
                  }{" "}
                  enabled
                </small>
              </span>
            </span>
            <FeatherIcon
              icon={permissionsDrawerOpen ? "chevron-up" : "chevron-down"}
              size="17"
            />
          </button>
          {permissionsDrawerOpen &&
            createPortal(
              <div
                className="ai-capability-popover-layer"
                onMouseDown={() => setPermissionsDrawerOpen(false)}
              >
                <section
                  id="ai-capability-controls"
                  className="ai-capability-bar ai-capability-popover"
                  style={permissionsPopoverPosition}
                  role="dialog"
                  aria-modal="false"
                  aria-label="Agent permissions"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <header className="ai-capability-popover-head">
                    <span>
                      <b>Permissions</b>
                      <small>Choose what osChat can use in this chat.</small>
                    </span>
                    <button
                      type="button"
                      aria-label="Close permissions"
                      title="Close permissions"
                      onClick={() => setPermissionsDrawerOpen(false)}
                    >
                      <FeatherIcon icon="x" size="17" />
                    </button>
                  </header>
                  <div className="ai-capability-grid">
                    <button
                      className={fileAccess ? "enabled" : ""}
                      aria-pressed={fileAccess}
                      aria-label={`File access: ${fileAccess ? "on" : "off"}`}
                      title={`Files ${fileAccess ? "on" : "off"}: allow osChat to read workspace files`}
                      data-tooltip={`Files ${fileAccess ? "on" : "off"}: read project files`}
                      onClick={() => {
                        const next = !fileAccess;
                        applyCapabilities(
                          { ...capabilityRef.current, fileAccess: next },
                          `Files ${next ? "allowed" : "off"}`,
                        );
                      }}
                    >
                      <FeatherIcon
                        icon={fileAccess ? "folder" : "folder-minus"}
                        size="17"
                      />
                      <span className="ai-capability-copy">
                        <b>Files</b>
                        <small>{fileAccess ? "Allowed" : "Off"}</small>
                      </span>
                    </button>
                    <button
                      className={
                        !fileAccess
                          ? ""
                          : editMode === "auto"
                            ? "enabled"
                            : "guarded"
                      }
                      disabled={!fileAccess}
                      aria-pressed={fileAccess && editMode === "auto"}
                      aria-label={`Editing: ${!fileAccess ? "off" : editMode === "auto" ? "automatic" : "ask first"}`}
                      title={`Edits ${!fileAccess ? "off" : editMode === "auto" ? "automatic" : "ask first"}: allow osChat to change workspace files`}
                      data-tooltip={`Edits ${!fileAccess ? "off" : editMode === "auto" ? "auto-save" : "ask first"}: change files`}
                      onClick={() => {
                        const next = editMode === "ask" ? "auto" : "ask";
                        applyCapabilities(
                          { ...capabilityRef.current, editMode: next },
                          `Edits ${next === "auto" ? "allowed and automatic" : "allowed with review"}`,
                        );
                      }}
                    >
                      <FeatherIcon
                        icon={
                          !fileAccess
                            ? "edit-2"
                            : editMode === "auto"
                              ? "edit-3"
                              : "shield"
                        }
                        size="17"
                      />
                      <span className="ai-capability-copy">
                        <b>Edits</b>
                        <small>
                          {!fileAccess
                            ? "Files are off"
                            : editMode === "auto"
                              ? "Automatic"
                              : "Ask first"}
                        </small>
                      </span>
                    </button>
                    <button
                      className={webAccess ? "enabled network" : ""}
                      aria-pressed={webAccess}
                      aria-label={`Web access: ${webAccess ? "on" : "off"}`}
                      title={`Web ${webAccess ? "on" : "off"}: allow public searches and HTTPS pages`}
                      data-tooltip={`Web ${webAccess ? "on" : "off"}: search public pages`}
                      onClick={() => {
                        const next = !webAccess;
                        applyCapabilities(
                          { ...capabilityRef.current, webAccess: next },
                          `Web ${next ? "allowed" : "off"}`,
                        );
                        if (!next && browserAccess)
                          void window.oscode.stopAgentControl();
                      }}
                    >
                      <FeatherIcon
                        icon={webAccess ? "wifi" : "wifi-off"}
                        size="17"
                      />
                      <span className="ai-capability-copy">
                        <b>Web</b>
                        <small>{webAccess ? "Allowed" : "Off"}</small>
                      </span>
                    </button>
                    <span
                      className="ai-capability-divider"
                      aria-hidden="true"
                    />
                    <button
                      className={browserAccess ? "enabled" : ""}
                      aria-pressed={browserAccess}
                      aria-label={`Dedicated agent browser: ${browserAccess ? "on" : "off"}`}
                      title={`Browser ${browserAccess ? "on" : "off"}: open and test pages in an isolated browser`}
                      data-tooltip={`Browser ${browserAccess ? "on" : "off"}: open and test pages`}
                      onClick={() => {
                        const next = !browserAccess;
                        applyCapabilities(
                          { ...capabilityRef.current, browserAccess: next },
                          `Browser ${next ? "allowed" : "off"}`,
                        );
                        if (!next) void window.oscode.stopAgentControl();
                      }}
                    >
                      <FeatherIcon icon="compass" size="17" />
                      <span className="ai-capability-copy">
                        <b>Browser</b>
                        <small>{browserAccess ? "Allowed" : "Off"}</small>
                      </span>
                    </button>
                    {!hideTerminalControl && (
                      <button
                        className={
                          terminalMode === "auto" ? "enabled" : "guarded"
                        }
                        aria-pressed={terminalMode === "auto"}
                        aria-label={`Terminal access: ${terminalMode === "auto" ? "automatic" : "ask first"}`}
                        title={`Terminal ${terminalMode === "auto" ? "automatic" : "ask first"}: run commands in the host shell`}
                        data-tooltip={`Terminal ${terminalMode === "auto" ? "auto" : "ask"}: run host shell commands`}
                        onClick={() => {
                          const next = terminalMode === "ask" ? "auto" : "ask";
                          applyCapabilities(
                            { ...capabilityRef.current, terminalMode: next },
                            `Terminal ${next === "auto" ? "automatic for this chat" : "will ask before commands"}`,
                          );
                        }}
                      >
                        <FeatherIcon
                          icon={terminalMode === "auto" ? "terminal" : "shield"}
                          size="17"
                        />
                        <span className="ai-capability-copy">
                          <b>Terminal</b>
                          <small>
                            {terminalMode === "auto"
                              ? "Automatic"
                              : "Ask first"}
                          </small>
                        </span>
                      </button>
                    )}
                    <button
                      className={computerAccess ? "enabled" : ""}
                      aria-pressed={computerAccess}
                      aria-label={`Computer Control: ${computerAccess ? "on" : "off"}`}
                      title={`Computer Control ${computerAccess ? "on" : "off"}: operate approved visible apps`}
                      data-tooltip={`Control ${computerAccess ? "on" : "off"}: use approved visible apps`}
                      onClick={() => {
                        const next = !computerAccess;
                        applyCapabilities(
                          { ...capabilityRef.current, computerAccess: next },
                          `Control ${next ? "allowed" : "off"}`,
                        );
                        if (!next) void window.oscode.stopAgentControl();
                      }}
                    >
                      <FeatherIcon icon="mouse-pointer" size="17" />
                      <span className="ai-capability-copy">
                        <b>Control</b>
                        <small>{computerAccess ? "Allowed" : "Off"}</small>
                      </span>
                    </button>
                  </div>
                </section>
              </div>,
              document.querySelector(".oschat-app") || document.body,
            )}
        </section>
        {workspaceMode && (
          <div className="ai-inline-goal">
            <button
              type="button"
              className={activeGoal ? "active" : ""}
              aria-expanded={goalMenuOpen}
              onClick={() => {
                setGoalMenuOpen((current) => !current);
                setTierPickerOpen(false);
                setPermissionsDrawerOpen(false);
              }}
            >
              <FeatherIcon icon="target" size="17" />
              <span className="ai-footer-label">
                {activeGoal ? "Goal set" : "Goal"}
              </span>
              <FeatherIcon
                icon={goalMenuOpen ? "chevron-down" : "chevron-up"}
                size="15"
              />
            </button>
            {goalMenuOpen && (
              <form
                className="ai-inline-goal-popover"
                onSubmit={(event) => {
                  event.preventDefault();
                  const nextGoal = goalDraft.trim();
                  if (!nextGoal || !chatId) return;
                  void (async () => {
                    await window.oscode.setAiGoal(chatId, nextGoal);
                    await refreshAgentState();
                    setGoalMenuOpen(false);
                    setStatus(activeGoal ? "Goal updated" : "Goal set");
                  })();
                }}
              >
                <label htmlFor="ai-chat-goal">Goal for this chat</label>
                <textarea
                  id="ai-chat-goal"
                  value={goalDraft}
                  placeholder="What should this chat finish?"
                  onChange={(event) => setGoalDraft(event.target.value)}
                />
                <div>
                  {activeGoal && (
                    <button
                      type="button"
                      onClick={() =>
                        void (async () => {
                          await window.oscode.completeAiGoal(activeGoal.id);
                          setGoalDraft("");
                          await refreshAgentState();
                          setGoalMenuOpen(false);
                          setStatus("Goal completed");
                        })()
                      }
                    >
                      <FeatherIcon icon="check" size="15" /> Complete
                    </button>
                  )}
                  <button
                    type="submit"
                    className="primary"
                    disabled={!goalDraft.trim() || !chatId}
                  >
                    {activeGoal ? "Update goal" : "Set goal"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
      {!!attachments.length && (
        <div className="ai-attachments" aria-label="Attached local files">
          {attachments.map((attachment) => (
            <figure key={attachment.id}>
              {attachment.kind === "image" ? (
                <img src={attachment.dataUrl} alt={attachment.name} />
              ) : (
                <span className="ai-attachment-file" title={attachment.name}>
                  <FeatherIcon
                    icon={attachmentIcon(attachment.kind)}
                    size="18"
                  />
                  <small>{attachment.name}</small>
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.id !== attachment.id),
                  )
                }
              >
                <FeatherIcon icon="x" size="14" />
              </button>
            </figure>
          ))}
        </div>
      )}
      <form className="ai-composer" onSubmit={send}>
        <input
          ref={attachmentInputRef}
          className="sr-only"
          type="file"
          accept={attachmentAccept}
          multiple
          onChange={(event) => {
            if (event.target.files) void addAttachments(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="ai-attach-button"
          aria-label="Attach local media or documents"
          title="Attach local media or documents"
          disabled={!projectName || attachments.length >= 6}
          onClick={() => attachmentInputRef.current?.click()}
        >
          <FeatherIcon icon="paperclip" size="17" />
        </button>
        <textarea
          ref={composerInputRef}
          aria-label="Message local AI"
          placeholder={
            projectName
              ? busyRef.current || pipelineOccupied
                ? "Queue the next message…"
                : "Ask, set a goal, or enter a command…"
              : "Open a project first"
          }
          value={input}
          disabled={!projectName}
          onChange={(event) => setInput(event.target.value)}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter(
              (file) => file.type.startsWith("image/"),
            );
            if (images.length) void addAttachments(images);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {busy && (
          <button
            type="button"
            className="ai-steer-button"
            disabled={!input.trim()}
            aria-label="Steer the current task"
            title="Steer the current task"
            onClick={() => void steer()}
          >
            <FeatherIcon icon="corner-up-left" size="17" />
          </button>
        )}
        <button
          type="submit"
          disabled={
            (!input.trim() && !attachments.length) || !model || !projectName
          }
          aria-label={
            busyRef.current || pipelineOccupied
              ? "Queue message"
              : "Send message"
          }
        >
          <FeatherIcon
            icon={
              busyRef.current || pipelineOccupied
                ? "corner-down-left"
                : "arrow-up"
            }
            size="17"
          />
        </button>
      </form>
      <div
        className={`ai-context ${usage.used / usage.limit > 0.9 ? "critical" : usage.used / usage.limit > 0.72 ? "near" : ""}`}
        title="Older chat is summarized locally before this fills"
      >
        <div>
          <span
            style={{
              width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
            }}
          />
        </div>
        <small>
          Context {Math.ceil(usage.used / 100) / 10}k / {usage.limit / 1000}k
          tokens
          {selectedModel?.contextLimit &&
          selectedModel.contextLimit > usage.limit
            ? ` · ${selectedModel.contextLimit / 1000}k supported`
            : ""}
          {usage.compacted ? " · compacted locally" : ""}
        </small>
      </div>
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </aside>
  );
}

function websiteLabel(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname.replace(/^www\./i, "")}${path}`.slice(0, 90);
  } catch {
    return value.slice(0, 90);
  }
}

function ActionTimeline({
  actions,
  compact = false,
  empty = "No agent actions yet.",
}: {
  actions: AiActionEntry[];
  compact?: boolean;
  empty?: string;
}) {
  if (!actions.length) return <p className="ai-action-empty">{empty}</p>;
  return (
    <div className={`ai-action-timeline${compact ? " compact" : ""}`}>
      {actions.map((action) => (
        <article className={`ai-action-card ${action.status}`} key={action.id}>
          <i className="ai-action-icon">
            <FeatherIcon icon={actionIcon(action.kind)} size="15" />
          </i>
          <div>
            <header>
              <span>{actionKindLabel(action.kind)}</span>
              <time dateTime={action.createdAt}>
                {new Date(action.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <em>{action.status}</em>
            </header>
            <b>{action.title}</b>
            {action.detail && <p>{action.detail}</p>}
            {!!action.websites?.length && (
              <div className="ai-action-sites" aria-label="Websites used">
                {action.websites.map((website) => (
                  <button
                    type="button"
                    key={website}
                    title={website}
                    onClick={() => void window.oscode.openExternalUrl(website)}
                  >
                    <FeatherIcon icon="external-link" size="12" />
                    {websiteLabel(website)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function PopoverTitle({ title, close }: { title: string; close: () => void }) {
  return (
    <div className="ai-history-title">
      <h3>{title}</h3>
      <button
        type="button"
        className="ai-history-close"
        aria-label={`Close ${title}`}
        onClick={close}
      >
        <FeatherIcon icon="x" size="20" />
      </button>
    </div>
  );
}

function lineDiff(before: string, after: string) {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  if (left.length * right.length > 90_000)
    return [
      ...left.slice(0, 120).map((text) => ({ kind: "remove", text })),
      ...right.slice(0, 120).map((text) => ({ kind: "add", text })),
    ];
  const table = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i -= 1)
    for (let j = right.length - 1; j >= 0; j -= 1)
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: Array<{ kind: "same" | "add" | "remove"; text: string }> = [];
  let i = 0,
    j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "same", text: left[i++] });
      j += 1;
    } else if (
      j < right.length &&
      (i === left.length || table[i][j + 1] >= table[i + 1][j])
    )
      result.push({ kind: "add", text: right[j++] });
    else result.push({ kind: "remove", text: left[i++] });
  }
  return result.slice(0, 500);
}
