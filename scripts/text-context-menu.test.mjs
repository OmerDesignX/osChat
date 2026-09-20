import assert from "node:assert/strict";
import test from "node:test";
import { textContextMenuItems } from "../dist-electron/main/text-context-menu.js";

const editFlags = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
};

test("right-clicking any editable text field offers standard edit commands", () => {
  const items = textContextMenuItems({
    isEditable: true,
    selectionText: "text",
    editFlags,
  });
  assert.deepEqual(
    items.filter((item) => item.role).map((item) => item.role),
    ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll"],
  );
  assert.equal(items.find((item) => item.role === "redo").enabled, false);
});

test("selected answer text can be copied without exposing edit actions", () => {
  const items = textContextMenuItems({
    isEditable: false,
    selectionText: "answer",
    editFlags,
  });
  assert.deepEqual(
    items.map((item) => item.role),
    ["copy", "selectAll"],
  );
  assert.deepEqual(
    textContextMenuItems({ isEditable: false, selectionText: "", editFlags }),
    [],
  );
});
