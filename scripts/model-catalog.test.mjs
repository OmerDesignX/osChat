import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archiveFilesForVariant,
  archiveForVariant,
  defaultModelRelease,
  downloadArchive,
  filesForVariant,
  migrateLegacyModelInstallations,
  migratedModelSelection,
  modelInstallDirectory,
  resolveVersionedModelSelection,
  modelRepository,
  modelVariants,
  validateArchiveEntry,
  verifiedCrc32,
  withModelArchiveFetchFallback,
} from "../dist-electron/main/model-catalog.js";
import {
  defaultBuiltInContext,
  findGguf,
  findMlx,
  bundledModels,
  localAiEngine,
  mlxRuntimeSupported,
} from "../dist-electron/main/bundled-models.js";

const mainSource = await fs.readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);

test("runtime selection keeps MLX on supported Apple silicon and GGUF everywhere else", () => {
  assert.equal(mlxRuntimeSupported("darwin", "arm64", "23.0.0"), true);
  assert.equal(localAiEngine("darwin", "arm64", "23.0.0"), "mlx");
  assert.equal(mlxRuntimeSupported("darwin", "arm64", "22.6.0"), false);
  assert.equal(localAiEngine("darwin", "arm64", "22.6.0"), "llamacpp");
  assert.equal(localAiEngine("darwin", "x64", "25.0.0"), "llamacpp");
  assert.equal(localAiEngine("win32", "x64", "10.0.0"), "llamacpp");
  assert.equal(localAiEngine("linux", "x64", "6.8.0"), "llamacpp");
});

