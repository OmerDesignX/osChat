import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AiModelTier } from "../types.js";

export type DownloadableTier = Exclude<AiModelTier, "custom">;
export type CatalogRuntime = "llamacpp" | "mlx";

type Variant = {
  runtime: CatalogRuntime;
  tier: DownloadableTier;
  repositoryPath: string;
  folder: string;
  bytes: number;
  shards: number;
};

type PublishedVariant = {
  runtime?: unknown;
  tier?: unknown;
  path?: unknown;
  bytes?: unknown;
  files?: unknown;
  modalities?: unknown;
};

function publishedFiles(variant: Variant, published: PublishedVariant) {
  if (!Array.isArray(published.files)) return filesForVariant(variant);
  const files = published.files
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (!files.length || files.length > 1_000)
    throw new Error("The published model file list is invalid");
  const allowedPrefix =
    variant.runtime === "mlx"
      ? `${variant.repositoryPath}/`
      : `${path.posix.dirname(variant.repositoryPath)}/`;
  if (
    files.some(
      (file) =>
        !file.startsWith(allowedPrefix) ||
        file.includes("../") ||
        file.endsWith("/"),
    )
  )
    throw new Error("The published model file list leaves its model folder");
  const required = filesForVariant(variant);
  if (required.some((file) => !files.includes(file)))
    throw new Error("The published model file list is incomplete");
  return [...new Set(files)];
}

const repository = "https://github.com/OmerDesignX/osCode-Models";
const rawRepository = `${repository}/raw/refs/heads/main`;
const rawTextRepository =
  "https://raw.githubusercontent.com/OmerDesignX/osCode-Models/main";

export const modelVariants: Variant[] = [
  {
    runtime: "llamacpp",
    tier: "small",
    repositoryPath: "GGUF/osCode-GGUF-Small-Q4_K_M-00001-of-00002.gguf",
    folder: "small",
    bytes: 2_708_804_288,
    shards: 2,
  },
  {
    runtime: "llamacpp",
    tier: "medium",
    repositoryPath: "GGUF/osCode-GGUF-Medium-Q6_K-00001-of-00002.gguf",
    folder: "medium",
    bytes: 3_464_055_456,
    shards: 2,
  },
  {
    runtime: "llamacpp",
    tier: "large",
    repositoryPath: "GGUF/osCode-GGUF-Large-Q8_0-00001-of-00003.gguf",
    folder: "large",
    bytes: 4_482_403_136,
    shards: 3,
  },
  {
    runtime: "mlx",
    tier: "small",
    repositoryPath: "MLX/osCode-MLX-Small-Q5",
    folder: "osCode-MLX-Small-Q5",
    bytes: 2_912_931_406,
    shards: 21,
  },
  {
    runtime: "mlx",
    tier: "medium",
    repositoryPath: "MLX/osCode-MLX-Medium-Q6",
    folder: "osCode-MLX-Medium-Q6",
    bytes: 3_701_329_697,
    shards: 27,
  },
  {
    runtime: "mlx",
    tier: "large",
    repositoryPath: "MLX/osCode-MLX-Large-Q8",
    folder: "osCode-MLX-Large-Q8",
    bytes: 4_489_728_089,
    shards: 34,
  },
];

function encodedRepositoryPath(value: string) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function ggufFiles(variant: Variant) {
  const match = variant.repositoryPath.match(/^(.*)-00001-of-(\d{5})\.gguf$/i);
  if (!match || Number(match[2]) !== variant.shards)
    throw new Error("The shared GGUF catalogue is invalid");
  return Array.from(
    { length: variant.shards },
    (_, index) =>
      `${match[1]}-${String(index + 1).padStart(5, "0")}-of-${match[2]}.gguf`,
  );
}

function mlxFiles(variant: Variant) {
  const prefix = variant.repositoryPath;
  return [
    `${prefix}/config.json`,
    `${prefix}/chat_template.jinja`,
    `${prefix}/model.safetensors.index.json`,
    `${prefix}/tokenizer.json`,
    `${prefix}/tokenizer_config.json`,
    `${prefix}/README.md`,
    ...Array.from(
      { length: variant.shards },
      (_, index) =>
        `${prefix}/model-${String(index + 1).padStart(5, "0")}-of-${String(variant.shards).padStart(5, "0")}.safetensors`,
    ),
  ];
}

export function filesForVariant(variant: Variant) {
  return variant.runtime === "llamacpp"
    ? ggufFiles(variant)
    : mlxFiles(variant);
}

async function fetchText(
  relative: "release.json" | "SHA256SUMS",
  signal: AbortSignal,
) {
  const response = await fetch(`${rawTextRepository}/${relative}`, {
    redirect: "follow",
    signal,
    headers: { "user-agent": "osChat-model-downloader" },
  });
  if (!response.ok)
    throw new Error(`Model catalogue request failed (${response.status})`);
  return response.text();
}

