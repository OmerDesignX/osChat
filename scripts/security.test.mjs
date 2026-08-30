import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTextFile,
  MAX_TEXT_FILE_BYTES,
  validateGitBranch,
  validateGitIdentity,
  validateGitRemote,
  validateTerminalId,
  validateTerminalInput,
  validateTextContent,
  validTerminalSize,
} from "../dist-electron/main/security.js";
import {
  MAX_IMAGE_PREVIEW_BYTES,
  projectMediaType,
  validateProjectMedia,
} from "../dist-electron/main/media-preview.js";

test("accepts explicit HTTPS, SSH, SCP-style, and local file remotes", () => {
  assert.equal(
    validateGitRemote(" https://github.com/example/project.git "),
    "https://github.com/example/project.git",
  );
  assert.equal(
    validateGitRemote("ssh://git@example.com/example/project.git"),
    "ssh://git@example.com/example/project.git",
  );
  assert.equal(
    validateGitRemote("git@github.com:example/project.git"),
    "git@github.com:example/project.git",
  );
  assert.equal(
    validateGitRemote("file:///tmp/project.git"),
    "file:///tmp/project.git",
  );
});

test("rejects executable Git helpers, implicit paths, and embedded credentials", () => {
  for (const remote of [
    "ext::sh -c calc",
    "fd::3",
    "git://example.com/project.git",
    "../project.git",
    "https://token@example.com/project.git",
    "git@example:--upload-pack=bad",
  ])
    assert.throws(() => validateGitRemote(remote));
});

test("validates local branch names and repository identities", () => {
  assert.equal(validateGitBranch(" feature/calm-ui "), "feature/calm-ui");
  for (const branch of ["", "-delete", "bad\nbranch", "x".repeat(256)])
    assert.throws(() => validateGitBranch(branch));
  assert.deepEqual(
    validateGitIdentity(
      JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com" }),
    ),
    { name: "Ada Lovelace", email: "ada@example.com" },
  );
  for (const identity of [
    "not json",
    JSON.stringify({ name: "", email: "ada@example.com" }),
    JSON.stringify({ name: "Ada", email: "not-an-email" }),
  ])
    assert.throws(() => validateGitIdentity(identity));
});

test("bounds terminal identifiers, writes, and dimensions", () => {
  assert.equal(validateTerminalId("main-123"), "main-123");
  assert.throws(() => validateTerminalId("../../terminal"));
  assert.equal(
    validateTerminalInput("python --version\r"),
    "python --version\r",
  );
  assert.throws(() => validateTerminalInput(""));
  assert.equal(validTerminalSize(120, 40), true);
  assert.equal(validTerminalSize(1, 40), false);
  assert.equal(validTerminalSize(120, 500), false);
});

test("accepts bounded UTF-8 text and rejects binary or malformed files", () => {
  assert.equal(
    decodeTextFile(Buffer.from("const ready = true;\n")),
    "const ready = true;\n",
  );
  assert.equal(validateTextContent("hello"), "hello");
  assert.throws(() => decodeTextFile(Buffer.from([0x66, 0x00, 0x6f])));
  assert.throws(() => decodeTextFile(Buffer.from([0xc3, 0x28])));
  assert.throws(() => validateTextContent(Buffer.from("not text")));
});

test("caps text files before they reach the renderer", () => {
  const oversized = new Uint8Array(MAX_TEXT_FILE_BYTES + 1);
  oversized.fill(0x61);
  assert.throws(() => decodeTextFile(oversized), /10 MB/);
  assert.throws(
    () => validateTextContent("a".repeat(MAX_TEXT_FILE_BYTES + 1)),
    /10 MB/,
  );
});

test("classifies common local image, video, and audio preview formats", () => {
  assert.deepEqual(projectMediaType("photo.JPEG"), {
    kind: "image",
    mimeType: "image/jpeg",
  });
  assert.deepEqual(projectMediaType("clip.mp4"), {
    kind: "video",
    mimeType: "video/mp4",
  });
  assert.deepEqual(projectMediaType("voice.flac"), {
    kind: "audio",
    mimeType: "audio/flac",
  });
  assert.equal(projectMediaType("main.ts"), null);
});

test("bounds decoded images without preventing streamed audio and video", () => {
  assert.equal(validateProjectMedia("photo.webp", 1024).kind, "image");
  assert.equal(validateProjectMedia("movie.webm", 2_000_000_000).kind, "video");
  assert.throws(
    () => validateProjectMedia("photo.png", MAX_IMAGE_PREVIEW_BYTES + 1),
    /64 MB/,
  );
  assert.throws(() => validateProjectMedia("archive.zip", 100));
});
