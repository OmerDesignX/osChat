import { FeatherIcon } from "./FeatherIcon";
import { useState } from "react";
import type { TreeEntry } from "../types";
export function FileTree({
  entries,
  onOpen,
  onExpand,
  onError,
  onSelect,
  selectedPath,
  level = 0,
}: {
  entries: TreeEntry[];
  onOpen: (x: TreeEntry) => void;
  onExpand: (path: string) => Promise<void>;
  onError: (error: unknown) => void;
  onSelect: (entry: TreeEntry) => void;
  selectedPath: string;
  level?: number;
}) {
  return (
    <>
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          onOpen={onOpen}
          onExpand={onExpand}
          onError={onError}
          onSelect={onSelect}
          selectedPath={selectedPath}
          level={level}
        />
      ))}
    </>
  );
}
function TreeNode({
  entry,
  onOpen,
  onExpand,
  onError,
  onSelect,
  selectedPath,
  level,
}: {
  entry: TreeEntry;
  onOpen: (x: TreeEntry) => void;
  onExpand: (path: string) => Promise<void>;
  onError: (error: unknown) => void;
  onSelect: (entry: TreeEntry) => void;
  selectedPath: string;
  level: number;
}) {
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false);
  const folder = entry.kind === "directory";
  const toggle = async () => {
    onSelect(entry);
    if (!folder) {
      onOpen(entry);
      return;
    }
    if (!open && entry.children === undefined) {
      setLoading(true);
      try {
        await onExpand(entry.path);
      } catch (error) {
        onError(error);
        return;
      } finally {
        setLoading(false);
      }
    }
    setOpen(!open);
  };
  return (
    <div>
      <button
        className={`tree-row ${selectedPath === entry.path ? "selected" : ""}`}
        style={{ paddingLeft: 12 + level * 15 }}
        onClick={toggle}
      >
        <FeatherIcon
          icon={
            loading
              ? "loader"
              : folder
                ? open
                  ? "chevron-down"
                  : "chevron-right"
                : "file-text"
          }
          size="14"
        />
        <span>{entry.name}</span>
      </button>
      {folder && open && entry.children && (
        <FileTree
          entries={entry.children}
          onOpen={onOpen}
          onExpand={onExpand}
          onError={onError}
          onSelect={onSelect}
          selectedPath={selectedPath}
          level={level + 1}
        />
      )}
    </div>
  );
}
