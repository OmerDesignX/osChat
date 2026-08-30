import { access, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

if (process.platform === "darwin") {
  const source = path.join(
    root,
    "native",
    "computer-control",
    "macos-addon",
    "addon.mm",
  );
  const outputRoot = path.join(
    root,
    "vendor",
    "computer-control",
    "darwin-universal",
  );
  const universal = path.join(outputRoot, "oscode-computer-control.node");
  const nodePrefix = String(process.config.variables.node_prefix || "");
  const includeCandidates = [
    path.join(nodePrefix, "include", "node"),
    "/opt/homebrew/include/node",
    "/usr/local/include/node",
  ];
  let nodeInclude = "";
  for (const candidate of includeCandidates) {
    if (!candidate) continue;
    try {
      await access(path.join(candidate, "node_api.h"));
      nodeInclude = candidate;
      break;
    } catch {}
  }
  if (!nodeInclude)
    throw new Error(
      "Node API headers are missing. Install Node.js before preparing Computer Control.",
    );
  await mkdir(outputRoot, { recursive: true });
  await run("xcrun", [
    "clang++",
    source,
    "-std=c++17",
    "-O2",
    "-fobjc-arc",
    "-fblocks",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-mmacosx-version-min=12.0",
    "-arch",
    "arm64",
    "-arch",
    "x86_64",
    "-I",
    nodeInclude,
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "CoreGraphics",
    "-o",
    universal,
  ]);
  await chmod(universal, 0o755);
  process.stdout.write(`Prepared ${universal}\n`);
} else {
  process.stdout.write(
    "Computer Control uses the pinned Windows helper or native macOS build.\n",
  );
}
