import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SaveHistoryStore } from "../dist-electron/main/save-history.js";
import {
  processKeyProtector,
  SecureDataStore,
} from "../dist-electron/main/secure-store.js";

test("ordinary save history is encrypted, deduplicated, and restorable", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-save-history-"));
  const project = path.join(base, "project");
  const userData = path.join(base, "data");
  await fs.mkdir(project);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const secure = new SecureDataStore(
    userData,
    processKeyProtector(`${base}:save-history`),
  );
  const history = new SaveHistoryStore(secure);
  await history.record(project, "README.md", "first\n", "manual");
  await history.record(project, "README.md", "first\n", "autosave");
  await history.record(project, "README.md", "second\n", "autosave");
  const entries = await history.list(project, "README.md");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, "autosave");
  assert.equal(entries[0].bytes, "second\n".length);
  assert.equal(
    await history.content(project, "README.md", entries[1].id),
    "first\n",
  );
  const [projectDirectory] = await fs.readdir(
    path.join(secure.root, "projects"),
  );
  const stored = await fs.readFile(
    path.join(
      secure.root,
      "projects",
      projectDirectory,
      "save-history.oscode-data",
    ),
  );
  assert.ok(stored.length > 0);
  assert.equal(stored.includes(Buffer.from("first")), false);
});