test("Windows and Linux model downloads use the portable transport fallback", () => {
  assert.match(
    mainSource,
    /modelArchiveFetch: withModelArchiveFetchFallback\(/,
  );
  assert.match(mainSource, /globalThis\.fetch\(url, init\)/);
});

test("built-in models retain their advertised context", () => {
  assert.equal(defaultBuiltInContext("llamacpp"), 262_144);
  assert.equal(defaultBuiltInContext("llamacpp", 4_096), 4_096);
  assert.equal(defaultBuiltInContext("mlx"), 262_144);
});

test("the public model catalogue maps one selectable tier per runtime", () => {
  assert.equal(modelRepository, "https://models.omerdesign.com/oscode-models");
  assert.equal(defaultModelRelease, "v2");
  assert.equal(modelVariants.length, 8);
  for (const runtime of ["llamacpp", "mlx"])
    assert.deepEqual(
      modelVariants
        .filter((variant) => variant.runtime === runtime)
        .map((variant) => variant.tier),
      ["xsmall", "small", "medium", "large"],
    );
});

test("both published releases map every tier to its own ZIP", () => {
  for (const release of ["v1", "v2"])
    for (const variant of modelVariants) {
      if (release === "v1" && variant.tier === "xsmall") {
        assert.throws(() => archiveForVariant(variant, release));
        continue;
      }
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

test("the case-sensitive V2 xSmall archive paths match the published links", () => {
  const gguf = modelVariants.find(
    (variant) => variant.runtime === "llamacpp" && variant.tier === "xsmall",
  );
  const mlx = modelVariants.find(
    (variant) => variant.runtime === "mlx" && variant.tier === "xsmall",
  );
  assert.ok(gguf);
  assert.ok(mlx);
  assert.equal(
    archiveForVariant(gguf).url,
    `${modelRepository}/osModels-V2-D/GGUF/xSmall.zip`,
  );
  assert.equal(
    archiveForVariant(mlx).url,
    `${modelRepository}/osModels-V2-D/MLX/osCode-MLX-xSmall-Q4.zip`,
  );
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
  assert.equal(
    validateArchiveEntry(
      { ...entry, fileName: "__MACOSX/Small/._model.gguf" },
      allowed,
    ),
    null,
  );
  assert.equal(
    validateArchiveEntry({ ...entry, fileName: "__MACOSX/._Small" }, allowed),
    null,
  );
  for (const name of [
    "../model.gguf",
    "/model.gguf",
    "C:/model.gguf",
    "Small\\model.gguf",
    "Small/unknown.gguf",
    "__MACOSX/Small/unknown.gguf",
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

test("archive downloads resume after a transient fetch failure", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-fetch-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "model.zip");
  const payload = Buffer.from("verified model archive payload");
  await fs.writeFile(destination, payload.subarray(0, 8));
  let calls = 0;
  await downloadArchive(
    "https://models.example/model.zip",
    destination,
    payload.length,
    new AbortController().signal,
    () => {},
    async (_url, init) => {
      calls += 1;
      const range = new Headers(init?.headers).get("range");
      const offset = Number(range?.match(/^bytes=(\d+)-$/)?.[1]);
      assert.equal(offset, 8);
      if (calls === 1) throw new Error("temporary connection loss");
      return new Response(payload.subarray(offset), {
        status: 206,
        headers: {
          "content-length": String(payload.length - offset),
          "content-range": `bytes ${offset}-${payload.length - 1}/${payload.length}`,
        },
      });
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(await fs.readFile(destination), payload);
});

test("model archive fetch falls back when an Electron transport is unavailable", async () => {
  const controller = new AbortController();
  let fallbackCalls = 0;
  const fetchArchive = withModelArchiveFetchFallback(
    async () => new Response("blocked by transport", { status: 403 }),
    async (url, init) => {
      fallbackCalls += 1;
      assert.equal(url, "https://models.example/model.zip");
      assert.equal(new Headers(init?.headers).get("range"), "bytes=8-");
      assert.equal(init?.signal, controller.signal);
      return new Response("archive", { status: 206 });
    },
  );
  const response = await fetchArchive("https://models.example/model.zip", {
    signal: controller.signal,
    headers: { range: "bytes=8-" },
  });
  assert.equal(response.status, 206);
  assert.equal(fallbackCalls, 1);
});

test("missing archives do not retry through a second transport", async () => {
  let fallbackCalls = 0;
  const fetchArchive = withModelArchiveFetchFallback(
    async () => new Response(null, { status: 404 }),
    async () => {
      fallbackCalls += 1;
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(
    (await fetchArchive("https://models.example/missing.zip")).status,
    404,
  );
  assert.equal(fallbackCalls, 0);
});

test("a rejected range restarts the archive cleanly", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-range-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "model.zip");
  const payload = Buffer.from("portable complete archive");
  await fs.writeFile(destination, payload.subarray(0, 8));
  const ranges = [];
  await downloadArchive(
    "https://models.example/model.zip",
    destination,
    payload.length,
    new AbortController().signal,
    () => {},
    async (_url, init) => {
      const range = new Headers(init?.headers).get("range");
      ranges.push(range);
      if (ranges.length === 1) return new Response(null, { status: 416 });
      return new Response(payload, {
        status: 200,
        headers: { "content-length": String(payload.length) },
      });
    },
  );
  assert.deepEqual(ranges, ["bytes=8-", null]);
  assert.deepEqual(await fs.readFile(destination), payload);
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

test("V2 MLX is not ready until its indexed vision shard is present", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-v2-mlx-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const variant = modelVariants.find(
    (item) => item.runtime === "mlx" && item.tier === "small",
  );
  assert.ok(variant);
  const model = path.join(directory, variant.folder);
  await fs.mkdir(model);
  for (const file of [
    "config.json",
    "chat_template.jinja",
    "tokenizer.json",
    "tokenizer_config.json",
  ])
    await fs.writeFile(path.join(model, file), "fixture");
  await fs.writeFile(
    path.join(model, "model.safetensors.index.json"),
    JSON.stringify({
      weight_map: {
        "language_model.layers.0": "model-00001-of-00021.safetensors",
        "vision_tower.blocks.0": "model-vision-00001-of-00001.safetensors",
      },
    }),
  );
  await fs.writeFile(
    path.join(model, "model-00001-of-00021.safetensors"),
    "text weights",
  );
  assert.equal(await findMlx(directory, variant), "");
  await fs.writeFile(
    path.join(model, "model-vision-00001-of-00001.safetensors"),
    "vision weights",
  );
  assert.equal(await findMlx(directory, variant), model);
});

test("app upgrades move existing V1 and V2 installs into separate internal folders", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "model-upgrade-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const variants = [
    modelVariants.find(
      (item) => item.runtime === "mlx" && item.tier === "small",
    ),
    modelVariants.find(
      (item) => item.runtime === "mlx" && item.tier === "medium",
    ),
    modelVariants.find(
      (item) => item.runtime === "llamacpp" && item.tier === "small",
    ),
    modelVariants.find(
      (item) => item.runtime === "llamacpp" && item.tier === "medium",
    ),
  ];
  assert.ok(variants.every(Boolean));
  for (const variant of variants) {
    const release = variant.tier === "small" ? "v1" : "v2";
    const legacy = path.join(
      root,
      variant.runtime === "mlx" ? "mlx" : "gguf",
      variant.folder,
    );
    await fs.mkdir(legacy, { recursive: true });
    if (variant.runtime === "mlx") {
      for (const name of [
        "config.json",
        "chat_template.jinja",
        "tokenizer.json",
        "tokenizer_config.json",
      ])
        await fs.writeFile(path.join(legacy, name), "{}");
      const weights = ["model-00001-of-00021.safetensors"];
      if (release === "v2")
        weights.push("model-vision-00001-of-00001.safetensors");
      await fs.writeFile(
        path.join(legacy, "model.safetensors.index.json"),
        JSON.stringify({
          weight_map: Object.fromEntries(
            weights.map((file, index) => [`weight.${index}`, file]),
          ),
        }),
      );
      for (const file of weights)
        await fs.writeFile(path.join(legacy, file), "weight");
    } else {
      await fs.writeFile(
        path.join(legacy, path.basename(variant.repositoryPath)),
        "model",
      );
      if (release === "v2")
        await fs.writeFile(
          path.join(legacy, "osCode-GGUF-Medium-mmproj-Q6_K.gguf"),
          "projector",
        );
    }
  }
  const oldMlx = path.join(root, "mlx", variants[0].folder);
  const oldGguf = path.join(
    root,
    "gguf",
    "small",
    path.basename(variants[2].repositoryPath),
  );
  const moves = await migrateLegacyModelInstallations(root);
  assert.equal(moves.length, 4);
  assert.equal(
    await migrateLegacyModelInstallations(root).then((items) => items.length),
    0,
  );
  for (const variant of variants) {
    const release = variant.tier === "small" ? "v1" : "v2";
    const destination = modelInstallDirectory(root, variant, release);
    assert.equal((await fs.stat(destination)).isDirectory(), true);
  }
  assert.equal(
    migratedModelSelection(oldMlx, moves),
    modelInstallDirectory(root, variants[0], "v1"),
  );
  assert.equal(
    await resolveVersionedModelSelection(oldMlx, [
      path.join(root, "other"),
      root,
    ]),
    modelInstallDirectory(root, variants[0], "v1"),
  );
  assert.equal(
    migratedModelSelection(oldGguf, moves),
    path.join(
      modelInstallDirectory(root, variants[2], "v1"),
      path.basename(oldGguf),
    ),
  );
  assert.equal(
    await resolveVersionedModelSelection(oldGguf, [root]),
    path.join(
      modelInstallDirectory(root, variants[2], "v1"),
      path.basename(oldGguf),
    ),
  );
  const models = await bundledModels(root);
  const runtime = localAiEngine();
  assert.ok(
    models.some(
      (item) =>
        item.engine === runtime &&
        item.tier === "small" &&
        item.release === "v1" &&
        item.installed,
    ),
  );
  assert.ok(
    models.some(
      (item) =>
        item.engine === runtime &&
        item.tier === "medium" &&
        item.release === "v2" &&
        item.installed,
    ),
  );
  assert.ok(
    models.some(
      (item) =>
        item.engine === runtime &&
        item.tier === "small" &&
        item.release === "v2" &&
        !item.installed,
    ),
  );
});

test("upgrade never overwrites an existing versioned model", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "model-upgrade-collision-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const variant = modelVariants.find(
    (item) => item.runtime === "mlx" && item.tier === "small",
  );
  assert.ok(variant);
  const legacy = path.join(root, "mlx", variant.folder);
  const destination = modelInstallDirectory(root, variant, "v1");
  await fs.mkdir(legacy, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(legacy, "legacy.txt"), "keep this");
  await fs.writeFile(path.join(destination, "installed.txt"), "keep this too");
  assert.deepEqual(await migrateLegacyModelInstallations(root), []);
  assert.equal(await resolveVersionedModelSelection(legacy, [root]), legacy);
  assert.equal(
    await fs.readFile(path.join(legacy, "legacy.txt"), "utf8"),
    "keep this",
  );
  assert.equal(
    await fs.readFile(path.join(destination, "installed.txt"), "utf8"),
    "keep this too",
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
