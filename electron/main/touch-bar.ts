import {
  TouchBar,
  nativeImage,
  type BrowserWindow,
  type NativeImage,
} from "electron";

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

function touchBarIcon(name: string): NativeImage {
  const source = nativeImage.createFromNamedImage(name);
  if (source.isEmpty()) return source;
  const icon = source.resize({ width: 18, height: 18, quality: "best" });
  icon.setTemplateImage(true);
  return icon;
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
  const icons = {
    newChat: touchBarIcon("NSTouchBarComposeTemplate"),
    chats: touchBarIcon("NSTouchBarListViewTemplate"),
    notes: touchBarIcon("NSTouchBarBookmarksTemplate"),
    document: touchBarIcon("NSTouchBarAddDetailTemplate"),
    spreadsheet: touchBarIcon("NSTouchBarIconViewTemplate"),
    presentation: touchBarIcon("NSTouchBarQuickLookTemplate"),
    attach: touchBarIcon("NSTouchBarDownloadTemplate"),
    send: touchBarIcon("NSTouchBarGoUpTemplate"),
    stop: touchBarIcon("NSTouchBarRecordStopTemplate"),
    retry: touchBarIcon("NSTouchBarRefreshTemplate"),
  };
  const newChat = new TouchBar.TouchBarButton({
    label: "New Chat",
    icon: icons.newChat,
    iconPosition: "left",
    accessibilityLabel: "Start a new chat",
    backgroundColor: accent,
    click: () => send("new-chat"),
  });
  const attach = new TouchBar.TouchBarButton({
    label: "Attach",
    icon: icons.attach,
    iconPosition: "left",
    accessibilityLabel: "Attach local media or documents",
    backgroundColor: dark,
    click: () => send("chat-attach"),
  });
  const sendStop = new TouchBar.TouchBarButton({
    label: "Send",
    icon: icons.send,
    iconPosition: "left",
    accessibilityLabel: "Send message",
    backgroundColor: accent,
    click: () => send(state.busy ? "chat-stop" : "chat-send"),
  });
  const retry = new TouchBar.TouchBarButton({
    label: "Retry",
    icon: icons.retry,
    iconPosition: "left",
    accessibilityLabel: "Retry the last response",
    backgroundColor: dark,
    click: () => send("chat-retry"),
  });
  const secondaryActions = [
    { label: "Chats", icon: icons.chats, action: "show-chats" },
    { label: "Notes", icon: icons.notes, action: "show-notes" },
    {
      label: "Document",
      icon: icons.document,
      action: "new-document",
    },
    {
      label: "Sheet",
      icon: icons.spreadsheet,
      action: "new-spreadsheet",
    },
    {
      label: "Slides",
      icon: icons.presentation,
      action: "new-presentation",
    },
  ];
  const secondary = new TouchBar.TouchBarScrubber({
    items: secondaryActions.map(({ label, icon }) => ({ label, icon })),
    mode: "free",
    continuous: false,
    showArrowButtons: true,
    selectedStyle: "background",
    highlight: (index) => {
      const item = secondaryActions[index];
      if (item) send(item.action);
    },
  });
  const bar = new TouchBar({
    items: [
      newChat,
      secondary,
      new TouchBar.TouchBarSpacer({ size: "flexible" }),
      attach,
      sendStop,
      retry,
    ],
  });
  window.setTouchBar(bar);

  const render = () => {
    attach.enabled = state.canAttach && !state.busy;
    sendStop.enabled = state.busy || state.canSend;
    sendStop.label = state.busy ? "Stop" : "Send";
    sendStop.icon = state.busy ? icons.stop : icons.send;
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
