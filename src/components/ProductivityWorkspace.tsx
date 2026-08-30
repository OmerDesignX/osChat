import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { FeatherIcon } from "./FeatherIcon";
import type { ProductivityArtifact } from "../types";

type Props = {
  artifact: ProductivityArtifact;
  onChange: (artifact: ProductivityArtifact) => void;
  onSave: () => void;
  onExport: () => void;
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
};
type Sheet = {
  id: string;
  name: string;
  cells: string[][];
  styles: Record<string, CellStyle>;
};
type SpreadsheetData = { sheets: Sheet[]; activeSheetId: string };
type Slide = {
  id: string;
  title: string;
  body: string;
  notes: string;
  background: string;
  layout: "title" | "section" | "blank";
};
type PresentationData = {
  slides: Slide[];
  activeSlideId: string;
  theme: "gunmetal" | "blue" | "light";
};

const newId = () => globalThis.crypto.randomUUID();
const emptyRows = (rows = 30, columns = 12) =>
  Array.from({ length: rows }, () => Array(columns).fill(""));
const command = (
  event: MouseEvent<HTMLButtonElement>,
  name: string,
  value?: string,
) => {
  event.preventDefault();
  document.execCommand(name, false, value);
};
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
      <small>{saving ? "Saving…" : "Saved locally"}</small>
    </label>
  );
}

function WorkspaceActions({
  artifact,
  onSave,
  onExport,
  onDelete,
  saving,
}: Pick<Props, "artifact" | "onSave" | "onExport" | "onDelete" | "saving">) {
  return (
    <div className="workspace-actions">
      <button type="button" onClick={onSave} disabled={saving}>
        <FeatherIcon icon="save" size="16" />
        Save
      </button>
      <button type="button" onClick={onExport}>
        <FeatherIcon icon="download" size="16" />
        Export{" "}
        {artifact.kind === "document"
          ? "DOCX"
          : artifact.kind === "spreadsheet"
            ? "XLSX"
            : "PPTX"}
      </button>
      <button type="button" className="danger-quiet" onClick={onDelete}>
        <FeatherIcon icon="trash-2" size="16" />
        Delete
      </button>
    </div>
  );
}

