import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("osChat exposes native contextual Touch Bar chat controls", () => {
  const touchBar = read("electron/main/touch-bar.ts");
  const main = read("electron/main/index.ts");
  const preload = read("electron/preload/index.cts");
  const app = read("src/App.tsx");
  const aiPanel = read("src/components/AiPanel.tsx");

  assert.match(touchBar, /process\.platform !== "darwin"/);
  assert.match(touchBar, /new TouchBar\(/);
  for (const label of ["New Chat", "Chats", "Notes", "Attach", "Send", "Retry"])
    assert.match(touchBar, new RegExp(label));
  assert.match(touchBar, /state\.busy \? "chat-stop" : "chat-send"/);
  assert.match(touchBar, /Object\.hasOwn\(source, "section"\)/);
  assert.match(touchBar, /nativeImage\.createFromNamedImage/);
  assert.match(touchBar, /new TouchBar\.TouchBarScrubber/);
  assert.match(touchBar, /mode: "free"/);
  assert.match(touchBar, /showArrowButtons: true/);
  assert.match(touchBar, /select: \(index\)/);
  assert.match(touchBar, /items: \[actionStrip\]/);
  assert.match(touchBar, /actionStrip\.items = actions\.map/);
  for (const action of ["new-document", "new-spreadsheet", "new-presentation"])
    assert.match(touchBar, new RegExp(`action: "${action}"`));
  assert.match(main, /installOsChatTouchBar\(window\)/);
  assert.match(main, /ipcMain\.handle\("app:set-touch-bar-state"/);
  assert.match(preload, /setTouchBarState:[\s\S]*app:set-touch-bar-state/);
  assert.match(app, /action === "show-chats"/);
  assert.match(app, /action === "show-notes"/);
  assert.match(aiPanel, /"chat-attach"/);
  assert.match(aiPanel, /"chat-send"/);
  assert.match(aiPanel, /"chat-stop": stopResponse/);
  assert.match(aiPanel, /"chat-retry"/);
  assert.match(aiPanel, /canRetry:/);
});
