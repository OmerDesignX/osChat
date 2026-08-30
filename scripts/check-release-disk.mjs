import { statfs } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const minimumGiB = Number(process.env.OSCODE_RELEASE_MIN_FREE_GIB || "20");
if (!Number.isFinite(minimumGiB) || minimumGiB < 10)
  throw new Error("OSCODE_RELEASE_MIN_FREE_GIB must be at least 10");

const disk = await statfs(root, { bigint: true });
const freeBytes = disk.bavail * disk.bsize;
const freeGiB = Number(freeBytes / 1024n / 1024n / 1024n);
if (freeBytes < BigInt(Math.ceil(minimumGiB * 1024 ** 3)))
  throw new Error(
    `Native releases require ${minimumGiB} GiB free; this runner has about ${freeGiB} GiB`,
  );

console.log(`Release disk check passed: about ${freeGiB} GiB free`);
