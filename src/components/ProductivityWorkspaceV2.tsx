import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { FeatherIcon } from "./FeatherIcon";
import type { ArtifactExportFormat, ProductivityArtifact } from "../types";

type Props = {
  artifact: ProductivityArtifact;
  onChange: (artifact: ProductivityArtifact) => void;
  onExport: (format: ArtifactExportFormat) => void;
  onDelete: () => void;
  saving: boolean;
};
type DocumentData = {
  html: string;
  plainText: string;
  page: "letter" | "a4";
  zoom: number;
};
type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  format?: "plain" | "currency" | "percent";
  color?: string;
  background?: string;
  fontSize?: number;
  border?: boolean;
};
type Sheet = {
  id: string;
  name: string;
  cells: string[][];
  styles: Record<string, CellStyle>;
};
type SpreadsheetData = { sheets: Sheet[]; activeSheetId: string };
type SlideElement = {
  id: string;
  type: "text" | "shape" | "image";
  role?: "title" | "body";
  variant?: "rectangle" | "circle" | "line";
  src?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fill: string;
  color: string;
  fontSize: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
};
type Slide = {
  id: string;
  title: string;
  body: string;
  notes: string;
  background: string;
  layout: "title" | "section" | "blank";
  elements?: SlideElement[];
};
type PresentationData = {
  slides: Slide[];
  activeSlideId: string;
  theme: "gunmetal" | "blue" | "light";
};

const newId = () => globalThis.crypto.randomUUID();
const emptyRows = (rows = 40, columns = 16) =>
  Array.from({ length: rows }, () => Array(columns).fill(""));
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
const command = (
  event: MouseEvent<HTMLButtonElement>,
  name: string,
  value?: string,
) => {
  event.preventDefault();
  document.execCommand(name, false, value);
};
const slideText = (
  role: "title" | "body",
  text: string,
  y: number,
  height: number,
  fontSize: number,
): SlideElement => ({
  id: newId(),
  type: "text",
  role,
  x: 9,
  y,
  width: 82,
  height,
  text,
  fill: "transparent",
  color: "#f7f8f8",
  fontSize,
  bold: role === "title",
  align: "left",
});
const elementsForSlide = (slide: Slide): SlideElement[] =>
  slide.elements?.length
    ? slide.elements
    : slide.layout === "blank"
      ? []
      : [
          slideText(
            "title",
            slide.title || "Untitled presentation",
            20,
            18,
            40,
          ),
          slideText(
            "body",
            slide.body || "Add a subtitle or key idea",
            47,
            28,
            22,
          ),
        ];

