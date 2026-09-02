import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { FeatherIcon } from "./FeatherIcon";
import { MiniWidget } from "./MiniWidget";
import {
  isMiniWidgetType,
  normalizeMiniWidget,
  type MiniWidgetPayload,
  type MiniWidgetType,
} from "../lib/mini-widget";

export type ChatArtifactPayload = {
  type:
    | "document"
    | "spreadsheet"
    | "presentation"
    | "table"
    | "chart"
    | "metric"
    | MiniWidgetType;
  title?: string;
  description?: string;
  headers?: string[];
  rows?: Array<Array<string | number>>;
  labels?: string[];
  values?: number[];
  value?: string | number;
  unit?: string;
  content?: string;
  data?: unknown;
} & Partial<
  Omit<MiniWidgetPayload, "type" | "title" | "description" | "value">
>;

type Props = {
  content: string;
  onOpenArtifact?: (artifact: ChatArtifactPayload) => void;
};

const artifactBlock = /```oschat-(?:artifact|widget)\s*\n([\s\S]*?)```/gi;
const websiteIconCache = new Map<string, string>();
const websiteIconRequests = new Map<string, Promise<string>>();

function artifactMarkdown(content: string) {
  const clean = DOMPurify.sanitize(marked.parse(content) as string, {
    FORBID_TAGS: [
      "audio",
      "embed",
      "iframe",
      "img",
      "object",
      "style",
      "video",
    ],
  });
  const document = new DOMParser().parseFromString(clean, "text/html");
  for (const link of document.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    if (!/^https:\/\//i.test(href)) link.removeAttribute("href");
    else {
      link.setAttribute("rel", "noreferrer noopener");
      link.setAttribute("target", "_blank");
    }
  }
  return document.body.innerHTML;
}

function websiteOrigin(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function publicLinks(content: string) {
  const withoutArtifacts = content.replace(artifactBlock, "");
  const clean = DOMPurify.sanitize(marked.parse(withoutArtifacts) as string, {
    FORBID_TAGS: ["audio", "embed", "iframe", "img", "object", "video"],
  });
  const document = new DOMParser().parseFromString(clean, "text/html");
  const unique = new Map<string, string>();
  for (const heading of document.querySelectorAll("h2, h3, h4")) {
    if (
      !/^(?:sources?(?: used)?|references?)$/i.test(
        heading.textContent?.trim() || "",
      )
    )
      continue;
    const list = heading.nextElementSibling;
    if (list?.tagName !== "UL" && list?.tagName !== "OL") continue;
    for (const link of list.querySelectorAll("a")) {
      const href = link.getAttribute("href") || "";
      const origin = websiteOrigin(href);
      if (origin && !unique.has(origin)) unique.set(origin, href);
    }
  }
  return [...unique.entries()].map(([origin, href]) => ({ origin, href }));
}

async function cachedWebsiteIcon(origin: string, href: string) {
  if (websiteIconCache.has(origin)) return websiteIconCache.get(origin) || "";
  const existing = websiteIconRequests.get(origin);
  if (existing) return existing;
  const pending = window.oscode
    .websiteIcon(href)
    .then((icon) => (/^data:image\//i.test(icon) ? icon : ""))
    .catch(() => "")
    .then((icon) => {
      websiteIconCache.set(origin, icon);
      websiteIconRequests.delete(origin);
      return icon;
    });
  websiteIconRequests.set(origin, pending);
  return pending;
}

function artifactIcon(type: ChatArtifactPayload["type"]) {
  if (type === "spreadsheet" || type === "table") return "grid";
  if (type === "presentation") return "monitor";
  if (type === "chart" || type === "metric") return "bar-chart-2";
  if (type === "checklist") return "check-square";
  if (type === "quiz") return "help-circle";
  if (type === "poll") return "pie-chart";
  if (type === "counter") return "hash";
  if (type === "timer") return "clock";
  if (type === "flashcards") return "layers";
  if (type === "calculator") return "sliders";
  return "file-text";
}

function csvCell(value: unknown) {
  const source = String(value ?? "");
  return /[",\r\n]/.test(source) ? `"${source.replace(/"/g, '""')}"` : source;
}

function safeOutputName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 120) || "osChat-output"
  );
}

function codeExtension(language: string) {
  const extensions: Record<string, string> = {
    bash: "sh",
    c: "c",
    cpp: "cpp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    javascript: "js",
    js: "js",
    json: "json",
    jsx: "jsx",
    markdown: "md",
    md: "md",
    python: "py",
    py: "py",
    ruby: "rb",
    rust: "rs",
    shell: "sh",
    sql: "sql",
    swift: "swift",
    ts: "ts",
    tsx: "tsx",
    typescript: "ts",
    xml: "xml",
    yaml: "yml",
    yml: "yml",
  };
  return extensions[language.toLocaleLowerCase()] || "txt";
}

function artifactOutput(artifact: ChatArtifactPayload, title: string) {
  const headers = Array.isArray(artifact.headers) ? artifact.headers : [];
  const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
  if (artifact.type === "table" || artifact.type === "spreadsheet") {
    return {
      name: `${safeOutputName(title)}.csv`,
      content: [...(headers.length ? [headers] : []), ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\n"),
    };
  }
  if (artifact.type === "chart") {
    const labels = Array.isArray(artifact.labels) ? artifact.labels : [];
    const values = Array.isArray(artifact.values) ? artifact.values : [];
    return {
      name: `${safeOutputName(title)}.csv`,
      content: [
        "Label,Value",
        ...values.map(
          (value, index) =>
            `${csvCell(labels[index] || index + 1)},${csvCell(value)}`,
        ),
      ].join("\n"),
    };
  }
  if (isMiniWidgetType(artifact.type)) {
    return {
      name: `${safeOutputName(title)}.json`,
      content: JSON.stringify(artifact, null, 2),
    };
  }
  const content =
    artifact.content?.trim() ||
    (artifact.type === "metric"
      ? `${title}\n${String(artifact.value ?? "")}${artifact.unit ? ` ${artifact.unit}` : ""}`
      : JSON.stringify(artifact.data ?? artifact, null, 2));
  return {
    name: `${safeOutputName(title)}.${artifact.type === "document" || artifact.type === "presentation" ? "md" : "txt"}`,
    content,
  };
}

function ArtifactPreview({
  artifact,
  onOpen,
}: {
  artifact: ChatArtifactPayload;
  onOpen?: (artifact: ChatArtifactPayload) => void;
}) {
  const [tableQuery, setTableQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<
    "ascending" | "descending"
  >("ascending");
  const [outputStatus, setOutputStatus] = useState("");
  const title =
    artifact.title?.trim() ||
    artifact.type[0].toUpperCase() + artifact.type.slice(1);
  const rows = Array.isArray(artifact.rows) ? artifact.rows.slice(0, 12) : [];
  const headers = Array.isArray(artifact.headers)
    ? artifact.headers.slice(0, 12)
    : [];
  const values = Array.isArray(artifact.values)
    ? artifact.values.slice(0, 12).map((value) => Number(value) || 0)
    : [];
  const maximum = Math.max(1, ...values.map((value) => Math.abs(value)));
  const contentHtml = useMemo(
    () => artifactMarkdown(artifact.content?.slice(0, 12_000) || ""),
    [artifact.content],
  );
  const normalizedQuery = tableQuery.trim().toLocaleLowerCase();
  const visibleRows = rows
    .filter(
      (row) =>
        !normalizedQuery ||
        row.some((item) =>
          String(item).toLocaleLowerCase().includes(normalizedQuery),
        ),
    )
    .sort((left, right) => {
      if (sortColumn === null) return 0;
      const leftValue = String(left[sortColumn] ?? "");
      const rightValue = String(right[sortColumn] ?? "");
      const order = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "ascending" ? order : -order;
    });
  const changeSort = (column: number) => {
    if (sortColumn === column) {
      setSortDirection((current) =>
        current === "ascending" ? "descending" : "ascending",
      );
      return;
    }
    setSortColumn(column);
    setSortDirection("ascending");
  };
  const output = useMemo(
    () => artifactOutput(artifact, title),
    [artifact, title],
  );
  const showOutputStatus = (message: string) => {
    setOutputStatus(message);
    window.setTimeout(() => setOutputStatus(""), 1800);
  };
  const copyOutput = async () => {
    await window.oscode.copyChatOutput(output.content);
    showOutputStatus("Copied");
  };
  const downloadOutput = async () => {
    const saved = await window.oscode.downloadChatOutput(
      output.name,
      output.content,
    );
    if (saved) showOutputStatus("Downloaded");
  };
  return (
    <section className="chat-artifact-card" aria-label={`${title} artifact`}>
      <header>
        <span>
          <FeatherIcon icon={artifactIcon(artifact.type)} size="17" />
          <span>
            <b>{title}</b>
            <small>{artifact.type}</small>
          </span>
        </span>
        <span className="chat-artifact-actions">
          {outputStatus && <small role="status">{outputStatus}</small>}
          {onOpen &&
            ["document", "spreadsheet", "presentation"].includes(
              artifact.type,
            ) && (
              <button type="button" onClick={() => onOpen(artifact)}>
                Open workspace
                <FeatherIcon icon="arrow-up-right" size="14" />
              </button>
            )}
          <button
            type="button"
            className="chat-artifact-icon-action"
            aria-label={`Copy ${title}`}
            title={`Copy ${title}`}
            onClick={() => void copyOutput()}
          >
            <FeatherIcon icon="copy" size="14" />
          </button>
          <button
            type="button"
            className="chat-artifact-icon-action"
            aria-label={`Download ${title}`}
            title={`Download ${title}`}
            onClick={() => void downloadOutput()}
          >
            <FeatherIcon icon="download" size="14" />
          </button>
        </span>
      </header>
      {artifact.description && <p>{artifact.description}</p>}
      {artifact.type === "metric" && (
        <div className="chat-artifact-metric">
          <strong>{String(artifact.value ?? "—")}</strong>
          {artifact.unit && <span>{artifact.unit}</span>}
        </div>
      )}
      {(artifact.type === "table" || artifact.type === "spreadsheet") &&
        (headers.length > 0 || rows.length > 0) && (
          <div className="chat-artifact-table-wrap">
            <label className="chat-artifact-table-filter">
              <FeatherIcon icon="search" size="15" />
              <input
                type="search"
                value={tableQuery}
                placeholder="Filter rows"
                aria-label={`Filter ${title}`}
                onChange={(event) => setTableQuery(event.target.value)}
              />
              <span>
                {visibleRows.length} of {rows.length}
              </span>
            </label>
            <table>
              {headers.length > 0 && (
                <thead>
                  <tr>
                    {headers.map((item, index) => (
                      <th
                        key={`${item}-${index}`}
                        aria-sort={
                          sortColumn === index ? sortDirection : "none"
                        }
                      >
                        <button type="button" onClick={() => changeSort(index)}>
                          {item}
                          <FeatherIcon
                            icon={
                              sortColumn === index
                                ? sortDirection === "ascending"
                                  ? "chevron-up"
                                  : "chevron-down"
                                : "chevrons-up"
                            }
                            size="13"
                          />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.slice(0, 12).map((item, columnIndex) => (
                      <td key={columnIndex}>{String(item)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {artifact.type === "chart" && values.length > 0 && (
        <div className="chat-artifact-chart" role="img" aria-label={title}>
          {values.map((value, index) => (
            <div key={index}>
              <span
                style={{
                  height: `${Math.max(5, (Math.abs(value) / maximum) * 100)}%`,
                }}
                title={`${artifact.labels?.[index] || index + 1}: ${value}`}
              />
              <small>{artifact.labels?.[index] || index + 1}</small>
            </div>
          ))}
        </div>
      )}
      {isMiniWidgetType(artifact.type) && (
        <MiniWidget payload={artifact as MiniWidgetPayload} />
      )}
      {contentHtml && (
        <div
          className="chat-artifact-copy ai-formatted-copy"
          onClick={(event) => {
            const link = (event.target as HTMLElement).closest("a");
            const href = link?.getAttribute("href") || "";
            if (!/^https:\/\//i.test(href)) return;
            event.preventDefault();
            void window.oscode.openExternalUrl(href);
          }}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      )}
    </section>
  );
}

export function AiMessageContent({ content, onOpenArtifact }: Props) {
  const sourceLinks = useMemo(() => publicLinks(content), [content]);
  const [websiteIcons, setWebsiteIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void Promise.all(
      sourceLinks.map(async ({ origin, href }) => ({
        origin,
        icon: await cachedWebsiteIcon(origin, href),
      })),
    ).then((icons) => {
      if (!active) return;
      setWebsiteIcons((current) => {
        const next = { ...current };
        for (const { origin, icon } of icons) next[origin] = icon;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [sourceLinks]);

  const parsed = useMemo(() => {
    const artifacts: ChatArtifactPayload[] = [];
    const markdown = content.replace(
      artifactBlock,
      (_block, source: string) => {
        try {
          if (source.length > 200_000) return "";
          const value = JSON.parse(source) as ChatArtifactPayload;
          if (!value) return "";
          if (isMiniWidgetType(value.type)) {
            const widget = normalizeMiniWidget(value);
            if (widget) artifacts.push(widget);
          } else if (
            [
              "document",
              "spreadsheet",
              "presentation",
              "table",
              "chart",
              "metric",
            ].includes(value.type)
          ) {
            artifacts.push(value);
          }
        } catch {
          // Malformed widget data remains inert and is not rendered as HTML.
        }
        return "";
      },
    );
    const clean = DOMPurify.sanitize(marked.parse(markdown) as string, {
      FORBID_TAGS: [
        "audio",
        "embed",
        "iframe",
        "img",
        "object",
        "style",
        "video",
      ],
    });
    const document = new DOMParser().parseFromString(clean, "text/html");
    for (const table of document.querySelectorAll("table")) {
      const headers = [...table.querySelectorAll("thead th")]
        .map((cell) => cell.textContent?.trim() || "")
        .slice(0, 12);
      const rows = [...table.querySelectorAll("tbody tr")]
        .map((row) =>
          [...row.querySelectorAll("th, td")]
            .map((cell) => cell.textContent?.trim() || "")
            .slice(0, 12),
        )
        .filter((row) => row.length > 0)
        .slice(0, 12);
      if (!headers.length && !rows.length) continue;
      const heading = table.previousElementSibling;
      artifacts.push({
        type: "table",
        title:
          heading && /^H[2-4]$/.test(heading.tagName)
            ? heading.textContent?.trim() || "Interactive table"
            : "Interactive table",
        headers,
        rows,
      });
      table.remove();
    }
    for (const heading of document.querySelectorAll("h2, h3, h4")) {
      if (
        !/^(?:sources?(?: used)?|references?)$/i.test(
          heading.textContent?.trim() || "",
        )
      )
        continue;
      const list = heading.nextElementSibling;
      if (list?.tagName === "UL" || list?.tagName === "OL")
        list.classList.add("ai-source-list");
    }
    for (const pre of document.querySelectorAll("pre")) {
      const code = pre.querySelector("code");
      if (!code) continue;
      const language =
        [...code.classList]
          .find((name) => name.startsWith("language-"))
          ?.slice("language-".length) || "code";
      const wrapper = document.createElement("section");
      wrapper.className = "ai-code-output";
      wrapper.dataset.language = language;
      const toolbar = document.createElement("header");
      const label = document.createElement("span");
      label.textContent = language === "code" ? "Code" : language;
      toolbar.append(label);
      for (const action of ["copy", "download"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.chatOutputAction = action;
        button.textContent = action === "copy" ? "Copy" : "Download";
        button.setAttribute(
          "aria-label",
          `${action === "copy" ? "Copy" : "Download"} ${language} code`,
        );
        toolbar.append(button);
      }
      pre.replaceWith(wrapper);
      wrapper.append(toolbar, pre);
    }
    for (const link of document.querySelectorAll("a")) {
      const href = link.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) link.removeAttribute("href");
      else {
        const url = new URL(href);
        const hostname = url.hostname.replace(/^www\./i, "");
        let domainHash = 0;
        for (const character of hostname)
          domainHash = (domainHash * 31 + character.charCodeAt(0)) >>> 0;
        const mark = document.createElement("span");
        mark.className = "ai-web-link-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.setAttribute("title", hostname);
        mark.style.setProperty("--site-hue", String(domainHash % 360));
        mark.textContent = hostname.slice(0, 1).toLocaleUpperCase() || "↗";
        const icon = websiteIcons[url.origin];
        if (icon) {
          const image = document.createElement("img");
          image.className = "ai-web-link-icon";
          image.setAttribute("src", icon);
          image.setAttribute("alt", "");
          image.setAttribute("referrerpolicy", "no-referrer");
          mark.classList.add("has-site-icon");
          mark.prepend(image);
        }
        link.classList.add("ai-web-link");
        link.prepend(mark);
      }
      link.setAttribute("rel", "noreferrer noopener");
      link.setAttribute("target", "_blank");
    }
    return { html: document.body.innerHTML, artifacts };
  }, [content, websiteIcons]);

  return (
    <div className="ai-message-rich-content">
      <div
        className="ai-message-content"
        onClick={(event) => {
          const actionButton = (event.target as HTMLElement).closest(
            "[data-chat-output-action]",
          ) as HTMLButtonElement | null;
          if (actionButton) {
            const output = actionButton.closest(".ai-code-output");
            const code = output?.querySelector("code")?.textContent || "";
            const language =
              (output as HTMLElement | null)?.dataset.language || "code";
            if (!code) return;
            if (actionButton.dataset.chatOutputAction === "copy") {
              void window.oscode.copyChatOutput(code).then(() => {
                actionButton.textContent = "Copied";
                window.setTimeout(() => {
                  actionButton.textContent = "Copy";
                }, 1800);
              });
            } else {
              void window.oscode.downloadChatOutput(
                `code-output.${codeExtension(language)}`,
                code,
              );
            }
            return;
          }
          const link = (event.target as HTMLElement).closest("a");
          const href = link?.getAttribute("href") || "";
          if (!/^https:\/\//i.test(href)) return;
          event.preventDefault();
          void window.oscode.openExternalUrl(href);
        }}
        dangerouslySetInnerHTML={{ __html: parsed.html }}
      />
      {parsed.artifacts.map((artifact, index) => (
        <ArtifactPreview
          key={`${artifact.type}-${artifact.title || index}-${index}`}
          artifact={artifact}
          onOpen={onOpenArtifact}
        />
      ))}
    </div>
  );
}
