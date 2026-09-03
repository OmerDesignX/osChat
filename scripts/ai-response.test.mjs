import assert from "node:assert/strict";
import test from "node:test";
import {
  actionForTool,
  finishToolAction,
  focusedAgentTools,
  parseLocalToolCall,
  parseLocalToolCalls,
  parseQwenContent,
  qwenToolCallMarkup,
  qwenToolInstructions,
  normalizeRunCommand,
  validateGoalEvidence,
  automaticGoalText,
  isCasualGreeting,
  isDeferredActionReply,
  isDestructiveProjectCommand,
  isStalePermissionReply,
  needsTextToolProtocol,
  normalizePublicAssistantIdentity,
  normalizeAgentWebSearchQuery,
  shouldCreateAutomaticGoal,
  workRequestForAgent,
} from "../dist-electron/main/ai.js";

test("normalizes legacy osCode self-identification without rewriting shared assets", () => {
  assert.equal(
    normalizePublicAssistantIdentity("osCode. I already listed it."),
    "osChat. I already listed it.",
  );
  assert.equal(
    normalizePublicAssistantIdentity("As osCode, I can help."),
    "As osChat, I can help.",
  );
  assert.equal(
    normalizePublicAssistantIdentity("I should identify as osCode."),
    "I should identify as osChat.",
  );
  const sharedAsset =
    "Use https://github.com/OmerDesignX/osCode-Models and osCode-GGUF-Small.gguf.";
  assert.equal(normalizePublicAssistantIdentity(sharedAsset), sharedAsset);
});

test("destructive project commands are redirected to the Trash approval tool", () => {
  assert.equal(isDestructiveProjectCommand("rm", ["-rf", "src"]), true);
  assert.equal(isDestructiveProjectCommand("git", ["clean", "-fdx"]), true);
  assert.equal(
    isDestructiveProjectCommand("python3", [
      "-c",
      "import shutil; shutil.rmtree('src')",
    ]),
    true,
  );
  assert.equal(isDestructiveProjectCommand("pio", ["run"]), false);
});
import {
  publicIconCandidates,
  publicImageCandidates,
  receiveOnlyServerRedirect,
} from "../dist-electron/main/web-search.js";

test("extracts and ranks website icons from public page metadata", () => {
  assert.deepEqual(
    publicIconCandidates(
      [
        '<link rel="icon" href="/favicon.ico">',
        '<link sizes="180x180" href="/apple.png" rel="apple-touch-icon">',
        '<link rel="stylesheet" href="/site.css">',
        '<link rel="icon" href="data:image/png;base64,AAAA">',
      ].join(""),
      "https://en.wikipedia.org/wiki/Test",
    ),
    [
      "https://en.wikipedia.org/apple.png",
      "https://en.wikipedia.org/favicon.ico",
    ],
  );
});

test("extracts safe representative images from public page metadata", () => {
  assert.deepEqual(
    publicImageCandidates(
      '<meta property="og:image" content="/assets/sample.jpg"><img src="https://cdn.example.org/backup.png"><img src="data:image/png;base64,AAAA">',
      "https://example.com/gallery/item",
    ),
    [
      "https://example.com/assets/sample.jpg",
      "https://cdn.example.org/backup.png",
    ],
  );
});

test("server redirects permit signed CDN queries without weakening HTTPS boundaries", () => {
  const redirect = receiveOnlyServerRedirect(
    `https://cdn.example.com/image.jpg?${"signature=abcdef".repeat(40)}`,
  );
  assert.equal(redirect.hostname, "cdn.example.com");
  assert.throws(
    () => receiveOnlyServerRedirect("http://cdn.example.com/image.jpg"),
    /HTTPS redirects/,
  );
  assert.throws(
    () =>
      receiveOnlyServerRedirect("https://user:pass@cdn.example.com/image.jpg"),
    /credential-free/,
  );
});

test("web search hygiene removes internal agent vocabulary and keeps the public subject", () => {
  assert.equal(
    normalizeAgentWebSearchQuery(
      "osCode YOLO sample images permission",
      "Create a YOLO image detection script",
    ),
    "YOLO sample images",
  );
  assert.throws(
    () =>
      normalizeAgentWebSearchQuery(
        "osCode web download permission",
        "Create a YOLO image detection script",
      ),
    /no public task subject/,
  );
  assert.equal(
    normalizeAgentWebSearchQuery(
      "current Electron security guidance",
      "Research current Electron security guidance",
    ),
    "current Electron security guidance",
  );
});

