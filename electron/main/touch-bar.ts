import { TouchBar, type BrowserWindow } from "electron";

const accent = "#89cff0";
const dark = "#24292c";
const danger = "#d76b7a";

type OsChatTouchBarState = {
  section: "chats" | "notes";
  busy: boolean;
  canAttach: boolean;
  canSend: boolean;
  canRetry: boolean;
};

export type TouchBarController = {
  update(rawState: unknown): void;
  dispose(): void;
};

function booleanValue(source: Record<string, unknown>, key: string) {
  return source[key] === true;
}

function mergedBoolean(
  source: Record<string, unknown>,
  key: string,
  current: boolean,
) {
  return Object.hasOwn(source, key) ? booleanValue(source, key) : current;
}

export function installOsChatTouchBar(
  window: BrowserWindow,
): TouchBarController | null {
  if (process.platform !== "darwin") return null;

  let state: OsChatTouchBarState = {
    section: "chats",
    busy: false,
    canAttach: false,
    canSend: false,
    canRetry: false,
  };
  const send = (action: string) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("menu:action", action);
  };
  const newChat = new TouchBar.TouchBarButton({
    label: "＋ New Chat",
    accessibilityLabel: "Start a new chat",
    backgroundColor: accent,
    click: () => send("new-chat"),
  });
  const chats = new TouchBar.TouchBarButton({
    label: "Chats",
    accessibilityLabel: "Show chats",
    backgroundColor: accent,
    click: () => send("show-chats"),
  });
  const notes = new TouchBar.TouchBarButton({
    label: "Notes",
    accessibilityLabel: "Show notes",
    backgroundColor: dark,
    click: () => send("show-notes"),
  });
  const attach = new TouchBar.TouchBarButton({
    label: "Attach",
    accessibilityLabel: "Attach local media or documents",
    backgroundColor: dark,
    click: () => send("chat-attach"),
  });
  const sendStop = new TouchBar.TouchBarButton({
    label: "↑ Send",
    accessibilityLabel: "Send message",
    backgroundColor: accent,
    click: () => send(state.busy ? "chat-stop" : "chat-send"),
  });
  const retry = new TouchBar.TouchBarButton({
    label: "↻ Retry",
    accessibilityLabel: "Retry the last response",
    backgroundColor: dark,
    click: () => send("chat-retry"),
  });
  const bar = new TouchBar({
    items: [
      newChat,
      chats,
      notes,
      new TouchBar.TouchBarSpacer({ size: "flexible" }),
      attach,
      sendStop,
      retry,
    ],
  });
  window.setTouchBar(bar);

  const render = () => {
    chats.backgroundColor = state.section === "chats" ? accent : dark;
    notes.backgroundColor = state.section === "notes" ? accent : dark;
    attach.enabled = state.canAttach && !state.busy;
    sendStop.enabled = state.busy || state.canSend;
    sendStop.label = state.busy ? "■ Stop" : "↑ Send";
    sendStop.accessibilityLabel = state.busy
      ? "Stop the current response"
      : "Send message";
    sendStop.backgroundColor = state.busy ? danger : accent;
    retry.enabled = state.canRetry && !state.busy;
  };
  render();

  return {
    update(rawState) {
      if (!rawState || typeof rawState !== "object") return;
      const source = rawState as Record<string, unknown>;
      state = {
        section: Object.hasOwn(source, "section")
          ? source.section === "notes"
            ? "notes"
            : "chats"
          : state.section,
        busy: mergedBoolean(source, "busy", state.busy),
        canAttach: mergedBoolean(source, "canAttach", state.canAttach),
        canSend: mergedBoolean(source, "canSend", state.canSend),
        canRetry: mergedBoolean(source, "canRetry", state.canRetry),
      };
      render();
    },
    dispose() {
      if (!window.isDestroyed()) window.setTouchBar(null);
    },
  };
}
