import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/chat-collection-actions.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const actions = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const timestamp = "2026-08-30T12:00:00.000Z";
const original = {
  id: "chat-original",
  title: "Original chat",
  folder: "Research",
  favorite: false,
  projectRoot: "/qa/osChat Workspace",
  messages: [{ role: "user", content: "Keep this", createdAt: timestamp }],
  contextSummary: "Original context",
  createdAt: timestamp,
  updatedAt: timestamp,
};

function fakeApi() {
  const records = new Map([[original.id, structuredClone(original)]]);
  let sequence = 0;
  return {
    records,
    api: {
      createAiChat: async () => {
        const chat = {
          ...structuredClone(original),
          id: `chat-copy-${++sequence}`,
          title: "New chat",
          folder: "",
          messages: [],
          contextSummary: "",
        };
        records.set(chat.id, chat);
        return structuredClone(chat);
      },
      saveAiChat: async (id, messages, contextSummary) => {
        const saved = { ...records.get(id), messages, contextSummary };
        records.set(id, structuredClone(saved));
        return structuredClone(saved);
      },
      updateAiChatMetadata: async (id, patch) => {
        const saved = { ...records.get(id), ...patch };
        records.set(id, structuredClone(saved));
        return structuredClone(saved);
      },
      deleteAiChat: async (id) => records.delete(id),
    },
  };
}

test("chat collection rename, favorite, and move persist through the real API contract", async () => {
  const { api, records } = fakeApi();
  await actions.patchChatCollection(api, original, { title: "Renamed chat" });
  await actions.patchChatCollection(api, original, { favorite: true });
  await actions.patchChatCollection(api, original, { folder: "Trips" });
  assert.deepEqual(
    {
      title: records.get(original.id).title,
      favorite: records.get(original.id).favorite,
      folder: records.get(original.id).folder,
    },
    { title: "Renamed chat", favorite: true, folder: "Trips" },
  );
});

test("chat duplication preserves conversation content and delete removes it", async () => {
  const { api, records } = fakeApi();
  const copy = await actions.duplicateChatCollection(api, original);
  assert.equal(copy.title, "Original chat copy");
  assert.equal(copy.folder, "Research");
  assert.deepEqual(copy.messages, original.messages);
  assert.equal(copy.contextSummary, original.contextSummary);

  assert.equal(await actions.deleteChatCollection(api, original), true);
  assert.equal(records.has(original.id), false);
});

test("a failed partial duplicate is cleaned up and a failed delete is visible", async () => {
  const { api, records } = fakeApi();
  api.saveAiChat = async () => {
    throw new Error("save failed");
  };
  await assert.rejects(
    actions.duplicateChatCollection(api, original),
    /save failed/,
  );
  assert.deepEqual([...records.keys()], [original.id]);

  await assert.rejects(
    actions.deleteChatCollection(api, { ...original, id: "missing" }),
    /could not be deleted/,
  );
});
