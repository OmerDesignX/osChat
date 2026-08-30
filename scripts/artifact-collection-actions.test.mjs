import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/artifact-collection-actions.ts", import.meta.url),
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
const stored = {
  id: "artifact-1234",
  kind: "document",
  title: "Stored title",
  folder: "",
  favorite: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  data: { text: "stored" },
};
const summary = ({ data: _data, ...value }) => value;

function fakeApi() {
  const state = {
    records: new Map([[stored.id, structuredClone(stored)]]),
    exports: [],
    deleted: [],
  };
  return {
    state,
    api: {
      readArtifact: async (id) => structuredClone(state.records.get(id)),
      saveArtifact: async (artifact) => {
        state.records.set(artifact.id, structuredClone(artifact));
        return summary(artifact);
      },
      deleteArtifact: async (id) => {
        state.deleted.push(id);
        return state.records.delete(id);
      },
      exportArtifact: async (artifact, format) => {
        state.exports.push({ artifact: structuredClone(artifact), format });
        return `/exports/${artifact.id}.${format}`;
      },
    },
  };
}

test("note collection actions preserve active edits and persist favorites", async () => {
  const { api, state } = fakeApi();
  const active = {
    ...stored,
    title: "Unsaved active title",
    data: { text: "unsaved active content" },
  };
  await actions.patchProductivityArtifact(api, summary(stored), active, {
    favorite: true,
  });
  assert.deepEqual(state.records.get(stored.id), {
    ...active,
    favorite: true,
  });
});

test("duplicate, export, and delete execute against real collection APIs", async () => {
  const { api, state } = fakeApi();
  const artifact = summary(stored);
  const copy = await actions.duplicateProductivityArtifact(
    api,
    artifact,
    null,
    "artifact-copy-1234",
    timestamp,
  );
  assert.equal(copy.title, "Stored title copy");
  assert.deepEqual(state.records.get(copy.id).data, stored.data);

  const exported = await actions.exportProductivityArtifact(
    api,
    artifact,
    null,
  );
  assert.equal(exported, "/exports/artifact-1234.docx");
  assert.equal(state.exports[0].format, "docx");

  assert.equal(await actions.deleteProductivityArtifact(api, artifact), true);
  assert.deepEqual(state.deleted, [stored.id]);
  assert.equal(state.records.has(stored.id), false);
});

test("each note kind uses its native office export format", () => {
  assert.deepEqual(actions.preferredArtifactExportFormat, {
    document: "docx",
    spreadsheet: "xlsx",
    presentation: "pptx",
  });
});
