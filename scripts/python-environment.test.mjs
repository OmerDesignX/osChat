import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  pythonBytecodeCacheRoot,
  pythonRuntimeEnvironment,
} from "../dist-electron/main/python-environment.js";

test("Python bytecode is redirected to writable app data", () => {
  const userData = path.join(
    path.parse(process.cwd()).root,
    "oscode-user-data",
  );
  const environment = pythonRuntimeEnvironment(
    userData,
    { PATH: "inherited-path", PYTHONPYCACHEPREFIX: "unsafe-inherited" },
    { HF_HUB_OFFLINE: "1", PYTHONPYCACHEPREFIX: "unsafe-extra" },
  );

  assert.equal(environment.PATH, "inherited-path");
  assert.equal(environment.HF_HUB_OFFLINE, "1");
  assert.equal(
    environment.PYTHONPYCACHEPREFIX,
    pythonBytecodeCacheRoot(userData),
  );
  assert.equal(
    environment.PYTHONPYCACHEPREFIX,
    path.join(userData, "python-bytecode-cache"),
  );
});
