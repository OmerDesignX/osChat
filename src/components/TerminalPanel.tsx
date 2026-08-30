import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { EditorPreferences } from "../types";

const terminalPalette = (theme: EditorPreferences["theme"]) =>
  theme === "blue-light"
    ? {
        background: "#ffffff",
        foreground: "#0b1d33",
        cursor: "#2187b5",
        cursorAccent: "#ffffff",
        selectionBackground: "#b9e0f2",
        black: "#0b1d33",
        red: "#b33a3a",
        green: "#257349",
        yellow: "#8a6417",
        blue: "#246fa8",
        magenta: "#8755a6",
        cyan: "#1b6f91",
        white: "#eaf4ff",
        brightBlack: "#526d8c",
        brightWhite: "#ffffff",
      }
    : {
        background: theme === "blue-dark" ? "#07111f" : "#111314",
        foreground: theme === "blue-dark" ? "#e5f5fc" : "#e7ecee",
        cursor: theme === "blue-dark" ? "#75b8ff" : "#89cff0",
        cursorAccent: theme === "blue-dark" ? "#07111f" : "#111314",
        selectionBackground: theme === "blue-dark" ? "#173a64" : "#34484f",
      };

export function TerminalPanel({
  id,
  interpreter,
  active,
  theme,
}: {
  id: string;
  interpreter: string;
  active: boolean;
  theme: EditorPreferences["theme"];
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      fontFamily: "Fira Code",
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.1,
      theme: terminalPalette(theme),
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current);
    fit.fit();
    terminal.current = t;
    const off = window.oscode.onTerminalData((termId, data) => {
      if (termId === id) t.write(data);
    });
    void window.oscode
      .createTerminal(id, interpreter)
      .catch((error) =>
        t.write(
          `\r\nUnable to start terminal: ${error instanceof Error ? error.message : String(error)}\r\n`,
        ),
      );
    t.onData((data) => window.oscode.terminalWrite(id, data));
    t.onResize(({ cols, rows }) =>
      window.oscode.terminalResize(id, cols, rows),
    );
    const resize = () => {
      if (!activeRef.current) return;
      fit.fit();
      window.oscode.terminalResize(id, t.cols, t.rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    window.addEventListener("resize", resize);
    return () => {
      off();
      window.oscode.terminalDispose(id);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      t.dispose();
    };
  }, [id, interpreter]);
  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.theme = terminalPalette(theme);
  }, [theme]);
  useEffect(() => {
    if (!active || !terminal.current) return;
    terminal.current.focus();
    window.dispatchEvent(new Event("resize"));
  }, [active]);
  return (
    <div
      className="terminal-host"
      data-terminal-theme={theme}
      ref={host}
      hidden={!active}
    />
  );
}
