import crypto from "node:crypto";
import path from "node:path";
import { SecureDataStore } from "./secure-store.js";

export type SaveHistoryEntry = {
  id: string;
  createdAt: string;
  path: string;
  content: string;
  source: "manual" | "autosave" | "agent" | "restore";
};

function projectKey(root: string) {
  return crypto.createHash("sha256").update(root.toLowerCase()).digest("hex");
}

function validEntry(value: unknown): value is SaveHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SaveHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.path === "string" &&
    typeof entry.content === "string" &&
    ["manual", "autosave", "agent", "restore"].includes(String(entry.source))
  );
}

export class SaveHistoryStore {
  constructor(private readonly secure: SecureDataStore) {}

  private journal(root: string) {
    return path.join(
      this.secure.root,
      "projects",
      projectKey(root),
      "save-history.oscode-data",
    );
  }

  private namespace(root: string) {
    return `save-history:${projectKey(root)}`;
  }

  private async all(root: string) {
    const value = await this.secure.readJson<unknown>(
      this.journal(root),
      [],
      this.namespace(root),
    );
    return Array.isArray(value) ? value.filter(validEntry) : [];
  }

  async list(root: string, relative: string) {
    return (await this.all(root))
      .filter((entry) => entry.path === relative)
      .reverse()
      .map(({ content, ...entry }) => ({ ...entry, bytes: content.length }));
  }

  async record(
    root: string,
    relative: string,
    content: string,
    source: SaveHistoryEntry["source"],
  ) {
    const entries = await this.all(root);
    const last = entries
      .slice()
      .reverse()
      .find((entry) => entry.path === relative);
    if (last?.content === content) return null;
    entries.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      path: relative,
      content,
      source,
    });
    while (
      entries.length > 250 ||
      entries.reduce((bytes, entry) => bytes + entry.content.length, 0) >
        20_000_000
    )
      entries.shift();
    await this.secure.writeJson(
      this.journal(root),
      entries,
      this.namespace(root),
    );
    return entries.at(-1) || null;
  }

  async content(root: string, relative: string, id: string) {
    const entry = (await this.all(root)).find(
      (candidate) => candidate.id === id && candidate.path === relative,
    );
    if (!entry) throw new Error("That saved version is no longer available");
    return entry.content;
  }
}