test("focuses small-model tools without removing capabilities from relevant turns", () => {
  const tools = [
    "write_file",
    "python_install_packages",
    "web_download_image",
    "browser_open",
    "computer_inspect",
    "platformio_run",
    "mcp_list_tools",
    "set_goal",
    "complete_goal",
    "schedule_task",
  ].map((name) => ({ type: "function", function: { name } }));
  const names = (request, state = {}) =>
    focusedAgentTools(tools, request, {
      goal: true,
      browser: false,
      computer: false,
      ...state,
    }).map((tool) => tool.function.name);
  assert.deepEqual(names("Create a YOLO Python script and download images"), [
    "write_file",
    "python_install_packages",
    "web_download_image",
    "complete_goal",
  ]);
  assert.ok(
    names("Build ESP32 firmware with PlatformIO").includes("platformio_run"),
  );
  assert.ok(names("Inspect another desktop app").includes("computer_inspect"));
  assert.ok(
    names("Test the localhost preview in a browser").includes("browser_open"),
  );
  assert.ok(names("Use the configured MCP server").includes("mcp_list_tools"));
});

test("records synthetic tool history in the installed Qwen template format", () => {
  assert.equal(
    qwenToolCallMarkup("list_files", {}),
    "<tool_call>\n<function=list_files>\n</function>\n</tool_call>",
  );
  assert.equal(
    qwenToolCallMarkup("write_file", {
      path: "src/index.js",
      content: "export const revision = 2;\n",
    }),
    [
      "<tool_call>",
      "<function=write_file>",
      "<parameter=path>",
      "src/index.js",
      "</parameter>",
      "<parameter=content>",
      "export const revision = 2;",
      "",
      "</parameter>",
      "</function>",
      "</tool_call>",
    ].join("\n"),
  );
});

test("agent action records retain public sources without recording typed text", () => {
  const search = actionForTool(
    {
      id: "search-1",
      name: "web_search",
      arguments: { query: "Electron macOS accessibility documentation" },
    },
    "chat-1",
  );
  const finished = finishToolAction(
    search,
    "completed",
    "Electron https://www.electronjs.org/docs/latest/ and Apple https://developer.apple.com/documentation/applicationservices",
  );
  assert.equal(finished.query, "Electron macOS accessibility documentation");
  assert.deepEqual(finished.websites, [
    "https://www.electronjs.org/docs/latest/",
    "https://developer.apple.com/documentation/applicationservices",
  ]);

  const secret = "never-record-this-value";
  const browserType = actionForTool(
    {
      name: "browser_type",
      arguments: { query: "Search field", text: secret },
    },
    "chat-1",
  );
  const computerType = actionForTool(
    {
      name: "computer_type",
      arguments: { target: "osCode", query: "Prompt", text: secret },
    },
    "chat-1",
  );
  assert.doesNotMatch(JSON.stringify(browserType), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(computerType), new RegExp(secret));
  assert.match(browserType.detail, /23 characters \(text not recorded\)/);

  const page = actionForTool(
    {
      name: "web_fetch",
      arguments: {
        url: "https://person:secret@example.com/docs?token=private#account",
      },
    },
    "chat-1",
  );
  assert.equal(page.url, "https://example.com/docs");
  assert.doesNotMatch(JSON.stringify(page), /secret|private|person/);

  const fileRead = actionForTool(
    { name: "read_file", arguments: { path: "src/private.ts" } },
    "chat-1",
  );
  const finishedRead = finishToolAction(fileRead, "completed", secret);
  assert.equal(finishedRead.output, undefined);
  assert.doesNotMatch(JSON.stringify(finishedRead), new RegExp(secret));

  const command = actionForTool(
    { name: "run_command", arguments: { command: "npm", args: ["test"] } },
    "chat-1",
  );
  const finishedCommand = finishToolAction(
    command,
    "completed",
    JSON.stringify({ stdout: "Tests passed", stderr: "", exitCode: 0 }),
  );
  assert.equal(finishedCommand.output, "Tests passed");
});

