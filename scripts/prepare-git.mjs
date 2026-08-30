import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const version = "2.55.0.3";
const archiveName = `MinGit-${version}-64-bit.zip`;
const archiveUrl = `https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/${archiveName}`;
const expectedSha256 =
  "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05";
const vendorRoot = path.resolve("vendor", "git");
const target = path.join(vendorRoot, "win32-x64");
const marker = path.join(target, ".oscode-mingit-version");
const executable = path.join(target, "cmd", "git.exe");

if (process.platform !== "win32") {
  console.log("Bundled MinGit preparation is only needed on Windows");
  process.exit(0);
}

if (
  existsSync(executable) &&
  (await readFile(marker, "utf8").catch(() => "")) === version
) {
  console.log(`MinGit ${version} is ready`);
  process.exit(0);
}

await mkdir(vendorRoot, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), "oscode-mingit-"));
const archive = path.join(temporary, archiveName);
const extracted = path.join(temporary, "extracted");

try {
  const response = await fetch(archiveUrl, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`MinGit download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256)
    throw new Error("MinGit checksum did not match the pinned release");
  await writeFile(archive, bytes);
  await mkdir(extracted);
  const unpack = spawnSync("tar", ["-xf", archive, "-C", extracted], {
    stdio: "inherit",
  });
  if (unpack.error) throw unpack.error;
  if (unpack.status !== 0)
    throw new Error(`MinGit extraction exited ${unpack.status}`);
  if (!existsSync(path.join(extracted, "cmd", "git.exe")))
    throw new Error("The MinGit archive did not contain cmd/git.exe");
  await rm(target, { recursive: true, force: true });
  await rename(extracted, target);
  await writeFile(marker, version, "utf8");
  console.log(`Prepared MinGit ${version} (${actualSha256})`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
