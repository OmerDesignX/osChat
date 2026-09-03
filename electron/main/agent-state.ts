import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { SecureDataStore } from "./secure-store.js";
import { aiAttachmentKind } from "./attachments.js";
import type {
  AiAgentState,
  AiActionEntry,
  AiChatMessage,
  AiChatThread,
  AiGoal,
  AiPermissionGrant,
  AiPermissionKind,
  AiPermissionScope,
  AiQueueItem,
  AiSchedule,
} from "../types.js";

const permissionKinds = new Set<AiPermissionKind>([
  "project.read",
  "project.write",
  "project.delete",
  "terminal.run",
  "packages.install",
  "debug.run",
  "web.search",
  "attachments.external",
  "network.request",
  "browser.control",
  "computer.control",
  "computer.external",
  "mcp.call",
  "platformio.install",
  "platformio.run",
]);
const permissionScopes = new Set<AiPermissionScope>([
  "once",
  "conversation",
  "always",
]);

const emptyState = (): AiAgentState => ({
  chats: [],
  goals: [],
  queue: [],
  schedules: [],
  permissions: [],
});

type StoredChat = AiChatThread & { storageLabel?: string };
type StoredAgentState = Omit<AiAgentState, "chats"> & { chats: StoredChat[] };

function projectKey(root: string) {
  return crypto
    .createHash("sha256")
    .update(path.resolve(root).toLowerCase())
    .digest("hex");
}

function text(value: unknown, max = 20_000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function attachments(
  value: unknown,
): NonNullable<AiChatMessage["attachments"]> {
  if (!Array.isArray(value)) return [];
  let total = 0;
  return value.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    const name = text(input.name, 240) || "Attachment";
    const mimeType = text(input.mimeType, 120).toLowerCase();
    const kind = aiAttachmentKind(mimeType, name);
    const dataUrl = text(input.dataUrl, 16_800_000);
    if (
      !kind ||
      !dataUrl.startsWith(`data:${mimeType};base64,`) ||
      dataUrl.length > 16_800_000 ||
      total + dataUrl.length > 34_000_000
    )
      return [];
    total += dataUrl.length;
    return [
      {
        id: text(input.id, 100) || crypto.randomUUID(),
        name,
        kind,
        mimeType,
        dataUrl,
        size: Number.isFinite(Number(input.size))
          ? Math.max(0, Number(input.size))
          : undefined,
        extractedText: text(input.extractedText, 160_000) || undefined,
        processingError: text(input.processingError, 500) || undefined,
      },
    ];
  });
}

const actionKinds = new Set<AiActionEntry["kind"]>([
  "plan",
  "permission",
  "web",
  "browser",
  "computer",
  "files",
  "command",
  "goal",
  "result",
]);
const actionStatuses = new Set<AiActionEntry["status"]>([
  "running",
  "completed",
  "waiting",
  "failed",
  "denied",
]);

function actions(value: unknown): AiActionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-120).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<AiActionEntry>;
    if (!actionKinds.has(input.kind as AiActionEntry["kind"])) return [];
    if (!actionStatuses.has(input.status as AiActionEntry["status"])) return [];
    const title = text(input.title, 240).trim();
    const chatId = text(input.chatId, 100).trim();
    if (!title || !chatId) return [];
    const websites = Array.isArray(input.websites)
      ? input.websites
          .flatMap((site) =>
            typeof site === "string" ? [site.slice(0, 2000)] : [],
          )
          .slice(0, 12)
      : undefined;
    return [
      {
        id: text(input.id, 100) || crypto.randomUUID(),
        chatId,
        kind: input.kind as AiActionEntry["kind"],
        status: input.status as AiActionEntry["status"],
        title,
        detail: text(input.detail, 1000) || undefined,
        output: text(input.output, 6000) || undefined,
        tool: text(input.tool, 100) || undefined,
        query: text(input.query, 500) || undefined,
        url: text(input.url, 2000) || undefined,
        target: text(input.target, 300) || undefined,
        websites: websites?.length ? websites : undefined,
        createdAt: text(input.createdAt, 40) || new Date().toISOString(),
        completedAt: text(input.completedAt, 40) || undefined,
      },
    ];
  });
}

