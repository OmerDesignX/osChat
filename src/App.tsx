import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AiPanel } from "./components/AiPanel";
import type { ChatArtifactPayload } from "./components/AiMessageContent";
import { FeatherIcon } from "./components/FeatherIcon";
import { IconButton } from "./components/IconButton";
import {
  defaultArtifactData,
  ProductivityWorkspace,
} from "./components/ProductivityWorkspaceV2";
import osChatIcon from "./assets/oschat-icon.png";
import {
  deleteProductivityArtifact,
  duplicateProductivityArtifact,
  exportProductivityArtifact,
  patchProductivityArtifact,
} from "./lib/artifact-collection-actions";
import {
  deleteChatCollection,
  duplicateChatCollection,
  patchChatCollection,
} from "./lib/chat-collection-actions";
import { publicAssistantText } from "./lib/public-assistant-text";
import { chatListPreview } from "./lib/chat-list-preview";
import type {
  AgentActivity,
  AiAgentState,
  AiAttention,
  AiChatThread,
  AiEditMode,
  AiEngine,
  AiInferenceHardware,
  AiModel,
  AiModelTier,
  AiTerminalMode,
  AppUpdateStatus,
  EditorPreferences,
  ArtifactExportFormat,
  ProductivityArtifact,
  ProductivityArtifactKind,
  ProductivityArtifactSummary,
} from "./types";

type CollectionFilter = "all" | "favorites" | `folder:${string}`;
type FolderScope = "chat" | "notes";
type SavedFolderScopes = Record<FolderScope, string[]>;
type AppNotice = {
  id: string;
  chatId?: string;
  title: string;
  detail: string;
  createdAt: string;
  readAt?: string;
  kind:
    | "response"
    | "permission"
    | "input"
    | "error"
    | "update"
    | "activity"
    | "info";
};

type WorkspaceView = "chat" | ProductivityArtifactKind;
type ChatActionDialog = {
  action: "rename" | "move" | "delete";
  chat: AiChatThread;
  value: string;
};
const emptyAgentState: AiAgentState = {
  chats: [],
  goals: [],
  queue: [],
  schedules: [],
  permissions: [],
};
const emptyUpdate: AppUpdateStatus = {
  state: "disabled",
  message: "Automatic updates are off",
  currentVersion: "",
};
const workspaceLabels: Record<ProductivityArtifactKind, string> = {
  document: "Documents",
  spreadsheet: "Spreadsheets",
  presentation: "Presentations",
};
const workspaceIcons: Record<ProductivityArtifactKind, string> = {
  document: "file-text",
  spreadsheet: "grid",
  presentation: "monitor",
};
const newId = () => globalThis.crypto.randomUUID();
const NOTICE_AUTO_DISMISS_MS = 10_000;
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
        "",
      )
    : String(error);
function attentionNotification(attention: AiAttention): {
  title: string;
  kind: AppNotice["kind"];
} {
  if (attention.kind === "permission")
    return { title: "Permission required", kind: "permission" };
  if (attention.kind === "input")
    return { title: "Input required", kind: "input" };
  if (/stopp?ed/i.test(attention.title))
    return { title: "Stopped", kind: "error" };
  if (/fail|error|could(?: not|n't)/i.test(attention.title))
    return { title: "Failed", kind: "error" };
  return { title: "Complete", kind: "response" };
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] || character,
  );
}
function scrollHorizontalMenu(event: WheelEvent) {
  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-horizontal-menu]")
      : null;
  if (
    !target ||
    target.scrollWidth <= target.clientWidth + 1 ||
    Math.abs(event.deltaX) >= Math.abs(event.deltaY)
  )
    return;
  target.scrollLeft += event.deltaY;
  event.preventDefault();
}
function cleanFolderList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function loadFolderScopes(): SavedFolderScopes {
  try {
    const stored = JSON.parse(
      localStorage.getItem("oschat-folder-scopes-v2") || "null",
    ) as Partial<SavedFolderScopes> | null;
    if (stored && typeof stored === "object")
      return {
        chat: cleanFolderList(stored.chat),
        notes: cleanFolderList(stored.notes),
      };
    const legacy = JSON.parse(localStorage.getItem("oschat-folders") || "[]");
    return { chat: cleanFolderList(legacy), notes: [] };
  } catch {
    return { chat: [], notes: [] };
  }
}

