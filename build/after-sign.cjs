const fs = require("node:fs/promises");
const path = require("node:path");

const X64_ARCH = 1;
const ARM64_ARCH = 3;

async function makeTreeReadOnly(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await makeTreeReadOnly(target);
      await fs.chmod(target, 0o555);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(target);
    await fs.chmod(target, stat.mode & 0o111 ? 0o555 : 0o444);
  }
  await fs.chmod(root, 0o555);
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const architecture =
    context.arch === ARM64_ARCH
      ? "arm64"
      : context.arch === X64_ARCH
        ? "x64"
        : "";
  if (!architecture)
    throw new Error(`Unsupported macOS package architecture: ${context.arch}`);

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const pythonRoot = path.join(
    context.appOutDir,
    appName,
    "Contents",
    "Resources",
    "python",
    `darwin-${architecture}`,
  );

  // Signing must finish before permissions are locked. Runtime bytecode is
  // redirected to app data; this is a second line of defence that prevents a
  // missed Python call from mutating the signed application installation.
  await makeTreeReadOnly(pythonRoot);
  console.log(`Locked the packaged ${architecture} Python runtime read-only`);
};
