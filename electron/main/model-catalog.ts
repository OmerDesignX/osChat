import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import extractZip from "extract-zip";
import type { AiModelTier } from "../types.js";

export type DownloadableTier = Exclude<AiModelTier, "custom">;
export type CatalogRuntime = "llamacpp" | "mlx";
export type ModelRelease = "v1" | "v2";

type Variant = {
  runtime: CatalogRuntime;
  tier: DownloadableTier;
  repositoryPath: string;
  folder: string;
  bytes: number;
  shards: number;
};

export const modelRepository = "https://models.omerdesign.com/oscode-models";
export const defaultModelRelease: ModelRelease = "v2";

// Published Content-Length values: reject truncated or silently replaced archives.
const archiveBytes: Record<
  ModelRelease,
  Record<CatalogRuntime, Record<DownloadableTier, number>>
> = {
  v1: {
    llamacpp: {
      small: 2_663_066_338,
      medium: 3_444_921_439,
      large: 4_313_321_259,
    },
    mlx: { small: 2_810_409_773, medium: 3_518_857_995, large: 4_249_519_034 },
  },
  v2: {
    llamacpp: {
      small: 2_915_090_775,
      medium: 3_721_827_190,
      large: 4_656_349_013,
    },
    mlx: { small: 3_034_570_654, medium: 3_798_962_462, large: 4_585_902_742 },
  },
};

export const modelVariants: Variant[] = [
  {
    runtime: "llamacpp",
    tier: "small",
    repositoryPath: "GGUF/osCode-GGUF-Small-Q4_K_M-00001-of-00002.gguf",
    folder: "small",
    bytes: archiveBytes.v2.llamacpp.small,
    shards: 2,
  },
  {
    runtime: "llamacpp",
    tier: "medium",
    repositoryPath: "GGUF/osCode-GGUF-Medium-Q6_K-00001-of-00002.gguf",
    folder: "medium",
    bytes: archiveBytes.v2.llamacpp.medium,
    shards: 2,
  },
  {
    runtime: "llamacpp",
    tier: "large",
    repositoryPath: "GGUF/osCode-GGUF-Large-Q8_0-00001-of-00003.gguf",
    folder: "large",
    bytes: archiveBytes.v2.llamacpp.large,
    shards: 3,
  },
  {
    runtime: "mlx",
    tier: "small",
    repositoryPath: "MLX/osCode-MLX-Small-Q5",
    folder: "osCode-MLX-Small-Q5",
    bytes: archiveBytes.v2.mlx.small,
    shards: 21,
  },
  {
    runtime: "mlx",
    tier: "medium",
    repositoryPath: "MLX/osCode-MLX-Medium-Q6",
    folder: "osCode-MLX-Medium-Q6",
    bytes: archiveBytes.v2.mlx.medium,
    shards: 27,
  },
  {
    runtime: "mlx",
    tier: "large",
    repositoryPath: "MLX/osCode-MLX-Large-Q8",
    folder: "osCode-MLX-Large-Q8",
    bytes: archiveBytes.v2.mlx.large,
    shards: 34,
  },
];

export function archiveForVariant(
  variant: Variant,
  release: ModelRelease = defaultModelRelease,
) {
  const root =
    modelRepository + "/osModels-" + (release === "v1" ? "V1" : "V2") + "-D";
  const file =
    variant.runtime === "llamacpp"
      ? "GGUF/" + variant.tier[0].toUpperCase() + variant.tier.slice(1) + ".zip"
      : variant.repositoryPath + ".zip";
  return {
    url: root + "/" + file,
    bytes: archiveBytes[release][variant.runtime][variant.tier],
  };
}

function ggufFiles(variant: Variant) {
  const match = variant.repositoryPath.match(/^(.*)-00001-of-(\d{5})\.gguf$/i);
  if (!match || Number(match[2]) !== variant.shards)
    throw new Error("The shared GGUF catalogue is invalid");
  return Array.from(
    { length: variant.shards },
    (_, index) =>
      match[1] +
      "-" +
      String(index + 1).padStart(5, "0") +
      "-of-" +
      match[2] +
      ".gguf",
  );
}

