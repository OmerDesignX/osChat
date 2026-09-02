import { app, shell } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppUpdateStatus } from "../types.js";
import {
  isNewerVersion,
  isTrustedUpdateUrl,
  selectUpdateAsset,
  updateAssetName,
  updateAssetVersion,
  updateChannel,
  updateChannelApiUrl,
  type UpdateChannel,
} from "./updater-policy.js";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

type ReleaseAsset = {
  name?: unknown;
  size?: unknown;
  digest?: unknown;
  browser_download_url?: unknown;
};

type AvailableUpdate = {
  version: string;
  name: string;
  asset: ReleaseAsset;
  channel: UpdateChannel;
};

type ReadyUpdate = {
  version: string;
  name: string;
  digest: string;
  bytes: number;
  channelTag: string;
};

export class AppUpdateService {
  private enabled = false;
  private checkInProgress = false;
  private downloadInProgress = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private downloadedPackage = "";
  private availableUpdate: AvailableUpdate | null = null;
  private status: AppUpdateStatus = {
    state: "disabled",
    message: "Automatic updates are off; manual checks remain available",
    currentVersion: app.getVersion(),
  };

  constructor(
    private readonly emit: (status: AppUpdateStatus) => void,
    private readonly handoffInstaller: (installerPath: string) => void,
  ) {}

  initialize(enabled: boolean) {
    this.enabled = enabled;
    this.schedule();
    if (!this.supported()) {
      this.update({
        state: "unsupported",
        message: "Updates are unavailable for this operating system build",
      });
      return;
    }
    this.update(
      enabled
        ? { state: "idle", message: "Automatic updates are on" }
        : {
            state: "disabled",
            message:
              "Automatic updates are off; manual checks remain available",
          },
    );
    void this.restoreReadyUpdate().then((restored) => {
      if (restored || !this.enabled) return;
      const timeout = setTimeout(() => void this.check(false), 2_500);
      timeout.unref();
    });
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.schedule();
    if (!this.supported()) {
      this.update({
        state: "unsupported",
        message: "Updates are unavailable for this operating system build",
      });
      return this.getStatus();
    }
    if (this.status.state === "ready" || this.status.state === "installing")
      return this.getStatus();
    if (!enabled) {
      this.update({
        state: this.availableUpdate ? "available" : "disabled",
        message: this.availableUpdate
          ? `osChat ${this.availableUpdate.version} is available`
          : "Automatic updates are off; manual checks remain available",
        ...(this.availableUpdate
          ? {
              version: this.availableUpdate.version,
              channel: this.availableUpdate.channel.label,
            }
          : {}),
      });
      return this.getStatus();
    }
    await this.check(false);
    return this.getStatus();
  }

