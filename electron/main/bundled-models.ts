import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AiHardwareProfile, AiModel, AiModelTier } from "../types.js";
import { modelVariants } from "./model-catalog.js";

const exec = promisify(execFile);
const tiers: Array<Exclude<AiModelTier, "custom">> = [
  "small",
  "medium",
  "large",
];
const osCodeContextLimit = 262_144;

export function defaultBuiltInContext(
  _engine: "llamacpp" | "mlx",
  maximum = osCodeContextLimit,
) {
  return maximum;
}

async function mlxContextLimit(directory: string) {
  try {
    const config = JSON.parse(
      await fs.readFile(path.join(directory, "config.json"), "utf8"),
    ) as { max_position_embeddings?: unknown };
    const limit = Number(config.max_position_embeddings);
    return Number.isInteger(limit) && limit >= 8_192
      ? Math.min(osCodeContextLimit, limit)
      : osCodeContextLimit;
  } catch {
    return osCodeContextLimit;
  }
}

async function directoryBytes(directory: string) {
  let total = 0;
  const visit = async (current: string) => {
    const entries = await fs
      .readdir(current, { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) total += (await fs.stat(full)).size;
    }
  };
  await visit(directory);
  return total;
}

function requiredMemory(tier: Exclude<AiModelTier, "custom">, bytes: number) {
  const floor =
    tier === "small"
      ? 8 * 1024 ** 3
      : tier === "medium"
        ? 12 * 1024 ** 3
        : 16 * 1024 ** 3;
  return Math.max(floor, bytes * 1.35 + 3 * 1024 ** 3);
}

export function mlxRuntimeSupported(
  platform = process.platform,
  arch = process.arch,
  release = os.release(),
) {
  if (platform !== "darwin" || arch !== "arm64") return false;
  const darwinMajor = Number.parseInt(release.split(".", 1)[0] || "0", 10);
  return Number.isFinite(darwinMajor) && darwinMajor >= 23;
}

export function localAiEngine(
  platform = process.platform,
  arch = process.arch,
  release = os.release(),
) {
  return mlxRuntimeSupported(platform, arch, release) ? "mlx" : "llamacpp";
}

async function findGguf(directory: string, tier: string) {
  const matches: string[] = [];
  const visit = async (current: string, depth: number) => {
    if (depth > 3) return;
    const entries = await fs
      .readdir(current, { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full, depth + 1);
      else if (
        entry.isFile() &&
        new RegExp(
          `osCode-GGUF-${tier}-.*(?:-00001-of-\\d{5})?\\.gguf$`,
          "i",
        ).test(entry.name)
      )
        matches.push(full);
    }
  };
  await visit(directory, 0);
  return matches[0] || "";
}

async function findMlx(
  directory: string,
  variant: (typeof modelVariants)[number],
) {
  const modelRoot = path.join(directory, variant.folder);
  const required = [
    "config.json",
    "chat_template.jinja",
    "model.safetensors.index.json",
    "tokenizer.json",
    "tokenizer_config.json",
  ];
  const ready = await Promise.all(
    required.map((file) =>
      fs
        .stat(path.join(modelRoot, file))
        .then((value) => value.isFile() && value.size > 0)
        .catch(() => false),
    ),
  );
  if (ready.some((value) => !value)) return "";
  try {
    const index = JSON.parse(
      await fs.readFile(
        path.join(modelRoot, "model.safetensors.index.json"),
        "utf8",
      ),
    ) as { weight_map?: Record<string, unknown> };
    const referenced = new Set(
      Object.values(index.weight_map || {}).filter(
        (value): value is string => typeof value === "string",
      ),
    );
    const expectedShards = [...referenced];
    if (
      !expectedShards.length ||
      expectedShards.some(
        (file) => path.basename(file) !== file || file.includes(".."),
      ) ||
      !(await Promise.all(
        expectedShards.map((file) =>
          fs
            .stat(path.join(modelRoot, file))
            .then((value) => value.isFile() && value.size > 0)
            .catch(() => false),
        ),
      ).then((values) => values.every(Boolean)))
    )
      return "";
  } catch {
    return "";
  }
  return modelRoot;
}

