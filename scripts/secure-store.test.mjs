import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appLocalKeyProtector,
  archiveLegacySecureStore,
  SecureDataStore,
} from "../dist-electron/main/secure-store.js";

const testProtector = {
  status: () => ({ available: true, backend: "test" }),
  protect: (value) => Buffer.from(value.map((byte) => byte ^ 0xa5)),
  unprotect: (value) => Buffer.from(value.map((byte) => byte ^ 0xa5)),
};

test("secure JSON is authenticated, unreadable at rest, and migrates plaintext", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-secure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SecureDataStore(root, testProtector);
  const target = path.join(store.root, "state", "chat.oscode-data");
  const secret = { message: "private project conversation" };
  await store.writeJson(target, secret, "chat-test");
  const disk = await fs.readFile(target);
  assert.equal(disk.includes(Buffer.from(secret.message)), false);
  assert.deepEqual(await store.readJson(target, {}, "chat-test"), secret);
  const tampered = Buffer.from(disk);
  tampered[tampered.length - 1] ^= 1;
  await fs.writeFile(target, tampered);
  await assert.rejects(store.readJson(target, {}, "chat-test"));

  const legacy = path.join(root, "legacy.json");
  const migrated = path.join(store.root, "state", "migrated.oscode-data");
  await fs.writeFile(legacy, JSON.stringify(secret), "utf8");
  assert.deepEqual(
    await store.readJson(migrated, {}, "migration", legacy),
    secret,
  );
  await assert.rejects(fs.access(legacy));
  assert.equal(
    (await fs.readFile(migrated)).includes(Buffer.from(secret.message)),
    false,
  );
});

test("secure storage refuses an unavailable key provider", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-no-key-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SecureDataStore(root, {
    status: () => ({
      available: false,
      backend: "basic_text",
      reason: "secure key store unavailable",
    }),
    protect: (value) => value,
    unprotect: (value) => value,
  });
  await assert.rejects(store.ready(), /secure key store unavailable/);
});

test("app-local encryption persists without an operating-system key store", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-local-key-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "secure", "state", "settings.oscode-data");
  const value = { privateSetting: "only ciphertext should contain this" };
  await new SecureDataStore(root, appLocalKeyProtector()).writeJson(
    target,
    value,
    "local-key-test",
  );
  const secondProcess = new SecureDataStore(root, appLocalKeyProtector());
  assert.deepEqual(
    await secondProcess.readJson(target, {}, "local-key-test"),
    value,
  );
  const keyPath = path.join(root, "secure", "device-key.oscode-key");
  assert.equal((await fs.readFile(keyPath)).length, 32);
  if (process.platform !== "win32")
    assert.equal((await fs.stat(keyPath)).mode & 0o777, 0o600);
  assert.equal(
    (await fs.readFile(target)).includes(Buffer.from(value.privateSetting)),
    false,
  );
});

test("an OS-wrapped legacy key is archived without contacting an OS key store", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-key-migrate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const secureRoot = path.join(root, "secure");
  const keyPath = path.join(secureRoot, "device-key.oscode-key");
  await fs.mkdir(secureRoot, { recursive: true });
  await fs.writeFile(keyPath, Buffer.from("legacy-os-wrapped-device-key"));
  await fs.writeFile(
    path.join(secureRoot, "private.oscode-data"),
    "ciphertext",
  );
  const archiveName = await archiveLegacySecureStore(root);
  assert.match(archiveName, /^secure-legacy-/);
  await assert.rejects(fs.access(secureRoot));
  assert.equal(
    await fs.readFile(
      path.join(root, archiveName, "private.oscode-data"),
      "utf8",
    ),
    "ciphertext",
  );
  assert.equal(await archiveLegacySecureStore(root), false);
});

test("legacy plaintext prompt artefacts are removed without broad cleanup", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "oscode-legacy-prompt-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SecureDataStore(root, testProtector);
  const tasks = path.join(root, "ai", "tasks");
  const cache = path.join(root, "ai", "prompt-cache");
  const keep = path.join(root, "ai", "models.json");
  await fs.mkdir(tasks, { recursive: true });
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(tasks, "prompt.txt"), "private prompt");
  await fs.writeFile(path.join(cache, "cache.bin"), "private prompt");
  await fs.writeFile(keep, "[]");
  await store.purgeLegacyPromptData();
  await assert.rejects(fs.access(tasks));
  await assert.rejects(fs.access(cache));
  await fs.access(keep);
});

test("llama prompts use private pipes rather than files or process arguments", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "electron", "main", "ai.ts"),
    "utf8",
  );
  assert.match(source, /\\\\\\\\\.\\\\pipe\\\\oscode-prompt/);
  assert.match(source, /"\/dev\/stdin"/);
  assert.doesNotMatch(source, /"--prompt-cache"/);
  assert.doesNotMatch(source, /"--file",\s*"-"/);
});
