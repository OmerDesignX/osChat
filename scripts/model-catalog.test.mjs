import assert from "node:assert/strict";
import test from "node:test";
import {
  filesForVariant,
  modelRepository,
  modelVariants,
} from "../dist-electron/main/model-catalog.js";
import {
  defaultBuiltInContext,
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
  assert.equal(modelRepository, "https://github.com/OmerDesignX/osCode-Models");
  assert.equal(modelVariants.length, 6);
  for (const runtime of ["llamacpp", "mlx"])
    assert.deepEqual(
      modelVariants
        .filter((variant) => variant.runtime === runtime)
        .map((variant) => variant.tier),
      ["small", "medium", "large"],
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