export async function bundledModels(modelsRoot: string): Promise<AiModel[]> {
  const engine = localAiEngine();
  const memoryBytes = os.totalmem();
  const results: AiModel[] = [];
  for (const tier of tiers) {
    const catalog = modelVariants.find(
      (item) => item.runtime === engine && item.tier === tier,
    );
    if (!catalog) continue;
    const installedPath =
      engine === "llamacpp"
        ? await findGguf(path.join(modelsRoot, "gguf"), tier)
        : await findMlx(path.join(modelsRoot, "mlx"), catalog);
    const bytes = installedPath
      ? engine === "llamacpp"
        ? await directoryBytes(path.dirname(installedPath))
        : await directoryBytes(installedPath)
      : catalog.bytes;
    const supported = memoryBytes >= requiredMemory(tier, bytes);
    const installed = Boolean(installedPath);
    results.push({
      id: `oscode:${engine}:${tier}`,
      name: `osChat ${tier[0].toUpperCase()}${tier.slice(1)}`,
      engine,
      path: installedPath || `catalog:${engine}:${tier}`,
      source: installed ? "downloaded" : "available",
      tier,
      bytes: installed ? bytes : undefined,
      downloadBytes: catalog.bytes,
      installed,
      supported,
      contextLimit: osCodeContextLimit,
      preferredContext: defaultBuiltInContext(engine),
      supportReason: supported
        ? undefined
        : `Needs about ${Math.ceil(requiredMemory(tier, bytes) / 1024 ** 3)} GB memory`,
    });
    if (installed && engine === "mlx") {
      results.at(-1)!.contextLimit = await mlxContextLimit(installedPath);
      results.at(-1)!.preferredContext = results.at(-1)!.contextLimit;
    }
  }
  return results;
}

function executableNames() {
  return process.platform === "win32"
    ? ["llama-completion.exe", "llama-mtmd-cli.exe"]
    : ["llama-completion", "llama-mtmd-cli", "llama"];
}

type AcceleratorCandidate = {
  root: string;
  accelerator: AiHardwareProfile["accelerator"];
  version?: string;
  runtimeBin?: string;
};

type CudaToolkit = {
  major: string;
  version: string;
  bin: string;
};

function versionParts(version = "") {
  return version
    .split(".")
    .slice(0, 3)
    .map((part) => Number(part.replace(/\D.*/, "")) || 0);
}

function versionAtLeast(version: string | undefined, minimum: string) {
  const left = versionParts(version);
  const right = versionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}

type NvidiaProfile = {
  name: string;
  driverVersion: string;
  cudaVersion: string;
};

async function nvidiaProfile(): Promise<NvidiaProfile | null> {
  if (process.platform !== "win32" && process.platform !== "linux") return null;
  try {
    const [query, banner] = await Promise.all([
      exec(
        process.platform === "win32" ? "nvidia-smi.exe" : "nvidia-smi",
        ["--query-gpu=name,driver_version", "--format=csv,noheader"],
        { timeout: 8_000, windowsHide: true },
      ),
      exec(process.platform === "win32" ? "nvidia-smi.exe" : "nvidia-smi", [], {
        timeout: 8_000,
        windowsHide: true,
      }),
    ]);
    const [name = "NVIDIA GPU", driverVersion = ""] = query.stdout
      .split(/\r?\n/, 1)[0]
      .split(",")
      .map((value) => value.trim());
    const cudaVersion = `${banner.stdout}\n${banner.stderr}`.match(
      /CUDA Version:\s*([0-9.]+)/i,
    )?.[1];
    return { name, driverVersion, cudaVersion: cudaVersion || "" };
  } catch {
    return null;
  }
}

