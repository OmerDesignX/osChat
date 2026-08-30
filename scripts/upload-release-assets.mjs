import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const [platform, tag] = process.argv.slice(2);
if (!["windows", "macos"].includes(platform) || !/^v\d/.test(tag || ""))
  throw new Error(
    "Usage: node scripts/upload-release-assets.mjs <windows|macos> <v-tag>",
  );

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repository =
  process.env.OSCODE_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY;
if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
if (!/^[^/\s]+\/[^/\s]+$/.test(repository || ""))
  throw new Error("GITHUB_REPOSITORY must use owner/repository format");

const root = path.resolve(import.meta.dirname, "..");
const assetRoot = path.join(root, "release-assets", platform);
const apiRoot = `https://api.github.com/repos/${repository}`;
const uploadRoot = `https://uploads.github.com/repos/${repository}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "osCode-release-uploader",
  "X-GitHub-Api-Version": "2022-11-28",
};
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const walk = async (directory) => {
  const results = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) results.push(...(await walk(full)));
    else if (item.isFile() && item.name !== "README.md") results.push(full);
  }
  return results;
};

const assets = await walk(assetRoot);
const expectedExtension = platform === "windows" ? ".exe" : ".dmg";
if (assets.length !== 1 || path.extname(assets[0]) !== expectedExtension)
  throw new Error(
    `${platform} releases must contain one ${expectedExtension} file`,
  );
const assetSizes = new Map();
for (const asset of assets) {
  const size = (await stat(asset)).size;
  if (size >= 2 * 1024 * 1024 * 1024)
    throw new Error(
      `${path.basename(asset)} is too large for a GitHub Release`,
    );
  assetSizes.set(asset, size);
}

const responseError = async (label, response) => {
  const detail = (await response.text()).slice(0, 2_000);
  return new Error(`${label} failed with HTTP ${response.status}: ${detail}`);
};
const api = (endpoint, options = {}) =>
  fetch(`${apiRoot}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

const tagResponse = await api(`/git/ref/tags/${encodeURIComponent(tag)}`);
if (!tagResponse.ok)
  throw await responseError(`Tag ${tag} lookup`, tagResponse);

const findRelease = async () => {
  const response = await api(`/releases/tags/${encodeURIComponent(tag)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError("Release lookup", response);
  return response.json();
};

let release = await findRelease();
if (!release) {
  const response = await api("/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `osCode ${tag}`,
      draft: true,
      generate_release_notes: true,
    }),
  });
  if (response.ok) release = await response.json();
  else if (response.status === 422) {
    // Native matrix jobs can race while creating the same draft.
    for (let attempt = 0; attempt < 5 && !release; attempt += 1) {
      await delay(1_000 * (attempt + 1));
      release = await findRelease();
    }
    if (!release) throw await responseError("Draft release creation", response);
  } else throw await responseError("Draft release creation", response);
}
if (!release.draft)
  throw new Error(
    `Release ${tag} is already published; refusing to replace public assets`,
  );

const listAssets = async () => {
  const response = await api(`/releases/${release.id}/assets?per_page=100`);
  if (!response.ok) throw await responseError("Release asset lookup", response);
  return response.json();
};

for (const asset of assets) {
  const name = path.basename(asset);
  let uploaded = false;
  for (let attempt = 1; attempt <= 3 && !uploaded; attempt += 1) {
    const existing = (await listAssets()).find((item) => item.name === name);
    if (existing) {
      const removal = await api(`/releases/assets/${existing.id}`, {
        method: "DELETE",
      });
      if (!removal.ok)
        throw await responseError(`Removing existing ${name}`, removal);
    }

    try {
      const response = await fetch(
        `${uploadRoot}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(assetSizes.get(asset)),
          },
          body: createReadStream(asset),
          duplex: "half",
        },
      );
      if (response.ok) {
        uploaded = true;
        console.log(`Uploaded ${name}`);
      } else if (attempt === 3)
        throw await responseError(`Uploading ${name}`, response);
      else await response.arrayBuffer();
    } catch (error) {
      if (attempt === 3) throw error;
    }
    if (!uploaded) await delay(2_000 * attempt);
  }
}

console.log(`Uploaded ${assets.length} ${platform} files to draft ${tag}`);
