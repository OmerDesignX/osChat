import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const target = path.join(root, "release");
if (path.dirname(target) !== root || path.basename(target) !== "release")
  throw new Error(`Refusing to clean unexpected path ${target}`);

async function makeWritable(directory) {
  const details = await fs.lstat(directory).catch(() => null);
  if (!details) return;
  if (!details.isDirectory() || details.isSymbolicLink())
    throw new Error(`Refusing to clean unexpected release path ${directory}`);
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink())
      await makeWritable(child);
    else if (!entry.isSymbolicLink()) await fs.chmod(child, 0o600);
  }
}

await makeWritable(target);
await fs.rm(target, { recursive: true, force: true });
console.log("Removed the intermediate release/ directory");
