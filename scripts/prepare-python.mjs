import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const version = "0.11.15";
const targets = {
  "win32-x64": "uv-x86_64-pc-windows-msvc.zip",
  "win32-arm64": "uv-aarch64-pc-windows-msvc.zip",
  "darwin-x64": "uv-x86_64-apple-darwin.tar.gz",
  "darwin-arm64": "uv-aarch64-apple-darwin.tar.gz",
  "linux-x64": "uv-x86_64-unknown-linux-gnu.tar.gz",
  "linux-arm64": "uv-aarch64-unknown-linux-gnu.tar.gz",
};
const platformKey = `${process.platform}-${process.arch}`;
const archiveName = targets[platformKey];
if (!archiveName)
  throw new Error(`Unsupported Python bundle target: ${platformKey}`);

const root = path.resolve("vendor");
const uvName = process.platform === "win32" ? "uv.exe" : "uv";
const platformTargets =
  process.platform === "darwin"
    ? ["darwin-arm64", "darwin-x64"]
    : [platformKey];
const readyMarker = "3.10\n3.11\n3.12";

const makePythonAliasesPortable = async (pythonRoot) => {
  for (const entry of await fs.readdir(pythonRoot, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const alias = path.join(pythonRoot, entry.name);
    const target = await fs.readlink(alias);
    if (!path.isAbsolute(target)) continue;

    const portableTarget = path.basename(target);
    const localTarget = path.join(pythonRoot, portableTarget);
    const targetStats = await fs.stat(localTarget);
    if (!targetStats.isDirectory())
      throw new Error(`Python alias target is not a directory: ${localTarget}`);
    await fs.unlink(alias);
    if (process.platform === "win32") {
      // Windows directory symlinks require Developer Mode or elevation, and
      // junctions retain an absolute path that breaks after packaging. Make
      // the version-neutral alias the real directory instead.
      await fs.rename(localTarget, alias);
      console.log(`Materialized portable Python alias: ${entry.name}`);
    } else {
      await fs.symlink(portableTarget, alias, "dir");
      console.log(`Made Python alias portable: ${entry.name}`);
    }
  }

  if (process.platform === "win32") {
    // Recover cleanly if an earlier run removed an alias before a privileged
    // symlink operation failed.
    for (const entry of await fs.readdir(pythonRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(
        /^cpython-(3\.\d+)\.\d+-(windows-(?:x86_64|aarch64)-none)$/,
      );
      if (!match) continue;
      const alias = path.join(pythonRoot, `cpython-${match[1]}-${match[2]}`);
      try {
        await fs.access(alias);
      } catch {
        await fs.rename(path.join(pythonRoot, entry.name), alias);
        console.log(`Recovered portable Python alias: ${path.basename(alias)}`);
      }
    }
  }
};

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-python-"));
try {
  const findUv = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === uvName) return candidate;
      if (entry.isDirectory()) {
        const nested = await findUv(candidate);
        if (nested) return nested;
      }
    }
    return "";
  };

  const uvPaths = new Map();
  for (const targetKey of platformTargets) {
    const targetArchive = targets[targetKey];
    const uvRoot = path.join(root, "uv", targetKey);
    const uvPath = path.join(uvRoot, uvName);
    try {
      await fs.access(uvPath);
      uvPaths.set(targetKey, uvPath);
      continue;
    } catch {
      // Download the pinned target runtime below.
    }

    const base = `https://releases.astral.sh/github/uv/releases/download/${version}`;
    const [archiveResponse, checksumResponse] = await Promise.all([
      fetch(`${base}/${targetArchive}`),
      fetch(`${base}/${targetArchive}.sha256`),
    ]);
    if (!archiveResponse.ok || !checksumResponse.ok)
      throw new Error(
        `uv download failed for ${targetKey} (${archiveResponse.status})`,
      );
    const archive = Buffer.from(await archiveResponse.arrayBuffer());
    const expected = (await checksumResponse.text()).trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(archive).digest("hex");
    if (!expected || actual !== expected)
      throw new Error(`uv checksum did not match for ${targetKey}`);

    const archivePath = path.join(temporary, `${targetKey}-${targetArchive}`);
    const extracted = path.join(temporary, `extracted-${targetKey}`);
    await fs.writeFile(archivePath, archive);
    await fs.mkdir(extracted);
    const unpack = spawnSync("tar", ["-xf", archivePath, "-C", extracted], {
      stdio: "inherit",
    });
    if (unpack.status !== 0)
      throw new Error(`uv extraction exited ${unpack.status} for ${targetKey}`);

    const extractedUv = await findUv(extracted);
    if (!extractedUv)
      throw new Error(`uv executable was not found for ${targetKey}`);
    await fs.mkdir(uvRoot, { recursive: true });
    await fs.copyFile(extractedUv, uvPath);
    if (process.platform !== "win32") await fs.chmod(uvPath, 0o755);
    uvPaths.set(targetKey, uvPath);
  }

  const nativeUv = uvPaths.get(platformKey);
  if (!nativeUv) throw new Error(`Native uv is missing for ${platformKey}`);

  for (const targetKey of platformTargets) {
    const pythonRoot = path.join(root, "python", targetKey);
    const readyPath = path.join(pythonRoot, ".oscode-ready");
    await fs.mkdir(pythonRoot, { recursive: true });
    await makePythonAliasesPortable(pythonRoot);
    try {
      const ready = await fs.readFile(readyPath, "utf8");
      if (ready.trim() === readyMarker.trim()) {
        console.log(`Contained Python runtimes are ready for ${targetKey}`);
        continue;
      }
    } catch {
      // Prepare a complete target bundle below.
    }

    const pythonRequests = targetKey.startsWith("darwin-")
      ? ["3.10", "3.11", "3.12"].map(
          (pythonVersion) =>
            `cpython-${pythonVersion}-macos-${targetKey.endsWith("arm64") ? "aarch64" : "x86_64"}-none`,
        )
      : ["3.10", "3.11", "3.12"];
    const install = spawnSync(
      nativeUv,
      ["python", "install", "--install-dir", pythonRoot, ...pythonRequests],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          UV_PYTHON_INSTALL_DIR: pythonRoot,
          UV_PYTHON_INSTALL_BIN: "0",
          UV_PYTHON_NO_REGISTRY: "1",
        },
      },
    );
    if (install.status !== 0)
      throw new Error(
        `Python runtime preparation exited ${install.status} for ${targetKey}`,
      );
    await makePythonAliasesPortable(pythonRoot);
    await fs.writeFile(readyPath, readyMarker, "utf8");
    console.log(
      `Prepared Python 3.10, 3.11, and 3.12 for ${targetKey} with uv ${version}`,
    );
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
