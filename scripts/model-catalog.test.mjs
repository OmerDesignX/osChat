import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archiveFilesForVariant,
  archiveForVariant,
  defaultModelRelease,
  filesForVariant,
  modelRepository,
  modelVariants,
  validateArchiveEntry,
  verifiedCrc32,
} from "../dist-electron/main/model-catalog.js";
import {
  defaultBuiltInContext,
  findGguf,
  localAiEngine,
  mlxRuntimeSupported,
} from "../dist-electron/main/bundled-models.js";

test("runtime selection keeps MLX on supported Apple silicon and GGUF everywhere else", () => {
  assert.equal(mlxRuntimeSupported("darwin", "arm64", "23.0.0"), true);
  assert.equal(localAiEngine("darwin", "arm64", "23.0.0"), "mlx");
  assert.equal(mlxRuntimeSupported("darwin", "arm64", "22.6.0"), false);
  assert.equal(localAiEngine("darwin", "arm64", "22.6.0"), "llamacpp");
  assert.equal(localAiEngine("darwin", "x64", "25.0.0"), "llamacpp");
  assert.equal(localAiEngine("win32", "x64", "10.0.0"), "llamacpp");
  assert.equal(localAiEngine("linux", "x64", "6.8.0"), "llamacpp");
});

test("built-in models retain their advertised context", () => {
  assert.equal(defaultBuiltInContext("llamacpp"), 262_144);
  assert.equal(defaultBuiltInContext("llamacpp", 4_096), 4_096);
  assert.equal(defaultBuiltInContext("mlx"), 262_144);
});

test("the public model catalogue maps one selectable tier per runtime", () => {
  assert.equal(modelRepository, "https://models.omerdesign.com/oscode-models");
  assert.equal(defaultModelRelease, "v2");
  assert.equal(modelVariants.length, 6);
  for (const runtime of ["llamacpp", "mlx"])
    assert.deepEqual(
      modelVariants
        .filter((variant) => variant.runtime === runtime)
        .map((variant) => variant.tier),
      ["small", "medium", "large"],
    );
});

test("both published releases map every tier to its own ZIP", () => {
  for (const release of ["v1", "v2"])
    for (const variant of modelVariants) {
      const archive = archiveForVariant(variant, release);
      assert.match(archive.url, new RegExp("/osModels-V[12]-D/"));
      assert.match(archive.url, /\.zip$/);
      assert.ok(archive.bytes > 1_000_000_000);
      const files = archiveFilesForVariant(variant, release);
      assert.equal(new Set(files).size, files.length);
      assert.ok(
        files.includes(
          variant.runtime === "mlx"
            ? "config.json"
            : variant.repositoryPath.split("/").at(-1),
        ),
      );
      if (release === "v2")
        assert.ok(files.some((file) => /mmproj|model-vision/.test(file)));
    }
});

test("archive entries reject traversal, links, and unknown files", () => {
  const allowed = new Set(["model.gguf"]);
  const entry = {
    fileName: "Small/model.gguf",
    uncompressedSize: 100,
    crc32: 1,
    externalFileAttributes: 0,
  };
  assert.equal(validateArchiveEntry(entry, allowed), "model.gguf");
  assert.equal(
    validateArchiveEntry({ ...entry, fileName: "./Small/model.gguf" }, allowed),
    "model.gguf",
  );
  assert.equal(
    validateArchiveEntry({ ...entry, fileName: "Small/" }, allowed),
    null,
  );
  for (const name of [
    "../model.gguf",
    "/model.gguf",
    "C:/model.gguf",
    "Small\\model.gguf",
    "Small/unknown.gguf",
  ])
    assert.throws(() =>
      validateArchiveEntry({ ...entry, fileName: name }, allowed),
    );
  assert.throws(() =>
    validateArchiveEntry(
      { ...entry, externalFileAttributes: 0o120000 << 16 },
      allowed,
    ),
  );
});

test("archive CRC verification detects a damaged extracted shard", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-crc-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "model.gguf");
  await fs.writeFile(file, "hello");
  await verifiedCrc32(file, 5, 0x3610a686);
  await assert.rejects(verifiedCrc32(file, 5, 0));
  await assert.rejects(verifiedCrc32(file, 6, 0x3610a686));
});

test("GGUF discovery selects the first model shard, never its projector", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-gguf-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of [
    "osCode-GGUF-Small-mmproj-Q5_K_M.gguf",
    "osCode-GGUF-Small-Q4_K_M-00002-of-00002.gguf",
    "osCode-GGUF-Small-Q4_K_M-00001-of-00002.gguf",
  ])
    await fs.writeFile(path.join(directory, name), "fixture");
  assert.equal(
    path.basename(await findGguf(directory, "small")),
    "osCode-GGUF-Small-Q4_K_M-00001-of-00002.gguf",
  );
});

test("each tier downloads only its own complete shard set", () => {
  for (const variant of modelVariants) {
    const files = filesForVariant(variant);
    assert.equal(
      files.filter((file) =>
        variant.runtime === "llamacpp"
          ? file.endsWith(".gguf")
          : file.endsWith(".safetensors"),
      ).length,
      variant.shards,
    );
    assert.ok(
      files.every((file) =>
        file.startsWith(
          variant.repositoryPath.split("/").slice(0, -1).join("/"),
        ),
      ),
    );
    if (variant.runtime === "mlx") {
      assert.ok(files.includes(`${variant.repositoryPath}/config.json`));
      assert.ok(
        files.includes(
          `${variant.repositoryPath}/model.safetensors.index.json`,
        ),
      );
    }
  }
});
