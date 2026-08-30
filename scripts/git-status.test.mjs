import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGitStatus,
  parseTracking,
} from "../dist-electron/main/git-status.js";

test("parses staged, working-tree, and untracked files", () => {
  assert.deepEqual(
    parseGitStatus(" M alpha.txt\0A  staged.ts\0?? new file.txt\0"),
    [
      { index: " ", workingTree: "M", path: "alpha.txt" },
      { index: "A", workingTree: " ", path: "staged.ts" },
      { index: "?", workingTree: "?", path: "new file.txt" },
    ],
  );
});

test("preserves rename pairs and filenames with newlines", () => {
  assert.deepEqual(
    parseGitStatus(
      "R  renamed target.txt\0rename source.txt\0?? line\nbreak.txt\0",
    ),
    [
      {
        index: "R",
        workingTree: " ",
        path: "renamed target.txt",
        originalPath: "rename source.txt",
      },
      { index: "?", workingTree: "?", path: "line\nbreak.txt" },
    ],
  );
});

test("parses upstream behind and ahead counts", () => {
  assert.deepEqual(parseTracking("2\t5\n"), { behind: 2, ahead: 5 });
  assert.deepEqual(parseTracking(""), { behind: 0, ahead: 0 });
  assert.deepEqual(parseTracking("invalid"), { behind: 0, ahead: 0 });
});
