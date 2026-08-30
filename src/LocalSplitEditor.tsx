import { useEffect, useRef } from "react";
import { monaco } from "./monaco";
import type * as Monaco from "monaco-editor/editor/editor.api";
import type { Tab } from "./types";

type SplitSide = "left" | "right";

function SplitPane({
  side,
  tab,
  theme,
  options,
  onChange,
}: {
  side: SplitSide;
  tab: Tab;
  theme: string;
  options: Monaco.editor.IStandaloneEditorConstructionOptions;
  onChange: (path: string, value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const model = useRef<Monaco.editor.ITextModel | null>(null);
  const change = useRef(onChange);
  const synchronizing = useRef(false);
  change.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const uri = monaco.Uri.parse(
      `inmemory://oscode/split/${side}/${encodeURIComponent(tab.path)}`,
    );
    const nextModel = monaco.editor.createModel(tab.content, undefined, uri);
    model.current = nextModel;
    const editor = monaco.editor.create(host.current, {
      ...options,
      model: nextModel,
      theme,
    });
    const subscription = nextModel.onDidChangeContent(() => {
      if (!synchronizing.current)
        change.current(tab.path, nextModel.getValue());
    });
    return () => {
      subscription.dispose();
      editor.dispose();
      nextModel.dispose();
      if (model.current === nextModel) model.current = null;
    };
  }, [side, tab.path]);

  useEffect(() => {
    const current = model.current;
    if (!current || current.getValue() === tab.content) return;
    synchronizing.current = true;
    current.setValue(tab.content);
    synchronizing.current = false;
  }, [tab.content]);

  return <div className="split-editor-surface" ref={host} />;
}

export default function LocalSplitEditor({
  tabs,
  leftPath,
  rightPath,
  theme,
  options,
  onSelect,
  onChange,
}: {
  tabs: Tab[];
  leftPath: string;
  rightPath: string;
  theme: string;
  options: Monaco.editor.IStandaloneEditorConstructionOptions;
  onSelect: (side: SplitSide, path: string) => void;
  onChange: (path: string, value: string) => void;
}) {
  const left = tabs.find((tab) => tab.path === leftPath) || tabs[0];
  const right =
    tabs.find((tab) => tab.path === rightPath) ||
    tabs.find((tab) => tab.path !== left?.path) ||
    left;

  useEffect(() => monaco.editor.setTheme(theme), [theme]);

  if (!left || !right) return null;
  const pane = (side: SplitSide, tab: Tab) => (
    <section className="split-editor-pane" aria-label={`${side} editor pane`}>
      <label>
        <span>{side === "left" ? "Left" : "Right"}</span>
        <select
          aria-label={`${side === "left" ? "Left" : "Right"} split tab`}
          value={tab.path}
          onChange={(event) => onSelect(side, event.target.value)}
          title={`Choose the ${side} split tab`}
        >
          {tabs.map((item) => (
            <option key={item.path} value={item.path}>
              {item.name}
              {item.content !== item.saved ? " •" : ""}
            </option>
          ))}
        </select>
      </label>
      <SplitPane
        side={side}
        tab={tab}
        theme={theme}
        options={options}
        onChange={onChange}
      />
    </section>
  );

  return (
    <div className="split-editor-host">
      {pane("left", left)}
      {pane("right", right)}
    </div>
  );
}
