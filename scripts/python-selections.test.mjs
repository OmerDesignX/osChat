import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  setPythonSelection,
  validPythonSelections,
} from "../dist-electron/main/python-selections.js";

test("accepts only absolute project interpreter selections", () => {
  const project = path.resolve("project");
  const interpreter = path.resolve("python", "python.exe");
  assert.deepEqual(
    validPythonSelections({
      [project]: interpreter,
      relative: interpreter,
      [path.resolve("bad")]: "python",
    }),
    { [project]: interpreter },
  );
});

test("replaces, removes, and bounds project interpreter selections", () => {
  const entries = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      path.resolve(`project-${index}`),
      path.resolve(`python-${index}`),
    ]),
  );
  const project = path.resolve("current-project");
  const interpreter = path.resolve("current-python");
  const updated = setPythonSelection(entries, project, interpreter);
  assert.equal(Object.keys(updated).length, 100);
  assert.equal(updated[project], interpreter);
  assert.equal(updated[path.resolve("project-0")], undefined);
  assert.equal(setPythonSelection(updated, project, "")[project], undefined);
});
