const trustedUpdateHosts = new Set([
  "api.github.com",
  "github.com",
  "downloads.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export const UPDATE_REPOSITORY = "OmerDesignX/osChat";

export type UpdateChannel = {
  tag: string;
  label: string;
  platform: "darwin" | "win32" | "linux";
  architecture: "arm64" | "x64";
};

export function updateChannelApiUrl(channel: UpdateChannel) {
  return `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/tags/${encodeURIComponent(channel.tag)}`;
}

export function updateChannelWebUrl(channel: UpdateChannel) {
  return `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${encodeURIComponent(channel.tag)}`;
}

export function isTrustedUpdateUrl(allowed: boolean, rawUrl: string) {
  if (!allowed) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && trustedUpdateHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function versionParts(value: string) {
  return value
    .replace(/^v/i, "")
    .split(/[.+-]/, 3)
    .map((part) => Number(part.replace(/\D.*/, "")) || 0);
}

export function isNewerVersion(candidate: string, current: string) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return false;
}

export function updateChannel(
  platform = process.platform,
  architecture = process.arch,
  systemRelease = "",
): UpdateChannel | null {
  if (platform === "darwin" && architecture === "arm64")
    return {
      tag: "macOS-Apple-Silicon-Updater",
      label: "macOS Apple Silicon",
      platform,
      architecture,
    };
  if (platform === "darwin" && architecture === "x64")
    return {
      tag: "macOS-Intel-Updater",
      label: "macOS Intel",
      platform,
      architecture,
    };
  if (platform === "win32" && architecture === "x64") {
    const build = Number(systemRelease.split(".")[2] || 0);
    const windows11 = build >= 22_000;
    return {
      tag: windows11 ? "Windows-11-Updater" : "Windows-10-Updater",
      label: windows11 ? "Windows 11" : "Windows 10",
      platform,
      architecture,
    };
  }
  if (platform === "linux" && architecture === "x64")
    return {
      tag: "Linux-Updater",
      label: "Linux x64",
      platform,
      architecture,
    };
  return null;
}

export function updateAssetName(
  version: string,
  platform = process.platform,
  architecture = process.arch,
) {
  if (platform === "win32" && architecture === "x64")
    return `osChat-Setup-${version}.exe`;
  if (platform === "darwin" && ["arm64", "x64"].includes(architecture))
    return `osChat-${version}-mac-${architecture}.dmg`;
  if (platform === "linux" && architecture === "x64")
    return `osChat-${version}-x64.deb`;
  return "";
}

export function updateAssetVersion(
  name: string,
  platform = process.platform,
  architecture = process.arch,
) {
  const version = "(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)";
  const pattern =
    platform === "win32" && architecture === "x64"
      ? new RegExp(`^osChat-Setup-${version}\\.exe$`, "i")
      : platform === "darwin" && ["arm64", "x64"].includes(architecture)
        ? new RegExp(`^osChat-${version}-mac-${architecture}\\.dmg$`, "i")
        : platform === "linux" && architecture === "x64"
          ? new RegExp(`^osChat-${version}-x64\\.deb$`, "i")
          : null;
  return pattern?.exec(name)?.[1] || "";
}

export function selectUpdateAsset<T extends { name?: unknown }>(
  assets: T[],
  currentVersion: string,
  platform = process.platform,
  architecture = process.arch,
) {
  let selected: { version: string; asset: T } | null = null;
  for (const asset of assets) {
    const version = updateAssetVersion(
      String(asset.name || ""),
      platform,
      architecture,
    );
    if (!version || !isNewerVersion(version, currentVersion)) continue;
    if (!selected || isNewerVersion(version, selected.version))
      selected = { version, asset };
  }
  return selected;
}
