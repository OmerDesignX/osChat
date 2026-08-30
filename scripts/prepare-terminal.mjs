import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

if (process.platform === "win32") {
  process.stdout.write(
    "node-pty uses Windows native modules without a spawn helper\n",
  );
  process.exit(0);
}

const targets =
  process.platform === "darwin"
    ? ["darwin-arm64", "darwin-x64"]
    : [`${process.platform}-${process.arch}`];

for (const target of targets) {
  const helper = path.resolve(
    "node_modules",
    "node-pty",
    "prebuilds",
    target,
    "spawn-helper",
  );
  if (!(await stat(helper)).isFile())
    throw new Error(`node-pty ${target} spawn helper is missing`);
  await chmod(helper, 0o755);
  process.stdout.write(`Prepared node-pty ${target} spawn helper\n`);
}
