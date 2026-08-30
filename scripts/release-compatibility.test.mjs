import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("release metadata keeps the requested desktop compatibility", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.devDependencies.electron, "^35.0.0");
  assert.equal(manifest.build.mac.minimumSystemVersion, "12.0");
  assert.deepEqual(manifest.build.mac.target, ["dmg"]);
  assert.equal(
    manifest.build.mac.artifactName,
    "osChat-${version}-mac-${arch}.${ext}",
  );
  assert.equal(manifest.build.mac.x64ArchFiles, undefined);
  assert.equal(
    manifest.build.win.artifactName,
    "osChat-Setup-${version}.${ext}",
  );
  assert.equal(manifest.build.nsis.differentialPackage, false);
  assert.ok(manifest.build.win.target[0].arch.includes("x64"));
  assert.equal(manifest.build.mac.icon, "build/icon-macos.icns");
  assert.equal(manifest.build.win.icon, "build/icon.png");
  assert.equal(manifest.build.linux.icon, "build/icon.png");

  const readme = read("README.md");
  assert.match(readme, /Windows 10[\s\S]*Windows 11/);
  assert.match(readme, /macOS 12 Monterey or newer/);
});

test("brand assets use the baby-blue palette and a production icon", () => {
  const css = read("src/styles.css").toLowerCase();
  assert.match(css, /--baby-200:\s*#89cff0/);
  assert.doesNotMatch(css, /#81d8d0|#55c9c0|tiffany/);

  const iconTargets = [
    ["assets/logo/oschat-icon-source.png", 1254, 2],
    ["assets/logo/oschat-icon.png", 1254, 6],
    ["src/assets/oschat-icon.png", 512, 6],
    ["build/icon.png", 1024, 6],
  ];
  for (const [relativePath, expectedSize, colorType] of iconTargets) {
    const icon = readFileSync(path.join(root, relativePath));
    assert.deepEqual(
      [...icon.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${relativePath} must be a PNG`,
    );
    assert.equal(icon.readUInt32BE(16), expectedSize, `${relativePath} width`);
    assert.equal(icon.readUInt32BE(20), expectedSize, `${relativePath} height`);
    assert.equal(icon.readUInt8(25), colorType, `${relativePath} color type`);
  }
  const macIcon = readFileSync(path.join(root, "build", "icon-macos.icns"));
  assert.equal(macIcon.subarray(0, 4).toString("ascii"), "icns");
  assert.match(read("scripts/update-app-icons.sh"), /CORNER_RATIO="0\.2185"/);
  assert.match(read("releaseScripts/macos/prepare-icon.sh"), /icon_512x512@2x/);
  assert.match(read("src/App.tsx"), /Search chats and workspaces/);
  assert.match(read("src/App.tsx"), /Documents/);
  assert.match(read("src/App.tsx"), /Spreadsheets/);
  assert.match(read("src/App.tsx"), /Presentations/);
});

test("native releases package local inference runtimes without model weights or a server", () => {
  const manifest = JSON.parse(read("package.json"));
  const windowsResources = manifest.build.win.extraResources;
  const macResources = manifest.build.mac.extraResources;
  const linuxResources = manifest.build.linux.extraResources.map(
    ({ from }) => from,
  );
  assert.deepEqual(macResources, []);
  const afterPack = read("build/after-pack.cjs");
  assert.match(afterPack, /context\.arch === ARM64_ARCH/);
  assert.match(afterPack, /context\.arch === X64_ARCH/);
  assert.match(afterPack, /`vendor\/llama\/\$\{target\}`/);
  assert.doesNotMatch(afterPack, /vendor\/models/);
  assert.deepEqual(
    windowsResources.find(({ from }) => from === "vendor/llama/win32-x64")
      ?.filter,
    [
      "llama-completion.exe",
      "llama-mtmd-cli.exe",
      "*.dll",
      "!llama-server-impl.dll",
    ],
  );
  assert.deepEqual(
    windowsResources.find(
      ({ from }) => from === "vendor/llama/win32-x64-vulkan",
    )?.filter,
    [
      "llama-completion.exe",
      "llama-mtmd-cli.exe",
      "*.dll",
      "OSCODE_RUNTIME.json",
    ],
  );
  assert.deepEqual(
    windowsResources.find(
      ({ from }) => from === "vendor/llama/win32-x64-cuda-13.3",
    )?.filter,
    [
      "llama-completion.exe",
      "llama-mtmd-cli.exe",
      "*.dll",
      "OSCODE_RUNTIME.json",
    ],
  );
  assert.deepEqual(
    windowsResources.find(
      ({ from }) => from === "vendor/llama/win32-x64-cuda-12.4",
    )?.filter,
    [
      "llama-completion.exe",
      "llama-mtmd-cli.exe",
      "*.dll",
      "OSCODE_RUNTIME.json",
    ],
  );
  assert.ok(linuxResources.includes("vendor/llama/linux-x64"));
  assert.ok(linuxResources.includes("vendor/llama/linux-x64-vulkan"));
  assert.ok(!linuxResources.some((value) => value.includes("vendor/models")));

  const snapConfig = read("build/electron-builder.linux-snap.cjs");
  assert.doesNotMatch(snapConfig, /vendor\/models/);
  const prepareLlama = read("scripts/prepare-llama.mjs");
  assert.match(prepareLlama, /llama-completion/);
  assert.match(prepareLlama, /llama-mtmd-cli/);
  assert.match(prepareLlama, /win32-x64-vulkan/);
  assert.match(prepareLlama, /llama-b10517-bin-win-cuda-12\.4-x64\.zip/);
  assert.match(prepareLlama, /llama-b10517-bin-win-cuda-13\.3-x64\.zip/);
  assert.match(
    prepareLlama,
    /e144d3291f4f2615ed9af1baa39b6f4777591188c31e18f0f0a8ba5e4cb1db13/,
  );
  assert.match(
    prepareLlama,
    /cbfac1e655d550df2515bac060b6410f9ed6aabc7df014353481608ac514b6dd/,
  );
  assert.doesNotMatch(prepareLlama, /cudart-llama-bin-win-cuda/);
  assert.doesNotMatch(prepareLlama, /keep[\s\S]*llama-server/);
  assert.match(prepareLlama, /llama-server-impl\.dll/);
  assert.match(
    prepareLlama,
    /CMAKE_OSX_DEPLOYMENT_TARGET=\$\{deploymentTarget\}/,
  );
  assert.match(prepareLlama, /deploymentTarget = "12\.0"/);
  assert.match(prepareLlama, /GGML_ACCELERATE=ON/);
  assert.match(prepareLlama, /GGML_METAL=ON/);
  assert.match(prepareLlama, /LLAMA_OPENSSL=OFF/);

  const aiService = read("electron/main/ai.ts");
  assert.match(
    aiService,
    /if \(hardware === "cpu"\) inferenceArguments\.push\("--gpu-layers", "0"\)/,
  );
  assert.doesNotMatch(aiService, /hardware === "cpu" \? "0" : "999"/);
  assert.match(aiService, /current\.acceleratorVersion\?\.startsWith\("12"\)/);
  const bundledModelRuntime = read("electron/main/bundled-models.ts");
  assert.match(bundledModelRuntime, /if \(left\.major === "12"\) return -1/);
  assert.match(
    read("scripts/verify-package.mjs"),
    /Bundled llama\.cpp CUDA \$\{cuda\.version\} command/,
  );
  assert.match(
    read("scripts/verify-package.mjs"),
    /NVIDIA CUDA runtime libraries must not be packaged/,
  );
  assert.match(read("scripts/verify-package.mjs"), /Server runtime artifacts/);
  assert.match(
    read("scripts/verify-package.mjs"),
    /requires macOS \$\{versions\.join\("\/"\)\}/,
  );
  assert.match(read("electron/main/bundled-models.ts"), /accelerator: "cuda"/);
  assert.match(read("electron/main/bundled-models.ts"), /cuda-system-/);
  assert.match(read("electron/main/bundled-models.ts"), /CUDA_PATH/);
  assert.match(read("electron/main/bundled-models.ts"), /nvidia-smi/);
  assert.match(read("electron/main/bundled-models.ts"), /cudaInstallSupported/);
  assert.match(read("electron/main/ai.ts"), /profile\.accelerator === "cuda"/);
  assert.match(read("electron/main/ai.ts"), /installCudaSupport/);
  assert.match(read("electron/main/ai.ts"), /cudart-llama-bin-win-cuda-12\.4/);
  assert.match(
    read("electron/main/ai.ts"),
    /download\.pytorch\.org\/whl\/\$\{pytorchCuda/,
  );
  assert.doesNotMatch(
    read("electron/main/ai.ts"),
    /hardware === "cpu" \? "0" : "999"/,
  );
  assert.match(
    read("electron/main/ai.ts"),
    /process\.platform.*process\.arch/s,
  );

  const preparePython = read("scripts/prepare-python.mjs");
  assert.match(preparePython, /\["darwin-arm64", "darwin-x64"\]/);
  assert.match(preparePython, /cpython-\$\{pythonVersion\}-macos-/);
  assert.match(preparePython, /makePythonAliasesPortable/);
  assert.match(preparePython, /fs\.symlink\(portableTarget/);
  assert.match(
    read("electron/main/index.ts"),
    /return path\.join\(root, `\$\{process\.platform\}-\$\{process\.arch\}`\)/,
  );
});

test("native Computer Control is local, permissioned, and packaged", () => {
  const manifest = JSON.parse(read("package.json"));
  const windowsResources = manifest.build.win.extraResources.map(
    ({ from }) => from,
  );
  const afterPack = read("build/after-pack.cjs");
  assert.equal(manifest.devDependencies["@microsoft/winappcli"], "0.5.0");
  assert.ok(
    windowsResources.includes("node_modules/@microsoft/winappcli/bin/win-x64"),
  );
  assert.match(afterPack, /darwin-universal\/oscode-computer-control\.node/);
  assert.match(afterPack, /const target = `darwin-\$\{architecture\}`/);
  const afterSign = read("build/after-sign.cjs");
  assert.equal(manifest.build.afterSign, "./build/after-sign.cjs");
  assert.match(afterSign, /makeTreeReadOnly/);
  assert.match(afterSign, /`darwin-\$\{architecture\}`/);

  const packageVerifier = read("scripts/verify-package.mjs");
  assert.match(packageVerifier, /PYTHONDONTWRITEBYTECODE: "1"/);
  assert.match(
    packageVerifier,
    /Packaged macOS smoke test mutated the signed app bundle/,
  );

  const pythonEnvironment = read("electron/main/python-environment.ts");
  assert.match(pythonEnvironment, /PYTHONPYCACHEPREFIX/);
  assert.match(
    read("electron/main/index.ts"),
    /pythonRuntimeEnvironment\(app\.getPath\("userData"\)\)/,
  );
  assert.match(read("electron/main/ai.ts"), /this\.pythonEnvironment\(\)/);

  const control = read("electron/main/agent-control.ts");
  assert.match(control, /WINAPP_CLI_TELEMETRY_OPTOUT: "1"/);
  assert.match(control, /DOTNET_CLI_TELEMETRY_OPTOUT: "1"/);
  assert.match(control, /UI Automation|nativeArgs\("invoke"/);
  assert.match(control, /Computer Control cannot operate terminals/);
  assert.match(control, /desktopCapturer\.getSources/);
  assert.match(control, /types: wholeDesktop \? \["screen"\] : \["window"\]/);
  assert.match(control, /systemPreferences\.getMediaAccessStatus\("screen"\)/);
  assert.match(control, /addon\.requestScreenCaptureAccess\(\)/);
  assert.match(
    control,
    /requestMacScreenCaptureAccess\(\)[\s\S]*desktopCapturer\.getSources/,
  );
  assert.match(control, /dialog\.showMessageBox/);
  assert.match(control, /ComputerSystemPermissionError/);
  assert.match(control, /phase: "permission"/);
  assert.match(control, /shell\.openExternal\(guidance\.settingsUrl\)/);
  assert.match(control, /openLinuxComputerSettings/);
  assert.match(control, /globalShortcut\.register\("Esc"/);
  assert.match(control, /monitorForegroundPointer/);
  assert.match(control, /systemPreferences\.isTrustedAccessibilityClient/);
  assert.match(control, /requireNativeModule\(addonPath\)/);
  assert.match(read("electron/main/index.ts"), /app\.setBadgeCount/);
  assert.match(read("electron/main/index.ts"), /setOverlayIcon/);
  assert.match(
    read("native/computer-control/macos-addon/addon.mm"),
    /kAXPressAction/,
  );
  assert.match(
    read("native/computer-control/macos-addon/addon.mm"),
    /AXIsProcessTrustedWithOptions/,
  );
  assert.match(
    read("native/computer-control/macos-addon/addon.mm"),
    /CGPreflightScreenCaptureAccess/,
  );
  assert.match(
    read("native/computer-control/macos-addon/addon.mm"),
    /CGRequestScreenCaptureAccess/,
  );
  const macComputerControl = read(
    "native/computer-control/macos-addon/addon.mm",
  );
  assert.match(macComputerControl, /kAXSubroleAttribute/);
  assert.match(macComputerControl, /kAXPlaceholderValueAttribute/);
  assert.match(macComputerControl, /SemanticControlText/);
  assert.match(macComputerControl, /CGEventCreateMouseEvent/);
  assert.match(macComputerControl, /CGEventKeyboardSetUnicodeString/);
  assert.match(macComputerControl, /kAXFocusedAttribute/);
  assert.match(control, /nativeInputMethod\(output\) === "mouse"/);
  assert.match(control, /nativeInputMethod\(output\) === "keyboard"/);
  assert.match(
    read("native/computer-control/macos-addon/addon.mm"),
    /NAPI_MODULE_INIT/,
  );
  assert.match(
    read("scripts/prepare-computer-control.mjs"),
    /-mmacosx-version-min=12\.0/,
  );
  assert.match(
    read("scripts/prepare-computer-control.mjs"),
    /"arm64"[\s\S]*"-arch"[\s\S]*"x86_64"/,
  );
  assert.match(read("scripts/build-macos-release.mjs"), /computer:prepare/);
});

test("manual release build preserves the verified native package pipeline", () => {
  assert.equal(
    existsSync(path.join(root, ".github", "workflows", "build.yml")),
    false,
  );
  const macBuild = read("scripts/build-macos-release.mjs");
  for (const command of [
    "release:check-disk",
    "format:check",
    "python:prepare",
    "llama:prepare",
    "terminal:prepare",
    "computer:prepare",
    "native:check",
    "release:stage:macos",
  ])
    assert.match(macBuild, new RegExp(command));
  assert.match(macBuild, /\["arm64", "x64"\]/);
  assert.match(macBuild, /`--\$\{architecture\}`/);
  assert.doesNotMatch(macBuild, /--universal/);
  assert.match(macBuild, /verify-package\.mjs[\s\S]*"macos"/);
  assert.match(macBuild, /OSCODE_REQUIRE_SIGNED/);
  assert.match(macBuild, /OSCODE_ALLOW_UNSIGNED: requireSigned \? "0" : "1"/);
  assert.match(macBuild, /--config\.mac\.identity=-/);
  assert.match(macBuild, /--config\.mac\.hardenedRuntime=false/);
  assert.match(macBuild, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(macBuild, /makeDirectoriesWritable/);
  assert.match(macBuild, /removeGeneratedRelease\(packageDirectory\)/);
  const packageVerifier = read("scripts/verify-package.mjs");
  assert.match(packageVerifier, /Signature=adhoc/);
  assert.match(packageVerifier, /--verify", "--deep", "--strict"/);
  assert.match(packageVerifier, /requireNativeModule\(macComputerControl\)/);
  assert.match(packageVerifier, /computerControlAddon\.list\(\)/);
  assert.match(packageVerifier, /computerControlAddon\.isScreenCaptureTrusted/);
  assert.match(
    packageVerifier,
    /computerControlAddon\.requestScreenCaptureAccess/,
  );
  assert.match(
    packageVerifier,
    /expectedMacArch === "x64" && process\.arch === "arm64" \? 60_000 : 15_000/,
  );
  const macWrapper = read("releaseScripts/macos/build.sh");
  assert.doesNotMatch(macWrapper, /Developer ID Application/);
  assert.doesNotMatch(macWrapper, /find-identity/);
  assert.match(
    read("docs/RELEASING.md"),
    /bash releaseScripts\/macos\/build\.sh/,
  );
  assert.equal(
    read("releaseScripts/VERSION.txt").trim(),
    JSON.parse(read("package.json")).version,
  );
  assert.match(
    read("releaseScripts/windows/build-windows.cmd"),
    /build-windows\.ps1/,
  );
  assert.match(
    read("releaseScripts/windows/build-windows.ps1"),
    /build-windows\.sh/,
  );
  assert.match(read("releaseScripts/linux/build.sh"), /--linux deb --x64/);
  assert.match(read(".gitignore"), /^\/release\/$/m);

  const stageNative = read("scripts/stage-native-release.mjs");
  assert.match(
    stageNative,
    /`osChat-\$\{manifest\.version\}-mac-\$\{architecture\}\.dmg`/,
  );
  assert.doesNotMatch(
    stageNative,
    /latest-mac|SHA256SUMS|manifest\.json|\.zip/,
  );
  const stageWindows = read("scripts/stage-windows-release.mjs");
  assert.match(stageWindows, /`osChat-Setup-\$\{manifest\.version\}\.exe`/);
  assert.doesNotMatch(
    stageWindows,
    /blockmap|latest\.yml|SHA256SUMS|manifest\.json/i,
  );
  const upload = read("scripts/upload-release-assets.mjs");
  assert.match(upload, /2 \* 1024 \* 1024 \* 1024/);
  assert.match(upload, /https:\/\/api\.github\.com\/repos/);
  assert.match(upload, /https:\/\/uploads\.github\.com\/repos/);
  assert.match(upload, /refusing to replace public assets/);
  assert.doesNotMatch(upload, /spawnSync\("gh"/);

  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.dependencies["electron-updater"], undefined);
  assert.equal(manifest.build.publish, undefined);
  assert.match(read("electron/main/updater.ts"), /updateChannelApiUrl/);
  assert.match(read("electron/main/updater-policy.ts"), /OmerDesignX\/osChat/);
  assert.match(read("electron/main/updater-policy.ts"), /releases\/tags/);
  assert.match(read("electron/main/updater.ts"), /sha256:/i);
  assert.match(read("electron/main/updater.ts"), /installReadyUpdate/);
  assert.match(read("electron/main/updater.ts"), /downloadAvailable/);
  assert.match(read("electron/main/updater.ts"), /ready-update\.json/);
  assert.doesNotMatch(
    read("electron/main/index.ts"),
    /before-quit[\s\S]{0,1800}installReadyUpdate/,
  );
  assert.match(
    read("scripts/verify-package.mjs"),
    /\^osChat-Setup-.\+\\\.exe\$/,
  );
  assert.match(read("scripts/verify-package.mjs"), /\\\.dmg\$/);
  assert.match(
    read("scripts/verify-package.mjs"),
    /platform === "macos" \? 10_000 : 1_000_000/,
  );
  assert.match(
    read("scripts/verify-package.mjs"),
    /Authority=Developer ID Application:/,
  );
  assert.match(
    read("electron/main/index.ts"),
    /app\.commandLine\.hasSwitch\("smoke-test"\)/,
  );
  assert.match(
    read("electron/main/index.ts"),
    /smokeMode\s*\? processKeyProtector\(userData\)/,
  );
  const main = read("electron/main/index.ts");
  assert.match(main, /if \(!smokeMode\)[\s\S]*archiveLegacySecureStore/);
  assert.match(
    main,
    /smokeMode\s*\? processKeyProtector\(userData\)\s*:\s*appLocalKeyProtector\(\)/,
  );
  assert.doesNotMatch(main, /backend:\s*"DPAPI"/);
  assert.doesNotMatch(main, /safeStorage/);
  assert.doesNotMatch(main, /decryptString|encryptString/);
  assert.doesNotMatch(main, /osCode refuses Electron's unprotected basic_text/);
});

test("model tiers are downloaded on demand from the separate verified catalogue", () => {
  const catalogue = read("electron/main/model-catalog.ts");
  assert.match(catalogue, /OmerDesignX\/osCode-Models/);
  assert.match(catalogue, /SHA256SUMS/);
  assert.match(catalogue, /Checksum verification failed/);
  assert.match(catalogue, /\.downloads/);
  assert.match(catalogue, /fs\.rename\(staging, finalDirectory\)/);
  for (const tier of ["small", "medium", "large"])
    assert.match(catalogue, new RegExp(`tier: "${tier}"`));

  const manifest = JSON.parse(read("package.json"));
  for (const platform of ["mac", "win", "linux"])
    assert.ok(
      !manifest.build[platform].extraResources.some(({ from }) =>
        from.includes("vendor/models"),
      ),
    );
  assert.doesNotMatch(read("build/after-pack.cjs"), /vendor\/models/);
  assert.equal(manifest.build.nsis.include, undefined);
});
