const fs = require("node:fs/promises");
const path = require("node:path");

const X64_ARCH = 1;
const ARM64_ARCH = 3;

/**
 * Add only the runtime tree matching this macOS package. The Computer Control
 * native addon stays universal because it is small and must execute inside the
 * osCode process so macOS applies the app's Accessibility permission to it.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const architecture =
    context.arch === ARM64_ARCH
      ? "arm64"
      : context.arch === X64_ARCH
        ? "x64"
        : "";
  if (!architecture)
    throw new Error(`Unsupported macOS package architecture: ${context.arch}`);

  const projectRoot = context.packager.projectDir;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const resourcesRoot = path.join(
    context.appOutDir,
    appName,
    "Contents",
    "Resources",
  );
  const target = `darwin-${architecture}`;
  const resources = [
    [`vendor/uv/${target}`, `uv/${target}`],
    [`vendor/python/${target}`, `python/${target}`],
    [`vendor/llama/${target}`, `llama/${target}`],
    ["vendor/llama/LICENSE", "llama/LICENSE"],
    [
      "vendor/computer-control/darwin-universal/oscode-computer-control.node",
      "computer-control/darwin-universal/oscode-computer-control.node",
    ],
  ];

  for (const [sourceRelative, destinationRelative] of resources) {
    const source = path.join(projectRoot, sourceRelative);
    const destination = path.join(resourcesRoot, destinationRelative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
  }

  console.log(
    `Added the Monterey-compatible ${architecture} macOS runtime tree`,
  );
};
