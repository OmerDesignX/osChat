import type { MenuItemConstructorOptions } from "electron";

export type TextContext = {
  isEditable: boolean;
  selectionText: string;
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
};

export function textContextMenuItems(
  context: TextContext,
): MenuItemConstructorOptions[] {
  if (context.isEditable)
    return [
      { role: "undo", enabled: context.editFlags.canUndo },
      { role: "redo", enabled: context.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: context.editFlags.canCut },
      { role: "copy", enabled: context.editFlags.canCopy },
      { role: "paste", enabled: context.editFlags.canPaste },
      {
        role: "pasteAndMatchStyle",
        enabled: context.editFlags.canPaste,
      },
      { type: "separator" },
      { role: "selectAll", enabled: context.editFlags.canSelectAll },
    ];
  if (context.selectionText.trim())
    return [
      { role: "copy", enabled: context.editFlags.canCopy },
      { role: "selectAll", enabled: context.editFlags.canSelectAll },
    ];
  return [];
}
