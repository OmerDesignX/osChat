import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerVersion,
  isTrustedUpdateUrl,
  selectUpdateAsset,
  updateAssetName,
  updateAssetVersion,
  updateChannel,
  updateChannelApiUrl,
  updateChannelWebUrl,
} from "../dist-electron/main/updater-policy.js";

test("application updates are network silent until the user opts in", () => {
  assert.equal(
    isTrustedUpdateUrl(
      false,
      "https://api.github.com/repos/OmerDesignX/osChat/releases/latest",
    ),
    false,
  );
});

test("application updates accept only the official HTTPS GitHub hosts", () => {
  for (const url of [
    "https://api.github.com/repos/OmerDesignX/osChat/releases/latest",
    "https://github.com/OmerDesignX/osChat/releases/download/v0.2.0/osChat.exe",
    "https://release-assets.githubusercontent.com/github-production-release-asset/file",
  ])
    assert.equal(isTrustedUpdateUrl(true, url), true);
  for (const url of [
    "http://github.com/OmerDesignX/osChat/releases",
    "https://github.example.com/update.yml",
    "https://example.com/latest.yml",
  ])
    assert.equal(isTrustedUpdateUrl(true, url), false);
});

test("full-package updates select one native release asset", () => {
  assert.equal(
    updateAssetName("1.2.3", "win32", "x64"),
    "osChat-Setup-1.2.3.exe",
  );
  assert.equal(
    updateAssetName("1.2.3", "darwin", "arm64"),
    "osChat-1.2.3-mac-arm64.dmg",
  );
  assert.equal(
    updateAssetName("1.2.3", "darwin", "x64"),
    "osChat-1.2.3-mac-x64.dmg",
  );
  assert.equal(updateAssetName("1.2.3", "darwin", "ia32"), "");
  assert.equal(
    updateAssetName("1.2.3", "linux", "x64"),
    "osChat-1.2.3-x64.deb",
  );
  assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
});

test("fixed updater tags stay separate by architecture and Windows generation", () => {
  assert.equal(
    updateChannel("darwin", "arm64").tag,
    "macOS-Apple-Silicon-Updater",
  );
  assert.equal(updateChannel("darwin", "x64").tag, "macOS-Intel-Updater");
  assert.equal(
    updateChannel("win32", "x64", "10.0.19045").tag,
    "Windows-10-Updater",
  );
  assert.equal(
    updateChannel("win32", "x64", "10.0.22631").tag,
    "Windows-11-Updater",
  );
  assert.equal(updateChannel("linux", "x64").tag, "Linux-Updater");
  assert.equal(updateChannel("linux", "arm64"), null);
});

test("every native updater channel points to the official osChat release page", () => {
  const channels = [
    updateChannel("darwin", "arm64"),
    updateChannel("darwin", "x64"),
    updateChannel("win32", "x64", "10.0.19045"),
    updateChannel("win32", "x64", "10.0.22631"),
    updateChannel("linux", "x64"),
  ];
  const expectedTags = [
    "macOS-Apple-Silicon-Updater",
    "macOS-Intel-Updater",
    "Windows-10-Updater",
    "Windows-11-Updater",
    "Linux-Updater",
  ];
  for (const [index, channel] of channels.entries()) {
    assert.ok(channel);
    assert.equal(channel.tag, expectedTags[index]);
    assert.equal(
      updateChannelApiUrl(channel),
      `https://api.github.com/repos/OmerDesignX/osChat/releases/tags/${expectedTags[index]}`,
    );
    assert.equal(
      updateChannelWebUrl(channel),
      `https://github.com/OmerDesignX/osChat/releases/tag/${expectedTags[index]}`,
    );
  }
});

test("updater channels select the newest matching versioned package", () => {
  const assets = [
    { name: "osChat-0.2.0-mac-arm64.dmg", id: 1 },
    { name: "osChat-0.3.0-mac-x64.dmg", id: 2 },
    { name: "osChat-0.2.5-mac-arm64.dmg", id: 3 },
    { name: "README.txt", id: 4 },
  ];
  assert.equal(updateAssetVersion(assets[0].name, "darwin", "arm64"), "0.2.0");
  assert.deepEqual(selectUpdateAsset(assets, "0.1.0", "darwin", "arm64"), {
    version: "0.2.5",
    asset: assets[2],
  });
  assert.equal(selectUpdateAsset(assets, "0.2.5", "darwin", "arm64"), null);
});
