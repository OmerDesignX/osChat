import fs from "node:fs/promises";
import path from "node:path";
import { LocalAiService } from "../dist-electron/main/ai.js";

process.env.OSCODE_LLAMA_MAX_TOKENS ||= "32";

const platformKey = `${process.platform}-${process.arch}`;
const root = path.resolve(
  "work",
  "local-ai-verification",
  platformKey,
  "binding",
);
const projectRoot = path.join(root, "project");
const userData = path.join(root, "data");
await fs.mkdir(projectRoot, { recursive: true });
await fs.writeFile(
  path.join(projectRoot, "hello.py"),
  "def hello():\n    return 'hello'\n",
  "utf8",
);

async function files(directory) {
  const found = [];
  for (const entry of await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => [])) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(candidate)));
    else found.push(candidate);
  }
  return found;
}

const bundledPython = (
  await files(path.resolve("vendor", "python", platformKey))
).find((file) =>
  process.platform === "win32"
    ? /3\.12[^\\/]*[\\/]python\.exe$/i.test(file) && !/Scripts/i.test(file)
    : /python3(?:\.12)?$/.test(file),
);
const bundledUv = (await files(path.resolve("vendor", "uv", platformKey))).find(
  (file) => /[\\/]uv(?:\.exe)?$/i.test(file),
);
if (!bundledPython || !bundledUv)
  throw new Error(
    "Prepare the bundled Python runtimes before running the AI verifier",
  );

const service = new LocalAiService({
  userData,
  modelsRoot: path.join(userData, "models"),
  llamaRoot: path.resolve("vendor", "llama"),
  getProjectRoot: () => projectRoot,
  getPython: async () => bundledPython,
  getUv: async () => bundledUv,
  status: (message) => console.log(message),
});
try {
  await service.prepareEngine("llamacpp");
  const modelPath = process.env.OSCODE_TEST_GGUF;
  if (!modelPath)
    throw new Error(
      "Set OSCODE_TEST_GGUF to an absolute local GGUF file before running the AI verifier",
    );
  if (!path.isAbsolute(modelPath))
    throw new Error("OSCODE_TEST_GGUF must be an absolute local GGUF path");
  await fs.access(modelPath);
  const model = await service.registerModel({
    id: `llamacpp:${modelPath}`,
    name: path.basename(modelPath),
    engine: "llamacpp",
    path: modelPath,
    source: "local",
  });
  const chat = await service.createChat("Runtime verification");
  await service.grantPermission(
    "project.read",
    "conversation",
    chat.id,
    "project files",
  );
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: model.path,
    executable: "",
    editMode: "read-only",
    contextLimit: 8192,
    contextSummary: "",
    goal: "Verify the local model runtime",
    messages: [{ role: "user", content: "Reply with only OK." }],
  });
  if (!result.content.trim())
    throw new Error("The local model returned an empty response");
  console.log(
    `Local AI verification passed: ${result.content.trim().slice(0, 240)}`,
  );
} finally {
  await service.dispose();
}
