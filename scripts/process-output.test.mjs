import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { guardBrokenOutputPipe } from "../dist-electron/main/process-output.js";

test("closed output pipes do not crash the Electron main process", () => {
  const stream = new EventEmitter();
  guardBrokenOutputPipe(stream);
  assert.doesNotThrow(() =>
    stream.emit(
      "error",
      Object.assign(new Error("broken pipe"), { code: "EPIPE" }),
    ),
  );
});

test("unexpected output errors still surface", () => {
  const stream = new EventEmitter();
  guardBrokenOutputPipe(stream);
  assert.throws(
    () =>
      stream.emit(
        "error",
        Object.assign(new Error("output failed"), { code: "EIO" }),
      ),
    /output failed/,
  );
});
