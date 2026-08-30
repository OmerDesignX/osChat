import type { GitFile } from "../types.js";

export function parseGitStatus(raw: string): GitFile[] {
  const records = raw ? raw.split("\0").filter(Boolean) : [];
  const files: GitFile[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) continue;
    const indexStatus = record[0];
    const workingTree = record[1];
    const renamed = [indexStatus, workingTree].some((status) =>
      ["R", "C"].includes(status),
    );
    const file: GitFile = {
      index: indexStatus,
      workingTree,
      path: record.slice(3),
    };
    if (renamed) file.originalPath = records[++index];
    files.push(file);
  }
  return files;
}

export function parseTracking(raw: string) {
  const [behind = 0, ahead = 0] = raw.split(/\s+/).filter(Boolean).map(Number);
  return {
    behind: Number.isFinite(behind) ? behind : 0,
    ahead: Number.isFinite(ahead) ? ahead : 0,
  };
}
