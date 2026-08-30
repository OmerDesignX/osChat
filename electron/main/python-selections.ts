import path from "node:path";

const maximumSelections = 100;

export function validPythonSelections(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const valid: Record<string, string> = {};
  for (const [project, interpreter] of Object.entries(value).slice(
    -maximumSelections,
  )) {
    if (
      typeof interpreter === "string" &&
      project.length <= 32_767 &&
      interpreter.length <= 32_767 &&
      path.isAbsolute(project) &&
      path.isAbsolute(interpreter)
    )
      valid[path.resolve(project)] = path.resolve(interpreter);
  }
  return valid;
}

export function setPythonSelection(
  selections: Record<string, string>,
  project: string,
  interpreter: string,
) {
  const updated = { ...selections };
  delete updated[project];
  if (interpreter) updated[project] = interpreter;
  return Object.fromEntries(Object.entries(updated).slice(-maximumSelections));
}
