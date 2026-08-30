export function validateGitRemote(value: unknown) {
  if (typeof value !== "string")
    throw new Error("Enter a Git remote destination");
  const remote = value.trim();
  if (!remote || remote.length > 2048 || /[\u0000-\u001f\u007f]/.test(remote))
    throw new Error("Enter a valid Git remote destination");

  const scpStyle = remote.match(
    /^([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):([^\s]+)$/,
  );
  if (scpStyle) {
    if (!scpStyle[2].includes(".") || scpStyle[3].startsWith("-"))
      throw new Error("Enter a valid SSH Git destination");
    return remote;
  }

  let parsed: URL;
  try {
    parsed = new URL(remote);
  } catch {
    throw new Error("Use an HTTPS, SSH, or file Git URL");
  }
  if (!["https:", "ssh:", "file:"].includes(parsed.protocol))
    throw new Error("Only HTTPS, SSH, and file Git remotes are supported");
  if (parsed.protocol !== "file:" && !parsed.hostname)
    throw new Error("The Git remote must include a host");
  if (parsed.protocol === "https:" && (parsed.username || parsed.password))
    throw new Error("Do not place credentials in a Git remote URL");
  if (parsed.protocol === "file:" && !parsed.pathname)
    throw new Error("The file Git remote must include a path");
  return remote;
}

export function validateGitBranch(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter a branch name");
  const branch = value.trim();
  if (
    !branch ||
    branch.length > 255 ||
    branch.startsWith("-") ||
    /[\u0000-\u001f\u007f]/.test(branch)
  )
    throw new Error("Enter a valid branch name");
  return branch;
}

export function validateGitIdentity(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter a Git identity");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Enter a valid Git identity");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("Enter a valid Git identity");
  const { name, email } = parsed as { name?: unknown; email?: unknown };
  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new Error("Enter a name and valid email address");
  return { name: name.trim(), email };
}

export function validateTerminalId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    throw new Error("Invalid terminal identifier");
  return value;
}

export function validateTerminalInput(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 65_536)
    throw new Error("Invalid terminal input");
  return value;
}

export function validTerminalSize(cols: unknown, rows: unknown) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    (cols as number) >= 2 &&
    (cols as number) <= 500 &&
    (rows as number) >= 2 &&
    (rows as number) <= 200
  );
}

export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;

export function validateTextContent(value: unknown) {
  if (typeof value !== "string") throw new Error("File content must be text");
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_FILE_BYTES)
    throw new Error("Text files are limited to 10 MB");
  return value;
}

export function decodeTextFile(data: Uint8Array) {
  if (data.byteLength > MAX_TEXT_FILE_BYTES)
    throw new Error("Text files are limited to 10 MB");
  if (data.subarray(0, 8192).includes(0))
    throw new Error("Binary files cannot be opened in the text editor");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error("This file is not valid UTF-8 text");
  }
}
