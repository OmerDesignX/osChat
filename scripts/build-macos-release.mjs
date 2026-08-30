import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const requireSigned = process.env.OSCODE_REQUIRE_SIGNED === "1";

if (process.platform !== "darwin")
  throw new Error("The macOS release must be built on macOS");

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

async function makeDirectoriesWritable(directory) {
  const details = await fs.lstat(directory).catch(() => null);
  if (!details) return;
  if (!details.isDirectory() || details.isSymbolicLink())
    throw new Error(`Refusing to clean unexpected release path: ${directory}`);
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink())
      await makeDirectoriesWritable(path.join(directory, entry.name));
  }
}

async function removeGeneratedRelease(target) {
  const releaseRoot = path.join(root, "release");
  const relative = path.relative(releaseRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Refusing to clean outside ${releaseRoot}`);
  if (!(await fs.lstat(target).catch(() => null))) return;
  await makeDirectoriesWritable(target);
  await fs.rm(target, { recursive: true, force: true });
}

await run("pnpm", ["run", "release:check-disk"]);
await run("bash", ["releaseScripts/macos/prepare-icon.sh"]);
await run("pnpm", ["run", "format:check"]);
await run("pnpm", ["test"]);
await run("pnpm", ["run", "git:prepare"]);
await run("pnpm", ["run", "python:prepare"]);
await run("pnpm", ["run", "llama:prepare"]);
await run("pnpm", ["run", "terminal:prepare"]);
await run("pnpm", ["run", "computer:prepare"]);
await run("pnpm", ["run", "native:check"]);
await run("pnpm", ["exec", "vite", "build"], {
  NODE_OPTIONS: "--max-old-space-size=4096",
});
await run("pnpm", ["run", "smoke:run"]);
for (const architecture of ["arm64", "x64"]) {
  const packageDirectory = path.join(root, "release", `macos-${architecture}`);
  await removeGeneratedRelease(packageDirectory);
  const localIntegritySeal = requireSigned
    ? []
    : ["--config.mac.identity=-", "--config.mac.hardenedRuntime=false"];
  await run(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--mac",
      "dmg",
      `--${architecture}`,
      `--config.directories.output=${packageDirectory}`,
      "--publish",
      "never",
      ...localIntegritySeal,
    ],
    requireSigned ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  );
  await run(
    process.execPath,
    ["scripts/verify-package.mjs", "macos", "--run-smoke"],
    {
      OSCODE_EXPECTED_MAC_ARCH: architecture,
      OSCODE_PACKAGE_DIR: packageDirectory,
      OSCODE_ALLOW_UNSIGNED: requireSigned ? "0" : "1",
      // An x64 Electron renderer runs through Rosetta on Apple silicon. The
      // production bundle's first V8 compilation is much slower there than on
      // a native Intel Mac, so retain every smoke assertion with more headroom.
      ...(architecture === "x64" ? { OSCODE_SMOKE_TIMEOUT_MS: "600000" } : {}),
    },
  );
}
await run("pnpm", ["run", "release:stage:macos"]);
await removeGeneratedRelease(path.join(root, "release"));

process.stdout.write(
  "\nApple-silicon and Intel macOS releases verified and staged in release-assets/macos; intermediate release folder removed\n",
);
