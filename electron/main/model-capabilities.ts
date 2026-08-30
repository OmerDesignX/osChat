import fs from "node:fs/promises";
import path from "node:path";
import type { AiEngine } from "../types.js";

export type LocalModelCapabilities = {
  text: true;
  documents: true;
  images: boolean;
  video: boolean;
  audio: boolean;
  /**
   * The selected local runtime accepts media input and performs the final
   * capability check itself. A missing sidecar or incomplete metadata must
   * never make osCode discard a private attachment before inference.
   */
  mediaInput: boolean;
  projector?: string;
  reason?: string;
};

const textOnly: LocalModelCapabilities = {
  text: true,
  documents: true,
  images: false,
  video: false,
  audio: false,
  mediaInput: false,
};

async function jsonFile(file: string) {
  return fs
    .readFile(file, "utf8")
    .then((value) => JSON.parse(value) as Record<string, unknown>)
    .catch(() => null);
}

async function mlxCapabilities(model: string) {
  const [config, index] = await Promise.all([
    jsonFile(path.join(model, "config.json")),
    jsonFile(path.join(model, "model.safetensors.index.json")),
  ]);
  const keys = Object.keys(
    (index?.weight_map as Record<string, unknown> | undefined) || {},
  );
  const hasVisionConfig = Boolean(
    config?.vision_config || config?.visual_config || config?.vision_encoder,
  );
  const hasVisionWeights = keys.some((key) =>
    /(?:^|\.)(?:visual|vision_model|vision_tower|image_encoder)(?:\.|$)/i.test(
      key,
    ),
  );
  const processorFiles = [
    "preprocessor_config.json",
    "processor_config.json",
    "video_preprocessor_config.json",
  ];
  const hasProcessor = await Promise.all(
    processorFiles.map((file) =>
      fs
        .stat(path.join(model, file))
        .then((value) => value.isFile() && value.size > 0)
        .catch(() => false),
    ),
  ).then((values) => values.some(Boolean));
  const architectures = Array.isArray(config?.architectures)
    ? config.architectures.map(String)
    : [];
  const unifiedMultimodalModel =
    architectures.some((value) =>
      /(?:conditionalgeneration|vision|visual|vl|omni)/i.test(value),
    ) || Boolean(config?.vision_start_token_id);
  // Some text-only Qwen checkpoints retain reserved image/video token IDs in
  // config.json even though their safetensors contain no visual module. Those
  // token IDs describe the vocabulary, not executable vision capability.
  // Starting mlx-vlm for such a checkpoint produces "vision_tower has no
  // weights" and aborts an otherwise valid Computer Control turn. Require
  // actual visual weights, or a visual config plus processor for unindexed
  // single-file checkpoints, before selecting the VLM runtime.
  const images =
    hasVisionWeights ||
    (hasVisionConfig && hasProcessor) ||
    (unifiedMultimodalModel && hasProcessor);
  const hasAudioConfig = Boolean(
    config?.audio_config || config?.audio_encoder || config?.speech_config,
  );
  const hasAudioWeights = keys.some((key) =>
    /(?:^|\.)(?:audio|audio_tower|audio_encoder|speech_encoder)(?:\.|$)/i.test(
      key,
    ),
  );
  const audio = hasAudioConfig && hasAudioWeights;
  return {
    ...textOnly,
    images,
    // MLX-VLM represents video as a sequence of visual frames, so a usable
    // visual tower is sufficient for both still-image and video routing.
    video: images,
    audio,
    mediaInput: images || audio,
    reason:
      images || audio
        ? undefined
        : "This MLX checkpoint has no visual or audio weights. Text and accessibility inspection remain available.",
  } satisfies LocalModelCapabilities;
}

async function ggufProjector(model: string) {
  const directory = path.dirname(model);
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => [] as import("node:fs").Dirent[]);
  const projectors = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:mmproj|.*[.-]mmproj)[^/]*\.gguf$/i.test(entry.name),
    )
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  return projectors[0] || "";
}

export async function localModelCapabilities(
  engine: AiEngine,
  model: string,
): Promise<LocalModelCapabilities> {
  if (engine === "ollama")
    return {
      ...textOnly,
      images: true,
      video: false,
      audio: false,
      mediaInput: true,
    };
  if (!model || model.startsWith("catalog:")) return textOnly;
  if (engine === "mlx") return mlxCapabilities(model);
  if (engine === "llamacpp") {
    const projector = await ggufProjector(model);
    return {
      ...textOnly,
      // Current and future llama.cpp-compatible runtimes get the opportunity
      // to inspect media embedded in a unified GGUF. A discovered projector
      // remains an optional compatibility aid, never a prerequisite imposed
      // by osCode.
      images: true,
      video: true,
      audio: true,
      mediaInput: true,
      ...(projector ? { projector } : {}),
      ...(!projector
        ? {
            reason:
              "No separate projector was found; the local GGUF runtime will inspect the model's embedded media support.",
          }
        : {}),
    };
  }
  return textOnly;
}
