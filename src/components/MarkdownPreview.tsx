import { useEffect, useId, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import mermaid from "mermaid";
import { FeatherIcon } from "./FeatherIcon";

type Props = {
  content: string;
  filePath: string;
  theme: "dark" | "blue-dark" | "blue-light";
  onNotice: (message: string) => void;
};

function MarkdownPart({
  value,
  filePath,
}: {
  value: string;
  filePath: string;
}) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let active = true;
    const render = async () => {
      const clean = DOMPurify.sanitize(marked.parse(value) as string);
      const document = new DOMParser().parseFromString(clean, "text/html");
      await Promise.all(
        [...document.querySelectorAll("img")].map(async (image) => {
          const source = image.getAttribute("src") || "";
          image.removeAttribute("srcset");
          if (source.startsWith("data:image/")) return;
          image.removeAttribute("src");
          if (!source || /^[a-z][a-z0-9+.-]*:/i.test(source)) return;
          try {
            image.setAttribute(
              "src",
              await window.oscode.readMarkdownImage(filePath, source),
            );
          } catch {
            image.setAttribute("data-missing", "true");
          }
        }),
      );
      if (active) setHtml(document.body.innerHTML);
    };
    void render();
    return () => {
      active = false;
    };
  }, [value, filePath]);
  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

type Part =
  | { kind: "markdown"; value: string; key: string }
  | { kind: "mermaid"; value: string; key: string };

function splitMarkdown(content: string): Part[] {
  const parts: Part[] = [];
  const pattern = /```mermaid[^\S\r\n]*(?:\r?\n)([\s\S]*?)```/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    if (match.index > cursor)
      parts.push({
        kind: "markdown",
        value: content.slice(cursor, match.index),
        key: `markdown-${cursor}`,
      });
    parts.push({
      kind: "mermaid",
      value: match[1].trim(),
      key: `mermaid-${match.index}`,
    });
    cursor = pattern.lastIndex;
  }
  if (cursor < content.length || !parts.length)
    parts.push({
      kind: "markdown",
      value: content.slice(cursor),
      key: `markdown-${cursor}`,
    });
  return parts;
}

async function svgToPng(svg: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Diagram image could not render"));
      image.src = url;
    });
    const width = Math.max(1, Math.ceil(image.naturalWidth || 1200));
    const height = Math.max(1, Math.ceil(image.naturalHeight || 800));
    const scale = Math.min(2, 4096 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Diagram image could not render");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Diagram({
  source,
  theme,
  onNotice,
}: {
  source: string;
  theme: Props["theme"];
  onNotice: Props["onNotice"];
}) {
  const reactId = useId().replace(/[^a-z0-9]/gi, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "blue-light" ? "neutral" : "dark",
      suppressErrorRendering: true,
    });
    void mermaid
      .render(`oscodeDiagram${reactId}${Date.now()}`, source)
      .then(({ svg: rendered }) => {
        if (active) {
          setSvg(rendered);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Diagram is invalid",
          );
      });
    return () => {
      active = false;
    };
  }, [source, theme, reactId]);

  const exportDiagram = async (
    action: "copy" | "save",
    format: "svg" | "png",
  ) => {
    try {
      const data = format === "svg" ? svg : await svgToPng(svg);
      const complete = await window.oscode.exportDiagram(action, format, data);
      if (complete)
        onNotice(
          `${format.toUpperCase()} ${action === "copy" ? "copied" : "saved"}`,
        );
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : "Diagram export failed",
      );
    }
  };

  if (error)
    return (
      <div className="markdown-diagram-error">
        <b>Diagram could not render</b>
        <span>{error}</span>
      </div>
    );
  if (!svg)
    return <div className="markdown-diagram-loading">Rendering diagram…</div>;
  return (
    <figure className="markdown-diagram">
      <div
        className="markdown-diagram-canvas"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          }),
        }}
      />
      <figcaption>
        <button onClick={() => void exportDiagram("copy", "svg")}>
          <FeatherIcon icon="copy" size="14" /> Copy SVG
        </button>
        <button onClick={() => void exportDiagram("save", "svg")}>
          <FeatherIcon icon="save" size="14" /> Save SVG
        </button>
        <button onClick={() => void exportDiagram("copy", "png")}>
          <FeatherIcon icon="copy" size="14" /> Copy PNG
        </button>
        <button onClick={() => void exportDiagram("save", "png")}>
          <FeatherIcon icon="image" size="14" /> Save PNG
        </button>
      </figcaption>
    </figure>
  );
}

export function MarkdownPreview({ content, filePath, theme, onNotice }: Props) {
  const parts = useMemo(() => splitMarkdown(content), [content]);
  return (
    <section className="markdown-preview" aria-label="Markdown preview">
      {parts.map((part) =>
        part.kind === "mermaid" ? (
          <Diagram
            key={part.key}
            source={part.value}
            theme={theme}
            onNotice={onNotice}
          />
        ) : (
          <MarkdownPart key={part.key} value={part.value} filePath={filePath} />
        ),
      )}
    </section>
  );
}