function messages(value: unknown): AiChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<AiChatMessage>;
    if (input.role !== "user" && input.role !== "assistant") return [];
    const content = text(input.content, 200_000);
    const savedAttachments = attachments(input.attachments);
    if (!content.trim() && !savedAttachments.length) return [];
    return [
      {
        id: text(input.id, 100) || crypto.randomUUID(),
        role: input.role,
        content,
        thinking: text(input.thinking, 40_000) || undefined,
        createdAt: text(input.createdAt, 40) || new Date().toISOString(),
        assistantName:
          input.assistantName === "Custom Model"
            ? "Custom Model"
            : input.role === "assistant"
              ? "osChat"
              : undefined,
        attachments: savedAttachments,
        actions: actions(input.actions),
      },
    ];
  });
}

function hasUserInput(value: AiChatMessage[]) {
  return value.some(
    (item) =>
      item.role === "user" &&
      (item.content.trim().length > 0 || Boolean(item.attachments?.length)),
  );
}

export class AgentStateStore {
  private mutation = Promise.resolve();
  private readonly secure: SecureDataStore;
  private readonly draftChats = new Map<string, AiChatThread>();

  constructor(
    private readonly userData: string,
    secureStore?: SecureDataStore,
  ) {
    this.secure = secureStore || new SecureDataStore(userData);
  }

  private get statePath() {
    return path.join(this.secure.root, "state", "agent-state.oscode-data");
  }

  private get legacyStatePath() {
    return path.join(this.userData, "ai", "agent-state.json");
  }

  private projectDirectory(projectRoot: string) {
    return path.join(this.secure.root, "projects", projectKey(projectRoot));
  }

  private chatDirectory(projectRoot: string, label: string) {
    return path.join(this.projectDirectory(projectRoot), "chats", label);
  }

  private chatPath(projectRoot: string, label: string) {
    return path.join(
      this.chatDirectory(projectRoot, label),
      "chat.oscode-data",
    );
  }

  private chatNamespace(projectRoot: string, chatId: string) {
    return `chat:${projectKey(projectRoot)}:${chatId}`;
  }

  private storageLabel(chat: StoredChat, chats: StoredChat[]) {
    if (/^\d{4}-\d{2}-\d{2}-\d{3}$/.test(chat.storageLabel || ""))
      return chat.storageLabel!;
    const date =
      /^\d{4}-\d{2}-\d{2}/.exec(chat.createdAt)?.[0] ||
      new Date().toISOString().slice(0, 10);
    const used = chats
      .filter((item) => item.projectRoot === chat.projectRoot)
      .map((item) => item.storageLabel || "")
      .filter((label) => label.startsWith(`${date}-`))
      .map((label) => Number(label.slice(-3)))
      .filter(Number.isFinite);
    const next = Math.max(0, ...used) + 1;
    return `${date}-${String(next).padStart(3, "0")}`;
  }

  agentCodeDirectory(projectRoot: string, chat: StoredChat) {
    if (!chat.storageLabel) throw new Error("Chat storage is not ready");
    return path.join(
      this.chatDirectory(projectRoot, chat.storageLabel),
      "agentCode",
    );
  }

