import path from "node:path";

export function pythonBytecodeCacheRoot(userData: string) {
  return path.join(userData, "python-bytecode-cache");
}

export function pythonRuntimeEnvironment(
  userData: string,
  inherited: NodeJS.ProcessEnv = process.env,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...inherited,
    ...extra,
    // A contained interpreter must never write __pycache__ into a signed app
    // bundle. Python mirrors each source path below this writable app-data
    // directory, retaining bytecode caching without mutating the installation.
    PYTHONPYCACHEPREFIX: pythonBytecodeCacheRoot(userData),
  };
}