function mlxFiles(variant: Variant) {
  const prefix = variant.repositoryPath;
  return [
    prefix + "/config.json",
    prefix + "/chat_template.jinja",
    prefix + "/model.safetensors.index.json",
    prefix + "/tokenizer.json",
    prefix + "/tokenizer_config.json",
    prefix + "/README.md",
    ...Array.from(
      { length: variant.shards },
      (_, index) =>
        prefix +
        "/model-" +
        String(index + 1).padStart(5, "0") +
        "-of-" +
        String(variant.shards).padStart(5, "0") +
        ".safetensors",
    ),
  ];
}

export function filesForVariant(variant: Variant) {
  return variant.runtime === "llamacpp"
    ? ggufFiles(variant)
    : mlxFiles(variant);
}

export function archiveFilesForVariant(
  variant: Variant,
  release: ModelRelease = defaultModelRelease,
) {
  const files = filesForVariant(variant).map((file) =>
    path.posix.basename(file),
  );
  if (release === "v1") return files;
  if (variant.runtime === "mlx")
    return [
      ...files,
      "model-vision-00001-of-00001.safetensors",
      "preprocessor_config.json",
      "video_preprocessor_config.json",
    ];
  const projector = {
    small: "osCode-GGUF-Small-mmproj-Q5_K_M.gguf",
    medium: "osCode-GGUF-Medium-mmproj-Q6_K.gguf",
    large: "osCode-GGUF-Large-mmproj-Q8_0.gguf",
  }[variant.tier];
  return [...files, projector];
}

type ZipEntry = {
  fileName: string;
  uncompressedSize: number;
  crc32: number;
  externalFileAttributes: number;
};

export function validateArchiveEntry(
  entry: ZipEntry,
  allowedFiles: ReadonlySet<string>,
) {
  const name = entry.fileName;
  if (
    !name ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.includes(":")
  )
    throw new Error("Unsafe model archive entry: " + name);
  const parts = name.replace(/^\.\//, "").split("/");
  if (
    parts.length > 6 ||
    parts.some(
      (part, index) =>
        part === "." || part === ".." || (!part && index !== parts.length - 1),
    )
  )
    throw new Error("Unsafe model archive entry: " + name);
  if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000)
    throw new Error("Model archive contains a symbolic link: " + name);
  if (name.endsWith("/")) return null;
  const basename = parts.at(-1)!;
  if (
    !allowedFiles.has(basename) ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 1 ||
    entry.uncompressedSize > 6 * 1024 ** 3
  )
    throw new Error("Unexpected model archive entry: " + name);
  return basename;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export async function verifiedCrc32(
  file: string,
  expectedSize: number,
  expectedCrc: number,
) {
  let size = 0;
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(file)) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    for (const byte of bytes)
      crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  if (size !== expectedSize || (crc ^ 0xffffffff) >>> 0 !== expectedCrc >>> 0)
    throw new Error(
      "Archive checksum verification failed for " + path.basename(file),
    );
}

async function downloadArchive(
  url: string,
  destination: string,
  expectedBytes: number,
  signal: AbortSignal,
  onProgress: (progress: number, file: string) => void,
) {
  const response = await fetch(url, {
    redirect: "follow",
    signal,
    headers: { "user-agent": "osChat-model-downloader" },
  });
  if (!response.ok || !response.body)
    throw new Error(
      "Could not download model archive (" + response.status + ")",
    );
  const length = Number(response.headers.get("content-length"));
  if (length && length !== expectedBytes)
    throw new Error("The published model archive size changed");
  let received = 0;
  const stream = Readable.fromWeb(response.body as never);
  stream.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > expectedBytes)
      stream.destroy(new Error("Model archive exceeds its expected size"));
    onProgress(
      Math.min(65, Math.floor((received / expectedBytes) * 65)),
      "Downloading model archive",
    );
  });
  await pipeline(stream, createWriteStream(destination, { flags: "wx" }), {
    signal,
  });
  if (received !== expectedBytes)
    throw new Error("The model archive download is incomplete");
}

