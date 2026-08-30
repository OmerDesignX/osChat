import type * as Monaco from "monaco-editor/editor/editor.api";

const monaco = (globalThis as typeof globalThis & { monaco?: typeof Monaco })
  .monaco as typeof Monaco;

if (!monaco) throw new Error("The bundled Monaco editor did not load");

export { monaco };
