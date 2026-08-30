import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const version = "b10517";
const assets = {
  "darwin-arm64": {
    name: "llama-b10517-bin-macos-arm64.tar.gz",
    sha256: "d5d9ed544126f9f1af62252223f70ba11a75d1ee6f63bb61999e398bb8c74ffc",
  },
  "darwin-x64": {
    name: "llama-b10517-bin-macos-x64.tar.gz",
    sha256: "f0aa2c8b9b9b2a5b44c767b83e3f47c4e7e1da9473a038f11e6d1e6a983d4b2b",
  },
  "linux-x64": {
    name: "llama-b10517-bin-ubuntu-x64.tar.gz",
    sha256: "dfe6304a96af76975838db974eacfb825a5bcc71096c8553e06a63ff2c0240b1",
  },
  "linux-x64-vulkan": {
    name: "llama-b10517-bin-ubuntu-vulkan-x64.tar.gz",
    sha256: "0740df99b45a384672ae5983e1cc32f6c831a08e78d6f192691944cb39b6840d",
  },
  "win32-x64-vulkan": {
    name: "llama-b10517-bin-win-vulkan-x64.zip",
    sha256: "afa3b2d38b2b461e45a3df7783009b22b2b7e4bb92b40bcb910d0c8924925c88",
  },
  "win32-x64-cuda-12.4": {
    name: "llama-b10517-bin-win-cuda-12.4-x64.zip",
    sha256: "e144d3291f4f2615ed9af1baa39b6f4777591188c31e18f0f0a8ba5e4cb1db13",
  },
  "win32-x64-cuda-13.3": {
    name: "llama-b10517-bin-win-cuda-13.3-x64.zip",
    sha256: "cbfac1e655d550df2515bac060b6410f9ed6aabc7df014353481608ac514b6dd",
  },
};
const sourceAsset = {
  name: "llama.cpp-b10517.tar.gz",
  url: "https://github.com/ggml-org/llama.cpp/archive/refs/tags/b10517.tar.gz",
  sha256: "eff311dd10ee35647ebe9b129f51bb44965bc968bf5a723b074c430d450c4a10",
};

const hashFile = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

const download = async (asset, destination) => {
  const response = await fetch(
    asset.url ||
      `https://github.com/ggml-org/llama.cpp/releases/download/${version}/${asset.name}`,
    { redirect: "follow" },
  );
  if (!response.ok || !response.body)
    throw new Error(
      `Unable to download ${asset.name}: HTTP ${response.status}`,
    );
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination, { flags: "wx" }),
  );
  if ((await hashFile(destination)) !== asset.sha256)
    throw new Error(`Checksum mismatch for ${asset.name}`);
};

const targets =
  process.platform === "darwin"
    ? ["darwin-arm64", "darwin-x64"]
    : process.platform === "linux" && process.arch === "x64"
      ? ["linux-x64", "linux-x64-vulkan"]
      : [];

const findFile = async (directory, expectedName, depth = 0) => {
  if (depth > 5) return "";
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === expectedName) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, expectedName, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
};

const copyDlls = async (source, destination, depth = 0) => {
  if (depth > 5) return;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const candidate = path.join(source, entry.name);
    if (entry.isDirectory()) await copyDlls(candidate, destination, depth + 1);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll"))
      await cp(candidate, path.join(destination, entry.name), { force: true });
  }
};

