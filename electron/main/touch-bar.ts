import {
  TouchBar,
  nativeImage,
  type BrowserWindow,
  type NativeImage,
} from "electron";

type OsChatTouchBarState = {
  section: "chats" | "notes";
  busy: boolean;
  canAttach: boolean;
  canSend: boolean;
  canRetry: boolean;
};

type TouchBarAction = {
  label: string;
  icon: NativeImage;
  action: string;
  enabled: boolean;
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
  let actions: TouchBarAction[] = [];
  const actionStrip = new TouchBar.TouchBarScrubber({
    items: [],
    mode: "free",
    continuous: false,
    showArrowButtons: true,
    selectedStyle: "background",
    select: (index) => {
      const item = actions[index];
      if (item?.enabled) send(item.action);
    },
    highlight: () => undefined,
  });
  const bar = new TouchBar({
    items: [actionStrip],
  });
  window.setTouchBar(bar);

  const render = () => {
    actions = [
      {
        label: "New Chat",
        icon: icons.newChat,
        action: "new-chat",
        enabled: true,
      },
      {
        label: "Chats",
        icon: icons.chats,
        action: "show-chats",
        enabled: true,
      },
      {
        label: "Notes",
        icon: icons.notes,
        action: "show-notes",
        enabled: true,
      },
      {
        label: "Document",
        icon: icons.document,
        action: "new-document",
        enabled: true,
      },
      {
        label: "Sheet",
        icon: icons.spreadsheet,
        action: "new-spreadsheet",
        enabled: true,
      },
      {
        label: "Slides",
        icon: icons.presentation,
        action: "new-presentation",
        enabled: true,
      },
      {
        label: "Attach",
        icon: icons.attach,
        action: "chat-attach",
        enabled: state.canAttach && !state.busy,
      },
      {
        label: state.busy ? "Stop" : "Send",
        icon: state.busy ? icons.stop : icons.send,
        action: state.busy ? "chat-stop" : "chat-send",
        enabled: state.busy || state.canSend,
      },
      {
        label: "Retry",
        icon: icons.retry,
        action: "chat-retry",
        enabled: state.canRetry && !state.busy,
      },
    ];
    actionStrip.items = actions.map(({ label, icon }) => ({ label, icon }));
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
