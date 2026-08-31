import path from "node:path";
import type { EditorPreferences } from "../types.js";

export const defaultPreferences: EditorPreferences = {
  version: 13,
  theme: "dark",
  locale: "en",
  sidebarSide: "left",
  uiScale: 1,
  editorFontSize: 14,
  sidebarWidth: 480,
  gitHeight: 390,
  aiPanelWidth: 330,
  sidebarVisible: true,
  aiVisible: false,
  aiEngine:
    process.platform === "darwin" && process.arch === "arm64"
      ? "mlx"
      : "llamacpp",
  aiModel: "",
  aiExecutable: "",
  aiEditMode: "ask",
  aiFileAccess: false,
  aiWebAccess: false,
  aiContextLimit: 262144,
  aiHardware: "auto",
  aiThinkingEnabled: true,
  suggestions: true,
  wordWrap: false,
  proseWrap: true,
  minimap: true,
  spellcheck: true,
  autoSave: true,
  autoUpdateEnabled: false,
  autoUpdatePromptAnswered: false,
  autoUpdateDismissedVersion: "",
  lastProject: "",
};

export function validPreferences(value: unknown): EditorPreferences {
  if (!value || typeof value !== "object") return { ...defaultPreferences };
  const input = value as Partial<EditorPreferences>;
  const legacy = value as { aiAllowEdits?: unknown; theme?: unknown };
  return {
    version: 13,
    theme:
      input.theme === "blue-dark" || input.theme === "blue-light"
        ? input.theme
        : legacy.theme === "light"
          ? "blue-light"
          : "dark",
    locale: input.locale === "ar" ? "ar" : "en",
    sidebarSide: input.sidebarSide === "right" ? "right" : "left",
    uiScale:
      Number(input.version) >= 5 &&
      [1, 1.15, 1.3, 1.5, 1.7].includes(Number(input.uiScale))
        ? (input.uiScale as EditorPreferences["uiScale"])
        : 1,
    editorFontSize:
      Number.isInteger(input.editorFontSize) &&
      Number(input.editorFontSize) >= 12 &&
      Number(input.editorFontSize) <= 24
        ? Number(input.editorFontSize)
        : 14,
    sidebarWidth:
      Number(input.version) < 12 && Number(input.sidebarWidth) === 300
        ? 480
        : Number.isFinite(input.sidebarWidth) &&
            Number(input.sidebarWidth) >= 240 &&
            Number(input.sidebarWidth) <= 520
          ? Math.round(Number(input.sidebarWidth))
          : 480,
    gitHeight:
      Number.isFinite(input.gitHeight) &&
      Number(input.gitHeight) >= 180 &&
      Number(input.gitHeight) <= 700
        ? Math.round(Number(input.gitHeight))
        : 390,
    aiPanelWidth:
      Number.isFinite(input.aiPanelWidth) &&
      Number(input.aiPanelWidth) >= 280 &&
      Number(input.aiPanelWidth) <= 560
        ? Math.round(Number(input.aiPanelWidth))
        : 330,
    sidebarVisible:
      typeof input.sidebarVisible === "boolean" ? input.sidebarVisible : true,
    aiVisible: typeof input.aiVisible === "boolean" ? input.aiVisible : false,
    aiEngine: ["llamacpp", "ollama", "pytorch", "mlx"].includes(
      String(input.aiEngine),
    )
      ? (input.aiEngine as EditorPreferences["aiEngine"])
      : process.platform === "darwin" && process.arch === "arm64"
        ? "mlx"
        : "llamacpp",
    aiModel:
      typeof input.aiModel === "string" ? input.aiModel.slice(0, 1000) : "",
    aiExecutable:
      typeof input.aiExecutable === "string" &&
      (!input.aiExecutable || path.isAbsolute(input.aiExecutable))
        ? input.aiExecutable
        : "",
    aiEditMode: ["ask", "auto", "read-only"].includes(String(input.aiEditMode))
      ? (input.aiEditMode as EditorPreferences["aiEditMode"])
      : legacy.aiAllowEdits === false
        ? "read-only"
        : "ask",
    aiFileAccess:
      typeof input.aiFileAccess === "boolean" ? input.aiFileAccess : false,
    aiWebAccess:
      typeof input.aiWebAccess === "boolean" ? input.aiWebAccess : false,
    aiContextLimit:
      Number(input.version) >= 7 &&
      [8192, 16384, 32768, 65536, 131072, 262144].includes(
        Number(input.aiContextLimit),
      )
        ? Number(input.aiContextLimit)
        : 262144,
    aiHardware: ["auto", "cpu", "gpu"].includes(String(input.aiHardware))
      ? (input.aiHardware as EditorPreferences["aiHardware"])
      : "auto",
    aiThinkingEnabled:
      typeof input.aiThinkingEnabled === "boolean"
        ? input.aiThinkingEnabled
        : true,
    suggestions:
      typeof input.suggestions === "boolean" ? input.suggestions : true,
    wordWrap: typeof input.wordWrap === "boolean" ? input.wordWrap : false,
    proseWrap: typeof input.proseWrap === "boolean" ? input.proseWrap : true,
    minimap: typeof input.minimap === "boolean" ? input.minimap : true,
    spellcheck: typeof input.spellcheck === "boolean" ? input.spellcheck : true,
    autoSave: typeof input.autoSave === "boolean" ? input.autoSave : true,
    autoUpdateEnabled:
      typeof input.autoUpdateEnabled === "boolean"
        ? input.autoUpdateEnabled
        : false,
    autoUpdatePromptAnswered:
      typeof input.autoUpdatePromptAnswered === "boolean"
        ? input.autoUpdatePromptAnswered
        : false,
    autoUpdateDismissedVersion:
      typeof input.autoUpdateDismissedVersion === "string" &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
        input.autoUpdateDismissedVersion,
      )
        ? input.autoUpdateDismissedVersion
        : "",
    lastProject:
      typeof input.lastProject === "string" &&
      (!input.lastProject || path.isAbsolute(input.lastProject))
        ? input.lastProject
        : "",
  };
}
