import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import type { AiChatAttachment } from "../types.js";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENT_DATA_URL = 16_800_000;
const MAX_ATTACHMENT_TEXT = 160_000;

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const audioTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
]);
const videoTypes = new Set([
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm",
]);
const documentTypes = new Set([
  "application/json",
  "application/pdf",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/rtf",
  "text/xml",
]);
const textExtensions = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export function aiAttachmentKind(
  mimeTypeValue: unknown,
  nameValue: unknown,
): AiChatAttachment["kind"] | "" {
  const mimeType =
    typeof mimeTypeValue === "string" ? mimeTypeValue.toLowerCase() : "";
  const name = typeof nameValue === "string" ? nameValue : "";
  const extension = path.extname(name).toLowerCase();
  if (imageTypes.has(mimeType)) return "image";
  if (
    audioTypes.has(mimeType) ||
    [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].includes(extension)
  )
    return "audio";
  if (
    videoTypes.has(mimeType) ||
    [".m4v", ".mov", ".mp4", ".ogv", ".webm"].includes(extension)
  )
    return "video";
  if (
    documentTypes.has(mimeType) ||
    mimeType.startsWith("text/") ||
    textExtensions.has(extension) ||
    [".docx", ".pdf", ".rtf"].includes(extension)
  )
    return "document";
  return "";
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function decodeAttachmentDataUrl(dataUrl: string, mimeType: string) {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix) || dataUrl.length > MAX_ATTACHMENT_DATA_URL)
    throw new Error("The attachment data is invalid or too large");
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new Error("The attachment data is invalid");
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > MAX_ATTACHMENT_BYTES)
    throw new Error("Attachments must be 12 MB or smaller");
  return data;
}

function readableText(data: Buffer) {
  return data
    .toString("utf8")
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, MAX_ATTACHMENT_TEXT)
    .trim();
}

function readableRtf(data: Buffer) {
  return data
    .toString("utf8")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_ATTACHMENT_TEXT)
    .trim();
}

async function pdfText(data: Buffer) {
  // PDF.js is large and its optional drawing polyfills are expensive to load
  // through Rosetta. Keep it off the application startup path and initialize it
  // only for a PDF the user explicitly attaches.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    standardFontDataUrl: `${fileURLToPath(
      new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
    )}${path.sep}`,
    useWorkerFetch: false,
  });
  const document = await loading.promise;
  try {
    const pages: string[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) =>
          item && typeof item === "object" && "str" in item
            ? [String(item.str)]
            : [],
        )
        .join(" ")
        .trim();
      if (text) {
        const block = `Page ${pageNumber}\n${text}`;
        pages.push(block);
        length += block.length;
      }
      if (length >= MAX_ATTACHMENT_TEXT) break;
    }
    return pages.join("\n\n").slice(0, MAX_ATTACHMENT_TEXT).trim();
  } finally {
    await loading.destroy();
  }
}

async function documentText(name: string, mimeType: string, data: Buffer) {
  const extension = path.extname(name).toLowerCase();
  if (mimeType === "application/pdf" || extension === ".pdf")
    return pdfText(data);
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    const result = await mammoth.extractRawText({ buffer: data });
    return result.value.slice(0, MAX_ATTACHMENT_TEXT).trim();
  }
  if (
    ["application/rtf", "text/rtf"].includes(mimeType) ||
    extension === ".rtf"
  )
    return readableRtf(data);
  return readableText(data);
}

export async function prepareAiAttachments(
  value: unknown,
): Promise<AiChatAttachment[]> {
  if (!Array.isArray(value)) return [];
  let total = 0;
  const prepared: AiChatAttachment[] = [];
  for (const raw of value.slice(0, 6)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = cleanText(item.name, 240).trim() || "Attachment";
    const mimeType = cleanText(item.mimeType, 120).toLowerCase().trim();
    const kind = aiAttachmentKind(mimeType, name);
    const dataUrl = cleanText(item.dataUrl, MAX_ATTACHMENT_DATA_URL);
    if (!kind || !mimeType || !dataUrl) continue;
    try {
      const data = decodeAttachmentDataUrl(dataUrl, mimeType);
      if (total + data.length > 24 * 1024 * 1024) continue;
      total += data.length;
      let extractedText = "";
      let processingError = "";
      if (kind === "document") {
        try {
          extractedText = await documentText(name, mimeType, data);
          if (!extractedText)
            processingError = "No readable text was found in this document";
        } catch {
          processingError = "This document could not be decoded locally";
        }
      }
      prepared.push({
        id: cleanText(item.id, 100) || randomUUID(),
        name,
        kind,
        mimeType,
        dataUrl,
        size: data.length,
        extractedText: extractedText || undefined,
        processingError: processingError || undefined,
      });
    } catch {
      // Invalid or oversized files never reach inference or encrypted history.
    }
  }
  return prepared;
}

export type MaterializedAiMedia = {
  root: string;
  files: Array<{
    kind: "image" | "audio" | "video";
    path: string;
    name: string;
  }>;
  cleanup: () => Promise<void>;
};

const privateMediaExtensions: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/m4a": ".m4a",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-m4a": ".m4a",
  "video/mp4": ".mp4",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export async function materializeAiMedia(
  messages: Array<{ attachments?: AiChatAttachment[] }>,
  privateRoot: string,
): Promise<MaterializedAiMedia> {
  const root = path.join(privateRoot, randomUUID());
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const files: MaterializedAiMedia["files"] = [];
  try {
    for (const message of messages) {
      for (const attachment of message.attachments || []) {
        if (attachment.kind === "document") continue;
        const data = decodeAttachmentDataUrl(
          attachment.dataUrl,
          attachment.mimeType,
        );
        const extension =
          privateMediaExtensions[attachment.mimeType] ||
          (attachment.kind === "image"
            ? ".img"
            : attachment.kind === "audio"
              ? ".audio"
              : ".video");
        const destination = path.join(
          root,
          `${String(files.length + 1).padStart(2, "0")}-${attachment.kind}${extension}`,
        );
        await fs.writeFile(destination, data, { mode: 0o600, flag: "wx" });
        data.fill(0);
        files.push({
          kind: attachment.kind,
          path: destination,
          name: attachment.name,
        });
      }
    }
    return {
      root,
      files,
      cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
