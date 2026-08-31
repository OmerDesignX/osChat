export type TreeEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: TreeEntry[];
};
export type EditorPreferences = {
  version: 13;
  theme: "dark" | "blue-dark" | "blue-light";
  locale: "en" | "ar";
  sidebarSide: "left" | "right";
  uiScale: 1 | 1.15 | 1.3 | 1.5 | 1.7;
  editorFontSize: number;
  sidebarWidth: number;
  gitHeight: number;
  aiPanelWidth: number;
  sidebarVisible: boolean;
  aiVisible: boolean;
  aiEngine: AiEngine;
  aiModel: string;
  aiExecutable: string;
  aiEditMode: AiEditMode;
  aiFileAccess: boolean;
  aiWebAccess: boolean;
  aiContextLimit: number;
  aiHardware: AiInferenceHardware;
  aiThinkingEnabled: boolean;
  suggestions: boolean;
  wordWrap: boolean;
  proseWrap: boolean;
  minimap: boolean;
  spellcheck: boolean;
  autoSave: boolean;
  autoUpdateEnabled: boolean;
  autoUpdatePromptAnswered: boolean;
  autoUpdateDismissedVersion: string;
  lastProject: string;
};
export type AppUpdateStatus = {
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "current"
    | "error"
    | "unsupported";
  message: string;
  currentVersion: string;
  version?: string;
  percent?: number;
  channel?: string;
};
export type AiEngine = "llamacpp" | "ollama" | "pytorch" | "mlx";
export type AiInferenceHardware = "auto" | "cpu" | "gpu";
export type AiEditMode = "ask" | "auto" | "read-only";
export type AiTerminalMode = "ask" | "auto";
export type McpServerConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
};
export type AiModel = {
  id: string;
  name: string;
  engine: AiEngine;
  path: string;
  source: "local" | "downloaded" | "available" | "ollama" | "bundled";
  tier?: AiModelTier;
  bytes?: number;
  supported?: boolean;
  supportReason?: string;
  contextLimit?: number;
  preferredContext?: number;
  installed?: boolean;
  downloadBytes?: number;
};
export type AiModelTier = "small" | "medium" | "large" | "custom";
export type AiPipelineState = {
  state: "idle" | "waiting" | "running";
  label: string;
  position: number;
  activeProject: string;
};
export type AiModelOutput = {
  chatId: string;
  phase: "reasoning" | "answer";
  delta: string;
  reset?: boolean;
};
export type OllamaCliStatus = {
  installed: boolean;
  managed: boolean;
  version: string;
  message: string;
};
export type AiPermissionKind =
  | "project.read"
  | "project.write"
  | "project.delete"
  | "terminal.run"
  | "packages.install"
  | "debug.run"
  | "web.search"
  | "attachments.external"
  | "network.request"
  | "browser.control"
  | "computer.control"
  | "computer.external"
  | "computer.system"
  | "mcp.call"
  | "platformio.install"
  | "platformio.run";
export type AiPermissionScope = "once" | "conversation" | "always";
export type AiPermissionGrant = {
  id: string;
  kind: AiPermissionKind;
  scope: AiPermissionScope;
  chatId: string;
  projectRoot: string;
  createdAt: string;
  detail: string;
};
export type AiPermissionRequest = {
  id: string;
  kind: AiPermissionKind;
  title: string;
  detail: string;
};
export type AiChatAttachment = {
  id: string;
  name: string;
  kind: "image" | "document" | "audio" | "video";
  mimeType: string;
  dataUrl: string;
  size?: number;
  extractedText?: string;
  processingError?: string;
};
export type AiActionKind =
  | "plan"
  | "permission"
  | "web"
  | "browser"
  | "computer"
  | "files"
  | "command"
  | "goal"
  | "result";
export type AiActionStatus =
  "running" | "completed" | "waiting" | "failed" | "denied";
export type AiActionEntry = {
  id: string;
  chatId: string;
  kind: AiActionKind;
  status: AiActionStatus;
  title: string;
  detail?: string;
  tool?: string;
  query?: string;
  url?: string;
  target?: string;
  websites?: string[];
  createdAt: string;
  completedAt?: string;
};
export type AiChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  createdAt?: string;
  assistantName?: "osChat" | "Custom Model";
  attachments?: AiChatAttachment[];
  actions?: AiActionEntry[];
};
export type AiChatThread = {
  id: string;
  title: string;
  folder: string;
  favorite: boolean;
  projectRoot: string;
  messages: AiChatMessage[];
  contextSummary: string;
  createdAt: string;
  updatedAt: string;
};
export type AiGoal = {
  id: string;
  chatId: string;
  text: string;
  status: "active" | "complete";
  automatic: boolean;
  createdAt: string;
};
export type AiQueueItem = {
  id: string;
  chatId: string;
  prompt: string;
  status: "queued" | "running" | "complete" | "failed";
  createdAt: string;
  runAt?: string;
  automatic?: boolean;
};
export type AiSchedule = {
  id: string;
  chatId: string;
  prompt: string;
  cadence: "once" | "daily" | "weekly";
  nextRunAt: string;
  enabled: boolean;
  createdAt: string;
  automatic?: boolean;
};
export type AiAgentState = {
  chats: AiChatThread[];
  goals: AiGoal[];
  queue: AiQueueItem[];
  schedules: AiSchedule[];
  permissions: AiPermissionGrant[];
};
export type AiHardwareProfile = {
  platform: NodeJS.Platform;
  arch: string;
  memoryBytes: number;
  engine: "llamacpp" | "mlx";
  recommendedTier: Exclude<AiModelTier, "custom">;
  gpuAvailable: boolean;
  gpuName: string;
  gpuNames?: string[];
  gpuCount?: number;
  accelerator: "metal" | "vulkan" | "cuda" | "none";
  acceleratorVersion?: string;
  nvidiaDetected?: boolean;
  nvidiaDriverVersion?: string;
  nvidiaCudaVersion?: string;
  cudaRuntimeAvailable?: boolean;
  cudaInstallSupported?: boolean;
  cudaMessage?: string;
  pytorchCudaMessage?: string;
};
export type GitCommit = {
  id: string;
  shortId: string;
  subject: string;
  author: string;
  date: string;
  state: "local" | "unpushed" | "pushed";
};
export type AiChatResponse = {
  content: string;
  thinking?: string;
  retainedMessages?: AiChatMessage[];
  changedFiles: string[];
  toolSteps: string[];
  actions: AiActionEntry[];
  pendingEdits: Array<{ id: string; path: string }>;
  contextSummary: string;
  usage: { used: number; limit: number; compacted: boolean };
  permissionRequest?: AiPermissionRequest;
};
export type AiHistoryEntry = {
  id: string;
  createdAt: string;
  path: string;
  before: string | null;
  after: string;
  summary: string;
};
export type GitFile = {
  path: string;
  originalPath?: string;
  index: string;
  workingTree: string;
};
export type GitState = {
  initialized: boolean;
  branch: string;
  branches: string[];
  ahead: number;
  behind: number;
  remote: string;
  userName: string;
  userEmail: string;
  files: GitFile[];
  submodules: Array<{ path: string; url: string }>;
  stashes: Array<{ ref: string; message: string }>;
  tags: string[];
  commits: GitCommit[];
};
