import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const versionFile = path.join(root, "releaseScripts", "VERSION.txt");
const packageFile = path.join(root, "package.json");
const version = (await fs.readFile(versionFile, "utf8")).trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error(
    "releaseScripts/VERSION.txt must contain one semantic version such as 0.1.1",
  );

const manifest = JSON.parse(await fs.readFile(packageFile, "utf8"));
if (manifest.name !== "oschat")
  throw new Error(`Refusing to update an unexpected package at ${packageFile}`);

if (manifest.version !== version) {
  manifest.version = version;
  await fs.writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated package.json to ${version}`);
} else {
  console.log(`Version ${version} is already synchronized`);
}
