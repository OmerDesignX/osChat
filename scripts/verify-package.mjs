import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const requireNativeModule = createRequire(import.meta.url);
const packagedPythonEnvironment = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
};

const [platform, ...flags] = process.argv.slice(2);
if (!["windows", "macos", "linux"].includes(platform))
  throw new Error(
    "Usage: node scripts/verify-package.mjs <windows|macos|linux> [--run-smoke]",
  );
const expectedMacArch =
  platform === "macos"
    ? process.env.OSCODE_EXPECTED_MAC_ARCH || process.arch
    : "";
if (platform === "macos" && !["arm64", "x64"].includes(expectedMacArch))
  throw new Error(
    `Unsupported expected macOS architecture: ${expectedMacArch}`,
  );

const release = path.resolve(process.env.OSCODE_PACKAGE_DIR || "release");
const walk = (root, depth = 8) => {
  if (depth < 0) return [];
  const result = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, item.name);
    if (item.isDirectory()) result.push(...walk(full, depth - 1));
    else if (item.isFile()) result.push(full);
  }
  return result;
};
const releaseFiles = walk(release);
const relative = (file) => path.relative(release, file).replaceAll("\\", "/");
const requireLargeFile = (file, label, minimum = 100_000) => {
  if (!file || statSync(file).size < minimum)
    throw new Error(`${label} is missing or unexpectedly small`);
  return file;
};
const first = (predicate) => releaseFiles.find(predicate);
const all = (predicate) => releaseFiles.filter(predicate);
const hasMagic = (file, bytes) => {
  const header = readFileSync(file).subarray(0, bytes.length);
  return bytes.every((value, index) => header[index] === value);
};
const hasBytesAt = (file, offset, bytes) => {
  const value = readFileSync(file).subarray(offset, offset + bytes.length);
  return bytes.every((expected, index) => value[index] === expected);
};
const pythonExecutables = (root) =>
  walk(root).filter((file) =>
    process.platform === "win32"
      ? /[\\/]python(?:3(?:\.\d+)?)?\.exe$/i.test(file)
      : /[\\/]python3(?:\.\d+)?$/.test(file),
  );