test("malformed command actions remain visible so the model can repair them", () => {
  assert.doesNotThrow(() =>
    actionForTool(
      {
        name: "run_command",
        arguments: { command: "python script.py", args: [] },
      },
      "chat-1",
    ),
  );
});

test("separates Qwen thinking from the formatted final answer", () => {
  assert.deepEqual(
    parseQwenContent(
      "<think>Inspect the project first.</think>\n\n## Result\n\n- Fixed it<|im_end|>",
    ),
    {
      thinking: "Inspect the project first.",
      content: "## Result\n\n- Fixed it",
    },
  );
});

test("supports Qwen thinking models that emit only a closing marker", () => {
  assert.deepEqual(parseQwenContent("Check the files.\n</think>\n\nDone."), {
    thinking: "Check the files.",
    content: "Done.",
  });
});

test("removes a stray punctuation line before a Qwen final answer", () => {
  assert.deepEqual(parseQwenContent(".\n## Result\n\nDone."), {
    content: "## Result\n\nDone.",
    thinking: undefined,
  });
});

test("removes llama.cpp cache diagnostics from public answers", () => {
  assert.deepEqual(
    parseQwenContent(
      "Hello! What would you like to build?\n\nllama_completion: saving final output to\nsession file\n'C:\\\\Users\\\\person\\\\AppData\\\\Roaming\\\\oscode\\\\ai\\\\prompt-cache\\\\abc.bin'",
    ),
    {
      content: "Hello! What would you like to build?",
      thinking: undefined,
    },
  );
});

test("normalizes a safe command accidentally placed in the executable field", () => {
  assert.deepEqual(
    normalizeRunCommand("python -m unittest test_focusboard", [
      "test_focusboard",
    ]),
    {
      command: "python",
      args: ["-m", "unittest", "test_focusboard"],
    },
  );
  assert.throws(
    () => normalizeRunCommand("python & whoami", []),
    /executable name/,
  );
  assert.deepEqual(normalizeRunCommand("npm", undefined), {
    command: "npm",
    args: [],
  });
});

test("requires distinct CRUD evidence and an update implementation", () => {
  assert.throws(
    () =>
      validateGoalEvidence(
        "Ship task CRUD",
        ["addTask creates", "render reads", "deleteTask removes"],
        "function addTask() {} function render() {} function deleteTask() {}",
      ),
    /update\/edit/,
  );
  assert.doesNotThrow(() =>
    validateGoalEvidence(
      "Ship task CRUD",
      [
        "addTask creates",
        "render reads",
        "editTask updates",
        "deleteTask removes",
      ],
      "function addTask() {} function render() {} function editTask() {} button.onclick = () => editTask(1); function deleteTask() {}",
    ),
  );
});

test("creates bounded automatic goals only for substantive work", () => {
  assert.equal(shouldCreateAutomaticGoal("Hello"), false);
  assert.equal(
    shouldCreateAutomaticGoal(
      "Create a local React notes app and test that it works",
    ),
    true,
  );
  const request = `Please repair and verify this project. ${"Inspect every requirement. ".repeat(8)}`;
  assert.equal(shouldCreateAutomaticGoal(request), true);
  assert.match(automaticGoalText(request), /^Complete and verify/);
  assert.ok(automaticGoalText(request).length <= 740);
});

test("short confirmations retain the earlier work request and reject plan-only replies", () => {
  const request =
    "Create a local React notes app that stores names and verify the finished project";
  assert.equal(
    workRequestForAgent([
      { role: "user", content: request },
      { role: "assistant", content: "Should I build it?" },
      { role: "user", content: "yes do that pls" },
    ]),
    request,
  );
  assert.equal(
    isDeferredActionReply(
      "I should create the React structure and implement the editor.",
    ),
    true,
  );
  assert.equal(
    isDeferredActionReply("Created and tested the React editor."),
    false,
  );
});

test("recognizes casual greetings without treating work requests as small talk", () => {
  assert.equal(isCasualGreeting("Hi there!"), true);
  assert.equal(isCasualGreeting("Good morning"), true);
  assert.equal(isCasualGreeting("Hi, please fix the tests"), false);
});

