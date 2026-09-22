import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const main = await fs.readFile(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const css = await fs.readFile(
  new URL("../src/desktop-flat.css", import.meta.url),
  "utf8",
);
const app = await fs.readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const ai = await fs.readFile(
  new URL("../src/components/AiPanel.tsx", import.meta.url),
  "utf8",
);

test("desktop flat design loads last and keeps Paper Light accessible", () => {
  assert.match(
    main,
    /import "\.\/startup\.css";\s*import "\.\/desktop-flat\.css";/,
  );
  assert.match(
    css,
    /\.oschat-app\.blue-light\s*\{[^}]*--bg: #ffffff;[^}]*--accent: #397b9d;[^}]*--chat-user: #eef4f7;/s,
  );
  assert.match(
    css,
    /\.ai-message\.assistant\s*\{[^}]*background: transparent !important;/s,
  );
  assert.match(
    css,
    /\.ai-composer\s*\{[^}]*border: 1px solid var\(--line\) !important;[^}]*border-radius: 21px !important;/s,
  );
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /--app-font-size: 13px/);
  assert.match(css, /\.ai-composer\.expanded-input/);
  assert.match(css, /border-radius: 999px !important/);
  assert.match(app, /className="folder-disclosure"/);
  assert.match(
    app,
    /className="folder-add-button"[\s\S]*?<FeatherIcon icon="folder-plus" size="16" \/>[\s\S]*?<\/button>/,
  );
  assert.doesNotMatch(
    app,
    /className="folder-add-button"[\s\S]*?<span>New<\/span>/,
  );
  assert.match(
    css,
    /\.folder-add-button\s*\{[^}]*width: 34px;[^}]*border-radius: 0 !important;[^}]*background: transparent !important;/s,
  );
  assert.match(app, /className="folder-list"/);
  assert.doesNotMatch(app, /<nav className="workspace-nav"/);
  assert.match(app, /hideHistory/);
  assert.match(ai, /className="ai-main-menu"/);
  assert.match(ai, /workspaceMode\s*\?\s*"Model"/);
});

test("desktop hover feedback stays transparent and refresh uses a circular icon", () => {
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.oschat-app[\s\S]*background-color: transparent !important;/,
  );
  assert.match(
    css,
    /\.sidebar-list article:hover[\s\S]*background-color: transparent !important;/,
  );
  assert.doesNotMatch(ai, /refresh-cw/);
});

test("chat output uses the flat iOS disclosure hierarchy", () => {
  assert.match(
    css,
    /\.ai-message\.user\s*\{[^}]*border-radius: 0 !important;[^}]*background: transparent !important;/s,
  );
  assert.match(css, /summary::before\s*\{[^}]*content: "›";/s);
  assert.match(
    css,
    /\.ai-action-card\s*\{[^}]*border-radius: 0 !important;[^}]*background: transparent !important;/s,
  );
  assert.match(ai, /message\.role === "user" \? \(\s*<span>You<\/span>/);
  assert.match(ai, /<span>Thinking<\/span>/);
  assert.match(ai, /<span>Model log<\/span>/);
});