function OsChatWordmark({ settings = false }: { settings?: boolean }) {
  if (settings) {
    return (
      <span className="oschat-wordmark" aria-label="Settings">
        Settings
      </span>
    );
  }
  return (
    <span className="oschat-wordmark" aria-label="osChat">
      <span className="oschat-wordmark-os">os</span>
      <span className="oschat-wordmark-chat">Chat</span>
    </span>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [view, setView] = useState<WorkspaceView>("chat");
  const [artifacts, setArtifacts] = useState<ProductivityArtifactSummary[]>([]);
  const [activeArtifact, setActiveArtifact] =
    useState<ProductivityArtifact | null>(null);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const artifactSaveTimer = useRef<number | null>(null);
  const activeArtifactRef = useRef<ProductivityArtifact | null>(null);
  activeArtifactRef.current = activeArtifact;

  const [agentState, setAgentState] = useState(emptyAgentState);
  const [activeChatId, setActiveChatId] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotice[]>([]);
  const [collectionFilter, setCollectionFilter] =
    useState<CollectionFilter>("all");
  const [itemMenu, setItemMenu] = useState("");
  const [itemMenuPosition, setItemMenuPosition] = useState({ top: 0, left: 0 });
  const [chatAction, setChatAction] = useState<ChatActionDialog | null>(null);
  const [chatActionSaving, setChatActionSaving] = useState(false);
  const [notesView, setNotesView] =
    useState<ProductivityArtifactKind>("document");
  const [savedFolderScopes, setSavedFolderScopes] =
    useState<SavedFolderScopes>(loadFolderScopes);
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "appearance" | "models" | "permissions" | "updates" | "data"
  >("appearance");
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelEngine, setModelEngine] = useState<AiEngine>("llamacpp");
  const [downloadingTier, setDownloadingTier] = useState("");
  const [activity, setActivity] = useState<AgentActivity | null>(null);

  const [theme, setTheme] = useState<EditorPreferences["theme"]>("dark");
  const [uiScale, setUiScale] = useState<EditorPreferences["uiScale"]>(1);
  const [aiEngine, setAiEngine] = useState<AiEngine>("llamacpp");
  const [aiModel, setAiModel] = useState("");
  const [aiExecutable, setAiExecutable] = useState("");
  const [aiEditMode, setAiEditMode] = useState<AiEditMode>("ask");
  const [aiTerminalMode, setAiTerminalMode] = useState<AiTerminalMode>("ask");
  const [aiFileAccess, setAiFileAccess] = useState(false);
  const [aiWebAccess, setAiWebAccess] = useState(false);
  const [aiBrowserAccess, setAiBrowserAccess] = useState(false);
  const [aiComputerAccess, setAiComputerAccess] = useState(false);
  const [aiContextLimit, setAiContextLimit] = useState(262_144);
  const [aiHardware, setAiHardware] = useState<AiInferenceHardware>("auto");
  const [aiThinkingEnabled, setAiThinkingEnabled] = useState(true);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(emptyUpdate);
  const [aiAttention, setAiAttention] = useState<AiAttention | null>(null);

  const addNotification = useCallback(
    (
      title: string,
      detail: string,
      kind: AppNotice["kind"] = "info",
      chatId?: string,
    ) => {
      const clean = detail.trim();
      if (!clean) return;
      setNotifications((current) => {
        if (
          current[0]?.title === title &&
          current[0]?.detail === clean &&
          current[0]?.chatId === chatId &&
          !current[0]?.readAt
        )
          return current;
        return [
          {
            id: newId(),
            chatId,
            title,
            detail: clean,
            kind,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ].slice(0, 100);
      });
    },
    [],
  );
  const markVisibleChatRead = useCallback((chatId: string) => {
    if (!chatId) return;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) =>
        item.chatId === chatId && item.kind !== "permission" && !item.readAt
          ? { ...item, readAt }
          : item,
      ),
    );
    setAiAttention((current) =>
      current?.chatId === chatId && current.kind !== "permission"
        ? null
        : current,
    );
  }, []);
  const markNotificationPanelRead = useCallback(() => {
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) =>
        item.kind !== "permission" && !item.readAt ? { ...item, readAt } : item,
      ),
    );
    setAiAttention((current) =>
      current?.kind === "permission" ? current : null,
    );
  }, []);
  const clearReadNotifications = useCallback(() => {
    setNotifications((current) =>
      current.filter((item) => item.kind === "permission" && !item.readAt),
    );
    setAiAttention((current) =>
      current?.kind === "permission" ? current : null,
    );
  }, []);

  const refreshArtifacts = useCallback(async () => {
    const next = await window.oscode.listArtifacts();
    setArtifacts(next);
    const current = activeArtifactRef.current;
    if (current && next.some((item) => item.id === current.id))
      setActiveArtifact(await window.oscode.readArtifact(current.id));
  }, []);
  const refreshAgentState = useCallback(async () => {
    const next = await window.oscode.aiAgentState();
    setAgentState(next);
    if (!activeChatId && next.chats[0]) setActiveChatId(next.chats[0].id);
  }, [activeChatId]);
  const refreshModels = useCallback(async () => {
    setModels(await window.oscode.listAiModels());
  }, []);

  useEffect(() => {
    document.addEventListener("wheel", scrollHorizontalMenu, {
      capture: true,
      passive: false,
    });
    return () =>
      document.removeEventListener("wheel", scrollHorizontalMenu, true);
  }, []);
  useEffect(() => {
    if (view !== "chat") setNotesView(view);
  }, [view]);
  useEffect(() => {
    if (!itemMenu) return;
    const close = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".sidebar-item-menu, .item-more")) return;
      setItemMenu("");
    };
    const closeForViewportChange = () => setItemMenu("");
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("scroll", closeForViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("scroll", closeForViewportChange, true);
    };
  }, [itemMenu]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [workspace, preferences, status] = await Promise.all([
          window.oscode.ensureChatWorkspace(),
          window.oscode.loadPreferences(),
          window.oscode.appUpdateStatus(),
        ]);
        if (cancelled) return;
        setWorkspaceRoot(workspace.root);
        setTheme(preferences.theme);
        setUiScale(preferences.uiScale);
        setAiEngine(preferences.aiEngine);
        setModelEngine(preferences.aiEngine);
        setAiModel(preferences.aiModel);
        setAiExecutable(preferences.aiExecutable);
        setAiEditMode(preferences.aiEditMode);
        setAiFileAccess(preferences.aiFileAccess);
        setAiWebAccess(preferences.aiWebAccess);
        setAiContextLimit(preferences.aiContextLimit);
        setAiHardware(preferences.aiHardware);
        setAiThinkingEnabled(preferences.aiThinkingEnabled);
        setAutoUpdateEnabled(preferences.autoUpdateEnabled);
        setUpdateStatus(status);
        await Promise.all([
          refreshArtifacts(),
          refreshAgentState(),
          refreshModels(),
        ]);
        setReady(true);
      } catch (error) {
        setNotice(errorMessage(error));
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => void refreshAgentState(), 1_500);
    return () => window.clearInterval(timer);
  }, [ready, refreshAgentState]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice(""),
      NOTICE_AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(
    () => window.oscode.onAppUpdateStatus((status) => setUpdateStatus(status)),
    [],
  );
  useEffect(() => {
    if (["available", "ready", "error"].includes(updateStatus.state))
      addNotification(
        updateStatus.state === "error"
          ? "Update check needs attention"
          : "Update available",
        updateStatus.message,
        "update",
      );
  }, [addNotification, updateStatus.message, updateStatus.state]);
  useEffect(
    () =>
      window.oscode.onAgentActivity((next) => {
        setActivity(next);
        if (next?.active && next.label) {
          setNotice(next.label);
          addNotification("Agent activity", next.label, "activity");
        }
      }),
    [addNotification],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    window.oscode.setZoomFactor(uiScale);
  }, [theme, uiScale]);
  useEffect(() => {
    localStorage.setItem(
      "oschat-folder-scopes-v2",
      JSON.stringify(savedFolderScopes),
    );
  }, [savedFolderScopes]);
  useEffect(() => {
    if (!ready) return;
    void window.oscode
      .loadPreferences()
      .then((current) =>
        window.oscode.savePreferences({
          ...current,
          theme,
          uiScale,
          aiEngine,
          aiModel,
          aiExecutable,
          aiEditMode,
          aiFileAccess,
          aiWebAccess,
          aiContextLimit,
          aiHardware,
          aiThinkingEnabled,
          autoUpdateEnabled,
          autoUpdatePromptAnswered: true,
          aiVisible: true,
          sidebarVisible: true,
          lastProject: workspaceRoot,
        }),
      )
      .catch(() => undefined);
  }, [
    ready,
    workspaceRoot,
    theme,
    uiScale,
    aiEngine,
    aiModel,
    aiExecutable,
    aiEditMode,
    aiFileAccess,
    aiWebAccess,
    aiContextLimit,
    aiHardware,
    aiThinkingEnabled,
    autoUpdateEnabled,
  ]);
  useEffect(() => {
    const visibleResponse = Boolean(
      aiAttention &&
      aiAttention.kind !== "permission" &&
      aiAttention.chatId === activeChatId &&
      view === "chat" &&
      document.visibilityState === "visible" &&
      document.hasFocus(),
    );
    if (visibleResponse && aiAttention) {
      markVisibleChatRead(aiAttention.chatId);
      return;
    }
    const count = aiAttention ? 1 : 0;
    void window.oscode.setAppAttentionBadge(
      count,
      aiAttention?.kind || "response",
    );
    if (aiAttention) {
      const notification = attentionNotification(aiAttention);
      addNotification(
        notification.title,
        aiAttention.detail,
        notification.kind,
        aiAttention.chatId,
      );
    }
  }, [activeChatId, addNotification, aiAttention, markVisibleChatRead, view]);
  useEffect(() => {
    const acknowledgeVisibleChat = () => {
      if (
        view === "chat" &&
        activeChatId &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      )
        markVisibleChatRead(activeChatId);
    };
    const frame = requestAnimationFrame(acknowledgeVisibleChat);
    window.addEventListener("focus", acknowledgeVisibleChat);
    document.addEventListener("visibilitychange", acknowledgeVisibleChat);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", acknowledgeVisibleChat);
      document.removeEventListener("visibilitychange", acknowledgeVisibleChat);
    };
  }, [activeChatId, markVisibleChatRead, view]);
  useEffect(() => {
    if (notificationsOpen) markNotificationPanelRead();
  }, [markNotificationPanelRead, notificationsOpen]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => !item.readAt).length,
    [notifications],
  );

  const saveArtifact = useCallback(
    async (artifact = activeArtifactRef.current) => {
      if (!artifact) return;
      setArtifactSaving(true);
      try {
        const saved = await window.oscode.saveArtifact(artifact);
        setActiveArtifact((current) =>
          current?.id === saved.id ? { ...current, ...saved } : current,
        );
        await refreshArtifacts();
      } catch (error) {
        setNotice(errorMessage(error));
      } finally {
        setArtifactSaving(false);
      }
    },
    [refreshArtifacts],
  );
  const changeArtifact = (artifact: ProductivityArtifact) => {
    setActiveArtifact(artifact);
    if (artifactSaveTimer.current)
      window.clearTimeout(artifactSaveTimer.current);
    artifactSaveTimer.current = window.setTimeout(
      () => void saveArtifact(artifact),
      650,
    );
  };
  const createArtifact = async (
    kind: ProductivityArtifactKind,
    title = `Untitled ${kind}`,
    data = defaultArtifactData(kind),
  ) => {
    const now = new Date().toISOString();
    const artifact: ProductivityArtifact = {
      id: newId(),
      kind,
      title,
      folder: "",
      favorite: false,
      createdAt: now,
      updatedAt: now,
      data,
    };
    const saved = await window.oscode.saveArtifact(artifact);
    setArtifacts(await window.oscode.listArtifacts());
    setActiveArtifact({ ...artifact, ...saved });
    setView(kind);
  };
  const openArtifact = async (summary: ProductivityArtifactSummary) => {
    setActiveArtifact(await window.oscode.readArtifact(summary.id));
    setView(summary.kind);
  };
  const openChatArtifact = async (payload: ChatArtifactPayload) => {
    if (!["document", "spreadsheet", "presentation"].includes(payload.type))
      return;
    const kind = payload.type as ProductivityArtifactKind;
    let data = payload.data || defaultArtifactData(kind);
    if (kind === "document" && !payload.data) {
      const content = payload.content || payload.description || "";
      data = {
        html: `<h1>${escapeHtml(payload.title || "AI document")}</h1><p>${escapeHtml(content).replace(/\n/g, "</p><p>")}</p>`,
        plainText: `${payload.title || "AI document"}\n${content}`,
        page: "letter",
        zoom: 1,
      };
    }
    if (kind === "spreadsheet" && !payload.data) {
      const rows = [
        payload.headers || [],
        ...(payload.rows || []).map((row) => row.map(String)),
      ];
      while (rows.length < 30)
        rows.push(Array(Math.max(12, rows[0]?.length || 0)).fill(""));
      const sheet = {
        id: newId(),
        name: "Sheet 1",
        cells: rows.map((row) => {
          const next = [...row];
          while (next.length < 12) next.push("");
          return next;
        }),
        styles: {},
      };
      data = { sheets: [sheet], activeSheetId: sheet.id };
    }
    if (kind === "presentation" && !payload.data) {
      const points = (payload.content || payload.description || "")
        .split(/\n+/)
        .filter(Boolean);
      const slides = [
        {
          id: newId(),
          title: payload.title || "AI presentation",
          body: payload.description || "",
          notes: "",
          background: "#20262a",
          layout: "title",
        },
        ...points.slice(0, 12).map((point, index) => ({
          id: newId(),
          title: `Idea ${index + 1}`,
          body: point,
          notes: "",
          background: "#20262a",
          layout: "section",
        })),
      ];
      data = { slides, activeSlideId: slides[0].id, theme: "gunmetal" };
    }
    await createArtifact(kind, payload.title || `AI ${kind}`, data);
  };

  const newChat = async () => {
    const chat = await window.oscode.createAiChat(undefined, true);
    setView("chat");
    setActiveChatId(chat.id);
    setAgentState(await window.oscode.aiAgentState());
    window.dispatchEvent(
      new CustomEvent("oscode:open-ai-chat", { detail: chat.id }),
    );
  };
  const updateChatCollection = async (
    chat: AiChatThread,
    patch: { title?: string; folder?: string; favorite?: boolean },
  ): Promise<boolean> => {
    try {
      await patchChatCollection(window.oscode, chat, patch);
      await refreshAgentState();
      return true;
    } catch (error) {
      setNotice(errorMessage(error));
      return false;
    } finally {
      setItemMenu("");
    }
  };
  const updateArtifactCollection = async (
    artifact: ProductivityArtifactSummary,
    patch: { title?: string; folder?: string; favorite?: boolean },
  ): Promise<boolean> => {
    try {
      await patchProductivityArtifact(
        window.oscode,
        artifact,
        activeArtifactRef.current,
        patch,
      );
      await refreshArtifacts();
      return true;
    } catch (error) {
      setNotice(errorMessage(error));
      return false;
    } finally {
      setItemMenu("");
    }
  };
  const openChatAction = (
    action: ChatActionDialog["action"],
    chat: AiChatThread,
  ) => {
    setItemMenu("");
    setChatAction({
      action,
      chat,
      value:
        action === "rename"
          ? chat.title || "New chat"
          : action === "move"
            ? chat.folder || ""
            : "",
    });
  };
  const submitChatAction = async () => {
    if (!chatAction || chatActionSaving) return;
    setChatActionSaving(true);
    try {
      if (chatAction.action === "delete") {
        await deleteChatCollection(window.oscode, chatAction.chat);
        const next = await window.oscode.aiAgentState();
        setAgentState(next);
        if (activeChatId === chatAction.chat.id) {
          const nextChat =
            next.chats[0] ||
            (await window.oscode.createAiChat(undefined, true));
          if (!next.chats.length)
            setAgentState(await window.oscode.aiAgentState());
          setActiveChatId(nextChat.id);
          window.dispatchEvent(
            new CustomEvent("oscode:open-ai-chat", { detail: nextChat.id }),
          );
        }
        setNotice(`Deleted “${chatAction.chat.title || "New chat"}”`);
      } else {
        const value = chatAction.value.replace(/\s+/g, " ").trim();
        if (chatAction.action === "rename") {
          if (!value) throw new Error("Enter a name for the chat");
          const saved = await updateChatCollection(chatAction.chat, {
            title: value.slice(0, 120),
          });
          if (!saved) return;
          setNotice(`Renamed chat to “${value.slice(0, 120)}”`);
        } else {
          const saved = await updateChatCollection(chatAction.chat, {
            folder: value.slice(0, 80),
          });
          if (!saved) return;
          setNotice(
            value
              ? `Moved “${chatAction.chat.title}” to ${value.slice(0, 80)}`
              : `Moved “${chatAction.chat.title}” out of its folder`,
          );
        }
      }
      setChatAction(null);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setChatActionSaving(false);
    }
  };
  const toggleChatFavorite = async (chat: AiChatThread) => {
    const favorite = !chat.favorite;
    if (await updateChatCollection(chat, { favorite }))
      setNotice(
        favorite
          ? `Added “${chat.title || "New chat"}” to favorites`
          : `Removed “${chat.title || "New chat"}” from favorites`,
      );
  };
  const moveArtifact = async (artifact: ProductivityArtifactSummary) => {
    const folder = globalThis.prompt(
      `Move ${artifact.kind} to folder`,
      artifact.folder || "",
    );
    if (folder === null) {
      setItemMenu("");
      return;
    }
    const nextFolder = folder.trim().slice(0, 80);
    if (
      await updateArtifactCollection(artifact, {
        folder: nextFolder,
      })
    )
      setNotice(
        nextFolder
          ? `Moved “${artifact.title}” to ${nextFolder}`
          : `Moved “${artifact.title}” out of its folder`,
      );
  };
  const toggleArtifactFavorite = async (
    artifact: ProductivityArtifactSummary,
  ) => {
    const favorite = !artifact.favorite;
    if (await updateArtifactCollection(artifact, { favorite }))
      setNotice(
        favorite
          ? `Added “${artifact.title}” to favorites`
          : `Removed “${artifact.title}” from favorites`,
      );
  };
  const duplicateArtifact = async (artifact: ProductivityArtifactSummary) => {
    try {
      const now = new Date().toISOString();
      const saved = await duplicateProductivityArtifact(
        window.oscode,
        artifact,
        activeArtifactRef.current,
        newId(),
        now,
      );
      await refreshArtifacts();
      setNotice(`Duplicated “${artifact.title}”`);
      await openArtifact(saved);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setItemMenu("");
    }
  };
  const exportArtifactFromLibrary = async (
    artifact: ProductivityArtifactSummary,
  ) => {
    setItemMenu("");
    try {
      const exported = await exportProductivityArtifact(
        window.oscode,
        artifact,
        activeArtifactRef.current,
      );
      if (exported) setNotice(`Exported to ${exported}`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const deleteArtifactFromLibrary = async (
    artifact: ProductivityArtifactSummary,
  ) => {
    setItemMenu("");
    try {
      if (!(await deleteProductivityArtifact(window.oscode, artifact))) return;
      if (activeArtifactRef.current?.id === artifact.id) {
        activeArtifactRef.current = null;
        setActiveArtifact(null);
      }
      await refreshArtifacts();
      setNotice(`Moved “${artifact.title}” to Trash`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const duplicateChat = async (chat: AiChatThread) => {
    setItemMenu("");
    try {
      const copy = await duplicateChatCollection(window.oscode, chat);
      await refreshAgentState();
      setActiveChatId(copy.id);
      setView("chat");
      window.dispatchEvent(
        new CustomEvent("oscode:open-ai-chat", { detail: copy.id }),
      );
      setNotice(`Duplicated “${chat.title || "New chat"}”`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  useEffect(
    () =>
      window.oscode.onMenuAction((action) => {
        if (action === "new-chat") void newChat();
        else if (action === "show-chats") setView("chat");
        else if (action === "show-notes") setView(notesView);
        else if (action === "new-document") void createArtifact("document");
        else if (action === "new-spreadsheet")
          void createArtifact("spreadsheet");
        else if (action === "new-presentation")
          void createArtifact("presentation");
        else if (action === "toggle-theme")
          setTheme((current) =>
            current === "dark"
              ? "blue-dark"
              : current === "blue-dark"
                ? "blue-light"
                : "dark",
          );
      }),
    [],
  );
  useEffect(() => {
    if (window.oscode.platform !== "darwin") return;
    void window.oscode.setTouchBarState({
      section: view === "chat" ? "chats" : "notes",
    });
  }, [view]);
  const filteredChats = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    return agentState.chats.filter(
      (chat) =>
        (collectionFilter === "all" ||
          (collectionFilter === "favorites" && chat.favorite) ||
          (collectionFilter.startsWith("folder:") &&
            chat.folder === collectionFilter.slice(7))) &&
        (!query ||
          chat.title.toLowerCase().includes(query) ||
          chat.messages.some((message) =>
            message.content.toLowerCase().includes(query),
          )),
    );
  }, [agentState.chats, chatSearch, collectionFilter]);
  const visibleArtifacts = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    return artifacts.filter(
      (artifact) =>
        (collectionFilter === "all" ||
          (collectionFilter === "favorites" && artifact.favorite) ||
          (collectionFilter.startsWith("folder:") &&
            artifact.folder === collectionFilter.slice(7))) &&
        (!query || artifact.title.toLowerCase().includes(query)) &&
        (view === "chat" || artifact.kind === view),
    );
  }, [artifacts, chatSearch, collectionFilter, view]);
  const folderScope: FolderScope = view === "chat" ? "chat" : "notes";
  const previousFolderScope = useRef<FolderScope>(folderScope);
  useEffect(() => {
    if (previousFolderScope.current === folderScope) return;
    previousFolderScope.current = folderScope;
    setCollectionFilter("all");
    setFolderEditorOpen(false);
    setFolderDraft("");
  }, [folderScope]);
  const folders = useMemo(
    () =>
      [
        ...new Set(
          [
            ...savedFolderScopes[folderScope],
            ...(folderScope === "chat"
              ? agentState.chats.map((chat) => chat.folder)
              : artifacts.map((artifact) => artifact.folder)),
          ].filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [agentState.chats, artifacts, folderScope, savedFolderScopes],
  );
  const createFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const folder = folderDraft.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!folder) return;
    setSavedFolderScopes((current) => ({
      ...current,
      [folderScope]: [...new Set([...current[folderScope], folder])],
    }));
    setFolderDraft("");
    setFolderEditorOpen(false);
  };
  const toggleItemMenu = (key: string, trigger: HTMLButtonElement) => {
    if (itemMenu === key) {
      setItemMenu("");
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const width = 190;
    setItemMenuPosition({
      top: Math.min(rect.bottom + 6, window.innerHeight - 210),
      left: Math.max(
        8,
        Math.min(rect.right - width, window.innerWidth - width - 8),
      ),
    });
    setItemMenu(key);
  };
  const sharedAi = (
    <AiPanel
      key="oschat-shared-ai"
      workspaceMode
      hideTerminalControl
      assistantName="osChat"
      controlsPortalId="oschat-ai-controls"
      engine={aiEngine}
      model={aiModel}
      executable={aiExecutable}
      editMode={aiEditMode}
      terminalMode={aiTerminalMode}
      fileAccess={aiFileAccess}
      webAccess={aiWebAccess}
      browserAccess={aiBrowserAccess}
      computerAccess={aiComputerAccess}
      contextLimit={aiContextLimit}
      hardwarePreference={aiHardware}
      thinkingEnabled={aiThinkingEnabled}
      width={0}
      side="right"
      projectName="osChat Workspace"
      openChatId={activeChatId}
      onEngine={(engine) => {
        setAiEngine(engine);
        setModelEngine(engine);
        setAiModel("");
      }}
      onModel={setAiModel}
      onEditMode={setAiEditMode}
      onTerminalMode={setAiTerminalMode}
      onFileAccess={setAiFileAccess}
      onWebAccess={setAiWebAccess}
      onBrowserAccess={setAiBrowserAccess}
      onComputerAccess={setAiComputerAccess}
      onContextLimit={setAiContextLimit}
      onHardwarePreference={setAiHardware}
      onChanged={async () => {
        await refreshArtifacts();
        await refreshAgentState();
      }}
      onNotice={(message) => {
        setNotice(message);
        addNotification("osChat", message, "info");
      }}
      onChatOpened={() => void refreshAgentState()}
      onAttentionChange={setAiAttention}
      onOpenArtifact={(artifact) => void openChatArtifact(artifact)}
    />
  );

  if (!ready)
    return (
      <div className="oschat-loading">
        <img src={osChatIcon} alt="" />
        <h1>osChat</h1>
        <p>Preparing your private workspace…</p>
      </div>
    );

  return (
    <div
      className={`app oschat-app ${theme === "dark" ? "" : theme}`.trim()}
      data-platform={window.oscode.platform}
      data-oschat-ready="true"
    >
      <div className="mac-titlebar-safe-area" aria-hidden="true" />
      {activity?.kind === "computer" && activity.active && (
        <div className="oschat-control-banner">
          <span>
            <FeatherIcon icon="mouse-pointer" size="18" />
            <span>
              <b>Computer Control active</b>
              <small>{activity.label}</small>
            </span>
          </span>
          <span>
            Press <kbd>Esc</kbd> anywhere to stop
            <button
              type="button"
              onClick={() => void window.oscode.stopAgentControl()}
            >
              <FeatherIcon icon="square" size="14" /> Stop control
            </button>
          </span>
        </div>
      )}
      <header className="oschat-topbar">
        <button
          className="oschat-brand"
          type="button"
          onClick={() => setView("chat")}
        >
          <img src={osChatIcon} alt="" />
          <b>
            <OsChatWordmark />
          </b>
        </button>
        <label className="oschat-global-search">
          <FeatherIcon icon="search" size="17" />
          <input
            type="search"
            value={chatSearch}
            placeholder="Search chats and workspaces"
            onChange={(event) => setChatSearch(event.target.value)}
          />
        </label>
        <div className="oschat-top-actions">
          {["available", "ready"].includes(updateStatus.state) && (
            <button
              type="button"
              className="update-ready"
              onClick={() => setSettingsOpen(true)}
            >
              <FeatherIcon icon="download-cloud" size="16" />
              Update available
            </button>
          )}
          <IconButton
            icon="bell"
            label="Notifications"
            badge={unreadNotificationCount}
            active={notificationsOpen}
            onClick={() => setNotificationsOpen((current) => !current)}
          />
          <span className="oschat-top-divider" aria-hidden="true" />
          <div id="oschat-ai-controls" className="oschat-ai-top-controls" />
        </div>
      </header>
      {notificationsOpen && (
        <aside className="oschat-notification-panel" aria-label="Notifications">
          <header>
            <span>
              <b>Notifications</b>
              <small>
                {unreadNotificationCount
                  ? `${unreadNotificationCount} unread · ${notifications.length} recent`
                  : notifications.length
                    ? `${notifications.length} recent · all read`
                    : "You’re all caught up"}
              </small>
            </span>
            <div>
              {!!notifications.length && (
                <button type="button" onClick={clearReadNotifications}>
                  Clear
                </button>
              )}
              <IconButton
                icon="x"
                label="Close notifications"
                onClick={() => setNotificationsOpen(false)}
              />
            </div>
          </header>
          <div className="notification-list">
            {notifications.map((item) => (
              <article
                key={item.id}
                className={`${item.kind}${item.readAt ? " read" : ""}${item.chatId ? " chat-linked" : ""}`}
                role={item.chatId ? "button" : undefined}
                tabIndex={item.chatId ? 0 : undefined}
                onClick={() => {
                  if (!item.chatId) return;
                  markVisibleChatRead(item.chatId);
                  setActiveChatId(item.chatId);
                  setView("chat");
                  setNotificationsOpen(false);
                }}
                onKeyDown={(event) => {
                  if (
                    item.chatId &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    event.currentTarget.click();
                  }
                }}
              >
                <span>
                  <FeatherIcon
                    icon={
                      item.kind === "permission"
                        ? "shield"
                        : item.kind === "input"
                          ? "help-circle"
                          : item.kind === "error"
                            ? "alert-circle"
                            : item.kind === "response"
                              ? "check-circle"
                              : item.kind === "update"
                                ? "download-cloud"
                                : item.kind === "activity"
                                  ? "activity"
                                  : "message-square"
                    }
                    size="17"
                  />
                </span>
                <div>
                  <b>{item.title}</b>
                  <p>{publicAssistantText(item.detail)}</p>
                  <time>{new Date(item.createdAt).toLocaleString()}</time>
                </div>
              </article>
            ))}
            {!notifications.length && (
              <div className="notifications-empty">
                <FeatherIcon icon="check-circle" size="28" />
                <b>No new notifications</b>
                <p>Responses, permissions, and updates will appear here.</p>
              </div>
            )}
          </div>
        </aside>
      )}
      <div className="oschat-shell">
        <aside className="oschat-sidebar">
          <button
            type="button"
            className="new-chat-button"
            onClick={() => void newChat()}
          >
            <FeatherIcon icon="edit" size="18" />
            New chat
            <span>{window.oscode.platform === "darwin" ? "⌘N" : "Ctrl N"}</span>
          </button>
          <nav className="workspace-nav" aria-label="Workspaces">
            <button
              type="button"
              className={view === "chat" ? "active" : ""}
              onClick={() => setView("chat")}
            >
              <FeatherIcon icon="message-square" size="18" />
              Chats
            </button>
            <button
              type="button"
              className={view !== "chat" ? "active" : ""}
              aria-expanded={view !== "chat"}
              onClick={() => setView(notesView)}
            >
              <FeatherIcon icon="file-text" size="18" />
              Notes
              <span>{artifacts.length}</span>
            </button>
          </nav>
          {view !== "chat" && (
            <nav className="notes-kind-nav" aria-label="Note types">
              {(Object.keys(workspaceLabels) as ProductivityArtifactKind[]).map(
                (kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={view === kind ? "active" : ""}
                    onClick={() => setView(kind)}
                  >
                    <FeatherIcon icon={workspaceIcons[kind]} size="16" />
                    {workspaceLabels[kind]}
                    <span>
                      {artifacts.filter((item) => item.kind === kind).length}
                    </span>
                  </button>
                ),
              )}
            </nav>
          )}
          <div className="sidebar-divider" />
          <section className="collection-browser" aria-label="Library filters">
            <div className="collection-tabs">
              <button
                type="button"
                className={collectionFilter === "all" ? "active" : ""}
                onClick={() => setCollectionFilter("all")}
              >
                <FeatherIcon icon="layers" size="15" /> All
              </button>
              <button
                type="button"
                className={collectionFilter === "favorites" ? "active" : ""}
                onClick={() => setCollectionFilter("favorites")}
              >
                <FeatherIcon icon="star" size="15" /> Favorites
              </button>
            </div>
            <header>
              <span>
                {folderScope === "chat" ? "Chat folders" : "Note folders"}
              </span>
              <button
                type="button"
                aria-label="New folder"
                title={`Add a ${folderScope} folder`}
                aria-expanded={folderEditorOpen}
                aria-controls="folder-create-form"
                onClick={() => {
                  setFolderEditorOpen((current) => !current);
                  setFolderDraft("");
                }}
              >
                <FeatherIcon icon="folder-plus" size="18" />
              </button>
            </header>
            {folderEditorOpen && (
              <form
                id="folder-create-form"
                className="folder-create-form"
                onSubmit={createFolder}
              >
                <input
                  autoFocus
                  value={folderDraft}
                  maxLength={80}
                  aria-label={`Name for new ${folderScope} folder`}
                  placeholder="Folder name"
                  onChange={(event) => setFolderDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    setFolderDraft("");
                    setFolderEditorOpen(false);
                  }}
                />
                <button
                  type="submit"
                  className="primary"
                  aria-label="Create folder"
                  disabled={!folderDraft.trim()}
                >
                  <FeatherIcon icon="check" size="17" />
                </button>
                <button
                  type="button"
                  aria-label="Cancel new folder"
                  onClick={() => {
                    setFolderDraft("");
                    setFolderEditorOpen(false);
                  }}
                >
                  <FeatherIcon icon="x" size="17" />
                </button>
              </form>
            )}
            <div
              className="folder-strip horizontal-menu-scroll"
              data-horizontal-menu
            >
              {folders.map((folder) => (
                <button
                  type="button"
                  key={folder}
                  className={
                    collectionFilter === `folder:${folder}` ? "active" : ""
                  }
                  onClick={() => setCollectionFilter(`folder:${folder}`)}
                >
                  <FeatherIcon icon="folder" size="14" /> {folder}
                </button>
              ))}
              {!folders.length && (
                <small>
                  {folderScope === "chat"
                    ? "Create folders for your chats."
                    : "Create folders shared by all notes."}
                </small>
              )}
            </div>
          </section>
          {view === "chat" ? (
            <section className="sidebar-list">
              <header>
                <span>Recent chats</span>
              </header>
              <div>
                {filteredChats.map((chat) => {
                  const preview = chatListPreview(
                    publicAssistantText(chat.messages.at(-1)?.content || ""),
                  );
                  return (
                    <article
                      key={chat.id}
                      className={`${chat.id === activeChatId ? "active" : ""}${
                        chat.favorite ? " favorite" : ""
                      }`.trim()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChatId(chat.id);
                          setView("chat");
                        }}
                      >
                        <b>{chat.title || "New chat"}</b>
                        {preview !== null && (
                          <small>
                            {preview.slice(0, 70) || "No messages yet"}
                          </small>
                        )}
                      </button>
                      {chat.favorite && (
                        <button
                          type="button"
                          className="chat-favorite-toggle"
                          aria-label={`Remove ${chat.title || "New chat"} from favorites`}
                          title="Remove from favorites"
                          onClick={() => void toggleChatFavorite(chat)}
                        >
                          <FeatherIcon icon="star" size="16" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="item-more"
                        aria-label={`Options for ${chat.title}`}
                        onClick={(event) =>
                          toggleItemMenu(`chat:${chat.id}`, event.currentTarget)
                        }
                      >
                        <FeatherIcon icon="more-horizontal" size="17" />
                      </button>
                      {itemMenu === `chat:${chat.id}` &&
                        createPortal(
                          <div
                            className="sidebar-item-menu sidebar-item-menu-portal"
                            style={itemMenuPosition}
                          >
                            <button
                              type="button"
                              onClick={() => openChatAction("rename", chat)}
                            >
                              <FeatherIcon icon="edit-3" size="15" /> Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleChatFavorite(chat)}
                            >
                              <FeatherIcon icon="star" size="15" />{" "}
                              {chat.favorite ? "Remove favorite" : "Favorite"}
                            </button>
                            <button
                              type="button"
                              onClick={() => openChatAction("move", chat)}
                            >
                              <FeatherIcon icon="folder" size="15" /> Move to
                              folder
                            </button>
                            <button
                              type="button"
                              onClick={() => void duplicateChat(chat)}
                            >
                              <FeatherIcon icon="copy" size="15" /> Duplicate
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => openChatAction("delete", chat)}
                            >
                              <FeatherIcon icon="trash-2" size="15" /> Delete
                            </button>
                          </div>,
                          document.querySelector(".oschat-app") ||
                            document.body,
                        )}
                    </article>
                  );
                })}
                {!filteredChats.length && (
                  <p>
                    {chatSearch.trim() || collectionFilter !== "all"
                      ? "No chats match this view."
                      : "No chats yet. Start a new conversation."}
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section className="sidebar-list">
              <header className="artifact-library-header">
                <span>{workspaceLabels[view]}</span>
                <button
                  type="button"
                  aria-label={`New ${view}`}
                  className="artifact-create-icon"
                  onClick={() => void createArtifact(view)}
                >
                  <FeatherIcon icon="plus" size="18" />
                </button>
              </header>
              <div>
                {visibleArtifacts.map((artifact) => (
                  <article
                    key={artifact.id}
                    className={
                      artifact.id === activeArtifact?.id ? "active" : ""
                    }
                  >
                    <button
                      type="button"
                      className="artifact-list-button"
                      onClick={() => void openArtifact(artifact)}
                    >
                      <i className="artifact-list-icon" aria-hidden="true">
                        <FeatherIcon
                          icon={workspaceIcons[artifact.kind]}
                          size="17"
                        />
                      </i>
                      <span>
                        <b>{artifact.title}</b>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="item-more"
                      aria-label={`Options for ${artifact.title}`}
                      onClick={(event) =>
                        toggleItemMenu(
                          `artifact:${artifact.id}`,
                          event.currentTarget,
                        )
                      }
                    >
                      <FeatherIcon icon="more-horizontal" size="17" />
                    </button>
                    {itemMenu === `artifact:${artifact.id}` &&
                      createPortal(
                        <div
                          className="sidebar-item-menu sidebar-item-menu-portal"
                          style={itemMenuPosition}
                        >
                          <button
                            type="button"
                            aria-pressed={artifact.favorite}
                            onClick={() =>
                              void toggleArtifactFavorite(artifact)
                            }
                          >
                            <FeatherIcon icon="star" size="15" />{" "}
                            {artifact.favorite ? "Remove favorite" : "Favorite"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void moveArtifact(artifact)}
                          >
                            <FeatherIcon icon="folder" size="15" /> Move to
                            folder
                          </button>
                          <button
                            type="button"
                            onClick={() => void duplicateArtifact(artifact)}
                          >
                            <FeatherIcon icon="copy" size="15" /> Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void exportArtifactFromLibrary(artifact)
                            }
                          >
                            <FeatherIcon icon="download" size="15" /> Export
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              void deleteArtifactFromLibrary(artifact)
                            }
                          >
                            <FeatherIcon icon="trash-2" size="15" /> Delete
                          </button>
                        </div>,
                        document.querySelector(".oschat-app") || document.body,
                      )}
                  </article>
                ))}
                {!visibleArtifacts.length && (
                  <p>
                    Your {workspaceLabels[view].toLowerCase()} will appear here.
                  </p>
                )}
              </div>
            </section>
          )}
          <footer>
            <button type="button" onClick={() => setSettingsOpen(true)}>
              <FeatherIcon icon="settings" size="17" />
              Settings
            </button>
          </footer>
        </aside>
        <main
          className={`oschat-main ${
            view === "chat"
              ? "chat-view"
              : activeArtifact?.kind === view
                ? "artifact-view has-artifact"
                : "artifact-view empty-artifact"
          }`}
        >
          {view !== "chat" && activeArtifact?.kind === view && (
            <div className="artifact-editor-pane">
              <ProductivityWorkspace
                artifact={activeArtifact}
                onChange={changeArtifact}
                onExport={(format: ArtifactExportFormat) =>
                  void (async () => {
                    await saveArtifact();
                    const exported = await window.oscode.exportArtifact(
                      activeArtifactRef.current!,
                      format,
                    );
                    if (exported) setNotice(`Exported to ${exported}`);
                  })().catch((error) => setNotice(errorMessage(error)))
                }
                onDelete={() => void deleteArtifactFromLibrary(activeArtifact)}
                saving={artifactSaving}
              />
            </div>
          )}
          {view !== "chat" && activeArtifact?.kind !== view && (
            <section className="workspace-empty">
              <span>
                <FeatherIcon icon={workspaceIcons[view]} size="32" />
              </span>
              <h1>Create your first {view}</h1>
              <p>
                Build it yourself or ask osChat to draft, revise, research, and
                format it with you.
              </p>
              <button type="button" onClick={() => void createArtifact(view)}>
                <FeatherIcon icon="plus" size="17" /> New {view}
              </button>
            </section>
          )}
          {sharedAi}
        </main>
      </div>
      {notice && (
        <div className="oschat-toast" role="status">
          <span>{notice}</span>
          <IconButton icon="x" label="Dismiss" onClick={() => setNotice("")} />
        </div>
      )}
      {chatAction && (
        <div
          className="chat-action-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !chatActionSaving)
              setChatAction(null);
          }}
        >
          <form
            className="chat-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-action-title"
            onSubmit={(event) => {
              event.preventDefault();
              void submitChatAction();
            }}
          >
            <header>
              <div>
                <h2 id="chat-action-title">
                  {chatAction.action === "rename"
                    ? "Rename chat"
                    : chatAction.action === "move"
                      ? "Move to folder"
                      : "Delete chat?"}
                </h2>
                <p>
                  {chatAction.action === "delete"
                    ? `“${chatAction.chat.title || "New chat"}” and its local conversation history will be removed.`
                    : chatAction.action === "move"
                      ? "Choose an existing folder or enter a new folder name."
                      : "Give this conversation a clear name."}
                </p>
              </div>
              <IconButton
                icon="x"
                label="Close"
                disabled={chatActionSaving}
                onClick={() => setChatAction(null)}
              />
            </header>
            {chatAction.action !== "delete" && (
              <label>
                <span>
                  {chatAction.action === "rename" ? "Chat name" : "Folder"}
                </span>
                <input
                  autoFocus
                  value={chatAction.value}
                  maxLength={chatAction.action === "rename" ? 120 : 80}
                  list={
                    chatAction.action === "move"
                      ? "oschat-chat-folder-options"
                      : undefined
                  }
                  placeholder={
                    chatAction.action === "rename"
                      ? "Chat name"
                      : "Leave empty to remove from its folder"
                  }
                  onChange={(event) =>
                    setChatAction((current) =>
                      current
                        ? { ...current, value: event.target.value }
                        : null,
                    )
                  }
                />
                {chatAction.action === "move" && (
                  <datalist id="oschat-chat-folder-options">
                    {savedFolderScopes.chat.map((folder) => (
                      <option value={folder} key={folder} />
                    ))}
                  </datalist>
                )}
              </label>
            )}
            <footer>
              <button
                type="button"
                disabled={chatActionSaving}
                onClick={() => setChatAction(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={
                  chatAction.action === "delete" ? "danger" : "primary"
                }
                disabled={
                  chatActionSaving ||
                  (chatAction.action === "rename" && !chatAction.value.trim())
                }
              >
                {chatActionSaving
                  ? "Saving…"
                  : chatAction.action === "rename"
                    ? "Rename"
                    : chatAction.action === "move"
                      ? "Move"
                      : "Delete chat"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          section={settingsSection}
          setSection={setSettingsSection}
          close={() => setSettingsOpen(false)}
          theme={theme}
          setTheme={setTheme}
          uiScale={uiScale}
          setUiScale={setUiScale}
          models={models}
          engine={modelEngine}
          setEngine={setModelEngine}
          downloadingTier={downloadingTier}
          downloadTier={async (tier) => {
            setDownloadingTier(tier);
            try {
              const model = await window.oscode.downloadOsCodeModel(tier);
              setAiEngine(model.engine);
              setModelEngine(model.engine);
              setAiModel(model.path);
              await refreshModels();
            } finally {
              setDownloadingTier("");
            }
          }}
          addCustomModel={async () => {
            const added = await window.oscode.chooseAiModel(modelEngine, "any");
            if (added.length) {
              setAiEngine(added[0].engine);
              setAiModel(added[0].path);
              await refreshModels();
            }
          }}
          removeModel={async (id) => {
            await window.oscode.removeAiModel(id);
            await refreshModels();
          }}
          aiFileAccess={aiFileAccess}
          setAiFileAccess={setAiFileAccess}
          aiWebAccess={aiWebAccess}
          setAiWebAccess={setAiWebAccess}
          aiBrowserAccess={aiBrowserAccess}
          setAiBrowserAccess={setAiBrowserAccess}
          aiComputerAccess={aiComputerAccess}
          setAiComputerAccess={setAiComputerAccess}
          aiThinkingEnabled={aiThinkingEnabled}
          setAiThinkingEnabled={setAiThinkingEnabled}
          autoUpdateEnabled={autoUpdateEnabled}
          setAutoUpdateEnabled={async (value) => {
            setAutoUpdateEnabled(value);
            setUpdateStatus(await window.oscode.setAppAutoUpdate(value));
          }}
          updateStatus={updateStatus}
          checkUpdate={async () =>
            setUpdateStatus(await window.oscode.checkForAppUpdate())
          }
          downloadUpdate={async () =>
            setUpdateStatus(await window.oscode.downloadAppUpdate())
          }
          installUpdate={async () =>
            setUpdateStatus(await window.oscode.installAppUpdate())
          }
          openSecureData={() => void window.oscode.openSecureData()}
        />
      )}
    </div>
  );
}

type SettingsProps = {
  section: "appearance" | "models" | "permissions" | "updates" | "data";
  setSection: (section: SettingsProps["section"]) => void;
  close: () => void;
  theme: EditorPreferences["theme"];
  setTheme: (theme: EditorPreferences["theme"]) => void;
  uiScale: EditorPreferences["uiScale"];
  setUiScale: (scale: EditorPreferences["uiScale"]) => void;
  models: AiModel[];
  engine: AiEngine;
  setEngine: (engine: AiEngine) => void;
  downloadingTier: string;
  downloadTier: (tier: Exclude<AiModelTier, "custom">) => Promise<void>;
  addCustomModel: () => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  aiFileAccess: boolean;
  setAiFileAccess: (value: boolean) => void;
  aiWebAccess: boolean;
  setAiWebAccess: (value: boolean) => void;
  aiBrowserAccess: boolean;
  setAiBrowserAccess: (value: boolean) => void;
  aiComputerAccess: boolean;
  setAiComputerAccess: (value: boolean) => void;
  aiThinkingEnabled: boolean;
  setAiThinkingEnabled: (value: boolean) => void;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (value: boolean) => Promise<void>;
  updateStatus: AppUpdateStatus;
  checkUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openSecureData: () => void;
};
function SettingsDialog(props: SettingsProps) {
  const sections = [
    ["appearance", "sliders", "Appearance"],
    ["models", "cpu", "Models"],
    ["permissions", "shield", "Permissions"],
    ["updates", "download-cloud", "Updates"],
    ["data", "lock", "Data & privacy"],
  ] as const;
  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.close();
      }}
    >
      <section
        className="oschat-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <aside>
          <header>
            <img src={osChatIcon} alt="" />
            <b>
              <OsChatWordmark settings />
            </b>
          </header>
          <nav>
            {sections.map(([id, icon, label]) => (
              <button
                type="button"
                key={id}
                className={props.section === id ? "active" : ""}
                onClick={() => props.setSection(id)}
              >
                <FeatherIcon icon={icon} size="17" /> {label}
              </button>
            ))}
          </nav>
          <small>Private by default. Models run locally.</small>
        </aside>
        <main>
          <header>
            <div>
              <h2>{sections.find(([id]) => id === props.section)?.[2]}</h2>
              <p>Simple controls with clear consequences.</p>
            </div>
            <IconButton icon="x" label="Close settings" onClick={props.close} />
          </header>
          {props.section === "appearance" && (
            <div className="settings-section">
              <SettingGroup
                title="Theme"
                description="Choose a calm canvas; baby blue remains the shared accent."
              >
                <div className="theme-grid">
                  {(["dark", "blue-dark", "blue-light"] as const).map(
                    (theme) => (
                      <button
                        type="button"
                        key={theme}
                        className={props.theme === theme ? "active" : ""}
                        onClick={() => props.setTheme(theme)}
                      >
                        <span className={theme} />
                        <b>
                          {theme === "dark"
                            ? "Gunmetal"
                            : theme === "blue-dark"
                              ? "Deep blue"
                              : "Paper light"}
                        </b>
                      </button>
                    ),
                  )}
                </div>
              </SettingGroup>
              <SettingGroup
                title="Interface size"
                description="Scale every workspace and control together."
              >
                <select
                  value={props.uiScale}
                  onChange={(event) =>
                    props.setUiScale(
                      Number(
                        event.target.value,
                      ) as EditorPreferences["uiScale"],
                    )
                  }
                >
                  <option value={1}>100%</option>
                  <option value={1.15}>115%</option>
                  <option value={1.3}>130%</option>
                  <option value={1.5}>150%</option>
                  <option value={1.7}>170%</option>
                </select>
              </SettingGroup>
            </div>
          )}
          {props.section === "models" && (
            <div className="settings-section">
              <SettingToggle
                label="Show model thinking"
                detail="Let compatible osChat and custom local models reason and stream their working text in the conversation."
                value={props.aiThinkingEnabled}
                set={props.setAiThinkingEnabled}
              />
              <SettingGroup
                title="osChat models"
                description="Download one verified tier at a time from the shared osCode model repository."
              >
                <div className="model-tier-grid">
                  {(["small", "medium", "large"] as const).map((tier) => {
                    const model = props.models.find(
                      (item) => item.tier === tier,
                    );
                    return (
                      <button
                        type="button"
                        key={tier}
                        disabled={
                          Boolean(props.downloadingTier) ||
                          model?.supported === false
                        }
                        onClick={() => void props.downloadTier(tier)}
                      >
                        <b>{tier[0].toUpperCase() + tier.slice(1)}</b>
                        <span>
                          {model?.installed
                            ? "Ready"
                            : props.downloadingTier === tier
                              ? "Downloading…"
                              : model?.supported === false
                                ? "Not supported"
                                : "Download"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SettingGroup>
              <SettingGroup
                title="Custom local models"
                description="Add GGUF, MLX, PyTorch, or Ollama models without uploading them."
              >
                <div className="custom-model-actions">
                  <select
                    value={props.engine}
                    onChange={(event) =>
                      props.setEngine(event.target.value as AiEngine)
                    }
                  >
                    <option value="llamacpp">llama.cpp / GGUF</option>
                    <option value="mlx">MLX</option>
                    <option value="pytorch">PyTorch</option>
                    <option value="ollama">Ollama</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void props.addCustomModel()}
                  >
                    <FeatherIcon icon="plus" size="16" /> Add model
                  </button>
                </div>
                <div className="settings-model-list">
                  {props.models
                    .filter(
                      (model) =>
                        model.tier === "custom" || model.source === "local",
                    )
                    .map((model) => (
                      <article key={model.id}>
                        <span>
                          <b>{model.name}</b>
                          <small>
                            {model.engine} ·{" "}
                            {model.installed === false
                              ? "not installed"
                              : "local"}
                          </small>
                        </span>
                        <IconButton
                          icon="trash-2"
                          label={`Remove ${model.name}`}
                          onClick={() => void props.removeModel(model.id)}
                        />
                      </article>
                    ))}
                </div>
              </SettingGroup>
            </div>
          )}
          {props.section === "permissions" && (
            <div className="settings-section">
              <SettingToggle
                label="Files and artifacts"
                detail="Allow the agent to read your osChat workspace."
                value={props.aiFileAccess}
                set={props.setAiFileAccess}
              />
              <SettingToggle
                label="Public web research"
                detail="Receive-only public search and page retrieval with source links."
                value={props.aiWebAccess}
                set={props.setAiWebAccess}
              />
              <SettingToggle
                label="Agent browser"
                detail="Open and inspect pages in the isolated in-app browser."
                value={props.aiBrowserAccess}
                set={props.setAiBrowserAccess}
              />
              <SettingToggle
                label="Computer Control"
                detail="Operate approved visible applications; Esc always stops control."
                value={props.aiComputerAccess}
                set={props.setAiComputerAccess}
              />
              <p className="settings-callout">
                <FeatherIcon icon="shield" size="17" /> Terminal commands remain
                available to the agent only through the existing permission
                flow, but developer terminal controls are intentionally hidden
                in osChat.
              </p>
            </div>
          )}
          {props.section === "updates" && (
            <div className="settings-section">
              <SettingToggle
                label="Automatic updates"
                detail="Check the configured native channel and download only trusted matching packages."
                value={props.autoUpdateEnabled}
                set={(value) => void props.setAutoUpdateEnabled(value)}
              />
              <SettingGroup
                title="Update status"
                description={props.updateStatus.message}
              >
                {typeof props.updateStatus.percent === "number" && (
                  <progress max={100} value={props.updateStatus.percent} />
                )}
                <div className="update-actions">
                  <button
                    type="button"
                    onClick={() => void props.checkUpdate()}
                  >
                    Check now
                  </button>
                  {props.updateStatus.state === "available" && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void props.downloadUpdate()}
                    >
                      Download
                    </button>
                  )}
                  {props.updateStatus.state === "ready" && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void props.installUpdate()}
                    >
                      Install and restart
                    </button>
                  )}
                </div>
              </SettingGroup>
              <p className="settings-callout">
                <FeatherIcon icon="info" size="17" /> Updates come from the
                official osChat GitHub channel for this operating system and
                architecture. Downloaded installers are SHA-256 verified before
                they can be opened.
              </p>
            </div>
          )}
          {props.section === "data" && (
            <div className="settings-section">
              <SettingGroup
                title="Local encrypted data"
                description="Chats, permissions, save history, MCP configuration, and app keys stay in osChat application data."
              >
                <button type="button" onClick={props.openSecureData}>
                  <FeatherIcon icon="folder" size="16" /> Show secure data
                  folder
                </button>
              </SettingGroup>
              <SettingGroup
                title="Network boundaries"
                description="Attachments remain local. Public browsing is receive-only and prompt-injection content is treated as untrusted."
              >
                <div className="privacy-list">
                  <span>
                    <FeatherIcon icon="check" size="15" /> No cloud account
                    required
                  </span>
                  <span>
                    <FeatherIcon icon="check" size="15" /> No telemetry
                  </span>
                  <span>
                    <FeatherIcon icon="check" size="15" /> Exact approval before
                    outbound private context
                  </span>
                </div>
              </SettingGroup>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}
function SettingGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="setting-group">
      <header>
        <b>{title}</b>
        <p>{description}</p>
      </header>
      <div>{children}</div>
    </section>
  );
}
function SettingToggle({
  label,
  detail,
  value,
  set,
}: {
  label: string;
  detail: string;
  value: boolean;
  set: (value: boolean) => void;
}) {
  return (
    <label className="setting-toggle">
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => set(event.target.checked)}
      />
      <i />
    </label>
  );
}
