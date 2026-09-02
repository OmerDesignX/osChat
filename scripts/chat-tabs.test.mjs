import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("open chat tabs persist and preserve the single inference queue", async () => {
  const [panel, styles] = await Promise.all([
    fs.readFile(
      new URL("../src/components/AiPanel.tsx", import.meta.url),
      "utf8",
    ),
    fs.readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /openChatTabs\.length > 1/);
  assert.match(panel, /open-chat-tabs:v1/);
  assert.match(panel, /window\.localStorage\.setItem/);
  assert.match(panel, /Pin chat/);
  assert.match(panel, /Favorite/);
  assert.match(panel, /Close chat/);
  assert.match(panel, /document\.querySelector\("\.app"\) \|\| document\.body/);
  assert.match(panel, /currentPipeline\.state !== "idle"/);
  assert.match(panel, /Messages sent here stay queued/);
  assert.match(styles, /\.ai-chat-tab-strip/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(
    styles,
    /\.ai-chat-tab > \.ai-chat-tab-more:hover,[\s\S]*?background: transparent;[\s\S]*?color: var\(--accent\);/,
  );
  assert.match(
    styles,
    /\.ai-chat-tab-menu\s*\{[\s\S]*?background: var\(--overlay-surface, #2b2e2f\);/,
  );
});
