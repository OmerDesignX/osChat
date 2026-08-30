import { useEffect, useRef } from "react";
import { monaco } from "./monaco";
import type * as Monaco from "monaco-editor/editor/editor.api";

type LocalEditorProps = {
  path: string;
  language?: string;
  value: string;
  theme: string;
  beforeMount?: (api: typeof monaco) => void;
  onMount?: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
  onChange?: (value: string) => void;
  revealLine?: number;
  onReveal?: () => void;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
};

export default function LocalEditor({
  path,
  language,
  value,
  theme,
  beforeMount,
  onMount,
  onChange,
  revealLine,
  onReveal,
  options,
}: LocalEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, Monaco.editor.ITextModel>());
  const applyingExternalValue = useRef(false);
  const localEchoes = useRef(new Map<string, string[]>());
  const change = useRef(onChange);
  change.current = onChange;
  const rememberLocalValue = (
    model: Monaco.editor.ITextModel,
    next: string,
  ) => {
    const key = model.uri.toString();
    const pending = localEchoes.current.get(key) || [];
    pending.push(next);
    if (pending.length > 100) pending.splice(0, pending.length - 100);
    localEchoes.current.set(key, pending);
  };
  const isLocalEcho = (model: Monaco.editor.ITextModel, next: string) => {
    const key = model.uri.toString();
    const pending = localEchoes.current.get(key);
    const index = pending?.indexOf(next) ?? -1;
    if (index < 0) return false;
    pending?.splice(0, index + 1);
    if (!pending?.length) localEchoes.current.delete(key);
    return true;
  };
  const syncValue = (model: Monaco.editor.ITextModel, next: string) => {
    if (model.getValue() === next) {
      isLocalEcho(model, next);
      return;
    }
    // Monaco can receive several keystrokes before React renders their latest
    // value. Ignore those older controlled-value echoes so they cannot move the
    // cursor or reorder rapid typing. A value not emitted by Monaco is an actual
    // external update and is applied below.
    if (isLocalEcho(model, next)) return;
    localEchoes.current.delete(model.uri.toString());
    const instance = editor.current;
    const active = instance?.getModel() === model;
    const view = active ? instance.saveViewState() : null;
    applyingExternalValue.current = true;
    try {
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: next }],
        () => null,
      );
    } finally {
      applyingExternalValue.current = false;
    }
    if (view && instance) instance.restoreViewState(view);
  };

  useEffect(() => {
    if (!host.current) return;
    beforeMount?.(monaco);
    const instance = monaco.editor.create(host.current, {
      ...options,
      model: null,
      theme,
    });
    editor.current = instance;
    const subscription = instance.onDidChangeModelContent(() => {
      if (!applyingExternalValue.current) {
        const model = instance.getModel();
        const next = instance.getValue();
        if (model) rememberLocalValue(model, next);
        change.current?.(next);
      }
    });
    onMount?.(instance);
    return () => {
      subscription.dispose();
      instance.dispose();
      for (const model of models.current.values()) model.dispose();
      models.current.clear();
      localEchoes.current.clear();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const uri = monaco.Uri.file(path);
    const key = uri.toString();
    let model = models.current.get(key);
    if (!model) {
      model = monaco.editor.createModel(value, language, uri);
      models.current.set(key, model);
    } else {
      if (language) monaco.editor.setModelLanguage(model, language);
      syncValue(model, value);
    }
    instance.setModel(model);
    if (host.current) {
      host.current.dataset.oscodeReady = "true";
      host.current.dataset.oscodeModelLength = String(model.getValueLength());
      host.current.dataset.oscodeLanguage = model.getLanguageId();
    }
  }, [path, language]);

  useEffect(() => {
    if (!revealLine || !editor.current) return;
    editor.current.revealLineInCenter(revealLine);
    editor.current.setPosition({ lineNumber: revealLine, column: 1 });
    editor.current.focus();
    onReveal?.();
  }, [path, revealLine]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    syncValue(model, value);
    if (host.current)
      host.current.dataset.oscodeModelLength = String(model.getValueLength());
  }, [path, value]);

  useEffect(() => monaco.editor.setTheme(theme), [theme]);
  useEffect(() => {
    editor.current?.updateOptions(options || {});
    if (host.current)
      host.current.dataset.oscodeWordWrap = String(options?.wordWrap || "off");
  }, [options]);

  return <div className="local-editor-host" ref={host} />;
}