function checksums(raw: string) {
  const result = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\.\/(.+)$/i);
    if (match) result.set(match[2].replace(/\\/g, "/"), match[1].toLowerCase());
  }
  return result;
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadFile(
  repositoryPath: string,
  destination: string,
  signal: AbortSignal,
  onChunk: (bytes: number) => void,
) {
  const response = await fetch(
    `${rawRepository}/${encodedRepositoryPath(repositoryPath)}`,
    {
      redirect: "follow",
      signal,
      headers: { "user-agent": "osChat-model-downloader" },
    },
  );
  if (!response.ok || !response.body)
    throw new Error(
      `Could not download ${path.basename(repositoryPath)} (${response.status})`,
    );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const stream = Readable.fromWeb(response.body as never);
  stream.on("data", (chunk: Buffer) => onChunk(chunk.length));
  await pipeline(stream, createWriteStream(destination, { flags: "wx" }), {
    signal,
  });
}

export async function downloadModelVariant(options: {
  modelsRoot: string;
  runtime: CatalogRuntime;
  tier: DownloadableTier;
  signal: AbortSignal;
  onProgress: (progress: number, file: string) => void;
}) {
  const variant = modelVariants.find(
    (item) => item.runtime === options.runtime && item.tier === options.tier,
  );
  if (!variant) throw new Error("That osChat model is not available");
  const staging = path.join(
    options.modelsRoot,
    ".downloads",
    `${variant.runtime}-${variant.tier}-${randomUUID()}`,
  );
  let activated = false;
  try {
    await fs.mkdir(staging, { recursive: true });
    options.onProgress(0, "Checking model catalogue");
    const [releaseText, checksumText] = await Promise.all([
      fetchText("release.json", options.signal),
      fetchText("SHA256SUMS", options.signal),
    ]);
    const release = JSON.parse(releaseText) as {
      release?: unknown;
      variants?: PublishedVariant[];
    };
    const published = release.variants?.find(
      (item) =>
        String(item.runtime).toLowerCase() ===
          (variant.runtime === "llamacpp" ? "llama.cpp" : "mlx") &&
        item.tier === variant.tier,
    );
    const publishedBytes = Number(published?.bytes);
    if (
      !/^\d+(?:\.\d+)?$/.test(String(release.release || "")) ||
      published?.path !== variant.repositoryPath ||
      !Number.isSafeInteger(publishedBytes) ||
      publishedBytes < 1_000_000 ||
      publishedBytes > 100 * 1024 ** 3
    )
      throw new Error(
        "The published model catalogue does not match this osChat release",
      );
    const expected = checksums(checksumText);
    const files = publishedFiles(variant, published!);
    let received = 0;
    for (const repositoryPath of files) {
      if (options.signal.aborted)
        throw new DOMException("Download stopped", "AbortError");
      const relative =
        variant.runtime === "llamacpp"
          ? path.basename(repositoryPath)
          : repositoryPath.slice(variant.repositoryPath.length + 1);
      const destination = path.join(staging, relative);
      options.onProgress(
        Math.min(99, Math.floor((received / publishedBytes) * 100)),
        path.basename(repositoryPath),
      );
      await downloadFile(
        repositoryPath,
        destination,
        options.signal,
        (bytes) => {
          received += bytes;
          options.onProgress(
            Math.min(99, Math.floor((received / publishedBytes) * 100)),
            path.basename(repositoryPath),
          );
        },
      );
      const expectedHash = expected.get(repositoryPath);
      if (!expectedHash || (await hashFile(destination)) !== expectedHash)
        throw new Error(
          `Checksum verification failed for ${path.basename(repositoryPath)}`,
        );
    }
    const finalDirectory = path.join(
      options.modelsRoot,
      variant.runtime === "llamacpp" ? "gguf" : "mlx",
      variant.folder,
    );
    await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
    await fs.rm(finalDirectory, { recursive: true, force: true });
    await fs.writeFile(
      path.join(staging, "OSCODE_MODEL.json"),
      `${JSON.stringify(
        {
          release: String(release.release),
          runtime: variant.runtime,
          tier: variant.tier,
          bytes: publishedBytes,
          files: files.map((file) =>
            variant.runtime === "llamacpp"
              ? path.basename(file)
              : file.slice(variant.repositoryPath.length + 1),
          ),
          modalities: published.modalities,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await fs.rename(staging, finalDirectory);
    activated = true;
    options.onProgress(100, "Ready");
    return {
      variant,
      path:
        variant.runtime === "llamacpp"
          ? path.join(finalDirectory, path.basename(variant.repositoryPath))
          : finalDirectory,
    };
  } finally {
    if (!activated)
      await fs
        .rm(staging, { recursive: true, force: true })
        .catch(() => undefined);
  }
}

export const modelRepository = repository;
