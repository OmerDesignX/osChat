import type {
  AiAgentState,
  AiChatMessage,
  AiChatThread,
  AiModel,
  AppUpdateStatus,
  EditorPreferences,
  ProductivityArtifact,
  ProductivityArtifactSummary,
} from "./types";

const now = () => new Date().toISOString();
const id = () => globalThis.crypto.randomUUID();

/**
 * In-memory bridge used only by the Vite development server when the explicit
 * `?browser-qa=1` switch is present. Production builds and Electron windows
 * can never enter this path, and this bridge cannot read files or use network.
 */
export function createBrowserQaBridge(): Window["oscode"] {
  const initialMessage: AiChatMessage = {
    id: id(),
    role: "assistant",
    createdAt: now(),
    assistantName: "osChat",
    content: [
      "Welcome to **osChat** — your private workspace for conversations, documents, spreadsheets, and presentations.",
      "",
      "```oschat-widget",
      JSON.stringify({
        type: "metric",
        title: "Private workspace",
        value: "Local first",
        detail: "Your model and workspace data stay on this device.",
      }),
      "```",
      "",
      "```oschat-artifact",
      JSON.stringify({
        type: "document",
        title: "Project brief",
        description:
          "A ready-to-edit document created inside the conversation.",
        content: "Goals\nResearch\nNext steps",
      }),
      "```",
      "",
      "Sources are shown as normal, clickable links when a web-enabled answer uses them.",
    ].join("\n"),
  };
  let chats: AiChatThread[] = [
    {
      id: id(),
      title: "Welcome to osChat",
      folder: "",
      favorite: true,
      projectRoot: "/qa/osChat Workspace",
      messages: [initialMessage],
      contextSummary: "",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: id(),
      title: "Quarterly planning",
      folder: "Work",
      favorite: false,
      projectRoot: "/qa/osChat Workspace",
      messages: [],
      contextSummary: "",
      createdAt: now(),
      updatedAt: now(),
    },
  ];
  let artifacts: ProductivityArtifact[] = [];
  const models: AiModel[] = [
    {
      id: "oschat:llamacpp:small",
      name: "osChat Small",
      engine: "llamacpp",
      path: "/qa/oschat-small.gguf",
      source: "downloaded",
      tier: "small",
      supported: true,
      installed: true,
      contextLimit: 262_144,
    },
    {
      id: "oschat:llamacpp:medium",
      name: "osChat Medium",
      engine: "llamacpp",
      path: "",
      source: "available",
      tier: "medium",
      supported: true,
      installed: false,
      contextLimit: 262_144,
    },
    {
      id: "oschat:llamacpp:large",
      name: "osChat Large",
      engine: "llamacpp",
      path: "",
      source: "available",
      tier: "large",
      supported: true,
      installed: false,
      contextLimit: 262_144,
    },
  ];
  let preferences: EditorPreferences = {
    version: 14,
    theme: "dark",
    locale: "en",
    sidebarSide: "left",
    uiScale: 1,
    editorFontSize: 14,
    sidebarWidth: 480,
    gitHeight: 390,
    aiPanelWidth: 330,
    sidebarVisible: true,
    aiVisible: true,
    aiEngine: "llamacpp",
    aiModel: "/qa/oschat-small.gguf",
    aiExecutable: "/qa/llama-completion",
    aiEditMode: "ask",
    aiFileAccess: false,
    aiWebAccess: false,
    aiContextLimit: 262_144,
    aiHardware: "auto",
    aiThinkingEnabled: true,
    suggestions: true,
    wordWrap: false,
    proseWrap: true,
    minimap: true,
    spellcheck: true,
    autoSave: true,
    autoUpdateEnabled: false,
    autoUpdatePromptAnswered: true,
    autoUpdateDismissedVersion: "",
    lastProject: "/qa/osChat Workspace",
  };
  let update: AppUpdateStatus = {
    state: "disabled",
    message: "Automatic updates are off",
    currentVersion: "0.1.0",
  };
  const agentState = (): AiAgentState => ({
    chats: structuredClone(chats),
    goals: [],
    queue: [],
    schedules: [],
    permissions: [],
  });
  const summary = (
    artifact: ProductivityArtifact,
  ): ProductivityArtifactSummary => ({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    folder: artifact.folder,
    favorite: artifact.favorite,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  });
  const noopSubscription = () => () => undefined;
  const base = {
    platform: "darwin",
    setDirtyState: () => undefined,
    setAppAttentionBadge: async () => true,
    setZoomFactor: () => undefined,
    confirmDiscardChanges: async () => true,
    ensureChatWorkspace: async () => ({
      root: "/qa/osChat Workspace",
      name: "osChat Workspace",
      tree: [],
    }),
    listArtifacts: async () => artifacts.map(summary),
    readArtifact: async (artifactId: string) =>
      structuredClone(artifacts.find((item) => item.id === artifactId)!),
    saveArtifact: async (artifact: ProductivityArtifact) => {
      const saved = { ...structuredClone(artifact), updatedAt: now() };
      artifacts = [saved, ...artifacts.filter((item) => item.id !== saved.id)];
      return summary(saved);
    },
    deleteArtifact: async (artifactId: string) => {
      artifacts = artifacts.filter((item) => item.id !== artifactId);
      return true;
    },
    exportArtifact: async (artifact: ProductivityArtifact) =>
      `/qa/exports/${artifact.title}`,
    loadPreferences: async () => structuredClone(preferences),
    savePreferences: async (next: EditorPreferences) => {
      preferences = structuredClone(next);
      return true;
    },
    openSecureData: async () => "/qa/osChat data",
    openExternalUrl: async (url: string) => url,
    websiteIcon: async () => "",
    appUpdateStatus: async () => structuredClone(update),
    setAppAutoUpdate: async (enabled: boolean) => {
      update = {
        ...update,
        state: enabled ? "idle" : "disabled",
        message: enabled
          ? "Ready to check for updates"
          : "Automatic updates are off",
      };
      return structuredClone(update);
    },
    checkForAppUpdate: async () => ({
      ...update,
      state: "current",
      message: "osChat is current",
    }),
    downloadAppUpdate: async () => update,
    installAppUpdate: async () => update,
    listAiModels: async () => structuredClone(models),
    aiHardwareProfile: async () => ({
      platform: "darwin",
      arch: "arm64",
      memoryBytes: 16 * 1024 ** 3,
      engine: "llamacpp" as const,
      recommendedTier: "small" as const,
      gpuAvailable: true,
      gpuName: "Apple GPU",
      accelerator: "metal" as const,
    }),
    aiAgentState: async () => agentState(),
    createAiChat: async (title = "New chat") => {
      const chat: AiChatThread = {
        id: id(),
        title,
        folder: "",
        favorite: false,
        projectRoot: "/qa/osChat Workspace",
        messages: [],
        contextSummary: "",
        createdAt: now(),
        updatedAt: now(),
      };
      chats = [...chats, chat];
      return structuredClone(chat);
    },
    saveAiChat: async (
      chatId: string,
      messages: AiChatMessage[],
      contextSummary: string,
    ) => {
      const existing = chats.find((item) => item.id === chatId)!;
      const saved = {
        ...existing,
        messages: structuredClone(messages),
        contextSummary,
        updatedAt: now(),
      };
      chats = chats.map((item) => (item.id === chatId ? saved : item));
      return structuredClone(saved);
    },
    updateAiChatMetadata: async (
      chatId: string,
      metadata: { title?: string; folder?: string; favorite?: boolean },
    ) => {
      const existing = chats.find((item) => item.id === chatId)!;
      const saved = { ...existing, ...metadata, updatedAt: now() };
      chats = chats.map((item) => (item.id === chatId ? saved : item));
      return structuredClone(saved);
    },
    deleteAiChat: async (chatId: string) => {
      chats = chats.filter((item) => item.id !== chatId);
      return true;
    },
    aiChat: async () => ({
      content:
        'I created an interactive result you can continue editing in osChat.\n\n```oschat-widget\n{"type":"chart","title":"Progress","labels":["Research","Draft","Review"],"values":[100,72,35]}\n```',
      thinking: "Prepared a safe local preview for interface testing.",
      changedFiles: [],
      toolSteps: [],
      actions: [],
      pendingEdits: [],
      contextSummary: "",
      usage: { used: 640, limit: 262_144, compacted: false },
    }),
    listAiHistory: async () => [],
    collectDueAiSchedules: async () => 0,
    ollamaCliStatus: async () => ({
      installed: false,
      managed: false,
      version: "",
      message: "Ollama is optional",
    }),
    stopAi: async () => true,
    stopAgentControl: async () => true,
    resolveAiEdits: async () => [],
    onPreferencesChanged: noopSubscription,
    onAppUpdateStatus: noopSubscription,
    onAgentActivity: noopSubscription,
    onAiPipelineState: noopSubscription,
    onAiStatus: noopSubscription,
    onAiModelOutput: noopSubscription,
    onAiAction: noopSubscription,
    onMenuAction: noopSubscription,
  };
  return new Proxy(base as unknown as Window["oscode"], {
    get(target, property, receiver) {
      if (Reflect.has(target, property))
        return Reflect.get(target, property, receiver);
      if (typeof property === "string" && property.startsWith("on"))
        return noopSubscription;
      return async () => undefined;
    },
  });
}
