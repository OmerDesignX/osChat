import { useEffect, useRef } from "react";
import { monaco } from "./monaco";
import type * as Monaco from "monaco-editor/editor/editor.api";

export default function LocalDiffEditor({
  originalPath,
  originalValue,
  modifiedPath,
  modifiedValue,
  theme,
  options,
}: {
  originalPath: string;
  originalValue: string;
  modifiedPath: string;
  modifiedValue: string;
  theme: string;
  options: Monaco.editor.IStandaloneEditorConstructionOptions;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const original = monaco.editor.createModel(
      originalValue,
      undefined,
      monaco.Uri.parse(
        `inmemory://oscode/original/${encodeURIComponent(originalPath)}`,
      ),
    );
    const modified = monaco.editor.createModel(
      modifiedValue,
      undefined,
      monaco.Uri.parse(
        `inmemory://oscode/modified/${encodeURIComponent(modifiedPath)}`,
      ),
    );
    const editor = monaco.editor.createDiffEditor(host.current, {
      ...options,
      theme,
      originalEditable: false,
      readOnly: true,
      renderSideBySide: true,
    });
    editor.setModel({ original, modified });
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [originalPath, originalValue, modifiedPath, modifiedValue]);
  useEffect(() => monaco.editor.setTheme(theme), [theme]);
  return <div className="local-editor-host diff-editor-host" ref={host} />;
}