  async check(manual = false) {
    if (!this.enabled && !manual) {
      this.update({
        state: "disabled",
        message: "Automatic updates are off; manual checks remain available",
      });
      return this.getStatus();
    }
    if (!this.supported()) {
      this.update({
        state: "unsupported",
        message: "Updates are unavailable for this operating system build",
      });
      return this.getStatus();
    }
    if (this.checkInProgress || this.downloadInProgress)
      return this.getStatus();
    const channel = this.channel();
    if (!channel) {
      this.update({
        state: "unsupported",
        message: "No update channel exists for this system",
      });
      return this.getStatus();
    }
    this.checkInProgress = true;
    this.update({
      state: "checking",
      message: `Checking the ${channel.label} update channel`,
      channel: channel.label,
    });
    try {
      const apiUrl = updateChannelApiUrl(channel);
      if (!isTrustedUpdateUrl(true, apiUrl))
        throw new Error("The update channel address is not trusted");
      const releaseResponse = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "osChat-updater",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!releaseResponse.ok)
        throw new Error(`GitHub returned ${releaseResponse.status}`);
      const release = (await releaseResponse.json()) as {
        tag_name?: unknown;
        draft?: unknown;
        prerelease?: unknown;
        assets?: ReleaseAsset[];
      };
      if (release.draft || release.prerelease)
        throw new Error("The update channel is not public and stable");
      if (release.tag_name !== channel.tag)
        throw new Error("GitHub returned the wrong update channel");
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const selected = selectUpdateAsset(
        assets,
        app.getVersion(),
        process.platform,
        process.arch,
      );
      if (!selected) {
        const hasNativePackage = assets.some((asset) =>
          Boolean(
            updateAssetVersion(
              String(asset.name || ""),
              process.platform,
              process.arch,
            ),
          ),
        );
        if (!hasNativePackage)
          throw new Error(
            `No ${channel.label} updater package has been uploaded yet`,
          );
        this.availableUpdate = null;
        this.update({
          state: "current",
          message: "osChat is up to date",
          version: app.getVersion(),
          channel: channel.label,
        });
        return this.getStatus();
      }
      const name = String(selected.asset.name || "");
      if (name !== updateAssetName(selected.version))
        throw new Error("The update package name is invalid");
      this.availableUpdate = {
        version: selected.version,
        name,
        asset: selected.asset,
        channel,
      };
      this.update({
        state: "available",
        message: `osChat ${selected.version} is available`,
        version: selected.version,
        channel: channel.label,
      });
      if (this.enabled) await this.downloadAvailable();
    } catch (error) {
      this.update({
        state: "error",
        message: `Update check failed: ${this.cleanError(error)}`,
        channel: channel.label,
      });
    } finally {
      this.checkInProgress = false;
    }
    return this.getStatus();
  }

  async downloadAvailable() {
    if (!this.supported()) return this.getStatus();
    if (this.downloadInProgress) return this.getStatus();
    if (!this.availableUpdate) {
      await this.check(true);
      if (!this.availableUpdate || this.status.state !== "available")
        return this.getStatus();
    }
    this.downloadInProgress = true;
    try {
      await this.download(this.availableUpdate);
    } catch (error) {
      this.update({
        state: "error",
        message: `Update download failed: ${this.cleanError(error)}`,
        version: this.availableUpdate.version,
        channel: this.availableUpdate.channel.label,
      });
    } finally {
      this.downloadInProgress = false;
    }
    return this.getStatus();
  }

  getStatus() {
    return { ...this.status };
  }

  isEnabled() {
    return this.enabled;
  }

  allowsNetworkUrl(rawUrl: string) {
    return isTrustedUpdateUrl(this.enabled, rawUrl);
  }

  async installReadyUpdate() {
    if (this.status.state !== "ready") return this.getStatus();
    const file = this.downloadedPackage;
    const expectedExtension =
      process.platform === "win32"
        ? ".exe"
        : process.platform === "darwin"
          ? ".dmg"
          : ".deb";
    if (!file || path.extname(file).toLowerCase() !== expectedExtension)
      return this.getStatus();
    const version = this.status.version;
    const channel = this.status.channel;
    try {
      if (process.platform !== "darwin") {
        const launchError = await shell.openPath(file);
        if (launchError) throw new Error(launchError);
      }
      this.update({
        state: "installing",
        message:
          process.platform === "darwin"
            ? "osChat is closing; the installer will open next"
            : "Installer opened; osChat is closing",
        version,
        channel,
        percent: 100,
      });
      const timeout = setTimeout(() => this.handoffInstaller(file), 150);
      timeout.unref();
    } catch (error) {
      this.update({
        state: "error",
        message: `Installer failed to open: ${this.cleanError(error)}`,
        version,
        channel,
      });
    }
    return this.getStatus();
  }

  cancelInstallHandoff() {
    if (this.status.state !== "installing" || !this.downloadedPackage)
      return this.getStatus();
    this.update({
      state: "ready",
      message: `osChat ${this.status.version || "update"} is downloaded and ready`,
      version: this.status.version,
      percent: 100,
      channel: this.status.channel,
    });
    return this.getStatus();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private supported() {
    return app.isPackaged && Boolean(this.channel());
  }

  private channel() {
    return updateChannel(process.platform, process.arch, os.release());
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.enabled || !this.supported()) return;
    this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private get updatesRoot() {
    return path.join(app.getPath("userData"), "updates");
  }

  private get readyMetadataPath() {
    return path.join(this.updatesRoot, "ready-update.json");
  }

  private async download(update: AvailableUpdate) {
    const url = String(update.asset.browser_download_url || "");
    const digest = String(update.asset.digest || "");
    const expectedBytes = Number(update.asset.size || 0);
    if (!isTrustedUpdateUrl(true, url))
      throw new Error("The update download address is not trusted");
    if (!/^sha256:[a-f0-9]{64}$/i.test(digest))
      throw new Error("The update has no trusted SHA-256 checksum");
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 10_000_000 ||
      expectedBytes > MAX_PACKAGE_BYTES
    )
      throw new Error("The update package size is invalid");
    const target = path.join(this.updatesRoot, update.name);
    const partial = `${target}.partial`;
    await fs.mkdir(this.updatesRoot, { recursive: true });
    await fs.rm(partial, { force: true });
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (
      !response.ok ||
      !response.body ||
      !isTrustedUpdateUrl(true, response.url)
    )
      throw new Error(`Update download failed (${response.status})`);
    let received = 0;
    let lastPercent = -1;
    const hash = createHash("sha256");
    const body = Readable.fromWeb(response.body as never);
    body.on("data", (chunk: Buffer) => {
      received += chunk.length;
      hash.update(chunk);
      const percent = Math.min(
        99,
        Math.floor((received / expectedBytes) * 100),
      );
      if (percent === lastPercent) return;
      lastPercent = percent;
      this.update({
        state: "downloading",
        message: `Downloading osChat ${update.version}`,
        version: update.version,
        percent,
        channel: update.channel.label,
      });
    });
    try {
      await pipeline(body, createWriteStream(partial, { flags: "w" }));
      if (received !== expectedBytes)
        throw new Error("The update download is incomplete");
      if (`sha256:${hash.digest("hex")}`.toLowerCase() !== digest.toLowerCase())
        throw new Error("The update failed checksum verification");
      await fs.rm(target, { force: true });
      await fs.rename(partial, target);
      const ready: ReadyUpdate = {
        version: update.version,
        name: update.name,
        digest: digest.toLowerCase(),
        bytes: expectedBytes,
        channelTag: update.channel.tag,
      };
      await fs.writeFile(
        this.readyMetadataPath,
        `${JSON.stringify(ready, null, 2)}\n`,
        { mode: 0o600 },
      );
      this.downloadedPackage = target;
      this.update({
        state: "ready",
        message: `osChat ${update.version} is downloaded and ready`,
        version: update.version,
        percent: 100,
        channel: update.channel.label,
      });
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async restoreReadyUpdate() {
    try {
      const raw = JSON.parse(
        await fs.readFile(this.readyMetadataPath, "utf8"),
      ) as Partial<ReadyUpdate>;
      const channel = this.channel();
      const version = String(raw.version || "");
      const name = String(raw.name || "");
      const digest = String(raw.digest || "");
      const bytes = Number(raw.bytes || 0);
      if (
        !channel ||
        raw.channelTag !== channel.tag ||
        !isNewerVersion(version, app.getVersion()) ||
        name !== updateAssetName(version) ||
        !/^sha256:[a-f0-9]{64}$/i.test(digest) ||
        !Number.isSafeInteger(bytes)
      )
        throw new Error("Stale update metadata");
      const file = path.join(this.updatesRoot, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes)
        throw new Error("Stale update package");
      const hash = createHash("sha256");
      await pipeline(createReadStream(file), hash);
      if (`sha256:${hash.digest("hex")}`.toLowerCase() !== digest.toLowerCase())
        throw new Error("Stored update checksum mismatch");
      this.downloadedPackage = file;
      this.update({
        state: "ready",
        message: `osChat ${version} is downloaded and ready`,
        version,
        percent: 100,
        channel: channel.label,
      });
      return true;
    } catch {
      await this.clearReadyUpdate();
      return false;
    }
  }

  private async clearReadyUpdate() {
    this.downloadedPackage = "";
    try {
      const raw = JSON.parse(
        await fs.readFile(this.readyMetadataPath, "utf8"),
      ) as Partial<ReadyUpdate>;
      const name = String(raw.name || "");
      if (name && name === path.basename(name))
        await fs.rm(path.join(this.updatesRoot, name), { force: true });
    } catch {
      // Missing or invalid metadata needs only the metadata cleanup below.
    }
    await fs.rm(this.readyMetadataPath, { force: true }).catch(() => {});
  }

  private update(next: Omit<AppUpdateStatus, "currentVersion">) {
    this.status = { ...next, currentVersion: app.getVersion() };
    this.emit(this.getStatus());
  }

  private cleanError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, "GitHub Releases").slice(0, 220);
  }
}