  private async read(): Promise<AiAgentState> {
    const value = await this.secure.readJson<Partial<StoredAgentState>>(
      this.statePath,
      {},
      "agent-state-index",
      this.legacyStatePath,
    );
    if (!value || typeof value !== "object") return emptyState();
    const referencedChatIds = new Set<string>();
    for (const items of [
      value.goals,
      value.queue,
      value.schedules,
    ] as unknown[]) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const chatId = text((item as { chatId?: unknown }).chatId, 100);
        if (chatId) referencedChatIds.add(chatId);
      }
    }
    const parsedChats: StoredChat[] = [];
    if (Array.isArray(value.chats)) {
      for (const item of value.chats.slice(-100)) {
        if (!item || typeof item !== "object") continue;
        const input = item as Partial<StoredChat>;
        const id = text(input.id, 100);
        const projectRoot = text(input.projectRoot, 2000);
        if (!id || !projectRoot) continue;
        const now = new Date().toISOString();
        const storageLabel = /^\d{4}-\d{2}-\d{2}-\d{3}$/.test(
          text(input.storageLabel, 20),
        )
          ? text(input.storageLabel, 20)
          : undefined;
        let chatMessages = messages(input.messages);
        let contextSummary = text(input.contextSummary, 64_000);
        if (storageLabel) {
          const body = await this.secure.readJson<{
            messages?: unknown;
            contextSummary?: unknown;
          }>(
            this.chatPath(projectRoot, storageLabel),
            {},
            this.chatNamespace(projectRoot, id),
          );
          chatMessages = messages(body.messages);
          contextSummary = text(body.contextSummary, 64_000);
        }
        const chat: StoredChat = {
          id,
          title: text(input.title, 120) || "New chat",
          folder: text(input.folder, 120),
          favorite: input.favorite === true,
          projectRoot,
          messages: chatMessages,
          contextSummary,
          createdAt: text(input.createdAt, 40) || now,
          updatedAt: text(input.updatedAt, 40) || now,
          ...(storageLabel ? { storageLabel } : {}),
        };
        if (hasUserInput(chat.messages) || referencedChatIds.has(chat.id))
          parsedChats.push(chat);
      }
    }
    return {
      chats: parsedChats,
      goals: Array.isArray(value.goals)
        ? (value.goals as AiGoal[]).slice(-200)
        : [],
      queue: Array.isArray(value.queue)
        ? (value.queue as AiQueueItem[]).slice(-500)
        : [],
      schedules: Array.isArray(value.schedules)
        ? (value.schedules as AiSchedule[]).slice(-200)
        : [],
      permissions: Array.isArray(value.permissions)
        ? value.permissions
            .slice(-500)
            .filter((grant): grant is AiPermissionGrant =>
              Boolean(
                grant &&
                typeof grant.id === "string" &&
                permissionKinds.has(grant.kind as AiPermissionKind) &&
                permissionScopes.has(grant.scope as AiPermissionScope),
              ),
            )
        : [],
    };
  }

  private async write(state: AiAgentState) {
    const chats = state.chats as StoredChat[];
    for (const chat of chats) {
      chat.storageLabel = this.storageLabel(chat, chats);
      const directory = this.chatDirectory(chat.projectRoot, chat.storageLabel);
      await fs.mkdir(path.join(directory, "agentCode"), {
        recursive: true,
        mode: 0o700,
      });
      await this.secure.writeJson(
        this.chatPath(chat.projectRoot, chat.storageLabel),
        {
          messages: chat.messages,
          contextSummary: chat.contextSummary,
        },
        this.chatNamespace(chat.projectRoot, chat.id),
      );
    }
    await this.secure.writeJson(
      this.statePath,
      {
        ...state,
        chats: chats.map(
          ({ messages: _messages, contextSummary: _summary, ...chat }) => ({
            ...chat,
            messages: [],
            contextSummary: "",
          }),
        ),
      },
      "agent-state-index",
    );
  }

  private async update<T>(change: (state: AiAgentState) => T | Promise<T>) {
    let result!: T;
    this.mutation = this.mutation.then(async () => {
      const state = await this.read();
      result = await change(state);
      await this.write(state);
    });
    await this.mutation;
    return result;
  }

  state(projectRoot: string) {
    return this.read().then((state) => {
      const persistedChats = state.chats.filter(
        (item) => item.projectRoot === projectRoot,
      );
      const draft = this.draftChats.get(projectKey(projectRoot));
      const chats =
        draft && !persistedChats.some((item) => item.id === draft.id)
          ? [draft, ...persistedChats]
          : persistedChats;
      return {
        chats,
        goals: state.goals.filter((item) =>
          chats.some((chat) => chat.id === item.chatId),
        ),
        queue: state.queue.filter((item) =>
          chats.some((chat) => chat.id === item.chatId),
        ),
        schedules: state.schedules.filter((item) =>
          chats.some((chat) => chat.id === item.chatId),
        ),
        permissions: state.permissions.filter(
          (item) => item.projectRoot === projectRoot,
        ),
      };
    });
  }

  async createChat(projectRoot: string, title = "New chat") {
    const now = new Date().toISOString();
    const chat: AiChatThread = {
      id: crypto.randomUUID(),
      title: text(title, 120) || "New chat",
      folder: "",
      favorite: false,
      projectRoot,
      messages: [],
      contextSummary: "",
      createdAt: now,
      updatedAt: now,
    };
    this.draftChats.set(projectKey(projectRoot), chat);
    return chat;
  }

  async ensureEmptyChat(projectRoot: string, title = "New chat") {
    const cleanTitle = text(title, 120) || "New chat";
    const key = projectKey(projectRoot);
    const existing = this.draftChats.get(key);
    if (existing && existing.title === cleanTitle) return existing;
    return this.createChat(projectRoot, cleanTitle);
  }

  private materializeDraft(state: AiAgentState, chatId: string) {
    const persisted = state.chats.find((item) => item.id === chatId);
    if (persisted) return persisted;
    for (const [key, draft] of this.draftChats) {
      if (draft.id !== chatId) continue;
      state.chats.push(draft);
      this.draftChats.delete(key);
      return draft;
    }
    return null;
  }

  saveChat(
    id: string,
    projectRoot: string,
    chatMessages: AiChatMessage[],
    contextSummary: string,
  ) {
    return this.update((state) => {
      const cleanMessages = messages(chatMessages);
      let chat = state.chats.find(
        (item) => item.id === id && item.projectRoot === projectRoot,
      );
      if (!chat) {
        const key = projectKey(projectRoot);
        const draft = this.draftChats.get(key);
        if (!hasUserInput(cleanMessages)) {
          if (!draft || draft.id !== id) throw new Error("Chat was not found");
          draft.messages = cleanMessages;
          draft.contextSummary = text(contextSummary, 64_000);
          draft.updatedAt = new Date().toISOString();
          return draft;
        }
        const now = new Date().toISOString();
        chat =
          draft?.id === id
            ? draft
            : {
                id,
                title: "New chat",
                folder: "",
                favorite: false,
                projectRoot,
                messages: [],
                contextSummary: "",
                createdAt: now,
                updatedAt: now,
              };
        state.chats.push(chat);
        if (draft?.id === id) this.draftChats.delete(key);
      }
      chat.messages = cleanMessages;
      chat.contextSummary = text(contextSummary, 64_000);
      chat.updatedAt = new Date().toISOString();
      const first = chat.messages.find((item) => item.role === "user");
      if (first && chat.title === "New chat")
        chat.title =
          first.content.replace(/\s+/g, " ").trim().slice(0, 60) ||
          first.attachments?.[0]?.name ||
          "Attachment";
      return chat;
    });
  }

  updateChatMetadata(
    id: string,
    projectRoot: string,
    metadata: { title?: unknown; folder?: unknown; favorite?: unknown },
  ) {
    const key = projectKey(projectRoot);
    const draft = this.draftChats.get(key);
    if (draft?.id === id) {
      if (metadata.title !== undefined)
        draft.title = text(metadata.title, 120).trim() || "New chat";
      if (metadata.folder !== undefined)
        draft.folder = text(metadata.folder, 120).trim();
      if (metadata.favorite !== undefined)
        draft.favorite = metadata.favorite === true;
      draft.updatedAt = new Date().toISOString();
      return Promise.resolve(draft);
    }
    return this.update((state) => {
      const chat = state.chats.find(
        (item) => item.id === id && item.projectRoot === projectRoot,
      );
      if (!chat) throw new Error("Chat was not found");
      if (metadata.title !== undefined)
        chat.title = text(metadata.title, 120).trim() || "New chat";
      if (metadata.folder !== undefined)
        chat.folder = text(metadata.folder, 120).trim();
      if (metadata.favorite !== undefined)
        chat.favorite = metadata.favorite === true;
      chat.updatedAt = new Date().toISOString();
      return chat;
    });
  }

  async deleteChat(id: string, projectRoot: string) {
    const key = projectKey(projectRoot);
    if (this.draftChats.get(key)?.id === id) {
      this.draftChats.delete(key);
      return true;
    }
    let removedLabel = "";
    const removed = await this.update((state) => {
      const exists = state.chats.some(
        (item) => item.id === id && item.projectRoot === projectRoot,
      );
      if (!exists) return false;
      removedLabel =
        (state.chats.find((item) => item.id === id) as StoredChat | undefined)
          ?.storageLabel || "";
      state.chats = state.chats.filter((item) => item.id !== id);
      state.goals = state.goals.filter((item) => item.chatId !== id);
      state.queue = state.queue.filter((item) => item.chatId !== id);
      state.schedules = state.schedules.filter((item) => item.chatId !== id);
      state.permissions = state.permissions.filter(
        (item) => item.chatId !== id || item.scope === "always",
      );
      return true;
    });
    if (removed && removedLabel) {
      const directory = this.chatDirectory(projectRoot, removedLabel);
      const relative = path.relative(this.secure.root, directory);
      const stat = await fs.lstat(directory).catch(() => null);
      if (
        stat?.isDirectory() &&
        !stat.isSymbolicLink() &&
        relative &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
      )
        await fs.rm(directory, { recursive: true });
    }
    return removed;
  }

  setGoal(chatId: string, goalText: string, automatic: boolean) {
    return this.update((state) => {
      if (!this.materializeDraft(state, chatId))
        throw new Error("Chat was not found");
      state.goals = state.goals.filter(
        (item) => item.chatId !== chatId || item.status === "complete",
      );
      const goal: AiGoal = {
        id: crypto.randomUUID(),
        chatId,
        text: text(goalText, 1000).trim(),
        status: "active",
        automatic,
        createdAt: new Date().toISOString(),
      };
      state.goals.push(goal);
      return goal;
    });
  }

  completeGoal(id: string) {
    return this.update((state) => {
      const goal = state.goals.find((item) => item.id === id);
      if (!goal) return false;
      goal.status = "complete";
      return true;
    });
  }

  removeGoal(id: string) {
    return this.update((state) => {
      const length = state.goals.length;
      state.goals = state.goals.filter((item) => item.id !== id);
      return state.goals.length !== length;
    });
  }

  addQueue(chatId: string, prompt: string, runAt?: string, automatic = false) {
    return this.update((state) => {
      if (!this.materializeDraft(state, chatId))
        throw new Error("Chat was not found");
      const item: AiQueueItem = {
        id: crypto.randomUUID(),
        chatId,
        prompt: text(prompt).trim(),
        status: "queued",
        createdAt: new Date().toISOString(),
        ...(runAt ? { runAt } : {}),
        automatic,
      };
      state.queue.push(item);
      return item;
    });
  }

  updateQueue(id: string, status: AiQueueItem["status"]) {
    return this.update((state) => {
      const item = state.queue.find((entry) => entry.id === id);
      if (!item) return false;
      item.status = status;
      return true;
    });
  }

  prioritizeQueue(id: string) {
    return this.update((state) => {
      const index = state.queue.findIndex(
        (item) => item.id === id && item.status === "queued",
      );
      if (index < 0) return false;
      const [item] = state.queue.splice(index, 1);
      state.queue.unshift(item);
      return true;
    });
  }

  removeQueue(id: string) {
    return this.update((state) => {
      const length = state.queue.length;
      state.queue = state.queue.filter((item) => item.id !== id);
      return state.queue.length !== length;
    });
  }

  addSchedule(
    chatId: string,
    prompt: string,
    nextRunAt: string,
    cadence: AiSchedule["cadence"],
    automatic = false,
  ) {
    return this.update((state) => {
      if (!this.materializeDraft(state, chatId))
        throw new Error("Chat was not found");
      const when = new Date(nextRunAt);
      if (!Number.isFinite(when.getTime()))
        throw new Error("Choose a date and time");
      const schedule: AiSchedule = {
        id: crypto.randomUUID(),
        chatId,
        prompt: text(prompt).trim(),
        cadence: ["once", "daily", "weekly"].includes(cadence)
          ? cadence
          : "once",
        nextRunAt: when.toISOString(),
        enabled: true,
        createdAt: new Date().toISOString(),
        automatic,
      };
      state.schedules.push(schedule);
      return schedule;
    });
  }

  removeSchedule(id: string) {
    return this.update((state) => {
      const length = state.schedules.length;
      state.schedules = state.schedules.filter((item) => item.id !== id);
      return length !== state.schedules.length;
    });
  }

  async collectDue(projectRoot: string) {
    return this.update((state) => {
      const now = Date.now();
      const projectChats = new Set(
        state.chats
          .filter((chat) => chat.projectRoot === projectRoot)
          .map((chat) => chat.id),
      );
      const due = state.schedules.filter(
        (item) =>
          item.enabled &&
          projectChats.has(item.chatId) &&
          new Date(item.nextRunAt).getTime() <= now,
      );
      for (const schedule of due) {
        state.queue.push({
          id: crypto.randomUUID(),
          chatId: schedule.chatId,
          prompt: schedule.prompt,
          status: "queued",
          createdAt: new Date().toISOString(),
          runAt: schedule.nextRunAt,
          automatic: true,
        });
        if (schedule.cadence === "once") schedule.enabled = false;
        else {
          const next = new Date(schedule.nextRunAt);
          next.setDate(next.getDate() + (schedule.cadence === "daily" ? 1 : 7));
          while (next.getTime() <= now)
            next.setDate(
              next.getDate() + (schedule.cadence === "daily" ? 1 : 7),
            );
          schedule.nextRunAt = next.toISOString();
        }
      }
      return due.length;
    });
  }

  grantPermission(
    kind: AiPermissionKind,
    scope: AiPermissionScope,
    chatId: string,
    projectRoot: string,
    detail: string,
  ) {
    if (!permissionKinds.has(kind) || !permissionScopes.has(scope))
      throw new Error("Choose a valid permission");
    return this.update((state) => {
      const grant: AiPermissionGrant = {
        id: crypto.randomUUID(),
        kind,
        scope,
        chatId: scope === "always" ? "*" : chatId,
        projectRoot,
        createdAt: new Date().toISOString(),
        detail: text(detail, 500),
      };
      state.permissions = state.permissions.filter(
        (item) =>
          !(
            item.kind === grant.kind &&
            item.scope === grant.scope &&
            item.chatId === grant.chatId &&
            item.projectRoot === grant.projectRoot
          ),
      );
      state.permissions.push(grant);
      return grant;
    });
  }

  revokePermission(id: string) {
    return this.update((state) => {
      const length = state.permissions.length;
      state.permissions = state.permissions.filter((item) => item.id !== id);
      return state.permissions.length !== length;
    });
  }

  async usePermission(
    kind: AiPermissionKind,
    chatId: string,
    projectRoot: string,
  ) {
    let allowed = false;
    await this.update((state) => {
      const grant = state.permissions
        .slice()
        .reverse()
        .find(
          (item) =>
            item.kind === kind &&
            item.projectRoot === projectRoot &&
            (item.scope === "always" || item.chatId === chatId),
        );
      if (!grant) return;
      allowed = true;
      if (grant.scope === "once")
        state.permissions = state.permissions.filter(
          (item) => item.id !== grant.id,
        );
    });
    return allowed;
  }
}