const runtimeReady = async (target, runtimeAssets, requiredDlls) => {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(target, "OSCODE_RUNTIME.json"), "utf8"),
    );
    const pinned = Array.isArray(metadata.assets)
      ? metadata.assets
      : [{ name: metadata.asset, sha256: metadata.sha256 }];
    const expected =
      pinned.length === runtimeAssets.length &&
      runtimeAssets.every((asset) =>
        pinned.some(
          (item) => item.name === asset.name && item.sha256 === asset.sha256,
        ),
      );
    if (!expected || metadata.version !== version) return false;
    for (const name of [
      "llama-completion.exe",
      "llama-mtmd-cli.exe",
      ...requiredDlls,
    ])
      if (!(await stat(path.join(target, name))).isFile()) return false;
    if (
      await stat(path.join(target, "llama-server-impl.dll"))
        .then(() => true)
        .catch(() => false)
    )
      return false;
    if (
      (await readdir(target)).some((name) =>
        /^cu(?:dart|blas)(?:Lt)?64_\d+\.dll$/i.test(name),
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
};

const prepareWindowsRuntime = async (
  targetName,
  runtimeAssets,
  requiredDlls,
) => {
  const target = path.join(root, "vendor", "llama", targetName);
  if (await runtimeReady(target, runtimeAssets, requiredDlls)) {
    console.log(`Verified the pinned Windows llama.cpp ${targetName} runtime`);
    return;
  }
  const downloadRoot = path.join(root, "work", "llama-runtime-archives");
  const stagingRoot = path.join(root, "work", `${targetName}-staging`);
  await mkdir(downloadRoot, { recursive: true });
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  const extracted = [];
  for (const asset of runtimeAssets) {
    const archive = path.join(downloadRoot, asset.name);
    if (
      !(await stat(archive).catch(() => null))?.isFile() ||
      (await hashFile(archive)) !== asset.sha256
    ) {
      await rm(archive, { force: true });
      await download(asset, archive);
    }
    const extraction = path.join(
      stagingRoot,
      asset.name.replace(/\.zip$/i, ""),
    );
    await mkdir(extraction, { recursive: true });
    const unpack = spawnSync("tar", ["-xf", archive, "-C", extraction], {
      encoding: "utf8",
      timeout: 180_000,
    });
    if (unpack.status !== 0)
      throw new Error(
        `Unable to extract ${asset.name}: ${unpack.stderr || unpack.stdout}`,
      );
    extracted.push(extraction);
  }
  const completion = await findFile(extracted[0], "llama-completion.exe");
  if (!completion)
    throw new Error(`${runtimeAssets[0].name} has no llama-completion.exe`);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(path.dirname(completion), target, { recursive: true });
  for (const extraction of extracted.slice(1))
    await copyDlls(extraction, target);
  for (const dependency of [
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
  ])
    await cp(
      path.join(root, "vendor", "llama", "win32-x64", dependency),
      path.join(target, dependency),
      { force: true },
    );
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const runtimeDll =
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".dll") &&
      entry.name.toLowerCase() !== "llama-server-impl.dll" &&
      !/^cu(?:dart|blas)/i.test(entry.name) &&
      !/^(?:llama-(?:batched-bench|bench|fit-params|perplexity|quantize)-impl)\.dll$/i.test(
        entry.name,
      );
    const keep =
      entry.isFile() &&
      (entry.name === "LICENSE" ||
        entry.name === "llama-completion.exe" ||
        entry.name === "llama-mtmd-cli.exe" ||
        runtimeDll);
    if (!keep)
      await rm(path.join(target, entry.name), {
        recursive: entry.isDirectory(),
        force: true,
      });
  }
  for (const dependency of requiredDlls)
    if (!(await stat(path.join(target, dependency))).isFile())
      throw new Error(`${targetName} is missing ${dependency}`);
  const runtime = path.join(target, "llama-completion.exe");
  const check = spawnSync(runtime, ["--version"], {
    cwd: target,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (check.status !== 0)
    throw new Error(`${targetName} failed its version check`);
  await writeFile(
    path.join(target, "OSCODE_RUNTIME.json"),
    `${JSON.stringify(
      {
        version,
        assets: runtimeAssets.map((asset) => ({
          name: asset.name,
          sha256: asset.sha256,
        })),
      },
      null,
      2,
    )}\n`,
  );
  await rm(stagingRoot, { recursive: true, force: true });
  console.log(`Prepared the Windows llama.cpp ${targetName} runtime`);
};

if (process.platform === "win32") {
  const completion = path.join(
    root,
    "vendor",
    "llama",
    "win32-x64",
    "llama-completion.exe",
  );
  const check = spawnSync(completion, ["--version"], {
    cwd: path.dirname(completion),
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (check.status !== 0)
    throw new Error("The checked-in Windows llama.cpp runtime is not ready");
  console.log("Verified the checked-in Windows llama.cpp CPU runtime");
  await prepareWindowsRuntime(
    "win32-x64-vulkan",
    [assets["win32-x64-vulkan"]],
    ["ggml-vulkan.dll"],
  );
  await prepareWindowsRuntime(
    "win32-x64-cuda-13.3",
    [assets["win32-x64-cuda-13.3"]],
    ["ggml-cuda.dll"],
  );
  await prepareWindowsRuntime(
    "win32-x64-cuda-12.4",
    [assets["win32-x64-cuda-12.4"]],
    ["ggml-cuda.dll"],
  );
  process.exit(0);
}

if (process.platform === "darwin") {
  const deploymentTarget = "12.0";
  const downloadRoot = path.join(root, "work", "llama-runtime-archives");
  const sourceArchive = path.join(downloadRoot, sourceAsset.name);
  const sourceRoot = path.join(root, "work", `llama-${version}-source`);

  const run = (command, args, timeout = 300_000) => {
    const result = spawnSync(command, args, {
      cwd: root,
      stdio: "inherit",
      timeout,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${command} exited with status ${result.status}`);
  };
  const macRuntimeReady = async (targetName) => {
    const target = path.join(root, "vendor", "llama", targetName);
    const binaries = ["llama-completion", "llama-mtmd-cli"].map((name) =>
      path.join(target, name),
    );
    try {
      const metadata = JSON.parse(
        await readFile(path.join(target, "OSCODE_RUNTIME.json"), "utf8"),
      );
      if (
        metadata.version !== version ||
        metadata.source !== sourceAsset.name ||
        metadata.sha256 !== sourceAsset.sha256 ||
        metadata.deploymentTarget !== deploymentTarget ||
        metadata.commit !== "dc72703fc" ||
        metadata.metal !== true ||
        metadata.multimodalCli !== true
      )
        return false;
      const expectedArchitecture = targetName.endsWith("arm64")
        ? "arm64"
        : "x86_64";
      for (const binary of binaries) {
        if (!(await stat(binary)).isFile()) return false;
        const architectures = spawnSync("xcrun", ["lipo", "-archs", binary], {
          encoding: "utf8",
          timeout: 10_000,
        });
        if (
          architectures.status !== 0 ||
          architectures.stdout.trim() !== expectedArchitecture
        )
          return false;
        const dependencies = spawnSync("xcrun", ["otool", "-L", binary], {
          encoding: "utf8",
          timeout: 10_000,
        });
        if (
          dependencies.status !== 0 ||
          dependencies.stdout
            .split(/\r?\n/)
            .slice(1)
            .some((line) => {
              const dependency = line.trim().split(/\s+/, 1)[0] || "";
              return (
                dependency &&
                !dependency.startsWith("/System/Library/") &&
                !dependency.startsWith("/usr/lib/")
              );
            })
        )
          return false;
        const build = spawnSync("xcrun", ["vtool", "-show-build", binary], {
          encoding: "utf8",
          timeout: 10_000,
        });
        if (
          build.status !== 0 ||
          !new RegExp(
            `\\bminos ${deploymentTarget.replace(".", "\\.")}\\b`,
          ).test(build.stdout)
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const missingTargets = [];
  for (const targetName of targets) {
    if (await macRuntimeReady(targetName))
      console.log(
        `Verified the Monterey-compatible ${targetName} llama.cpp runtime`,
      );
    else missingTargets.push(targetName);
  }
  if (missingTargets.length === 0) process.exit(0);

  await mkdir(downloadRoot, { recursive: true });
  if (
    !(await stat(sourceArchive).catch(() => null))?.isFile() ||
    (await hashFile(sourceArchive)) !== sourceAsset.sha256
  ) {
    await rm(sourceArchive, { force: true });
    await download(sourceAsset, sourceArchive);
  }
  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(sourceRoot, { recursive: true });
  run("tar", ["-xzf", sourceArchive, "-C", sourceRoot, "--strip-components=1"]);

  for (const targetName of missingTargets) {
    const architecture = targetName.endsWith("arm64") ? "arm64" : "x86_64";
    const buildRoot = path.join(root, "work", `llama-${version}-${targetName}`);
    const target = path.join(root, "vendor", "llama", targetName);
    await rm(buildRoot, { recursive: true, force: true });
    run("cmake", [
      "-S",
      sourceRoot,
      "-B",
      buildRoot,
      "-DCMAKE_BUILD_TYPE=Release",
      `-DCMAKE_OSX_ARCHITECTURES=${architecture}`,
      `-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`,
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DGGML_BLAS=OFF",
      "-DGGML_ACCELERATE=ON",
      "-DGGML_METAL=ON",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DLLAMA_BUILD_NUMBER=10517",
      "-DLLAMA_BUILD_COMMIT=dc72703fc",
      "-DLLAMA_BUILD_TESTS=OFF",
      "-DLLAMA_BUILD_SERVER=OFF",
      "-DLLAMA_BUILD_APP=OFF",
      "-DLLAMA_BUILD_UI=OFF",
      "-DLLAMA_OPENSSL=OFF",
      "-DLLAMA_CURL=OFF",
    ]);
    run(
      "cmake",
      [
        "--build",
        buildRoot,
        "--config",
        "Release",
        "--target",
        "llama-completion",
        "llama-mtmd-cli",
        "--parallel",
        "4",
      ],
      900_000,
    );
    const builtCompletion = await findFile(buildRoot, "llama-completion");
    const builtCli = await findFile(buildRoot, "llama-mtmd-cli");
    if (!builtCompletion || !builtCli)
      throw new Error(`${targetName} llama.cpp commands were not built`);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const completion = path.join(target, "llama-completion");
    const cli = path.join(target, "llama-mtmd-cli");
    await cp(builtCompletion, completion);
    await cp(builtCli, cli);
    await cp(path.join(sourceRoot, "LICENSE"), path.join(target, "LICENSE"));
    await chmod(completion, 0o755);
    await chmod(cli, 0o755);
    await writeFile(
      path.join(target, "OSCODE_RUNTIME.json"),
      `${JSON.stringify(
        {
          version,
          source: sourceAsset.name,
          sha256: sourceAsset.sha256,
          deploymentTarget,
          commit: "dc72703fc",
          architecture,
          metal: true,
          cpuFallback: "Accelerate",
          multimodalCli: true,
        },
        null,
        2,
      )}\n`,
    );
    if (!(await macRuntimeReady(targetName)))
      throw new Error(
        `${targetName} llama.cpp runtime is not compatible with macOS ${deploymentTarget}`,
      );
    if (architecture === process.arch) {
      for (const binary of [completion, cli]) {
        const check = spawnSync(binary, ["--version"], {
          cwd: target,
          encoding: "utf8",
          timeout: 30_000,
        });
        if (
          check.status !== 0 ||
          !/build\s+10517/i.test(`${check.stdout || ""}\n${check.stderr || ""}`)
        )
          throw new Error(`${targetName} llama.cpp runtime failed to start`);
      }
    }
    console.log(
      `Prepared ${targetName} llama.cpp ${version} for macOS ${deploymentTarget}+`,
    );
  }
  process.exit(0);
}

if (targets.length === 0)
  throw new Error(
    `No pinned llama.cpp runtime is available for ${process.platform}-${process.arch}`,
  );

const downloadRoot = path.join(root, "work", "llama-runtime-archives");
await mkdir(downloadRoot, { recursive: true });

for (const targetName of targets) {
  const asset = assets[targetName];
  const archive = path.join(downloadRoot, asset.name);
  const target = path.join(root, "vendor", "llama", targetName);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await rm(archive, { force: true });
  await download(asset, archive);
  const extraction = spawnSync(
    "tar",
    ["-xzf", archive, "-C", target, "--strip-components=1"],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (extraction.status !== 0)
    throw new Error(
      `Unable to extract ${asset.name}: ${extraction.stderr || extraction.stdout}`,
    );

  for (const name of await readdir(target)) {
    const keep =
      name === "LICENSE" ||
      name === "llama-completion" ||
      name === "llama-mtmd-cli" ||
      /^lib.+\.(?:dylib|so(?:\..+)?)$/.test(name);
    if (!keep) {
      const candidate = path.join(target, name);
      const stats = await lstat(candidate);
      await rm(candidate, { recursive: stats.isDirectory(), force: true });
    }
  }

  const completion = path.join(target, "llama-completion");
  const cli = path.join(target, "llama-mtmd-cli");
  await chmod(completion, 0o755);
  await chmod(cli, 0o755);
  const check = spawnSync(completion, ["--version"], {
    cwd: target,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (check.status !== 0)
    throw new Error(`${targetName} llama.cpp runtime failed its version check`);
  await writeFile(
    path.join(target, "OSCODE_RUNTIME.json"),
    `${JSON.stringify(
      { version, asset: asset.name, sha256: asset.sha256 },
      null,
      2,
    )}\n`,
  );
  console.log(`Prepared ${targetName} llama.cpp ${version}`);
}