const requireMacOs12Compatible = (file, label) => {
  const build = spawnSync("xcrun", ["vtool", "-show-build", file], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (build.status !== 0)
    throw new Error(`${label} has no readable macOS deployment target`);
  let versions = [...build.stdout.matchAll(/\bminos\s+(\d+(?:\.\d+)+)/g)].map(
    (match) => match[1],
  );
  if (!versions.length)
    versions = [
      ...build.stdout.matchAll(
        /cmd LC_VERSION_MIN_MACOSX[\s\S]*?\bversion\s+(\d+(?:\.\d+)+)/g,
      ),
    ].map((match) => match[1]);
  if (!versions.length)
    throw new Error(`${label} does not declare a macOS deployment target`);
  const newerThanMonterey = versions.some((version) => {
    const [major = 0, minor = 0] = version.split(".").map(Number);
    return major > 12 || (major === 12 && minor > 0);
  });
  if (newerThanMonterey)
    throw new Error(
      `${label} requires macOS ${versions.join("/")} instead of macOS 12.0 or older`,
    );
};

let appRoot;
let executable;
let artifacts;
if (platform === "windows") {
  appRoot = path.join(release, "win-unpacked");
  executable = path.join(appRoot, "osChat.exe");
  artifacts = all(
    (file) =>
      /^osChat-Setup-.+\.exe$/i.test(path.basename(file)) &&
      !relative(file).includes("/"),
  );
} else if (platform === "linux") {
  appRoot = path.join(release, "linux-unpacked");
  executable = path.join(appRoot, "oschat");
  artifacts = [
    first((file) => /^oschat[_-].*\.deb$/i.test(path.basename(file))),
    first((file) => /\.snap$/i.test(file)),
  ].filter(Boolean);
} else {
  executable = first((file) =>
    /osChat\.app\/Contents\/MacOS\/osChat$/.test(relative(file)),
  );
  appRoot = path.resolve(executable, "..", "..", "..");
  artifacts = [
    first((file) =>
      new RegExp(`-mac-${expectedMacArch}\\.dmg$`, "i").test(file),
    ),
  ].filter(Boolean);
}

requireLargeFile(
  executable,
  `${platform} application executable`,
  platform === "macos" ? 10_000 : 1_000_000,
);
const resourcesRoot =
  platform === "macos"
    ? path.join(appRoot, "Contents", "Resources")
    : path.join(appRoot, "resources");
const asar = requireLargeFile(
  path.join(resourcesRoot, "app.asar"),
  `${platform} app.asar`,
  1_000_000,
);
if (existsSync(path.join(resourcesRoot, "models")))
  throw new Error(
    "Model weights must not be embedded in the application package",
  );
const nativeRoot = path.join(
  resourcesRoot,
  "app.asar.unpacked",
  "node_modules",
  "node-pty",
);
const nativeFiles = walk(nativeRoot).filter((file) => file.endsWith(".node"));
let bundledGit;
if (platform === "windows") {
  const pty = nativeFiles.find((file) =>
    /prebuilds[\\/]win32-x64[\\/]pty\.node$/i.test(file),
  );
  if (!pty || !hasMagic(pty, [0x4d, 0x5a]))
    throw new Error("Windows x64 node-pty prebuild is missing or invalid");
  bundledGit = requireLargeFile(
    path.join(resourcesRoot, "git", "cmd", "git.exe"),
    "Bundled MinGit launcher",
    40_000,
  );
  if (!hasMagic(bundledGit, [0x4d, 0x5a]))
    throw new Error("Bundled MinGit launcher is not a Windows binary");
  const bundledGitCore = requireLargeFile(
    path.join(resourcesRoot, "git", "mingw64", "bin", "git.exe"),
    "Bundled MinGit core executable",
    1_000_000,
  );
  if (!hasMagic(bundledGitCore, [0x4d, 0x5a]))
    throw new Error("Bundled MinGit core is not a Windows binary");
  const computerControlRoot = path.join(
    resourcesRoot,
    "computer-control",
    "win32-x64",
  );
  const computerControl = requireLargeFile(
    path.join(computerControlRoot, "winapp.exe"),
    "Bundled Windows Computer Control helper",
    10_000_000,
  );
  if (!hasMagic(computerControl, [0x4d, 0x5a]))
    throw new Error(
      "Bundled Windows Computer Control helper is not a PE binary",
    );
  requireLargeFile(
    path.join(computerControlRoot, "libSkiaSharp.dll"),
    "Bundled Computer Control graphics dependency",
    1_000_000,
  );
  requireLargeFile(
    path.join(resourcesRoot, "computer-control", "WINAPP-LICENSE"),
    "Bundled Computer Control license",
    500,
  );
  const computerControlCheck = spawnSync(
    computerControl,
    ["ui", "list-windows", "--json"],
    {
      cwd: computerControlRoot,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      env: {
        ...process.env,
        WINAPP_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      },
    },
  );
  if (computerControlCheck.status !== 0)
    throw new Error("Bundled Windows Computer Control helper failed to start");
  try {
    if (!Array.isArray(JSON.parse(computerControlCheck.stdout.trim())))
      throw new Error("not an array");
  } catch {
    throw new Error(
      "Bundled Windows Computer Control helper returned invalid JSON",
    );
  }
  const bundledUvPath = walk(path.join(resourcesRoot, "uv", "win32-x64")).find(
    (file) => /[\\/]uv\.exe$/i.test(file),
  );
  if (!bundledUvPath) throw new Error("Bundled uv executable is missing");
  const bundledUv = requireLargeFile(
    bundledUvPath,
    "Bundled uv executable",
    5_000_000,
  );
  if (!hasMagic(bundledUv, [0x4d, 0x5a]))
    throw new Error("Bundled uv is not a Windows binary");
  const bundledLlama = requireLargeFile(
    path.join(resourcesRoot, "llama", "llama-completion.exe"),
    "Bundled llama.cpp command",
    8_000,
  );
  const bundledLlamaCli = requireLargeFile(
    path.join(resourcesRoot, "llama", "llama-mtmd-cli.exe"),
    "Bundled llama.cpp multimodal command",
    8_000,
  );
  if (!hasMagic(bundledLlama, [0x4d, 0x5a]))
    throw new Error("Bundled llama.cpp command is not a Windows binary");
  if (!hasMagic(bundledLlamaCli, [0x4d, 0x5a]))
    throw new Error(
      "Bundled llama.cpp multimodal command is not a Windows binary",
    );
  for (const dependency of [
    "llama-completion-impl.dll",
    "llama-common.dll",
    "llama.dll",
    "ggml.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
  ]) {
    requireLargeFile(
      path.join(resourcesRoot, "llama", dependency),
      `Bundled llama.cpp dependency ${dependency}`,
      5_000,
    );
  }
  const llamaCheck = spawnSync(bundledLlama, ["--version"], {
    cwd: path.dirname(bundledLlama),
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  const llamaVersionOutput = `${llamaCheck.stdout || ""}\n${llamaCheck.stderr || ""}`;
  if (llamaCheck.status !== 0 || !/build\s+\d+/i.test(llamaVersionOutput))
    throw new Error("Bundled llama.cpp command failed its dependency check");
  const vulkanRoot = path.join(resourcesRoot, "llama", "vulkan");
  const vulkanLlama = requireLargeFile(
    path.join(vulkanRoot, "llama-completion.exe"),
    "Bundled llama.cpp Vulkan command",
    8_000,
  );
  requireLargeFile(
    path.join(vulkanRoot, "llama-mtmd-cli.exe"),
    "Bundled llama.cpp Vulkan multimodal command",
    8_000,
  );
  for (const dependency of [
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
    "ggml-vulkan.dll",
  ])
    requireLargeFile(
      path.join(vulkanRoot, dependency),
      `Bundled Vulkan dependency ${dependency}`,
      5_000,
    );
  const vulkanCheck = spawnSync(vulkanLlama, ["--version"], {
    cwd: vulkanRoot,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (
    vulkanCheck.status !== 0 ||
    !/build\s+\d+/i.test(
      `${vulkanCheck.stdout || ""}\n${vulkanCheck.stderr || ""}`,
    )
  )
    throw new Error("Bundled llama.cpp Vulkan command failed to start");
  for (const cuda of [{ version: "13" }, { version: "12" }]) {
    const cudaRoot = path.join(
      resourcesRoot,
      "llama",
      `cuda-system-${cuda.version}`,
    );
    const cudaLlama = requireLargeFile(
      path.join(cudaRoot, "llama-completion.exe"),
      `Bundled llama.cpp CUDA ${cuda.version} command`,
      8_000,
    );
    requireLargeFile(
      path.join(cudaRoot, "llama-mtmd-cli.exe"),
      `Bundled llama.cpp CUDA ${cuda.version} multimodal command`,
      8_000,
    );
    for (const dependency of [
      "vcruntime140.dll",
      "vcruntime140_1.dll",
      "msvcp140.dll",
      "ggml-cuda.dll",
    ])
      requireLargeFile(
        path.join(cudaRoot, dependency),
        `Bundled CUDA ${cuda.version} dependency ${dependency}`,
        5_000,
      );
    const cudaCheck = spawnSync(cudaLlama, ["--version"], {
      cwd: cudaRoot,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (
      cudaCheck.status !== 0 ||
      !/build\s+\d+/i.test(
        `${cudaCheck.stdout || ""}\n${cudaCheck.stderr || ""}`,
      )
    )
      throw new Error(
        `Bundled llama.cpp CUDA ${cuda.version} command failed to start`,
      );
    const embeddedNvidiaRuntime = releaseFiles.filter(
      (file) =>
        file.startsWith(cudaRoot) &&
        /[\\/]cu(?:dart|blas(?:Lt)?)64_\d+\.dll$/i.test(file),
    );
    if (embeddedNvidiaRuntime.length)
      throw new Error("NVIDIA CUDA runtime libraries must not be packaged");
  }
  const serverArtifacts = releaseFiles.filter((file) =>
    /[\\/](?:(?:llama|ggml-rpc)-server\.exe|llama-server-impl\.dll)$/i.test(
      file,
    ),
  );
  if (serverArtifacts.length)
    throw new Error("Server runtime artifacts must not be packaged");
  const containedPython = pythonExecutables(
    path.join(resourcesRoot, "python", "win32-x64"),
  );
  for (const version of ["3.10", "3.11", "3.12"]) {
    const ready = containedPython.some((python) => {
      const check = spawnSync(
        python,
        [
          "-c",
          "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')",
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: packagedPythonEnvironment,
        },
      );
      return check.status === 0 && check.stdout.trim() === version;
    });
    if (!ready) throw new Error(`Contained Python ${version} is missing`);
  }
} else if (platform === "linux") {
  const pty = nativeFiles.find(
    (file) =>
      /(?:build[\\/]Release|prebuilds[\\/]linux-x64)/i.test(file) &&
      hasMagic(file, [0x7f, 0x45, 0x4c, 0x46]),
  );
  if (!pty) throw new Error("Linux x64 node-pty ELF addon is missing");
  const linuxLlamaRoot = path.join(resourcesRoot, "llama", "linux-x64");
  const linuxLlama = requireLargeFile(
    path.join(linuxLlamaRoot, "llama-completion"),
    "Bundled Linux llama.cpp command",
    8_000,
  );
  const linuxLlamaCli = requireLargeFile(
    path.join(linuxLlamaRoot, "llama-mtmd-cli"),
    "Bundled Linux llama.cpp multimodal command",
    8_000,
  );
  if (!hasMagic(linuxLlama, [0x7f, 0x45, 0x4c, 0x46]))
    throw new Error("Bundled Linux llama.cpp command is not an ELF binary");
  if (!hasMagic(linuxLlamaCli, [0x7f, 0x45, 0x4c, 0x46]))
    throw new Error(
      "Bundled Linux llama.cpp multimodal command is not an ELF binary",
    );
  const linuxLlamaCheck = spawnSync(linuxLlama, ["--version"], {
    cwd: linuxLlamaRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (
    linuxLlamaCheck.status !== 0 ||
    !/build\s+\d+/i.test(
      `${linuxLlamaCheck.stdout || ""}\n${linuxLlamaCheck.stderr || ""}`,
    )
  )
    throw new Error("Bundled Linux llama.cpp command failed its version check");
  if (existsSync(path.join(linuxLlamaRoot, "llama-server")))
    throw new Error(
      "The Linux llama.cpp server executable must not be packaged",
    );
  const linuxUv = requireLargeFile(
    path.join(resourcesRoot, "uv", "linux-x64", "uv"),
    "Bundled Linux uv command",
    5_000_000,
  );
  if (!hasMagic(linuxUv, [0x7f, 0x45, 0x4c, 0x46]))
    throw new Error("Bundled Linux uv command is not an ELF binary");
  const linuxUvCheck = spawnSync(linuxUv, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (linuxUvCheck.status !== 0 || !/^uv\s+\d+/i.test(linuxUvCheck.stdout))
    throw new Error("Bundled Linux uv command failed its version check");
  const linuxPython = pythonExecutables(
    path.join(resourcesRoot, "python", "linux-x64"),
  );
  for (const version of ["3.10", "3.11", "3.12"]) {
    const ready = linuxPython.some((python) => {
      if (!hasMagic(python, [0x7f, 0x45, 0x4c, 0x46])) return false;
      const check = spawnSync(
        python,
        [
          "-c",
          "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')",
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: packagedPythonEnvironment,
        },
      );
      return check.status === 0 && check.stdout.trim() === version;
    });
    if (!ready) throw new Error(`Contained Linux Python ${version} is missing`);
  }
} else {
  const infoPlist = path.join(appRoot, "Contents", "Info.plist");
  if (!existsSync(infoPlist)) throw new Error("macOS Info.plist is missing");
  const signature = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", appRoot],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (signature.status !== 0)
    throw new Error("macOS application does not have a valid code signature");
  const signatureDetails = spawnSync(
    "codesign",
    ["--display", "--verbose=4", appRoot],
    { encoding: "utf8", timeout: 30_000 },
  );
  const signatureOutput = `${signatureDetails.stdout}\n${signatureDetails.stderr}`;
  if (process.env.OSCODE_ALLOW_UNSIGNED === "1") {
    if (
      signatureDetails.status !== 0 ||
      !/Signature=adhoc/i.test(signatureOutput)
    )
      throw new Error("macOS application does not have a valid ad-hoc seal");
  } else if (
    signatureDetails.status !== 0 ||
    !/Authority=Developer ID Application:/i.test(signatureOutput)
  )
    throw new Error(
      "macOS application is not signed with Developer ID Application",
    );
  const minimumSystem = spawnSync(
    "plutil",
    ["-extract", "LSMinimumSystemVersion", "raw", "-o", "-", infoPlist],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (minimumSystem.status !== 0 || minimumSystem.stdout.trim() !== "12.0")
    throw new Error("macOS package must require Monterey 12.0 or newer");
  requireMacOs12Compatible(executable, "macOS application executable");
  const appArchitectures = spawnSync("lipo", ["-archs", executable], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const expectedLipoArch = expectedMacArch === "x64" ? "x86_64" : "arm64";
  const packagedArchitectures = appArchitectures.stdout.trim().split(/\s+/);
  if (
    appArchitectures.status !== 0 ||
    packagedArchitectures.length !== 1 ||
    packagedArchitectures[0] !== expectedLipoArch
  )
    throw new Error(
      `macOS application executable is not ${expectedMacArch}-only`,
    );
  const macComputerControl = requireLargeFile(
    path.join(
      resourcesRoot,
      "computer-control",
      "darwin-universal",
      "oscode-computer-control.node",
    ),
    "Bundled macOS Computer Control addon",
    10_000,
  );
  const helperArchitectures = spawnSync(
    "lipo",
    ["-archs", macComputerControl],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (
    helperArchitectures.status !== 0 ||
    !/\bx86_64\b/.test(helperArchitectures.stdout) ||
    !/\barm64\b/.test(helperArchitectures.stdout)
  )
    throw new Error("macOS Computer Control addon is not universal");
  requireMacOs12Compatible(macComputerControl, "macOS Computer Control addon");
  const computerControlAddon = requireNativeModule(macComputerControl);
  if (
    typeof computerControlAddon.list !== "function" ||
    typeof computerControlAddon.isTrusted !== "function" ||
    typeof computerControlAddon.isScreenCaptureTrusted !== "function" ||
    typeof computerControlAddon.requestScreenCaptureAccess !== "function"
  )
    throw new Error("macOS Computer Control addon API is incomplete");
  let computerApplications;
  try {
    computerApplications = JSON.parse(computerControlAddon.list());
  } catch {
    throw new Error(
      "macOS Computer Control addon failed its local application-list check",
    );
  }
  if (!Array.isArray(computerApplications))
    throw new Error(
      "macOS Computer Control addon returned an invalid application list",
    );
  const packagedRuntimeArchitecture = `darwin-${expectedMacArch}`;
  const excludedRuntimeArchitecture =
    expectedMacArch === "arm64" ? "darwin-x64" : "darwin-arm64";
  for (const runtimeKind of ["uv", "python", "llama"])
    if (
      existsSync(
        path.join(resourcesRoot, runtimeKind, excludedRuntimeArchitecture),
      )
    )
      throw new Error(
        `${excludedRuntimeArchitecture} ${runtimeKind} must not be in the ${expectedMacArch} package`,
      );
  for (const architecture of [packagedRuntimeArchitecture]) {
    const cpuType = architecture.endsWith("arm64")
      ? [0x0c, 0x00, 0x00, 0x01]
      : [0x07, 0x00, 0x00, 0x01];
    const pty = nativeFiles.find((file) =>
      new RegExp(`prebuilds[\\\\/]${architecture}[\\\\/]pty\\.node$`, "i").test(
        file,
      ),
    );
    if (
      !pty ||
      !hasMagic(pty, [0xcf, 0xfa, 0xed, 0xfe]) ||
      !hasBytesAt(pty, 4, cpuType)
    )
      throw new Error(
        `macOS ${architecture} node-pty prebuild is missing or invalid`,
      );
    requireMacOs12Compatible(pty, `${architecture} node-pty prebuild`);
    const spawnHelper = requireLargeFile(
      path.join(path.dirname(pty), "spawn-helper"),
      `${architecture} node-pty spawn helper`,
      5_000,
    );
    if (
      !hasMagic(spawnHelper, [0xcf, 0xfa, 0xed, 0xfe]) ||
      !hasBytesAt(spawnHelper, 4, cpuType) ||
      (statSync(spawnHelper).mode & 0o111) === 0
    )
      throw new Error(`${architecture} node-pty spawn helper is invalid`);
    requireMacOs12Compatible(
      spawnHelper,
      `${architecture} node-pty spawn helper`,
    );
    const llamaRoot = path.join(resourcesRoot, "llama", architecture);
    const llama = requireLargeFile(
      path.join(llamaRoot, "llama-completion"),
      `Bundled ${architecture} llama.cpp command`,
      8_000,
    );
    const llamaCli = requireLargeFile(
      path.join(llamaRoot, "llama-mtmd-cli"),
      `Bundled ${architecture} llama.cpp multimodal command`,
      8_000,
    );
    if (
      !hasMagic(llama, [0xcf, 0xfa, 0xed, 0xfe]) ||
      !hasBytesAt(llama, 4, cpuType)
    )
      throw new Error(
        `${architecture} llama.cpp command is not a Mach-O binary`,
      );
    requireMacOs12Compatible(llama, `${architecture} llama.cpp command`);
    if (
      !hasMagic(llamaCli, [0xcf, 0xfa, 0xed, 0xfe]) ||
      !hasBytesAt(llamaCli, 4, cpuType)
    )
      throw new Error(
        `${architecture} llama.cpp multimodal command is not a Mach-O binary`,
      );
    requireMacOs12Compatible(
      llamaCli,
      `${architecture} llama.cpp multimodal command`,
    );
    if (existsSync(path.join(llamaRoot, "llama-server")))
      throw new Error(
        `The ${architecture} llama.cpp server executable must not be packaged`,
      );
    const uv = requireLargeFile(
      path.join(resourcesRoot, "uv", architecture, "uv"),
      `Bundled ${architecture} uv command`,
      5_000_000,
    );
    if (!hasMagic(uv, [0xcf, 0xfa, 0xed, 0xfe]) || !hasBytesAt(uv, 4, cpuType))
      throw new Error(`${architecture} uv command has the wrong architecture`);
    requireMacOs12Compatible(uv, `${architecture} uv command`);
    const pythons = pythonExecutables(
      path.join(resourcesRoot, "python", architecture),
    );
    for (const version of ["3.10", "3.11", "3.12"]) {
      const python = pythons.find(
        (candidate) =>
          candidate.includes(`cpython-${version}`) &&
          hasMagic(candidate, [0xcf, 0xfa, 0xed, 0xfe]) &&
          hasBytesAt(candidate, 4, cpuType),
      );
      if (!python)
        throw new Error(
          `Contained ${architecture} Python ${version} is missing`,
        );
      requireMacOs12Compatible(
        python,
        `Contained ${architecture} Python ${version}`,
      );
    }
  }
  const nativeLlamaRoot = path.join(
    resourcesRoot,
    "llama",
    packagedRuntimeArchitecture,
  );
  const nativeRuntimeTimeout =
    expectedMacArch === "x64" && process.arch === "arm64" ? 60_000 : 15_000;
  const nativeLlama = path.join(nativeLlamaRoot, "llama-completion");
  const nativeLlamaCli = path.join(nativeLlamaRoot, "llama-mtmd-cli");
  const nativeLlamaCheck = spawnSync(nativeLlama, ["--version"], {
    cwd: nativeLlamaRoot,
    encoding: "utf8",
    timeout: Math.max(30_000, nativeRuntimeTimeout),
  });
  if (
    nativeLlamaCheck.status !== 0 ||
    !/build\s+\d+/i.test(
      `${nativeLlamaCheck.stdout || ""}\n${nativeLlamaCheck.stderr || ""}`,
    )
  )
    throw new Error("Native macOS llama.cpp command failed its version check");
  const nativeLlamaCliCheck = spawnSync(nativeLlamaCli, ["--version"], {
    cwd: nativeLlamaRoot,
    encoding: "utf8",
    timeout: Math.max(30_000, nativeRuntimeTimeout),
  });
  if (
    nativeLlamaCliCheck.status !== 0 ||
    !/build\s+\d+/i.test(
      `${nativeLlamaCliCheck.stdout || ""}\n${nativeLlamaCliCheck.stderr || ""}`,
    )
  )
    throw new Error(
      "Native macOS llama.cpp multimodal command failed its version check",
    );
  const nativeUv = path.join(
    resourcesRoot,
    "uv",
    packagedRuntimeArchitecture,
    "uv",
  );
  const nativeUvCheck = spawnSync(nativeUv, ["--version"], {
    encoding: "utf8",
    timeout: nativeRuntimeTimeout,
  });
  if (nativeUvCheck.status !== 0 || !/^uv\s+\d+/i.test(nativeUvCheck.stdout))
    throw new Error("Native macOS uv command failed its version check");
  const nativePython = pythonExecutables(
    path.join(resourcesRoot, "python", packagedRuntimeArchitecture),
  );
  for (const version of ["3.10", "3.11", "3.12"]) {
    const ready = nativePython.some((python) => {
      const check = spawnSync(
        python,
        [
          "-c",
          "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')",
        ],
        {
          encoding: "utf8",
          timeout: nativeRuntimeTimeout,
          env: packagedPythonEnvironment,
        },
      );
      return check.status === 0 && check.stdout.trim() === version;
    });
    if (!ready) throw new Error(`Native macOS Python ${version} failed to run`);
  }
}

const expectedArtifactCount =
  platform === "linux" && !flags.includes("--deb-only") ? 2 : 1;
if (artifacts.length !== expectedArtifactCount)
  throw new Error(`${platform} release artifacts are incomplete`);
const asarModifiedAt = statSync(asar).mtimeMs;
for (const artifact of artifacts) {
  requireLargeFile(
    artifact,
    `${platform} ${path.extname(artifact)} artifact`,
    1_000_000,
  );
  if (
    platform !== "linux" &&
    statSync(artifact).mtimeMs + 5_000 < asarModifiedAt
  )
    throw new Error(
      `${platform} ${path.extname(artifact)} artifact is older than app.asar`,
    );
}

if (flags.includes("--run-smoke")) {
  const command = platform === "linux" ? "xvfb-run" : executable;
  const args =
    platform === "linux"
      ? ["-a", executable, "--no-sandbox", "--smoke-test"]
      : platform === "windows"
        ? ["--disable-gpu", "--smoke-test"]
        : ["--smoke-test"];
  const smokeMarker = path.join(path.dirname(executable), ".oschat-smoke-test");
  writeFileSync(smokeMarker, "smoke\n", { mode: 0o600 });
  const smoke = (() => {
    try {
      return spawnSync(command, args, { stdio: "inherit" });
    } finally {
      rmSync(smokeMarker, { force: true });
    }
  })();
  if (smoke.error) throw smoke.error;
  if (smoke.status !== 0)
    throw new Error(`Packaged ${platform} smoke test exited ${smoke.status}`);

  if (platform === "macos") {
    const signatureAfterSmoke = spawnSync(
      "codesign",
      ["--verify", "--deep", "--strict", appRoot],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (signatureAfterSmoke.status !== 0)
      throw new Error(
        `Packaged macOS smoke test mutated the signed app bundle: ${signatureAfterSmoke.stderr || signatureAfterSmoke.stdout}`,
      );
  }
}

console.log(
  JSON.stringify(
    {
      platform,
      architecture: platform === "macos" ? expectedMacArch : process.arch,
      executable: relative(executable),
      asarBytes: statSync(asar).size,
      nativeAddons: nativeFiles.map(relative),
      modelWeights: "downloaded on demand to application data",
      bundledGit: bundledGit ? relative(bundledGit) : "system package",
      artifacts: artifacts.map(relative),
      smoke: flags.includes("--run-smoke") ? "passed" : "not requested",
    },
    null,
    2,
  ),
);