test("recognizes obsolete permission prose only when the capability is granted", () => {
  const granted = {
    fileAccess: true,
    editMode: "auto",
    terminalMode: "ask",
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
  };
  assert.equal(
    isStalePermissionReply("First, I need permission to write files.", granted),
    true,
  );
  assert.equal(
    isStalePermissionReply("I need permission to write files.", {
      ...granted,
      fileAccess: false,
    }),
    false,
  );
  assert.equal(
    isStalePermissionReply("The requested file is ready.", granted),
    false,
  );
  assert.equal(
    isStalePermissionReply("I need terminal permission to run npm.", {
      ...granted,
      terminalMode: "auto",
    }),
    true,
  );
});

test("parses Qwen coder native tool calls including JSON arrays", () => {
  assert.deepEqual(
    parseLocalToolCall(`<tool_call>
<function=run_command>
<parameter=command>python</parameter>
<parameter=args>["-m", "unittest"]</parameter>
<parameter=purpose>Run the tests</parameter>
</function>
</tool_call>`),
    {
      name: "run_command",
      arguments: {
        command: "python",
        args: ["-m", "unittest"],
        purpose: "Run the tests",
      },
    },
  );
});

test("parses JSON tool calls emitted by the MLX chat template", () => {
  assert.deepEqual(
    parseLocalToolCall(`<tool_call>
{"name":"write_file","arguments":{"path":"src/app.ts","content":"export const ready = true;\\n"}}
</tool_call>`),
    {
      name: "write_file",
      arguments: {
        path: "src/app.ts",
        content: "export const ready = true;\n",
      },
    },
  );
});

test("accepts a recoverable Qwen tool block when outer tags are omitted", () => {
  assert.deepEqual(
    parseLocalToolCall(`<function=read_file>
<parameter=path>src/app.ts</parameter>
</function>`),
    { name: "read_file", arguments: { path: "src/app.ts" } },
  );
});

test("recovers batched Qwen reads with omitted parameter closing tags", () => {
  assert.deepEqual(
    parseLocalToolCalls(`<tool_call>
<function=read_file>
<parameter=path>
app.js
</function>
</tool_call>
<tool_call>
<function=read_file>
<parameter=path>
test_focusboard.py
</parameter>
</function>
</tool_call>`),
    [
      { name: "read_file", arguments: { path: "app.js" } },
      { name: "read_file", arguments: { path: "test_focusboard.py" } },
    ],
  );
});

test("renders the compact Qwen tool protocol expected by the local model", () => {
  const prompt = qwenToolInstructions([
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write a file",
        parameters: {
          type: "object",
          required: ["path", "content"],
          properties: { path: { type: "string" }, content: { type: "string" } },
        },
      },
    },
  ]);
  assert.match(prompt, /<tools>/);
  assert.match(prompt, /<function=tool_name>/);
  assert.match(prompt, /"type":"function"/);
  assert.match(prompt, /IMPLEMENTATION WORKFLOW/);
  assert.match(prompt, /write_file/);
});

test("MLX and Ollama use their native tool templates without duplicating the text catalogue", () => {
  assert.equal(needsTextToolProtocol("mlx"), false);
  assert.equal(needsTextToolProtocol("ollama"), false);
  assert.equal(needsTextToolProtocol("llamacpp"), true);
  assert.equal(needsTextToolProtocol("pytorch"), true);
});

test("shows Qwen the development command and args form", () => {
  const prompt = qwenToolInstructions([
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Run a command",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  assert.match(prompt, /command is "npm"/);
  assert.match(prompt, /args is \["run", "build"\]/);
  assert.match(prompt, /shell operators[^.]+not interpreted/);
});

test("tells Qwen to use the dedicated Python package tool", () => {
  const prompt = qwenToolInstructions([
    {
      type: "function",
      function: {
        name: "python_install_packages",
        description: "Install Python packages",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  assert.match(prompt, /always call python_install_packages/);
  assert.match(prompt, /"ultralytics", "opencv-python", "numpy"/);
  assert.match(prompt, /Do not call pip, python -m pip, or uv/);
});