async function cudaToolkits(acceleratorRoot?: string): Promise<CudaToolkit[]> {
  if (process.platform !== "win32") return [];
  const candidates = new Set<string>();
  for (const [name, value] of Object.entries(process.env))
    if (/^CUDA_PATH(?:_V\d+_\d+)?$/i.test(name) && value)
      candidates.add(path.resolve(value, "bin"));
  for (const entry of (process.env.Path || process.env.PATH || "").split(";"))
    if (entry.trim()) candidates.add(path.resolve(entry.trim()));
  const toolkitRoot = path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "NVIDIA GPU Computing Toolkit",
    "CUDA",
  );
  for (const entry of await fs
    .readdir(toolkitRoot, { withFileTypes: true })
    .catch(() => []))
    if (entry.isDirectory())
      candidates.add(path.join(toolkitRoot, entry.name, "bin"));
  if (acceleratorRoot) {
    for (const entry of await fs
      .readdir(acceleratorRoot, { withFileTypes: true })
      .catch(() => []))
      if (entry.isDirectory())
        candidates.add(path.join(acceleratorRoot, entry.name));
  }

  const results: CudaToolkit[] = [];
  for (const bin of candidates) {
    const names = await fs.readdir(bin).catch(() => []);
    const majors = [
      ...new Set(
        names
          .map((name) => name.match(/^cudart64_(\d+)\.dll$/i)?.[1] || "")
          .filter(Boolean),
      ),
    ];
    for (const major of majors) {
      const required = [
        `cudart64_${major}.dll`,
        `cublas64_${major}.dll`,
        `cublasLt64_${major}.dll`,
      ];
      if (
        await Promise.all(
          required.map((name) =>
            fs
              .stat(path.join(bin, name))
              .then((value) => value.isFile())
              .catch(() => false),
          ),
        ).then((ready) => ready.every(Boolean))
      ) {
        const match = path
          .basename(path.dirname(bin))
          .match(/v?(\d+)(?:\.(\d+))?/i);
        const version =
          match?.[1] === major ? `${major}.${match?.[2] || "x"}` : major;
        if (!results.some((item) => item.major === major && item.bin === bin))
          results.push({ major, version, bin });
      }
    }
  }
  // Prefer the CUDA 12.4 backend. It runs on current NVIDIA drivers while
  // avoiding the PTX-forward-compatibility trap where a 13.3 build can list a
  // GPU on an older 13.x driver but fails when the first kernel is launched.
  return results.sort((left, right) => {
    if (left.major === right.major) return left.bin.localeCompare(right.bin);
    if (left.major === "12") return -1;
    if (right.major === "12") return 1;
    return Number(right.major) - Number(left.major);
  });
}

export async function systemCudaBin(
  version?: string,
  acceleratorRoot?: string,
) {
  const major = version?.match(/^(\d+)/)?.[1];
  return (
    (await cudaToolkits(acceleratorRoot)).find(
      (toolkit) => !major || toolkit.major === major,
    )?.bin || ""
  );
}

async function acceleratorExecutables(
  llamaRoot?: string,
  acceleratorRoot?: string,
) {
  if (!llamaRoot) return [];
  const cudaRoots: AcceleratorCandidate[] = [];
  if (process.platform === "win32")
    for (const toolkit of await cudaToolkits(acceleratorRoot)) {
      if (toolkit.major !== "12" && toolkit.major !== "13") continue;
      const releaseRoot = path.join(llamaRoot, `cuda-system-${toolkit.major}`);
      const developmentRoot = path.join(
        llamaRoot,
        `${process.platform}-${process.arch}-cuda-${toolkit.major === "13" ? "13.3" : "12.4"}`,
      );
      cudaRoots.push(
        {
          root: releaseRoot,
          accelerator: "cuda",
          version: toolkit.version,
          runtimeBin: toolkit.bin,
        },
        {
          root: developmentRoot,
          accelerator: "cuda",
          version: toolkit.version,
          runtimeBin: toolkit.bin,
        },
      );
    }
  const roots: AcceleratorCandidate[] = [
    ...cudaRoots,
    { root: path.join(llamaRoot, "vulkan"), accelerator: "vulkan" },
    {
      root: path.join(llamaRoot, `${process.platform}-${process.arch}-vulkan`),
      accelerator: "vulkan",
    },
    ...(process.platform === "darwin"
      ? [
          {
            root: path.join(llamaRoot, `${process.platform}-${process.arch}`),
            accelerator: "metal" as const,
          },
        ]
      : []),
  ];
  const results: Array<AcceleratorCandidate & { executable: string }> = [];
  for (const candidateRoot of roots)
    for (const name of executableNames()) {
      const candidate = path.join(candidateRoot.root, name);
      if (
        await fs
          .stat(candidate)
          .then((value) => value.isFile())
          .catch(() => false)
      ) {
        results.push({ ...candidateRoot, executable: candidate });
        break;
      }
    }
  return results;
}