export async function downloadModelVariant(options: {
  modelsRoot: string;
  runtime: CatalogRuntime;
  tier: DownloadableTier;
  release?: ModelRelease;
  signal: AbortSignal;
  onProgress: (progress: number, file: string) => void;
}) {
  const variant = modelVariants.find(
    (item) => item.runtime === options.runtime && item.tier === options.tier,
  );
  if (!variant) throw new Error("That osChat model is not available");
  const release = options.release || defaultModelRelease;
  const archive = archiveForVariant(variant, release);
  const required = archiveFilesForVariant(variant, release);
  const staging = path.join(
    options.modelsRoot,
    ".downloads",
    variant.runtime + "-" + variant.tier + "-" + randomUUID(),
  );
  const zipPath = path.join(staging, "model.zip");
  const unpacked = path.join(staging, "unpacked");
  const prepared = path.join(staging, "model");
  const finalDirectory = path.join(
    options.modelsRoot,
    variant.runtime === "llamacpp" ? "gguf" : "mlx",
    variant.folder,
  );
  const previous = finalDirectory + ".previous-" + randomUUID();
  let movedPrevious = false;
  let activated = false;
  try {
    await fs.mkdir(staging, { recursive: true });
    options.onProgress(0, "Downloading model archive");
    await downloadArchive(
      archive.url,
      zipPath,
      archive.bytes,
      options.signal,
      options.onProgress,
    );
    const allowed = new Set(required);
    const entries = new Map<string, ZipEntry>();
    let totalBytes = 0;
    await extractZip(zipPath, {
      dir: unpacked,
      onEntry: (entry) => {
        if (options.signal.aborted)
          throw new DOMException("Download stopped", "AbortError");
        const basename = validateArchiveEntry(entry, allowed);
        if (!basename) return;
        if (entries.has(basename))
          throw new Error("Duplicate model archive entry: " + basename);
        entries.set(basename, entry);
        totalBytes += entry.uncompressedSize;
        if (entries.size > required.length || totalBytes > 10 * 1024 ** 3)
          throw new Error("Model archive exceeds its expected contents");
        options.onProgress(
          65 + Math.floor((entries.size / required.length) * 20),
          "Extracting " + basename,
        );
      },
    });
    if (options.signal.aborted)
      throw new DOMException("Download stopped", "AbortError");
    if (
      entries.size !== required.length ||
      required.some((file) => !entries.has(file))
    )
      throw new Error(
        "The model archive is missing required shards or metadata",
      );
    await fs.mkdir(prepared);
    let verified = 0;
    for (const [basename, entry] of entries) {
      const extracted = path.join(unpacked, entry.fileName);
      await verifiedCrc32(extracted, entry.uncompressedSize, entry.crc32);
      await fs.rename(extracted, path.join(prepared, basename));
      verified += 1;
      options.onProgress(
        85 + Math.floor((verified / required.length) * 14),
        "Verifying " + basename,
      );
      if (options.signal.aborted)
        throw new DOMException("Download stopped", "AbortError");
    }
    await fs.writeFile(
      path.join(prepared, "OSCODE_MODEL.json"),
      JSON.stringify(
        {
          release,
          runtime: variant.runtime,
          tier: variant.tier,
          bytes: totalBytes,
          files: required,
          source: archive.url,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
    try {
      await fs.rename(finalDirectory, previous);
      movedPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.rename(prepared, finalDirectory);
      activated = true;
    } catch (error) {
      if (movedPrevious) await fs.rename(previous, finalDirectory);
      movedPrevious = false;
      throw error;
    }
    if (movedPrevious) await fs.rm(previous, { recursive: true, force: true });
    options.onProgress(100, "Ready");
    return {
      variant,
      path:
        variant.runtime === "llamacpp"
          ? path.join(finalDirectory, path.basename(variant.repositoryPath))
          : finalDirectory,
    };
  } finally {
    await fs
      .rm(staging, { recursive: true, force: true })
      .catch(() => undefined);
    if (!activated && movedPrevious)
      await fs.rename(previous, finalDirectory).catch(() => undefined);
  }
}
