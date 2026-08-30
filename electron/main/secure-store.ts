import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAGIC = Buffer.from("OSCODESECURE\u0001", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type KeyProtectionStatus = {
  available: boolean;
  backend: string;
  reason?: string;
};

export type KeyProtector = {
  status(): Promise<KeyProtectionStatus> | KeyProtectionStatus;
  protect(value: Buffer): Promise<Buffer> | Buffer;
  unprotect(value: Buffer): Promise<Buffer> | Buffer;
};

const testKeys = new Map<string, Buffer>();

function contained(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function zero(value?: Buffer) {
  value?.fill(0);
}

/**
 * Test/development fallback used only when Electron's OS key provider was not
 * injected. The key lives in this process and is never written to disk.
 */
export function processKeyProtector(namespace: string): KeyProtector {
  const id = path.resolve(namespace).toLowerCase();
  if (!testKeys.has(id)) testKeys.set(id, crypto.randomBytes(32));
  return {
    status: () => ({ available: true, backend: "process-memory" }),
    protect: (value) => Buffer.from(value),
    unprotect: (value) => Buffer.from(value),
  };
}

/**
 * Persistent app-managed protection for installed builds on every platform.
 * SecureDataStore writes the generated device key beneath the application's
 * data directory with owner-only permissions; JSON payloads remain
 * authenticated AES-256-GCM ciphertext at rest without depending on Keychain,
 * DPAPI, Secret Service, or KWallet for normal operation.
 */
export function appLocalKeyProtector(): KeyProtector {
  return {
    status: () => ({ available: true, backend: "app-local-file" }),
    protect: (value) => Buffer.from(value),
    unprotect: (value) => Buffer.from(value),
  };
}

/**
 * Stop using an older OS-wrapped key without contacting the operating-system
 * credential store. The unreadable encrypted folder is retained as an inert,
 * owner-only archive and a fresh app-local store is created on this launch.
 */
export async function archiveLegacySecureStore(userData: string) {
  const secureRoot = path.join(userData, "secure");
  const target = path.join(secureRoot, "device-key.oscode-key");
  let wrapped: Buffer;
  try {
    wrapped = await fs.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (wrapped.length === 32) return false;
  const archive = path.join(
    userData,
    `secure-legacy-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`,
  );
  await fs.rename(secureRoot, archive);
  await fs.chmod(archive, 0o700).catch(() => undefined);
  zero(wrapped);
  return path.basename(archive);
}

export class SecureDataStore {
  private readonly secureRoot: string;
  private readonly wrappedKeyPath: string;
  private readyPromise: Promise<KeyProtectionStatus> | null = null;

  constructor(
    private readonly userData: string,
    private readonly protector: KeyProtector = processKeyProtector(userData),
  ) {
    this.secureRoot = path.join(userData, "secure");
    this.wrappedKeyPath = path.join(this.secureRoot, "device-key.oscode-key");
  }

  get root() {
    return this.secureRoot;
  }

  ready() {
    if (!this.readyPromise) this.readyPromise = this.initialize();
    return this.readyPromise;
  }

  private async initialize() {
    const status = await this.protector.status();
    if (!status.available)
      throw new Error(
        status.reason ||
          "Secure local storage is unavailable. Sensitive data will not be saved.",
      );
    await fs.mkdir(this.secureRoot, { recursive: true, mode: 0o700 });
    await fs.chmod(this.secureRoot, 0o700).catch(() => undefined);
    try {
      const wrapped = await fs.readFile(this.wrappedKeyPath);
      const key = await this.protector.unprotect(wrapped);
      try {
        if (key.length !== 32)
          throw new Error("The secure storage key is invalid");
      } finally {
        zero(key);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const key = crypto.randomBytes(32);
      try {
        const wrapped = await this.protector.protect(key);
        await this.atomicWrite(this.wrappedKeyPath, wrapped);
      } finally {
        zero(key);
      }
    }
    return status;
  }

  private async key() {
    await this.ready();
    const wrapped = await fs.readFile(this.wrappedKeyPath);
    const key = await this.protector.unprotect(wrapped);
    if (key.length !== 32) {
      zero(key);
      throw new Error("The secure storage key is invalid");
    }
    return key;
  }

  private assertTarget(target: string) {
    if (!contained(this.userData, target))
      throw new Error("Secure data must stay inside application data");
  }

  private async atomicWrite(target: string, value: Buffer) {
    this.assertTarget(target);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(target), 0o700).catch(() => undefined);
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, value, { mode: 0o600 });
    await fs.chmod(temporary, 0o600).catch(() => undefined);
    await fs.rename(temporary, target);
  }

  async encrypt(value: Buffer, namespace: string) {
    const key = await this.key();
    const iv = crypto.randomBytes(IV_BYTES);
    try {
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(namespace, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
    } finally {
      zero(key);
    }
  }

  async decrypt(value: Buffer, namespace: string) {
    if (!value.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error("This file is not encrypted osChat data");
    const key = await this.key();
    const ivStart = MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const dataStart = tagStart + TAG_BYTES;
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(ivStart, tagStart),
      );
      decipher.setAAD(Buffer.from(namespace, "utf8"));
      decipher.setAuthTag(value.subarray(tagStart, dataStart));
      return Buffer.concat([
        decipher.update(value.subarray(dataStart)),
        decipher.final(),
      ]);
    } finally {
      zero(key);
    }
  }

  async writeJson(target: string, value: unknown, namespace = target) {
    const plain = Buffer.from(JSON.stringify(value), "utf8");
    try {
      await this.atomicWrite(target, await this.encrypt(plain, namespace));
    } finally {
      zero(plain);
    }
  }

  async readJson<T>(
    target: string,
    fallback: T,
    namespace = target,
    legacyPlaintextPath?: string,
  ): Promise<T> {
    this.assertTarget(target);
    try {
      const encrypted = await fs.readFile(target);
      const plain = await this.decrypt(encrypted, namespace);
      try {
        return JSON.parse(plain.toString("utf8")) as T;
      } finally {
        zero(plain);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (legacyPlaintextPath) {
      this.assertTarget(legacyPlaintextPath);
      try {
        const legacy = JSON.parse(
          await fs.readFile(legacyPlaintextPath, "utf8"),
        ) as T;
        await this.writeJson(target, legacy, namespace);
        await fs.rm(legacyPlaintextPath, { force: true });
        return legacy;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return fallback;
  }

  async remove(target: string) {
    this.assertTarget(target);
    await fs.rm(target, { force: true });
  }

  /** Remove obsolete prompt artefacts that could contain unencrypted chat text. */
  async purgeLegacyPromptData() {
    for (const target of [
      path.join(this.userData, "ai", "tasks"),
      path.join(this.userData, "ai", "prompt-cache"),
    ]) {
      this.assertTarget(target);
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink())
          throw new Error("Refusing to follow a legacy data link");
        await fs.rm(target, { recursive: stat.isDirectory(), force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