export async function hardwareProfile(
  _modelsRoot: string,
  llamaRoot?: string,
  acceleratorRoot?: string,
): Promise<AiHardwareProfile> {
  if (mlxRuntimeSupported())
    return {
      platform: process.platform,
      arch: process.arch,
      memoryBytes: os.totalmem(),
      engine: "mlx",
      recommendedTier: "small",
      gpuAvailable: true,
      gpuName: "Apple silicon GPU",
      gpuNames: ["Apple silicon GPU"],
      gpuCount: 1,
      accelerator: "metal",
    };
  let gpuName = "";
  let gpuNames: string[] = [];
  let accelerator: AiHardwareProfile["accelerator"] = "none";
  let acceleratorVersion: string | undefined;
  const nvidia = await nvidiaProfile();
  const toolkits = await cudaToolkits(acceleratorRoot);
  for (const candidate of await acceleratorExecutables(
    llamaRoot,
    acceleratorRoot,
  )) {
    try {
      const result = await exec(candidate.executable, ["--list-devices"], {
        cwd: candidate.root,
        timeout: 10_000,
        windowsHide: true,
        env: candidate.runtimeBin
          ? {
              ...process.env,
              Path: `${candidate.runtimeBin};${process.env.Path || process.env.PATH || ""}`,
            }
          : process.env,
      });
      const lines = `${result.stdout}\n${result.stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      gpuNames = [
        ...new Set(
          lines.filter(
            (line) =>
              /^(?:CUDA|Vulkan|Metal)\d*\s*:/i.test(line) ||
              (!/available devices|\(none\)/i.test(line) &&
                /NVIDIA|AMD|Intel|Apple/i.test(line)),
          ),
        ),
      ];
      gpuName =
        gpuNames[0] ||
        lines.find(
          (line) =>
            !/available devices|\(none\)/i.test(line) &&
            /NVIDIA|AMD|Intel|Apple/i.test(line),
        ) ||
        "";
      if (gpuName) {
        accelerator = candidate.accelerator;
        acceleratorVersion = candidate.version;
        break;
      }
    } catch {
      gpuName = "";
    }
  }
  const minimumPyTorchDriver =
    process.platform === "win32" ? "520.06" : "520.61";
  const pytorchVariant = versionAtLeast(
    nvidia?.driverVersion,
    process.platform === "win32" ? "570.65" : "570.26",
  )
    ? "CUDA 12.8"
    : versionAtLeast(
          nvidia?.driverVersion,
          process.platform === "win32" ? "560.76" : "560.28",
        )
      ? "CUDA 12.6"
      : versionAtLeast(nvidia?.driverVersion, minimumPyTorchDriver)
        ? "CUDA 11.8"
        : "";
  const cudaInstallSupported = versionAtLeast(nvidia?.driverVersion, "525");
  const cudaMessage =
    accelerator === "cuda"
      ? `CUDA ${acceleratorVersion || ""} is active through llama.cpp.`.replace(
          /\s+/g,
          " ",
        )
      : nvidia
        ? toolkits.some((toolkit) => ["12", "13"].includes(toolkit.major))
          ? `NVIDIA ${nvidia.driverVersion} was detected, but the installed CUDA runtime could not be loaded. Vulkan is active.`
          : cudaInstallSupported
            ? `NVIDIA ${nvidia.driverVersion} supports CUDA ${nvidia.cudaVersion || "12+"}. Add CUDA support to use llama.cpp with CUDA; Vulkan is active for now.`
            : `NVIDIA ${nvidia.driverVersion} is older than the CUDA 12 llama.cpp minimum (525). Vulkan is active.`
        : undefined;
  return {
    platform: process.platform,
    arch: process.arch,
    memoryBytes: os.totalmem(),
    engine: localAiEngine(),
    recommendedTier: "small",
    gpuAvailable: Boolean(gpuName),
    gpuName:
      nvidia?.name ||
      gpuName.replace(/^[-*\s]+/, "") ||
      "No supported GPU detected",
    gpuNames: gpuNames.length
      ? gpuNames.map((name) => name.replace(/^[-*\s]+/, ""))
      : nvidia?.name
        ? [nvidia.name]
        : [],
    gpuCount: Math.max(gpuNames.length, nvidia ? 1 : 0),
    accelerator,
    acceleratorVersion,
    nvidiaDetected: Boolean(nvidia),
    nvidiaDriverVersion: nvidia?.driverVersion,
    nvidiaCudaVersion: nvidia?.cudaVersion,
    cudaRuntimeAvailable: accelerator === "cuda",
    cudaInstallSupported,
    cudaMessage,
    pytorchCudaMessage: nvidia
      ? pytorchVariant
        ? `PyTorch 2.7.1 will use ${pytorchVariant}. Minimum NVIDIA driver: ${pytorchVariant === "CUDA 12.8" ? (process.platform === "win32" ? "570.65" : "570.26") : pytorchVariant === "CUDA 12.6" ? (process.platform === "win32" ? "560.76" : "560.28") : minimumPyTorchDriver}.`
        : `PyTorch GPU support needs NVIDIA driver ${minimumPyTorchDriver} or newer; CPU mode will be used.`
      : "PyTorch will use CPU because no NVIDIA GPU was detected.",
  };
}