function DocumentEditor(props: Props) {
  const data = props.artifact.data as DocumentData;
  const editor = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState<"letter" | "a4">(data.page || "letter");
  const [zoom, setZoom] = useState(Number(data.zoom) || 1);
  const [wordCount, setWordCount] = useState(0);

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
      <div
        className="productivity-toolbar horizontal-menu-scroll"
        data-horizontal-menu
      >
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
            document.execCommand("formatBlock", false, event.target.value);
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
          icon="list"
          label="Numbered list"
          onClick={(event) => command(event, "insertOrderedList")}
        />
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
          label="Insert table"
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
        <span className="toolbar-divider" />
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
          onChange={(event) => updateLayout(page, Number(event.target.value))}
        >
          <option value={0.75}>75%</option>
          <option value={1}>100%</option>
          <option value={1.25}>125%</option>
          <option value={1.5}>150%</option>
        </select>
        <button type="button" onClick={() => window.print()}>
          <FeatherIcon icon="printer" size="16" />
          Print
        </button>
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
function cellKey(row: number, column: number) {
  return `${row}:${column}`;
}
function referenceValue(cells: string[][], token: string) {
  const match = token.match(/^([A-Z]+)(\d+)$/);
  if (!match) return 0;
  let column = 0;
  for (const letter of match[1])
    column = column * 26 + letter.charCodeAt(0) - 64;
  const raw = cells[Number(match[2]) - 1]?.[column - 1] || "0";
  return Number(raw.replace(/[^0-9.+-]/g, "")) || 0;
}
function evaluateCell(cells: string[][], raw: string) {
  if (!raw.startsWith("=")) return raw;
  const formula = raw.slice(1).trim().toUpperCase();
  const aggregate = formula.match(
    /^(SUM|AVERAGE|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)$/,
  );
  if (aggregate) {
    const start = aggregate[2].match(/^([A-Z]+)(\d+)$/)!;
    const end = aggregate[3].match(/^([A-Z]+)(\d+)$/)!;
    const toColumn = (label: string) =>
      [...label].reduce(
        (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
        0,
      ) - 1;
    const values: number[] = [];
    for (let row = Number(start[2]) - 1; row <= Number(end[2]) - 1; row += 1)
      for (
        let column = toColumn(start[1]);
        column <= toColumn(end[1]);
        column += 1
      )
        values.push(Number(cells[row]?.[column]) || 0);
    if (!values.length) return "0";
    if (aggregate[1] === "SUM")
      return String(values.reduce((a, b) => a + b, 0));
    if (aggregate[1] === "AVERAGE")
      return String(values.reduce((a, b) => a + b, 0) / values.length);
    if (aggregate[1] === "MIN") return String(Math.min(...values));
    return String(Math.max(...values));
  }
  const expression = formula.replace(/[A-Z]+\d+/g, (token) =>
    String(referenceValue(cells, token)),
  );
  if (!/^[\d\s.+*/()-]+$/.test(expression)) return "#FORMULA!";
  try {
    const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g) || [];
    const values: number[] = [];
    const operators: string[] = [];
    const precedence = (operator: string) =>
      operator === "+" || operator === "-" ? 1 : 2;
    const apply = () => {
      const operator = operators.pop();
      const right = values.pop() ?? 0;
      const left = values.pop() ?? 0;
      values.push(
        operator === "+"
          ? left + right
          : operator === "-"
            ? left - right
            : operator === "*"
              ? left * right
              : right === 0
                ? NaN
                : left / right,
      );
    };
    for (const token of tokens) {
      if (/^\d/.test(token)) values.push(Number(token));
      else if (token === "(") operators.push(token);
      else if (token === ")") {
        while (operators.length && operators.at(-1) !== "(") apply();
        operators.pop();
      } else {
        while (
          operators.length &&
          operators.at(-1) !== "(" &&
          precedence(operators.at(-1)!) >= precedence(token)
        )
          apply();
        operators.push(token);
      }
    }
    while (operators.length) apply();
    return Number.isFinite(values[0])
      ? String(Math.round(values[0] * 1e8) / 1e8)
      : "#DIV/0!";
  } catch {
    return "#FORMULA!";
  }
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
      cells.push(Array(cells[0]?.length || 12).fill(""));
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
      <div
        className="productivity-toolbar spreadsheet-toolbar horizontal-menu-scroll"
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
        <span className="toolbar-divider" />
        <button
          type="button"
          onClick={() =>
            updateSheet({
              ...active,
              cells: [
                ...active.cells,
                Array(active.cells[0]?.length || 12).fill(""),
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
              cells: active.cells.filter((_, index) => index !== selected.row),
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
  const data = props.artifact.data as PresentationData;
  const slides = data.slides?.length
    ? data.slides
    : (defaultArtifactData("presentation") as PresentationData).slides;
  const active =
    slides.find((slide) => slide.id === data.activeSlideId) || slides[0];
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const update = (
    nextSlides: Slide[],
    activeSlideId = active.id,
    theme = data.theme || "gunmetal",
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
  const addSlide = (layout: Slide["layout"] = "section") => {
    const slide: Slide = {
      id: newId(),
      title: layout === "blank" ? "" : "New slide",
      body: layout === "blank" ? "" : "Add your key points",
      notes: "",
      background:
        data.theme === "light"
          ? "#f7f7f5"
          : data.theme === "blue"
            ? "#173b55"
            : "#20262a",
      layout,
    };
    update([...slides, slide], slide.id);
  };
  return (
    <>
      <header className="workspace-header">
        <ArtifactTitle {...props} />
        <WorkspaceActions {...props} />
      </header>
      <div
        className="productivity-toolbar horizontal-menu-scroll"
        data-horizontal-menu
      >
        <button type="button" onClick={() => addSlide()}>
          <FeatherIcon icon="plus" size="16" /> New slide
        </button>
        <button
          type="button"
          onClick={() => {
            const copy = {
              ...active,
              id: newId(),
              title: `${active.title} copy`,
            };
            update([...slides, copy], copy.id);
          }}
        >
          <FeatherIcon icon="copy" size="16" /> Duplicate
        </button>
        <button
          type="button"
          disabled={slides.length <= 1}
          onClick={() => {
            const remaining = slides.filter((slide) => slide.id !== active.id);
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
        <select
          aria-label="Presentation theme"
          value={data.theme || "gunmetal"}
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
          Background
          <input
            type="color"
            value={active.background}
            onChange={(event) =>
              updateSlide({ background: event.target.value })
            }
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setPresentIndex(slides.indexOf(active));
            setPresenting(true);
          }}
        >
          <FeatherIcon icon="play" size="16" /> Present
        </button>
      </div>
      <div className="presentation-layout">
        <aside className="slide-rail" aria-label="Slides">
          {slides.map((slide, index) => (
            <button
              type="button"
              key={slide.id}
              className={slide.id === active.id ? "active" : ""}
              onClick={() => update(slides, slide.id)}
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
            className={`slide-canvas ${active.layout} ${data.theme || "gunmetal"}`}
            style={{ background: active.background }}
          >
            {active.layout !== "blank" && (
              <input
                className="slide-title"
                value={active.title}
                placeholder="Slide title"
                onChange={(event) => updateSlide({ title: event.target.value })}
              />
            )}
            {active.layout !== "blank" && (
              <textarea
                className="slide-body"
                value={active.body}
                placeholder="Add text, facts, or a story…"
                onChange={(event) => updateSlide({ body: event.target.value })}
              />
            )}
            {active.layout === "blank" && (
              <p className="blank-slide-hint">
                Blank slide · use the AI collaborator to develop this canvas
              </p>
            )}
          </section>
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
            className={data.theme || "gunmetal"}
          >
            <h1>{slides[presentIndex].title}</h1>
            <p>{slides[presentIndex].body}</p>
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
