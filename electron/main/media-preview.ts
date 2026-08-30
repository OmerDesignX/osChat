import path from "node:path";

export type ProjectMediaKind = "image" | "video" | "audio";

export type ProjectMediaType = {
  kind: ProjectMediaKind;
  mimeType: string;
};

const mediaTypes = new Map<string, ProjectMediaType>([
  [".png", { kind: "image", mimeType: "image/png" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg" }],
  [".gif", { kind: "image", mimeType: "image/gif" }],
  [".webp", { kind: "image", mimeType: "image/webp" }],
  [".avif", { kind: "image", mimeType: "image/avif" }],
  [".bmp", { kind: "image", mimeType: "image/bmp" }],
  [".ico", { kind: "image", mimeType: "image/x-icon" }],
  [".heic", { kind: "image", mimeType: "image/heic" }],
  [".heif", { kind: "image", mimeType: "image/heif" }],
  [".mp4", { kind: "video", mimeType: "video/mp4" }],
  [".m4v", { kind: "video", mimeType: "video/mp4" }],
  [".mov", { kind: "video", mimeType: "video/quicktime" }],
  [".webm", { kind: "video", mimeType: "video/webm" }],
  [".ogv", { kind: "video", mimeType: "video/ogg" }],
  [".mpeg", { kind: "video", mimeType: "video/mpeg" }],
  [".mpg", { kind: "video", mimeType: "video/mpeg" }],
  [".mkv", { kind: "video", mimeType: "video/x-matroska" }],
  [".avi", { kind: "video", mimeType: "video/x-msvideo" }],
  [".mp3", { kind: "audio", mimeType: "audio/mpeg" }],
  [".wav", { kind: "audio", mimeType: "audio/wav" }],
  [".wave", { kind: "audio", mimeType: "audio/wav" }],
  [".ogg", { kind: "audio", mimeType: "audio/ogg" }],
  [".oga", { kind: "audio", mimeType: "audio/ogg" }],
  [".opus", { kind: "audio", mimeType: "audio/opus" }],
  [".m4a", { kind: "audio", mimeType: "audio/mp4" }],
  [".aac", { kind: "audio", mimeType: "audio/aac" }],
  [".flac", { kind: "audio", mimeType: "audio/flac" }],
]);

export const MAX_IMAGE_PREVIEW_BYTES = 64 * 1024 * 1024;

export function projectMediaType(filename: string) {
  return mediaTypes.get(path.extname(filename).toLowerCase()) || null;
}

export function validateProjectMedia(filename: string, bytes: number) {
  const media = projectMediaType(filename);
  if (!media) throw new Error("This file is not a supported media format");
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error("The media file size is invalid");
  // Image decoders expand compressed input in memory. Audio and video are
  // streamed by Chromium, but unusually large still images are rejected.
  if (media.kind === "image" && bytes > MAX_IMAGE_PREVIEW_BYTES)
    throw new Error("Image previews are limited to 64 MB");
  return media;
}