const ToolbarButton = ({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) => (
  <button
    type="button"
    className={active ? "active" : ""}
    aria-label={label}
    title={label}
    disabled={disabled}
    onMouseDown={onClick}
  >
    <FeatherIcon icon={icon} size="16" />
    <span>{label}</span>
  </button>
);

const RibbonTabs = <T extends string>({
  value,
  tabs,
  onChange,
  label,
}: {
  value: T;
  tabs: readonly T[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <nav className="productivity-ribbon-tabs" aria-label={label}>
    {tabs.map((tab) => (
      <button
        type="button"
        key={tab}
        className={tab === value ? "active" : ""}
        aria-current={tab === value ? "page" : undefined}
        onClick={() => onChange(tab)}
      >
        {tab}
      </button>
    ))}
  </nav>
);

export function defaultArtifactData(
  kind: ProductivityArtifact["kind"],
): unknown {
  if (kind === "document")
    return {
      html: "<h1>Untitled document</h1><p>Start writing here…</p>",
      plainText: "Untitled document\nStart writing here…",
      page: "letter",
      zoom: 1,
    } satisfies DocumentData;
  if (kind === "spreadsheet") {
    const sheet: Sheet = {
      id: newId(),
      name: "Sheet 1",
      cells: emptyRows(),
      styles: {},
    };
    return {
      sheets: [sheet],
      activeSheetId: sheet.id,
    } satisfies SpreadsheetData;
  }
  const slide: Slide = {
    id: newId(),
    title: "Untitled presentation",
    body: "Add a subtitle or key idea",
    notes: "",
    background: "#20262a",
    layout: "title",
  };
  slide.elements = elementsForSlide(slide);
  return {
    slides: [slide],
    activeSlideId: slide.id,
    theme: "gunmetal",
  } satisfies PresentationData;
}

export function ProductivityWorkspace(props: Props) {
  return (
    <section className="productivity-workspace">
      {props.artifact.kind === "document" ? (
        <DocumentEditor {...props} />
      ) : props.artifact.kind === "spreadsheet" ? (
        <SpreadsheetEditor {...props} />
      ) : (
        <PresentationEditor {...props} />
      )}
    </section>
  );
}

function ArtifactTitle({
  artifact,
  onChange,
  saving,
}: Pick<Props, "artifact" | "onChange" | "saving">) {
  return (
    <label className="artifact-title-field">
      <input
        value={artifact.title}
        aria-label="Artifact title"
        onChange={(event) =>
          onChange({ ...artifact, title: event.target.value.slice(0, 160) })
        }
      />
      <span className="sr-only">All changes saved automatically</span>
      {saving && <small>Saving…</small>}
    </label>
  );
}
const exportFormats: Record<
  ProductivityArtifact["kind"],
  Array<[ArtifactExportFormat, string]>
> = {
  document: [
    ["docx", "Word document (.docx)"],
    ["html", "Web page (.html)"],
    ["markdown", "Markdown (.md)"],
    ["txt", "Plain text (.txt)"],
  ],
  spreadsheet: [
    ["xlsx", "Workbook (.xlsx)"],
    ["csv", "CSV table (.csv)"],
    ["tsv", "Tab-separated (.tsv)"],
    ["json", "Structured data (.json)"],
  ],
  presentation: [
    ["pptx", "Presentation (.pptx)"],
    ["html-slides", "Interactive slides (.html)"],
    ["json", "Structured data (.json)"],
  ],
};
function WorkspaceActions({
  artifact,
  onExport,
}: Pick<Props, "artifact" | "onExport">) {
  const [open, setOpen] = useState(false);
  return (
    <div className="workspace-actions">
      <details className="export-menu" open={open}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setOpen(!open);
          }}
        >
          <FeatherIcon icon="download" size="16" /> Export{" "}
          <FeatherIcon icon="chevron-down" size="14" />
        </summary>
        <div>
          {exportFormats[artifact.kind].map(([format, label]) => (
            <button
              type="button"
              key={format}
              onClick={() => {
                setOpen(false);
                onExport(format);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function DocumentEditor(props: Props) {
  const data = props.artifact.data as DocumentData;
  const editor = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState<"letter" | "a4">(data.page || "letter");
  const [zoom, setZoom] = useState(Number(data.zoom) || 1);
  const [wordCount, setWordCount] = useState(0);
  const [ribbon, setRibbon] = useState<"Home" | "Insert" | "Layout" | "Review">(
    "Home",
  );
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== data.html)
      editor.current.innerHTML = data.html || "";
    setWordCount(
      (data.plainText || "").trim().split(/\s+/).filter(Boolean).length,
    );
  }, [props.artifact.id]);
  const updateContent = () => {
    const html = editor.current?.innerHTML || "";
    const plainText = editor.current?.innerText || "";
    setWordCount(plainText.trim().split(/\s+/).filter(Boolean).length);
    props.onChange({
      ...props.artifact,
      data: { ...data, html, plainText, page, zoom },
    });
  };
  const updateLayout = (nextPage = page, nextZoom = zoom) => {
    setPage(nextPage);
    setZoom(nextZoom);
    props.onChange({
      ...props.artifact,
      data: { ...data, page: nextPage, zoom: nextZoom },
    });
  };
  return (
    <>
      <header className="workspace-header">
        <ArtifactTitle {...props} />
        <WorkspaceActions {...props} />
      </header>
      <div className="productivity-toolbar ribbon-toolbar">
        <RibbonTabs
          value={ribbon}
          tabs={["Home", "Insert", "Layout", "Review"] as const}
          onChange={setRibbon}
          label="Document tools"
        />
        <div
          className="toolbar-row horizontal-menu-scroll"
          data-horizontal-menu
        >
          {ribbon === "Home" && (
            <>
              <ToolbarButton
                icon="corner-up-left"
                label="Undo"
                onClick={(event) => command(event, "undo")}
              />
              <ToolbarButton
                icon="corner-up-right"
                label="Redo"
                onClick={(event) => command(event, "redo")}
              />
              <span className="toolbar-divider" />
              <select
                aria-label="Paragraph style"
                defaultValue="p"
                onChange={(event) => {
                  document.execCommand(
                    "formatBlock",
                    false,
                    event.target.value,
                  );
                  editor.current?.focus();
                }}
              >
                <option value="p">Paragraph</option>
                <option value="h1">Title</option>
                <option value="h2">Heading</option>
                <option value="h3">Subheading</option>
                <option value="blockquote">Quote</option>
                <option value="pre">Code</option>
              </select>
              <select
                aria-label="Font"
                defaultValue="Manrope"
                onChange={(event) => {
                  document.execCommand("fontName", false, event.target.value);
                  editor.current?.focus();
                }}
              >
                <option>Manrope</option>
                <option>Georgia</option>
                <option>Arial</option>
                <option>Times New Roman</option>
                <option>Courier New</option>
              </select>
              <select
                aria-label="Font size"
                defaultValue="3"
                onChange={(event) => {
                  document.execCommand("fontSize", false, event.target.value);
                  editor.current?.focus();
                }}
              >
                <option value="2">Small</option>
                <option value="3">Normal</option>
                <option value="4">Large</option>
                <option value="5">Extra large</option>
              </select>
              <ToolbarButton
                icon="bold"
                label="Bold"
                onClick={(event) => command(event, "bold")}
              />
              <ToolbarButton
                icon="italic"
                label="Italic"
                onClick={(event) => command(event, "italic")}
              />
              <ToolbarButton
                icon="underline"
                label="Underline"
                onClick={(event) => command(event, "underline")}
              />
              <ToolbarButton
                icon="slash"
                label="Strikethrough"
                onClick={(event) => command(event, "strikeThrough")}
              />
              <span className="toolbar-divider" />
              <ToolbarButton
                icon="align-left"
                label="Align left"
                onClick={(event) => command(event, "justifyLeft")}
              />
              <ToolbarButton
                icon="align-center"
                label="Center"
                onClick={(event) => command(event, "justifyCenter")}
              />
              <ToolbarButton
                icon="align-right"
                label="Align right"
                onClick={(event) => command(event, "justifyRight")}
              />
              <ToolbarButton
                icon="list"
                label="Bulleted list"
                onClick={(event) => command(event, "insertUnorderedList")}
              />
              <ToolbarButton
                icon="hash"
                label="Numbered list"
                onClick={(event) => command(event, "insertOrderedList")}
              />
            </>
          )}
          {ribbon === "Insert" && (
            <>
              <ToolbarButton
                icon="link"
                label="Link"
                onClick={(event) => {
                  event.preventDefault();
                  const url = globalThis.prompt("HTTPS link");
                  if (url && /^https:\/\//i.test(url))
                    document.execCommand("createLink", false, url);
                }}
              />
              <ToolbarButton
                icon="grid"
                label="Table"
                onClick={(event) =>
                  command(
                    event,
                    "insertHTML",
                    "<table><tbody><tr><th>Heading</th><th>Heading</th></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>",
                  )
                }
              />
              <ToolbarButton
                icon="minus"
                label="Divider"
                onClick={(event) => command(event, "insertHorizontalRule")}
              />
              <ToolbarButton
                icon="code"
                label="Code block"
                onClick={(event) => command(event, "formatBlock", "pre")}
              />
              <ToolbarButton
                icon="message-square"
                label="Quote"
                onClick={(event) => command(event, "formatBlock", "blockquote")}
              />
            </>
          )}
          {ribbon === "Layout" && (
            <>
              <select
                aria-label="Page size"
                value={page}
                onChange={(event) =>
                  updateLayout(event.target.value as "letter" | "a4", zoom)
                }
              >
                <option value="letter">Letter</option>
                <option value="a4">A4</option>
              </select>
              <select
                aria-label="Document zoom"
                value={zoom}
                onChange={(event) =>
                  updateLayout(page, Number(event.target.value))
                }
              >
                <option value={0.75}>75%</option>
                <option value={1}>100%</option>
                <option value={1.25}>125%</option>
                <option value={1.5}>150%</option>
              </select>
              <button type="button" onClick={() => window.print()}>
                <FeatherIcon icon="printer" size="16" /> Print
              </button>
            </>
          )}
          {ribbon === "Review" && (
            <>
              <button type="button" disabled>
                <FeatherIcon icon="hash" size="16" />{" "}
                {wordCount.toLocaleString()} words
              </button>
              <ToolbarButton
                icon="check-circle"
                label="Select all"
                onClick={(event) => command(event, "selectAll")}
              />
              <ToolbarButton
                icon="x-circle"
                label="Clear formatting"
                onClick={(event) => command(event, "removeFormat")}
              />
              <button type="button" onClick={() => editor.current?.focus()}>
                <FeatherIcon icon="check" size="16" /> Spelling enabled
              </button>
            </>
          )}
        </div>
      </div>
      <div className="document-stage">
        <div
          ref={editor}
          className={`document-page ${page}`}
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Document editor"
          spellCheck
          onInput={updateContent}
          onBlur={updateContent}
        />
      </div>
      <footer className="workspace-status">
        <span>{wordCount.toLocaleString()} words</span>
        <span>
          {page.toUpperCase()} · {Math.round(zoom * 100)}%
        </span>
      </footer>
    </>
  );
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
const cellKey = (row: number, column: number) => `${row}:${column}`;
function evaluateCell(cells: string[][], raw: string) {
  if (!raw.startsWith("=")) return raw;
  const formula = raw.slice(1).trim().toUpperCase();
  const aggregate = formula.match(
    /^(SUM|AVERAGE|MIN|MAX)\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/,
  );
  const toColumn = (label: string) =>
    [...label].reduce(
      (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1;
  if (!aggregate) return "#FORMULA!";
  const values: number[] = [];
  for (
    let row = Number(aggregate[3]) - 1;
    row <= Number(aggregate[5]) - 1;
    row += 1
  )
    for (
      let column = toColumn(aggregate[2]);
      column <= toColumn(aggregate[4]);
      column += 1
    )
      values.push(Number(cells[row]?.[column]) || 0);
  if (!values.length) return "0";
  if (aggregate[1] === "SUM") return String(values.reduce((a, b) => a + b, 0));
  if (aggregate[1] === "AVERAGE")
    return String(values.reduce((a, b) => a + b, 0) / values.length);
  if (aggregate[1] === "MIN") return String(Math.min(...values));
  return String(Math.max(...values));
}

function SpreadsheetEditor(props: Props) {
  const data = props.artifact.data as SpreadsheetData;
  const sheets = data.sheets?.length
    ? data.sheets
    : (defaultArtifactData("spreadsheet") as SpreadsheetData).sheets;
  const active =
    sheets.find((sheet) => sheet.id === data.activeSheetId) || sheets[0];
  const [selected, setSelected] = useState({ row: 0, column: 0 });
  const [formula, setFormula] = useState(active.cells[0]?.[0] || "");
  const [ribbon, setRibbon] = useState<"Home" | "Insert" | "Data" | "Formulas">(
    "Home",
  );
  useEffect(() => {
    setFormula(active.cells[selected.row]?.[selected.column] || "");
  }, [active.id, selected.row, selected.column]);
  const update = (nextSheets: Sheet[], activeSheetId = active.id) =>
    props.onChange({
      ...props.artifact,
      data: { sheets: nextSheets, activeSheetId },
    });
  const updateSheet = (next: Sheet) =>
    update(sheets.map((sheet) => (sheet.id === active.id ? next : sheet)));
  const updateCell = (row: number, column: number, value: string) => {
    const cells = active.cells.map((line) => [...line]);
    while (cells.length <= row)
      cells.push(Array(cells[0]?.length || 16).fill(""));
    while (cells[row].length <= column) for (const line of cells) line.push("");
    cells[row][column] = value.slice(0, 20_000);
    updateSheet({ ...active, cells });
  };
  const style = active.styles[cellKey(selected.row, selected.column)] || {};
  const setStyle = (patch: Partial<CellStyle>) =>
    updateSheet({
      ...active,
      styles: {
        ...active.styles,
        [cellKey(selected.row, selected.column)]: { ...style, ...patch },
      },
    });
  return (
    <>
      <header className="workspace-header">
        <ArtifactTitle {...props} />
        <WorkspaceActions {...props} />
      </header>
      <div className="productivity-toolbar ribbon-toolbar spreadsheet-toolbar">
        <RibbonTabs
          value={ribbon}
          tabs={["Home", "Insert", "Data", "Formulas"] as const}
          onChange={setRibbon}
          label="Spreadsheet tools"
        />
        {ribbon === "Home" && (
          <div
            className="toolbar-row horizontal-menu-scroll"
            data-horizontal-menu
          >
            <ToolbarButton
              icon="bold"
              label="Bold"
              active={style.bold}
              onClick={(event) => {
                event.preventDefault();
                setStyle({ bold: !style.bold });
              }}
            />
            <ToolbarButton
              icon="italic"
              label="Italic"
              active={style.italic}
              onClick={(event) => {
                event.preventDefault();
                setStyle({ italic: !style.italic });
              }}
            />
            <span className="toolbar-divider" />
            <ToolbarButton
              icon="align-left"
              label="Align left"
              active={style.align === "left"}
              onClick={(event) => {
                event.preventDefault();
                setStyle({ align: "left" });
              }}
            />
            <ToolbarButton
              icon="align-center"
              label="Center"
              active={style.align === "center"}
              onClick={(event) => {
                event.preventDefault();
                setStyle({ align: "center" });
              }}
            />
            <ToolbarButton
              icon="align-right"
              label="Align right"
              active={style.align === "right"}
              onClick={(event) => {
                event.preventDefault();
                setStyle({ align: "right" });
              }}
            />
            <span className="toolbar-divider" />
            <button
              type="button"
              className={style.format === "currency" ? "active" : ""}
              onClick={() => setStyle({ format: "currency" })}
            >
              $ Currency
            </button>
            <button
              type="button"
              className={style.format === "percent" ? "active" : ""}
              onClick={() => setStyle({ format: "percent" })}
            >
              % Percent
            </button>
            <button
              type="button"
              className={
                !style.format || style.format === "plain" ? "active" : ""
              }
              onClick={() => setStyle({ format: "plain" })}
            >
              123 Number
            </button>
            <span className="toolbar-divider" />
            <label className="color-control compact">
              Text{" "}
              <input
                type="color"
                value={style.color || "#e8ecee"}
                onChange={(event) => setStyle({ color: event.target.value })}
              />
            </label>
            <label className="color-control compact">
              Fill{" "}
              <input
                type="color"
                value={style.background || "#17191a"}
                onChange={(event) =>
                  setStyle({ background: event.target.value })
                }
              />
            </label>
            <select
              aria-label="Cell text size"
              value={style.fontSize || 13}
              onChange={(event) =>
                setStyle({ fontSize: Number(event.target.value) })
              }
            >
              <option value="11">11</option>
              <option value="13">13</option>
              <option value="16">16</option>
              <option value="20">20</option>
            </select>
            <ToolbarButton
              icon="square"
              label="Cell border"
              active={style.border}
              onClick={(event) => {
                event.preventDefault();
                setStyle({ border: !style.border });
              }}
            />
          </div>
        )}
        {ribbon === "Insert" && (
          <div
            className="toolbar-row horizontal-menu-scroll"
            data-horizontal-menu
          >
            <button
              type="button"
              onClick={() =>
                updateSheet({
                  ...active,
                  cells: [
                    ...active.cells,
                    Array(active.cells[0]?.length || 16).fill(""),
                  ],
                })
              }
            >
              <FeatherIcon icon="plus" size="16" /> Row
            </button>
            <button
              type="button"
              onClick={() =>
                updateSheet({
                  ...active,
                  cells: active.cells.map((row) => [...row, ""]),
                })
              }
            >
              <FeatherIcon icon="plus" size="16" /> Column
            </button>
            <button
              type="button"
              disabled={active.cells.length <= 1}
              onClick={() =>
                updateSheet({
                  ...active,
                  cells: active.cells.filter(
                    (_, index) => index !== selected.row,
                  ),
                })
              }
            >
              <FeatherIcon icon="minus" size="16" /> Row
            </button>
            <button
              type="button"
              disabled={(active.cells[0]?.length || 0) <= 1}
              onClick={() =>
                updateSheet({
                  ...active,
                  cells: active.cells.map((row) =>
                    row.filter((_, index) => index !== selected.column),
                  ),
                })
              }
            >
              <FeatherIcon icon="minus" size="16" /> Column
            </button>
            <span className="toolbar-divider" />
            <button
              type="button"
              onClick={() => {
                const next = globalThis.prompt("Sheet name", active.name);
                if (next?.trim())
                  updateSheet({ ...active, name: next.trim().slice(0, 31) });
              }}
            >
              <FeatherIcon icon="edit-2" size="16" /> Rename sheet
            </button>
            <button
              type="button"
              onClick={() => {
                const sheet: Sheet = {
                  id: newId(),
                  name: `Sheet ${sheets.length + 1}`,
                  cells: emptyRows(),
                  styles: {},
                };
                update([...sheets, sheet], sheet.id);
              }}
            >
              <FeatherIcon icon="copy" size="16" /> New sheet
            </button>
          </div>
        )}
        {ribbon === "Data" && (
          <div
            className="toolbar-row horizontal-menu-scroll"
            data-horizontal-menu
          >
            <button
              type="button"
              onClick={() => {
                const rows = [...active.cells];
                rows.sort((a, b) =>
                  String(a[selected.column] || "").localeCompare(
                    String(b[selected.column] || ""),
                    undefined,
                    { numeric: true },
                  ),
                );
                updateSheet({ ...active, cells: rows });
              }}
            >
              <FeatherIcon icon="arrow-up" size="16" /> Sort ascending
            </button>
            <button
              type="button"
              onClick={() => {
                const rows = [...active.cells];
                rows.sort((a, b) =>
                  String(b[selected.column] || "").localeCompare(
                    String(a[selected.column] || ""),
                    undefined,
                    { numeric: true },
                  ),
                );
                updateSheet({ ...active, cells: rows });
              }}
            >
              <FeatherIcon icon="arrow-down" size="16" /> Sort descending
            </button>
            <button
              type="button"
              onClick={() => {
                const rows = active.cells.filter(
                  (row, index, all) =>
                    index ===
                    all.findIndex(
                      (item) => JSON.stringify(item) === JSON.stringify(row),
                    ),
                );
                updateSheet({ ...active, cells: rows });
              }}
            >
              <FeatherIcon icon="filter" size="16" /> Remove duplicates
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  globalThis.confirm(
                    "Clear every value and style in this sheet?",
                  )
                )
                  updateSheet({
                    ...active,
                    cells: emptyRows(40, 16),
                    styles: {},
                  });
              }}
            >
              <FeatherIcon icon="trash-2" size="16" /> Clear sheet
            </button>
          </div>
        )}
        {ribbon === "Formulas" && (
          <div
            className="toolbar-row horizontal-menu-scroll"
            data-horizontal-menu
          >
            {[
              ["SUM", "=SUM(A1:A8)"],
              ["AVERAGE", "=AVERAGE(A1:A8)"],
              ["MIN", "=MIN(A1:A8)"],
              ["MAX", "=MAX(A1:A8)"],
            ].map(([label, value]) => (
              <button
                type="button"
                key={label}
                onClick={() => {
                  setFormula(value);
                  updateCell(selected.row, selected.column, value);
                }}
              >
                <FeatherIcon icon="activity" size="16" /> {label}
              </button>
            ))}
            <span className="ribbon-hint">
              Formulas recalculate locally as cells change.
            </span>
          </div>
        )}
      </div>
      <label className="formula-bar">
        <b>
          {columnName(selected.column)}
          {selected.row + 1}
        </b>
        <span>ƒx</span>
        <input
          value={formula}
          aria-label="Formula"
          placeholder="Value or formula, e.g. =SUM(A1:A8)"
          onChange={(event) => {
            setFormula(event.target.value);
            updateCell(selected.row, selected.column, event.target.value);
          }}
        />
      </label>
      <div className="spreadsheet-grid-wrap">
        <table className="spreadsheet-grid">
          <thead>
            <tr>
              <th className="spreadsheet-corner" />
              {active.cells[0]?.map((_, column) => (
                <th key={column}>{columnName(column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th>{rowIndex + 1}</th>
                {row.map((raw, columnIndex) => {
                  const key = cellKey(rowIndex, columnIndex);
                  const cellStyle = active.styles[key] || {};
                  const selectedCell =
                    selected.row === rowIndex &&
                    selected.column === columnIndex;
                  const evaluated = evaluateCell(active.cells, raw);
                  const number = Number(evaluated);
                  const display =
                    cellStyle.format === "currency" && Number.isFinite(number)
                      ? new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: "USD",
                        }).format(number)
                      : cellStyle.format === "percent" &&
                          Number.isFinite(number)
                        ? new Intl.NumberFormat(undefined, {
                            style: "percent",
                            maximumFractionDigits: 2,
                          }).format(number)
                        : evaluated;
                  return (
                    <td
                      key={columnIndex}
                      className={selectedCell ? "selected" : ""}
                    >
                      <input
                        value={selectedCell ? raw : display}
                        style={{
                          fontWeight: cellStyle.bold ? 700 : 400,
                          fontStyle: cellStyle.italic ? "italic" : "normal",
                          textAlign: cellStyle.align || "left",
                          color: cellStyle.color,
                          background: cellStyle.background,
                          fontSize: cellStyle.fontSize,
                          boxShadow: cellStyle.border
                            ? "inset 0 0 0 1px var(--accent)"
                            : undefined,
                        }}
                        aria-label={`${columnName(columnIndex)}${rowIndex + 1}`}
                        onFocus={() => {
                          setSelected({ row: rowIndex, column: columnIndex });
                          setFormula(raw);
                        }}
                        onChange={(event) => {
                          setFormula(event.target.value);
                          updateCell(rowIndex, columnIndex, event.target.value);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="sheet-tabs">
        {sheets.map((sheet) => (
          <button
            type="button"
            key={sheet.id}
            className={sheet.id === active.id ? "active" : ""}
            onClick={() => update(sheets, sheet.id)}
          >
            {sheet.name}
          </button>
        ))}
        <button
          type="button"
          aria-label="Add sheet"
          onClick={() => {
            const sheet: Sheet = {
              id: newId(),
              name: `Sheet ${sheets.length + 1}`,
              cells: emptyRows(),
              styles: {},
            };
            update([...sheets, sheet], sheet.id);
          }}
        >
          <FeatherIcon icon="plus" size="16" />
        </button>
      </footer>
    </>
  );
}

function PresentationEditor(props: Props) {
  const raw = props.artifact.data as PresentationData;
  const sourceSlides = raw.slides?.length
    ? raw.slides
    : (defaultArtifactData("presentation") as PresentationData).slides;
  const slides = useMemo(
    () =>
      sourceSlides.map((slide) => ({
        ...slide,
        elements: elementsForSlide(slide),
      })),
    [props.artifact.data],
  );
  const active =
    slides.find((slide) => slide.id === raw.activeSlideId) || slides[0];
  const [selectedId, setSelectedId] = useState("");
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [slideClipboard, setSlideClipboard] = useState<Slide | null>(null);
  const [ribbon, setRibbon] = useState<
    "Home" | "Insert" | "Arrange" | "Design" | "Slideshow"
  >("Home");
  const [dragging, setDragging] = useState<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    rect: DOMRect;
  } | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const selected =
    active.elements?.find((element) => element.id === selectedId) || null;
  const update = (
    nextSlides: Slide[],
    activeSlideId = active.id,
    theme = raw.theme || "gunmetal",
  ) =>
    props.onChange({
      ...props.artifact,
      data: { slides: nextSlides, activeSlideId, theme },
    });
  const updateSlide = (patch: Partial<Slide>) =>
    update(
      slides.map((slide) =>
        slide.id === active.id ? { ...slide, ...patch } : slide,
      ),
    );
  const updateElements = (elements: SlideElement[]) => {
    const title =
      elements.find((element) => element.role === "title")?.text ||
      active.title;
    const body =
      elements.find((element) => element.role === "body")?.text || active.body;
    updateSlide({ elements, title, body });
  };
  const updateElement = (id: string, patch: Partial<SlideElement>) =>
    updateElements(
      (active.elements || []).map((element) =>
        element.id === id ? { ...element, ...patch } : element,
      ),
    );
  const addElement = (
    type: SlideElement["type"],
    variant?: SlideElement["variant"],
    role?: SlideElement["role"],
  ) => {
    const element: SlideElement = {
      id: newId(),
      type,
      variant,
      role,
      x: 18,
      y: 24,
      width: type === "shape" ? 26 : 58,
      height: type === "shape" ? 24 : 18,
      text:
        type === "text"
          ? role === "title"
            ? "New title"
            : "New text"
          : type === "image"
            ? "Image"
            : "",
      fill: type === "shape" ? "#7bc7ed" : "transparent",
      color: "#f7f8f8",
      fontSize: role === "title" ? 38 : 22,
      bold: role === "title",
      align: "left",
    };
    setSelectedId(element.id);
    updateElements([...(active.elements || []), element]);
  };
  const addImage = (file?: File) => {
    if (
      !file ||
      !file.type.startsWith("image/") ||
      file.size > 20 * 1024 * 1024
    )
      return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src.startsWith("data:image/")) return;
      const element: SlideElement = {
        id: newId(),
        type: "image",
        src,
        x: 18,
        y: 20,
        width: 50,
        height: 50,
        text: file.name,
        fill: "transparent",
        color: "#f7f8f8",
        fontSize: 16,
        align: "center",
      };
      setSelectedId(element.id);
      updateElements([...(active.elements || []), element]);
    });
    reader.readAsDataURL(file);
  };
  const addSlide = (layout: Slide["layout"] = "section") => {
    const slide: Slide = {
      id: newId(),
      title: layout === "blank" ? "" : "New slide",
      body: layout === "blank" ? "" : "Add your key points",
      notes: "",
      background:
        raw.theme === "light"
          ? "#f7f7f5"
          : raw.theme === "blue"
            ? "#173b55"
            : "#20262a",
      layout,
    };
    slide.elements = elementsForSlide(slide);
    update([...slides, slide], slide.id);
    setSelectedId("");
  };
  const beginDrag = (
    event: PointerEvent<HTMLButtonElement>,
    element: SlideElement,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget
      .closest<HTMLElement>(".slide-canvas")!
      .getBoundingClientRect();
    setDragging({
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      x: element.x,
      y: element.y,
      rect,
    });
    setSelectedId(element.id);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const element = active.elements?.find((item) => item.id === dragging.id);
    if (!element) return;
    updateElement(dragging.id, {
      x: clamp(
        dragging.x +
          ((event.clientX - dragging.startX) / dragging.rect.width) * 100,
        0,
        100 - element.width,
      ),
      y: clamp(
        dragging.y +
          ((event.clientY - dragging.startY) / dragging.rect.height) * 100,
        0,
        100 - element.height,
      ),
    });
  };
  const beginResize = (
    event: PointerEvent<HTMLButtonElement>,
    element: SlideElement,
    direction: "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget
      .closest<HTMLElement>(".slide-canvas")!
      .getBoundingClientRect();
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
    setSelectedId(element.id);
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const dx = ((moveEvent.clientX - start.clientX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - start.clientY) / rect.height) * 100;
      let { x, y, width, height } = start;
      if (direction.includes("e"))
        width = clamp(start.width + dx, 4, 100 - start.x);
      if (direction.includes("s"))
        height = clamp(start.height + dy, 3, 100 - start.y);
      if (direction.includes("w")) {
        width = clamp(start.width - dx, 4, start.x + start.width);
        x = start.x + start.width - width;
      }
      if (direction.includes("n")) {
        height = clamp(start.height - dy, 3, start.y + start.height);
        y = start.y + start.height - height;
      }
      updateElement(element.id, { x, y, width, height });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  const arrangeElement = (
    action: "front" | "forward" | "backward" | "back",
  ) => {
    if (!selected) return;
    const elements = [...(active.elements || [])];
    const index = elements.findIndex((element) => element.id === selected.id);
    if (index < 0) return;
    const [item] = elements.splice(index, 1);
    const target =
      action === "front"
        ? elements.length
        : action === "back"
          ? 0
          : action === "forward"
            ? Math.min(elements.length, index + 1)
            : Math.max(0, index - 1);
    elements.splice(target, 0, item);
    updateElements(elements);
  };
  const reorder = (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/slide-id");
    if (!sourceId || sourceId === targetId) return;
    const next: Slide[] = [...slides];
    const sourceIndex = next.findIndex((slide) => slide.id === sourceId);
    const targetIndex = next.findIndex((slide) => slide.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    update(next, active.id);
  };
  const cloneSlide = (source: Slide, title = source.title): Slide => ({
    ...source,
    id: newId(),
    title,
    elements: (source.elements || []).map((element) => ({
      ...element,
      id: newId(),
    })),
  });
  const pasteSlide = () => {
    if (!slideClipboard) return;
    const copy = cloneSlide(slideClipboard, `${slideClipboard.title} copy`);
    const next: Slide[] = [...slides];
    next.splice(slides.indexOf(active) + 1, 0, copy);
    update(next, copy.id);
    setSelectedId("");
  };
  const duplicateSlide = () => {
    const copy = cloneSlide(active, `${active.title} copy`);
    const next: Slide[] = [...slides];
    next.splice(slides.indexOf(active) + 1, 0, copy);
    update(next, copy.id);
    setSelectedId("");
  };
  const moveActiveSlide = (direction: -1 | 1) => {
    const sourceIndex = slides.indexOf(active);
    const targetIndex = sourceIndex + direction;
    if (targetIndex < 0 || targetIndex >= slides.length) return;
    const next = [...slides];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    update(next, active.id);
  };
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        updateElements(
          (active.elements || []).filter(
            (element) => element.id !== selected.id,
          ),
        );
        setSelectedId("");
        return;
      }
      const step = event.shiftKey ? 2 : 0.5;
      const moves: Record<string, Partial<SlideElement>> = {
        ArrowLeft: { x: clamp(selected.x - step, 0, 100 - selected.width) },
        ArrowRight: { x: clamp(selected.x + step, 0, 100 - selected.width) },
        ArrowUp: { y: clamp(selected.y - step, 0, 100 - selected.height) },
        ArrowDown: { y: clamp(selected.y + step, 0, 100 - selected.height) },
      };
      if (!moves[event.key]) return;
      event.preventDefault();
      updateElement(selected.id, moves[event.key]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, selected?.x, selected?.y, active.id]);
  useEffect(() => {
    if (!presenting) return;
    const onPresentationKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPresenting(false);
        return;
      }
      if (
        event.key === "ArrowRight" ||
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.key === " "
      ) {
        event.preventDefault();
        setPresentIndex((index) => Math.min(slides.length - 1, index + 1));
        return;
      }
      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowUp" ||
        event.key === "PageUp"
      ) {
        event.preventDefault();
        setPresentIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setPresentIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setPresentIndex(slides.length - 1);
      }
    };
    window.addEventListener("keydown", onPresentationKeyDown);
    return () => window.removeEventListener("keydown", onPresentationKeyDown);
  }, [presenting, slides.length]);
  return (
    <>
      <header className="workspace-header">
        <ArtifactTitle {...props} />
        <WorkspaceActions {...props} />
      </header>
      <div className="productivity-toolbar ribbon-toolbar presentation-toolbar">
        <RibbonTabs
          value={ribbon}
          tabs={["Home", "Insert", "Arrange", "Design", "Slideshow"] as const}
          onChange={setRibbon}
          label="Presentation tools"
        />
        <div
          className="toolbar-row horizontal-menu-scroll"
          data-horizontal-menu
        >
          {ribbon === "Home" && (
            <>
              <button type="button" onClick={() => addSlide()}>
                <FeatherIcon icon="plus" size="16" /> New slide
              </button>
              <button type="button" onClick={() => setSlideClipboard(active)}>
                <FeatherIcon icon="copy" size="16" /> Copy slide
              </button>
              <button
                type="button"
                disabled={!slideClipboard}
                onClick={pasteSlide}
              >
                <FeatherIcon icon="clipboard" size="16" /> Paste slide
              </button>
              <button type="button" onClick={duplicateSlide}>
                <FeatherIcon icon="copy" size="16" /> Duplicate slide
              </button>
              <button
                type="button"
                disabled={slides.indexOf(active) === 0}
                onClick={() => moveActiveSlide(-1)}
              >
                <FeatherIcon icon="arrow-up" size="16" /> Move earlier
              </button>
              <button
                type="button"
                disabled={slides.indexOf(active) === slides.length - 1}
                onClick={() => moveActiveSlide(1)}
              >
                <FeatherIcon icon="arrow-down" size="16" /> Move later
              </button>
              <button
                type="button"
                disabled={slides.length <= 1}
                onClick={() => {
                  const remaining = slides.filter(
                    (slide) => slide.id !== active.id,
                  );
                  update(
                    remaining,
                    remaining[Math.max(0, slides.indexOf(active) - 1)]?.id ||
                      remaining[0].id,
                  );
                }}
              >
                <FeatherIcon icon="trash-2" size="16" /> Delete slide
              </button>
              <span className="toolbar-divider" />
              <select
                aria-label="Slide layout"
                value={active.layout}
                onChange={(event) =>
                  updateSlide({ layout: event.target.value as Slide["layout"] })
                }
              >
                <option value="title">Title</option>
                <option value="section">Title and content</option>
                <option value="blank">Blank</option>
              </select>
            </>
          )}
          {ribbon === "Insert" && (
            <>
              <button
                type="button"
                onClick={() => addElement("text", undefined, "title")}
              >
                <FeatherIcon icon="type" size="16" /> Title
              </button>
              <button type="button" onClick={() => addElement("text")}>
                <FeatherIcon icon="edit-3" size="16" /> Text box
              </button>
              <button
                type="button"
                onClick={() => addElement("shape", "rectangle")}
              >
                <FeatherIcon icon="square" size="16" /> Rectangle
              </button>
              <button
                type="button"
                onClick={() => addElement("shape", "circle")}
              >
                <FeatherIcon icon="circle" size="16" /> Circle
              </button>
              <button type="button" onClick={() => addElement("shape", "line")}>
                <FeatherIcon icon="minus" size="16" /> Line
              </button>
              <input
                ref={imageInput}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  addImage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button type="button" onClick={() => imageInput.current?.click()}>
                <FeatherIcon icon="image" size="16" /> Image
              </button>
            </>
          )}
          {ribbon === "Arrange" && (
            <>
              <button
                type="button"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  const copy = {
                    ...selected,
                    id: newId(),
                    x: clamp(selected.x + 3, 0, 100 - selected.width),
                    y: clamp(selected.y + 3, 0, 100 - selected.height),
                  };
                  setSelectedId(copy.id);
                  updateElements([...(active.elements || []), copy]);
                }}
              >
                <FeatherIcon icon="copy" size="16" /> Duplicate
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  updateElements(
                    (active.elements || []).filter(
                      (element) => element.id !== selected.id,
                    ),
                  );
                  setSelectedId("");
                }}
              >
                <FeatherIcon icon="trash-2" size="16" /> Delete
              </button>
              <span className="toolbar-divider" />
              <button
                type="button"
                disabled={!selected}
                onClick={() => arrangeElement("front")}
              >
                <FeatherIcon icon="chevrons-up" size="16" /> Bring to front
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => arrangeElement("forward")}
              >
                <FeatherIcon icon="chevron-up" size="16" /> Forward
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => arrangeElement("backward")}
              >
                <FeatherIcon icon="chevron-down" size="16" /> Backward
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => arrangeElement("back")}
              >
                <FeatherIcon icon="chevrons-down" size="16" /> Send to back
              </button>
              <span className="toolbar-divider" />
              <button
                type="button"
                disabled={!selected}
                onClick={() => selected && updateElement(selected.id, { x: 0 })}
              >
                Align left
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() =>
                  selected &&
                  updateElement(selected.id, { x: (100 - selected.width) / 2 })
                }
              >
                Center
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() =>
                  selected &&
                  updateElement(selected.id, { x: 100 - selected.width })
                }
              >
                Align right
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() =>
                  selected &&
                  updateElement(selected.id, { y: (100 - selected.height) / 2 })
                }
              >
                Middle
              </button>
            </>
          )}
          {ribbon === "Design" && (
            <>
              <select
                aria-label="Presentation theme"
                value={raw.theme || "gunmetal"}
                onChange={(event) => {
                  const theme = event.target.value as PresentationData["theme"];
                  const background =
                    theme === "light"
                      ? "#f7f7f5"
                      : theme === "blue"
                        ? "#173b55"
                        : "#20262a";
                  update(
                    slides.map((slide) => ({ ...slide, background })),
                    active.id,
                    theme,
                  );
                }}
              >
                <option value="gunmetal">Gunmetal</option>
                <option value="blue">Deep blue</option>
                <option value="light">Paper light</option>
              </select>
              <label className="color-control">
                Background{" "}
                <input
                  type="color"
                  value={active.background}
                  onChange={(event) =>
                    updateSlide({ background: event.target.value })
                  }
                />
              </label>
              <span className="ribbon-hint">
                Theme changes apply across the deck; background changes apply to
                this slide.
              </span>
            </>
          )}
          {ribbon === "Slideshow" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setPresentIndex(slides.indexOf(active));
                  setPresenting(true);
                }}
              >
                <FeatherIcon icon="play" size="16" /> Present from current slide
              </button>
              <button
                type="button"
                onClick={() => {
                  setPresentIndex(0);
                  setPresenting(true);
                }}
              >
                <FeatherIcon icon="skip-back" size="16" /> Present from
                beginning
              </button>
              <span className="ribbon-hint">
                Use arrow keys while presenting; Escape exits.
              </span>
            </>
          )}
        </div>
      </div>
      <div className="presentation-layout">
        <aside className="slide-rail" aria-label="Slides">
          {slides.map((slide, index) => (
            <button
              type="button"
              draggable
              key={slide.id}
              className={slide.id === active.id ? "active" : ""}
              onDragStart={(event) =>
                event.dataTransfer.setData("text/slide-id", slide.id)
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => reorder(event, slide.id)}
              onClick={() => {
                update(slides, slide.id);
                setSelectedId("");
              }}
            >
              <span>{index + 1}</span>
              <i style={{ background: slide.background }}>
                <b>{slide.title || "Blank slide"}</b>
                <small>{slide.body}</small>
              </i>
            </button>
          ))}
          <button
            type="button"
            className="add-slide"
            onClick={() => addSlide()}
          >
            <FeatherIcon icon="plus" size="17" /> Add slide
          </button>
        </aside>
        <div className="slide-editor">
          <section
            className={`slide-canvas object-canvas ${raw.theme || "gunmetal"}`}
            style={{ background: active.background }}
            onPointerDown={() => setSelectedId("")}
          >
            {(active.elements || []).map((element, elementIndex) => (
              <div
                key={element.id}
                className={`slide-object ${element.type} ${element.variant || ""} ${element.id === selectedId ? "selected" : ""}`}
                style={{
                  left: `${element.x}%`,
                  top: `${element.y}%`,
                  width: `${element.width}%`,
                  height: `${element.height}%`,
                  background: element.fill,
                  color: element.color,
                  fontSize: `${element.fontSize}px`,
                  fontWeight: element.bold ? 700 : 400,
                  textAlign: element.align || "left",
                  zIndex: elementIndex + 1,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedId(element.id);
                }}
              >
                <button
                  className="slide-object-handle"
                  type="button"
                  aria-label="Drag object"
                  onPointerDown={(event) => beginDrag(event, element)}
                  onPointerMove={moveDrag}
                  onPointerUp={() => setDragging(null)}
                >
                  <FeatherIcon icon="move" size="13" />
                </button>
                {element.id === selectedId &&
                  (["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const).map(
                    (direction) => (
                      <button
                        type="button"
                        key={direction}
                        className={`slide-resize-handle ${direction}`}
                        aria-label={`Resize ${direction}`}
                        onPointerDown={(event) =>
                          beginResize(event, element, direction)
                        }
                      />
                    ),
                  )}
                {element.type === "text" ? (
                  <textarea
                    value={element.text}
                    aria-label={
                      element.role === "title" ? "Slide title" : "Slide text"
                    }
                    onChange={(event) =>
                      updateElement(element.id, { text: event.target.value })
                    }
                  />
                ) : element.type === "image" && element.src ? (
                  <img src={element.src} alt={element.text || "Slide image"} />
                ) : element.type === "image" ? (
                  <span className="slide-image-placeholder">
                    <FeatherIcon icon="image" size="28" />
                    <small>Choose an image</small>
                  </span>
                ) : null}
              </div>
            ))}
            {!active.elements?.length && (
              <p className="blank-slide-hint">
                Add text, shapes, or images from the toolbar
              </p>
            )}
          </section>
          {selected && (
            <section className="object-inspector" aria-label="Selected object">
              <b>Selected {selected.type}</b>
              <label>
                X{" "}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(selected.x)}
                  onChange={(event) =>
                    updateElement(selected.id, {
                      x: clamp(
                        Number(event.target.value),
                        0,
                        100 - selected.width,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Y{" "}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(selected.y)}
                  onChange={(event) =>
                    updateElement(selected.id, {
                      y: clamp(
                        Number(event.target.value),
                        0,
                        100 - selected.height,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Width{" "}
                <input
                  type="number"
                  min="4"
                  max="100"
                  value={Math.round(selected.width)}
                  onChange={(event) =>
                    updateElement(selected.id, {
                      width: clamp(
                        Number(event.target.value),
                        4,
                        100 - selected.x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Height{" "}
                <input
                  type="number"
                  min="3"
                  max="100"
                  value={Math.round(selected.height)}
                  onChange={(event) =>
                    updateElement(selected.id, {
                      height: clamp(
                        Number(event.target.value),
                        3,
                        100 - selected.y,
                      ),
                    })
                  }
                />
              </label>
              {selected.type === "text" && (
                <>
                  <label>
                    Size{" "}
                    <input
                      type="number"
                      min="8"
                      max="120"
                      value={selected.fontSize}
                      onChange={(event) =>
                        updateElement(selected.id, {
                          fontSize: clamp(Number(event.target.value), 8, 120),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={selected.bold ? "active" : ""}
                    onClick={() =>
                      updateElement(selected.id, { bold: !selected.bold })
                    }
                  >
                    <FeatherIcon icon="bold" size="15" /> Bold
                  </button>
                </>
              )}
              <label>
                Color{" "}
                <input
                  type="color"
                  value={
                    selected.type === "shape" ? selected.fill : selected.color
                  }
                  onChange={(event) =>
                    updateElement(
                      selected.id,
                      selected.type === "shape"
                        ? { fill: event.target.value }
                        : { color: event.target.value },
                    )
                  }
                />
              </label>
            </section>
          )}
          <label className="speaker-notes">
            <span>
              <FeatherIcon icon="message-square" size="15" /> Speaker notes
            </span>
            <textarea
              value={active.notes}
              placeholder="Notes are visible to you, not the audience."
              onChange={(event) => updateSlide({ notes: event.target.value })}
            />
          </label>
        </div>
      </div>
      {presenting && (
        <div
          className="presentation-player"
          role="dialog"
          aria-modal="true"
          aria-label="Presentation"
        >
          <section
            style={{ background: slides[presentIndex].background }}
            className={`${raw.theme || "gunmetal"} object-canvas`}
          >
            {(slides[presentIndex].elements || []).map((element) => (
              <div
                key={element.id}
                className={`slide-object ${element.type} ${element.variant || ""}`}
                style={{
                  left: `${element.x}%`,
                  top: `${element.y}%`,
                  width: `${element.width}%`,
                  height: `${element.height}%`,
                  background: element.fill,
                  color: element.color,
                  fontSize: `${element.fontSize}px`,
                  fontWeight: element.bold ? 700 : 400,
                  textAlign: element.align || "left",
                }}
              >
                {element.type === "text" ? (
                  element.text
                ) : element.type === "image" && element.src ? (
                  <img src={element.src} alt={element.text || "Slide image"} />
                ) : null}
              </div>
            ))}
          </section>
          <footer>
            <button
              type="button"
              disabled={presentIndex === 0}
              onClick={() => setPresentIndex((index) => Math.max(0, index - 1))}
            >
              <FeatherIcon icon="chevron-left" size="19" /> Previous
            </button>
            <span>
              {presentIndex + 1} / {slides.length}
            </span>
            <button
              type="button"
              disabled={presentIndex === slides.length - 1}
              onClick={() =>
                setPresentIndex((index) =>
                  Math.min(slides.length - 1, index + 1),
                )
              }
            >
              Next <FeatherIcon icon="chevron-right" size="19" />
            </button>
            <button type="button" onClick={() => setPresenting(false)}>
              <FeatherIcon icon="x" size="19" /> Exit
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
