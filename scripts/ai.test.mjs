import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  attachmentContextForModel,
  hasRenderableInteractiveContent,
  hasPrivateAttachmentContext,
  isTrustedOllamaDownloadUrl,
  isPackageInstallCommand,
  llamaMediaArguments,
  localMediaMessages,
  LocalAiService,
  ollamaCliAssetName,
  pythonPackageInstallSpecs,
  requiredProjectImageDownloadCount,
  requiresInteractiveChatContent,
  requiresProjectMutation,
  privateAttachmentExternalDetail,
  toolResultForModel,
} from "../dist-electron/main/ai.js";
import {
  materializeAiMedia,
  prepareAiAttachments,
} from "../dist-electron/main/attachments.js";
import { localModelCapabilities } from "../dist-electron/main/model-capabilities.js";
import { ComputerSystemPermissionError } from "../dist-electron/main/computer-permissions.js";

test("interactive chat completion recognizes only renderable artifact payloads", () => {
  assert.equal(
    requiresInteractiveChatContent("can you show me the table"),
    true,
  );
  assert.equal(requiresInteractiveChatContent("thanks"), false);
  assert.equal(
    hasRenderableInteractiveContent(
      '```oschat-widget\n{"type":"table","title":"Cars","headers":["Car"],"rows":[["A"]]}\n```',
    ),
    true,
  );
  assert.equal(
    hasRenderableInteractiveContent("```oschat-widget\n{not valid json}\n```"),
    false,
  );
  assert.equal(
    hasRenderableInteractiveContent(
      "| Car | Speed |\n| --- | --- |\n| A | 320 |",
    ),
    true,
  );
});

test("attachments are decoded locally and represented honestly for each engine", async () => {
  const [document] = await prepareAiAttachments([
    {
      id: "notes",
      name: "notes.md",
      kind: "document",
      mimeType: "text/markdown",
      dataUrl: `data:text/markdown;base64,${Buffer.from("# Private notes\nKeep this local.").toString("base64")}`,
    },
  ]);
  assert.equal(document.kind, "document");
  assert.match(document.extractedText, /Keep this local/);
  assert.match(
    attachmentContextForModel([document], "mlx")[0],
    /untrusted reference data/,
  );

  const docx = await fs.readFile(
    new URL(
      "../node_modules/mammoth/test/test-data/single-paragraph.docx",
      import.meta.url,
    ),
  );
  const [wordDocument] = await prepareAiAttachments([
    {
      id: "word",
      name: "notes.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx.toString("base64")}`,
    },
  ]);
  assert.match(wordDocument.extractedText, /Walking on imported air/);

  const stream = "BT /F1 18 Tf 72 720 Td (Private PDF text) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join(
      "\n",
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const [pdfDocument] = await prepareAiAttachments([
    {
      id: "pdf",
      name: "notes.pdf",
      mimeType: "application/pdf",
      dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
    },
  ]);
  assert.match(pdfDocument.extractedText, /Private PDF text/);

  const image = {
    id: "image",
    name: "private.png",
    kind: "image",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AA==",
  };
  assert.match(
    attachmentContextForModel([image], "mlx")[0],
    /pixels are supplied directly to the selected local model/,
  );
  assert.match(
    attachmentContextForModel([image], "mlx", {
      text: true,
      documents: true,
      images: true,
      video: true,
      audio: false,
      mediaInput: true,
    })[0],
    /pixels are supplied directly to the selected local model/,
  );
  assert.match(
    attachmentContextForModel([image], "ollama")[0],
    /pixels are supplied directly to the selected local model/,
  );
  assert.equal(
    hasPrivateAttachmentContext([
      { role: "user", content: "Review it", attachments: [image] },
    ]),
    true,
  );
});

test("private multimodal files are short-lived and local runtimes receive media without sidecar gating", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-media-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const media = await materializeAiMedia(
    [
      {
        attachments: [
          {
            id: "private-image",
            name: "private.png",
            kind: "image",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,AA==",
          },
        ],
      },
    ],
    base,
  );
  assert.equal(media.files.length, 1);
  assert.equal(await fs.readFile(media.files[0].path, "hex"), "00");
  assert.deepEqual(await llamaMediaArguments(media), [
    "--image",
    media.files[0].path,
  ]);
  const mediaRouting = localMediaMessages([
    {
      role: "user",
      content: "Review everything locally",
      attachments: [
        {
          id: "image",
          name: "image.png",
          kind: "image",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
        },
        {
          id: "audio",
          name: "audio.wav",
          kind: "audio",
          mimeType: "audio/wav",
          dataUrl: "data:audio/wav;base64,AA==",
        },
        {
          id: "video",
          name: "video.mp4",
          kind: "video",
          mimeType: "video/mp4",
          dataUrl: "data:video/mp4;base64,AA==",
        },
        {
          id: "document",
          name: "notes.md",
          kind: "document",
          mimeType: "text/markdown",
          dataUrl: "data:text/markdown;base64,AA==",
          extractedText: "decoded locally",
        },
      ],
    },
  ]);
  assert.deepEqual(
    mediaRouting[0].attachments.map((attachment) => attachment.kind),
    ["image", "audio", "video"],
  );
  const textOnlyRouting = localMediaMessages(
    [
      {
        role: "user",
        content: "Inspect locally",
        attachments: mediaRouting[0].attachments,
      },
    ],
    {
      text: true,
      documents: true,
      images: false,
      video: false,
      audio: false,
      mediaInput: false,
    },
  );
  assert.deepEqual(textOnlyRouting[0].attachments, []);
  await media.cleanup();
  await assert.rejects(fs.stat(media.root), { code: "ENOENT" });

  const textOnly = path.join(base, "text-only");
  await fs.mkdir(textOnly);
  await fs.writeFile(
    path.join(textOnly, "config.json"),
    JSON.stringify({ text_config: {} }),
  );
  await fs.writeFile(
    path.join(textOnly, "model.safetensors.index.json"),
    JSON.stringify({
      weight_map: { "language_model.layers.0": "model.safetensors" },
    }),
  );
  const routedMlxCapabilities = await localModelCapabilities("mlx", textOnly);
  assert.equal(routedMlxCapabilities.images, false);
  assert.equal(routedMlxCapabilities.video, false);
  assert.equal(routedMlxCapabilities.audio, false);
  assert.equal(routedMlxCapabilities.mediaInput, false);

  await fs.writeFile(
    path.join(textOnly, "config.json"),
    JSON.stringify({
      architectures: ["Qwen3_5ForConditionalGeneration"],
      text_config: { model_type: "qwen3_5_text" },
      image_token_id: 248056,
      video_token_id: 248057,
    }),
  );
  const reservedMediaTokens = await localModelCapabilities("mlx", textOnly);
  assert.equal(reservedMediaTokens.images, false);
  assert.equal(reservedMediaTokens.video, false);
  assert.equal(reservedMediaTokens.mediaInput, false);

  const vision = path.join(base, "vision");
  await fs.mkdir(vision);
  await fs.writeFile(
    path.join(vision, "config.json"),
    JSON.stringify({ text_config: {}, vision_config: {} }),
  );
  await fs.writeFile(
    path.join(vision, "preprocessor_config.json"),
    JSON.stringify({ do_resize: true }),
  );
  await fs.writeFile(
    path.join(vision, "model.safetensors.index.json"),
    JSON.stringify({
      weight_map: { "vision_model.layers.0": "model.safetensors" },
    }),
  );
  const visionCapabilities = await localModelCapabilities("mlx", vision);
  assert.equal(visionCapabilities.images, true);
  assert.equal(visionCapabilities.video, true);
  assert.equal(visionCapabilities.audio, false);
  assert.equal(visionCapabilities.mediaInput, true);

  const unified = path.join(base, "unified");
  await fs.mkdir(unified);
  await fs.writeFile(
    path.join(unified, "config.json"),
    JSON.stringify({
      architectures: ["Qwen3_5ForConditionalGeneration"],
      image_token_id: 100,
      video_token_id: 101,
      text_config: {},
    }),
  );
  const unifiedCapabilities = await localModelCapabilities("mlx", unified);
  assert.equal(unifiedCapabilities.images, false);
  assert.equal(unifiedCapabilities.video, false);
  assert.equal(unifiedCapabilities.mediaInput, false);

  const gguf = path.join(base, "model.gguf");
  const projector = path.join(base, "mmproj-model.gguf");
  await fs.writeFile(gguf, "gguf");
  await fs.writeFile(projector, "projector");
  const ggufCapabilities = await localModelCapabilities("llamacpp", gguf);
  assert.equal(ggufCapabilities.images, true);
  assert.equal(ggufCapabilities.projector, projector);

  await fs.rm(projector);
  const unifiedGgufCapabilities = await localModelCapabilities(
    "llamacpp",
    gguf,
  );
  assert.equal(unifiedGgufCapabilities.images, true);
  assert.equal(unifiedGgufCapabilities.video, true);
  assert.equal(unifiedGgufCapabilities.audio, true);
  assert.equal(unifiedGgufCapabilities.mediaInput, true);
  assert.equal(unifiedGgufCapabilities.projector, undefined);
});

test("attachment egress permission is exact and cannot be replaced by Web access", async (t) => {
  const { base, service, chat } = await fixture({
    serviceOptions: {
      mcpCall: async (serverId, name) => `called ${serverId}:${name}`,
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await service.grantPermission("web.search", "conversation", chat.id, "web");
  const call = {
    name: "web_search",
    arguments: { query: "generic public documentation" },
  };
  await assert.rejects(
    service.runTool(
      call,
      "auto",
      new Set(),
      [],
      true,
      true,
      chat.id,
      true,
      true,
      "auto",
      false,
      true,
      new Set(),
    ),
    (error) => {
      assert.equal(error.kind, "attachments.external");
      assert.match(error.detail, /generic public documentation/);
      return true;
    },
  );
  const exact = privateAttachmentExternalDetail({
    name: "mcp_call_tool",
    arguments: {
      server_id: "docs",
      name: "lookup",
      arguments: { topic: "generic API" },
    },
  });
  await service.grantPermission("attachments.external", "once", chat.id, exact);
  await service.grantPermission("mcp.call", "once", chat.id, "docs: lookup");
  const approvals = new Set([exact]);
  assert.equal(
    await service.runTool(
      {
        name: "mcp_call_tool",
        arguments: {
          server_id: "docs",
          name: "lookup",
          arguments: { topic: "generic API" },
        },
      },
      "auto",
      new Set(),
      [],
      true,
      true,
      chat.id,
      true,
      true,
      "auto",
      true,
      true,
      approvals,
    ),
    "called docs:lookup",
  );
  assert.equal(approvals.size, 0);
});

test("project image delivery obligations are narrow and count requested assets", () => {
  assert.equal(
    requiredProjectImageDownloadCount(
      "Download two public images into an images folder inside this project",
    ),
    2,
  );
  assert.equal(
    requiredProjectImageDownloadCount(
      "Create an image downloader component for the web app",
    ),
    0,
  );
  assert.equal(
    requiredProjectImageDownloadCount("Explain how image downloads work"),
    0,
  );
});
import {
  filesForVariant,
  modelVariants,
} from "../dist-electron/main/model-catalog.js";

test("Ollama setup selects standalone CLI archives and rejects desktop installers", () => {
  assert.equal(ollamaCliAssetName("win32", "x64"), "ollama-windows-amd64.zip");
  assert.equal(
    ollamaCliAssetName("win32", "arm64"),
    "ollama-windows-arm64.zip",
  );
  assert.equal(ollamaCliAssetName("darwin", "arm64"), "ollama-darwin.tgz");
  assert.equal(
    ollamaCliAssetName("linux", "x64"),
    "ollama-linux-amd64.tar.zst",
  );
  assert.equal(
    isTrustedOllamaDownloadUrl(
      "https://github.com/ollama/ollama/releases/download/v1.0.0/ollama-windows-amd64.zip",
    ),
    true,
  );
  assert.equal(
    isTrustedOllamaDownloadUrl("https://ollama.com/download/OllamaSetup.exe"),
    false,
  );
  assert.equal(
    isTrustedOllamaDownloadUrl("https://ollama.com/download/Ollama.dmg"),
    false,
  );
});

async function fixture({
  grants = true,
  status = () => undefined,
  installPythonPackages,
  serviceOptions = {},
} = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-ai-test-"));
  const root = path.join(base, "project");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "export const value = 1;\n",
  );
  const service = new LocalAiService({
    userData: path.join(base, "data"),
    modelsRoot: path.join(root, "models"),
    getProjectRoot: () => root,
    getPython: async () => "python",
    getUv: async () => "uv",
    ...(installPythonPackages ? { installPythonPackages } : {}),
    status,
    ...serviceOptions,
  });
  const chat = await service.createChat();
  if (grants) {
    await service.grantPermission(
      "project.read",
      "conversation",
      chat.id,
      "tests",
    );
    await service.grantPermission(
      "project.write",
      "conversation",
      chat.id,
      "tests",
    );
  }
  return { root, base, service, chat };
}

test("structured requests cannot finish with only an internal artifact path", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  let turns = 0;
  service.remoteReply = async (_request, messages) => {
    turns += 1;
    if (turns === 1)
      return {
        content:
          "I saved the comparison as Documents/cars.oschat.json. Ask me to show it.",
        toolCalls: [],
      };
    assert.match(
      String(messages.at(-1)?.content || ""),
      /Interactive-output correction:[\s\S]*Return the actual result now/,
    );
    return {
      content: [
        "Here is the comparison.",
        "```oschat-widget",
        '{"type":"table","title":"Cars","headers":["Car","Speed"],"rows":[["A",320],["B",315]]}',
        "```",
      ].join("\n"),
      toolCalls: [],
    };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [{ role: "user", content: "can you show me the table" }],
  });
  assert.equal(turns, 2);
  assert.match(result.content, /```oschat-widget/);
  assert.doesNotMatch(result.content, /\.oschat\.json/);
});

test("ordinary substantive prose receives an interactive card without another inference pass", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  let turns = 0;
  service.remoteReply = async () => {
    turns += 1;
    return {
      content:
        "Photosynthesis converts light energy into stored chemical energy.",
      toolCalls: [],
    };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "user", content: "Explain photosynthesis in one sentence" },
    ],
  });
  assert.equal(turns, 1);
  assert.match(result.content, /```oschat-widget/);
  assert.match(result.content, /\"type\":\"document\"/);
});

test("web, external desktop, and MCP actions request their scoped permission", async (t) => {
  const { base, service, chat } = await fixture({
    serviceOptions: {
      computerInspect: async (target) => `inspected ${target}`,
      mcpList: async (serverId) => `listed ${serverId || "all"}`,
      mcpCall: async (serverId, name) => `called ${serverId}:${name}`,
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const baseArgs = ["auto", new Set(), [], true, true, chat.id, true, true];

  await assert.rejects(
    service.runTool(
      { name: "web_search", arguments: { query: "Electron accessibility" } },
      ...baseArgs,
    ),
    (error) => {
      assert.equal(error.kind, "web.search");
      return true;
    },
  );
  await assert.rejects(
    service.runTool(
      { name: "computer_inspect", arguments: { target: "Preview" } },
      ...baseArgs,
    ),
    (error) => {
      assert.equal(error.kind, "computer.external");
      return true;
    },
  );
  await assert.rejects(
    service.runTool(
      { name: "mcp_list_tools", arguments: { server_id: "docs" } },
      ...baseArgs,
    ),
    (error) => {
      assert.equal(error.kind, "mcp.call");
      return true;
    },
  );
  await assert.rejects(
    service.runTool(
      {
        name: "mcp_call_tool",
        arguments: {
          server_id: "docs",
          name: "lookup",
          arguments: { path: "/Users/person/private.ts" },
        },
      },
      ...baseArgs,
    ),
    /blocked to protect project and personal data/,
  );
});

test("computer inspection gives the local model a private transient screenshot", async (t) => {
  let capturedTarget = "";
  const { base, service, chat } = await fixture({
    serviceOptions: {
      computerInspect: async (target) => `inspected ${target}`,
      computerSnapshot: async (target) => {
        capturedTarget = target;
        return {
          id: "screen-1",
          name: "Preview screenshot.png",
          kind: "image",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
          size: 1,
          target,
          scope: "window",
          capturedAt: Date.now(),
        };
      },
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await service.grantPermission(
    "computer.external",
    "conversation",
    chat.id,
    "Preview",
  );
  await service.grantPermission(
    "computer.control",
    "conversation",
    chat.id,
    "Preview",
  );
  const result = await service.runTool(
    { name: "computer_inspect", arguments: { target: "Preview" } },
    "auto",
    new Set(),
    [],
    true,
    false,
    chat.id,
    false,
    true,
  );
  assert.equal(capturedTarget, "Preview");
  assert.match(result, /current window screenshot/i);
  assert.match(result, /private, transient/);
  assert.equal(
    service.computerSnapshots.get(chat.id)?.dataUrl,
    "data:image/png;base64,AA==",
  );
});

test("every agent project deletion requires a fresh one-time Trash approval", async (t) => {
  const { root, base, service, chat } = await fixture({
    serviceOptions: {
      trashProjectPath: async (target) =>
        fs.rename(target, path.join(base, "trashed-item")),
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "remove-me.txt"), "temporary\n");
  const call = { name: "delete_path", arguments: { path: "remove-me.txt" } };
  const args = ["auto", new Set(), [], true, false, chat.id, false, false];
  await assert.rejects(service.runTool(call, ...args), (error) => {
    assert.equal(error.kind, "project.delete");
    return true;
  });
  const grant = await service.grantPermission(
    "project.delete",
    "always",
    chat.id,
    "remove-me.txt",
  );
  assert.equal(grant.scope, "once");
  assert.match(
    await service.runTool(call, ...args, "auto", true),
    /Moved remove-me\.txt to (?:Trash|the Recycle Bin)/,
  );
  await assert.rejects(fs.stat(path.join(root, "remove-me.txt")));
  assert.equal(
    (await service.getAgentState()).permissions.some(
      (permission) => permission.kind === "project.delete",
    ),
    false,
  );
});

test("Ollama streams reasoning, answer progress, and native tool calls", async (t) => {
  const statuses = [];
  const { base, service } = await fixture({
    status: (value) => statuses.push(value),
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const chunks = [
    JSON.stringify({
      message: { thinking: "Inspect the project. " },
      eval_count: 4,
      done: false,
    }),
    JSON.stringify({
      message: {
        content: "I found the next step.",
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "read_file",
              arguments: { path: "src/index.ts" },
            },
          },
        ],
      },
      eval_count: 9,
      done: true,
    }),
  ];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.stream, true);
    assert.equal(request.think, true);
    assert.equal(request.options.num_predict, 1024);
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks)
            controller.enqueue(encoder.encode(`${chunk}\n`));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/x-ndjson" } },
    );
  };
  const reply = await service.remoteReply(
    {
      chatId: "chat",
      engine: "ollama",
      model: "qwen3:latest",
      executable: "",
      messages: [],
      editMode: "auto",
      contextLimit: 8192,
      hardware: "auto",
      contextSummary: "",
      fileAccess: true,
      webAccess: false,
      browserAccess: false,
      computerAccess: false,
      resumePermission: false,
      goal: "",
    },
    [{ role: "user", content: "Inspect src/index.ts" }],
    service.tools("auto", true, false, false, false),
  );
  assert.equal(reply.thinking, "Inspect the project.");
  assert.equal(reply.content, "I found the next step.");
  assert.deepEqual(reply.toolCalls, [
    {
      id: "call-1",
      name: "read_file",
      arguments: { path: "src/index.ts" },
    },
  ]);
  assert.ok(
    statuses.some((value) => /Reasoning locally.*4 output tokens/.test(value)),
  );
  assert.ok(statuses.some((value) => /Answering/.test(value)));
});

test("permissions and autonomous execution are identical across local engines", async (t) => {
  for (const engine of ["llamacpp", "mlx", "pytorch", "ollama"]) {
    const { root, base, service, chat } = await fixture();
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    await service.grantPermission(
      "terminal.run",
      "conversation",
      chat.id,
      "verify generated file",
    );
    let turn = 0;
    service.remoteReply = async () => {
      turn += 1;
      if (turn === 1)
        return {
          content: "I need permission to write project files.",
          toolCalls: [],
        };
      if (turn === 2)
        return {
          content: "I should create and test the requested file now.",
          toolCalls: [],
        };
      if (turn === 3)
        return {
          content: `<tool_call>{"name":"write_file","arguments":{"path":"src/${engine}.ts","content":"export const engine = '${engine}';\\n"}}</tool_call>`,
          toolCalls: [],
        };
      if (turn === 4)
        return {
          content: "",
          toolCalls: [
            {
              id: `verify-${engine}`,
              name: "run_command",
              arguments: {
                command: "node",
                args: [
                  "-e",
                  `require('node:fs').readFileSync('src/${engine}.ts','utf8')`,
                ],
                purpose: "Verify the generated file is readable",
              },
            },
          ],
        };
      return { content: `Completed with ${engine}.`, toolCalls: [] };
    };
    const result = await service.chat({
      chatId: chat.id,
      engine,
      model: engine === "llamacpp" ? "fixture.gguf" : `fixture-${engine}`,
      executable: "",
      editMode: "auto",
      terminalMode: "auto",
      contextLimit: 8192,
      hardware: "auto",
      contextSummary: "",
      goal: "",
      fileAccess: true,
      webAccess: false,
      browserAccess: false,
      computerAccess: false,
      messages: [
        {
          role: "user",
          content: `Create and verify a project file demonstrating the ${engine} engine integration`,
        },
      ],
    });
    assert.equal(
      turn,
      5,
      `${engine} should correct prose, write, verify, and then finish`,
    );
    assert.deepEqual(result.changedFiles, [`src/${engine}.ts`]);
    assert.ok(result.actions.some((action) => action.tool === "set_goal"));
    assert.ok(result.actions.some((action) => action.tool === "list_files"));
    assert.ok(result.actions.some((action) => action.tool === "write_file"));
    assert.ok(result.actions.some((action) => action.tool === "run_command"));
    assert.match(
      await fs.readFile(path.join(root, "src", `${engine}.ts`), "utf8"),
      new RegExp(engine),
    );
  }
});

test("AI tools stay in the project and can edit when enabled", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  const listed = JSON.parse(
    await service.runTool(
      { name: "list_files", arguments: {} },
      true,
      changed,
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.deepEqual(listed, ["src/index.ts"]);
  assert.match(
    await service.runTool(
      { name: "read_file", arguments: { path: "src/index.ts" } },
      true,
      changed,
      [],
      true,
      false,
      chat.id,
    ),
    /value = 1/,
  );
  await service.runTool(
    {
      name: "write_file",
      arguments: { path: "src/index.ts", content: "export const value = 2;\n" },
    },
    true,
    changed,
    [],
    true,
    false,
    chat.id,
  );
  await service.runTool(
    {
      name: "write_file",
      arguments: {
        path: "src/generated/result.ts",
        content: "export const generated = true;\n",
      },
    },
    true,
    changed,
    [],
    true,
    false,
    chat.id,
  );
  assert.deepEqual([...changed], ["src/index.ts", "src/generated/result.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 2/,
  );
  assert.match(
    await fs.readFile(path.join(root, "src", "generated", "result.ts"), "utf8"),
    /generated = true/,
  );
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "../outside.txt" } },
      true,
      changed,
      [],
      true,
      false,
      chat.id,
    ),
    /inside the open project|outside the project/,
  );
});

test("JSON project files accept structured content from local model tool calls", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  const content = {
    private: true,
    scripts: { build: "vite build" },
  };
  const result = await service.runTool(
    {
      name: "write_file",
      arguments: { path: "package.json", content },
    },
    true,
    changed,
    [],
    true,
    false,
    chat.id,
    false,
    false,
  );
  assert.equal(result, "Saved package.json");
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")),
    content,
  );
});

test("agent action history survives chat persistence", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const createdAt = new Date().toISOString();
  await service.saveChat(
    chat.id,
    [
      { role: "user", content: "Check the docs" },
      {
        role: "assistant",
        content: "Checked.",
        actions: [
          {
            id: "web-1",
            chatId: chat.id,
            kind: "web",
            status: "completed",
            title: "Searched the public web",
            query: "public documentation",
            websites: ["https://example.com/docs"],
            createdAt,
            completedAt: createdAt,
          },
        ],
      },
    ],
    "",
  );
  const state = await service.getAgentState();
  assert.equal(
    state.chats[0].messages[1].actions[0].query,
    "public documentation",
  );
  assert.deepEqual(state.chats[0].messages[1].actions[0].websites, [
    "https://example.com/docs",
  ]);
});

test("successful tool results tell small models to stop repeating actions", () => {
  const saved = toolResultForModel("write_file", "Saved src/index.ts");
  assert.match(saved, /Do not rewrite it again/);
  assert.match(saved, /verification next/);

  const browser = toolResultForModel(
    "browser_open",
    "Opened file:///project/index.html in the dedicated agent browser",
  );
  assert.match(browser, /already open in the Agent Browser/);
  assert.match(browser, /Do not call browser_open again/);
  assert.match(browser, /browser_inspect/);

  const emptyBrowser = toolResultForModel(
    "browser_inspect",
    JSON.stringify({ title: "Preview", text: "", controls: [] }),
  );
  assert.match(emptyBrowser, /rendered no visible content/);
  assert.match(emptyBrowser, /background=true/);

  const success = toolResultForModel(
    "run_command",
    JSON.stringify({ exitCode: 0, stdout: "10\n", stderr: "" }),
  );
  assert.match(success, /VERIFIED/);
  assert.match(success, /Do not run the same command again/);
  assert.match(success, /complete_goal/);

  const platformioMissing = toolResultForModel(
    "platformio_status",
    JSON.stringify({ installed: false, project: false }),
  );
  assert.match(platformioMissing, /platformio_install exactly once/);
  assert.match(platformioMissing, /Do not use run_command/);

  const failure = toolResultForModel(
    "run_command",
    JSON.stringify({ exitCode: 1, stdout: "", stderr: "failed" }),
  );
  assert.match(failure, /change the code or command/);
  assert.match(failure, /do not repeat the same failing call unchanged/);

  const platformioFailure = toolResultForModel(
    "platformio_run",
    [
      "Tool error: PlatformIO exited with code 1.",
      "Compiling .pio/build/doit-esp32/src/main.cpp.o",
      "src/main.cpp:42: note: argument 1 is declared here",
      "src/main.cpp:42: error: invalid conversion from 'int' to 'const uint8_t*'",
      "src/main.cpp:51: error: cannot convert 'uint8_t (*)[80]' to 'uint8_t*'",
      "*** [.pio/build/doit-esp32/src/main.cpp.o] Error 1",
    ].join("\n"),
  );
  assert.match(platformioFailure, /COMPILER RECOVERY/);
  assert.match(platformioFailure, /oscode_compiler_diagnostics/);
  assert.match(
    platformioFailure,
    /src\/main\.cpp:42: error: invalid conversion/,
  );
  assert.match(platformioFailure, /src\/main\.cpp:51: error: cannot convert/);
  assert.match(platformioFailure, /every listed compiler error/);
  assert.match(platformioFailure, /next write must differ/);
  assert.match(platformioFailure, /multidimensional array lost its rank/);

  const platformioSuccess = toolResultForModel(
    "platformio_run",
    JSON.stringify({ action: "build", output: "[SUCCESS]" }),
  );
  assert.match(platformioSuccess, /VERIFIED: PlatformIO build/);
  assert.match(platformioSuccess, /do not repeat this successful call/);
});

test("PlatformIO installation uses a dedicated approval and private installer", async (t) => {
  let installed = false;
  let installs = 0;
  const { base, service, chat } = await fixture({
    serviceOptions: {
      platformioState: async () => ({ installed, project: false }),
      platformioInstall: async () => {
        installs += 1;
        installed = true;
        return { installed, project: false };
      },
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const args = ["auto", new Set(), [], true, false, chat.id, false, false];

  await assert.rejects(
    service.runTool(
      { name: "platformio_install", arguments: {} },
      ...args,
      "auto",
      false,
    ),
    (error) => {
      assert.equal(error.kind, "platformio.install");
      return true;
    },
  );
  assert.equal(installs, 0);
  await service.grantPermission(
    "platformio.install",
    "conversation",
    chat.id,
    "tests",
  );
  const result = await service.runTool(
    { name: "platformio_install", arguments: {} },
    ...args,
    "auto",
    true,
  );
  assert.equal(installs, 1);
  assert.equal(JSON.parse(result).installed, true);
});

test("PlatformIO initialization uses the validated board tool and records starter files", async (t) => {
  const initializations = [];
  const { base, service, chat } = await fixture({
    serviceOptions: {
      platformioState: async () => ({ installed: true, project: false }),
      platformioBoards: async () => [
        {
          id: "esp32doit-devkit-v1",
          name: "DOIT ESP32 DEVKIT V1",
          platform: "espressif32",
          frameworks: ["arduino"],
        },
      ],
      platformioInitialize: async (board, framework) => {
        initializations.push({ board, framework });
        return { installed: true, project: true };
      },
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await service.grantPermission(
    "project.write",
    "conversation",
    chat.id,
    "tests",
  );
  const changed = new Set();
  const result = await service.runTool(
    {
      name: "platformio_initialize",
      arguments: { board: "esp32doit-devkit-v1", framework: "arduino" },
    },
    "auto",
    changed,
    [],
    true,
    false,
    chat.id,
  );
  assert.deepEqual(initializations, [
    { board: "esp32doit-devkit-v1", framework: "arduino" },
  ]);
  assert.equal(JSON.parse(result).project, true);
  assert.deepEqual([...changed].sort(), ["platformio.ini", "src/main.cpp"]);
  assert.match(
    toolResultForModel("platformio_initialize", result),
    /starter source now exist/i,
  );
});

test("identical successful file calls are reused without duplicate work-log cards", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "tests",
  );
  let turn = 0;
  const repeatedWrite = {
    name: "write_file",
    arguments: {
      path: "platformio",
      content: "[env:native]\nplatform = native\n",
    },
  };
  service.remoteReply = async () => {
    turn += 1;
    if (turn <= 2)
      return {
        content: "",
        toolCalls: [{ id: `write-${turn}`, ...repeatedWrite }],
      };
    if (turn === 3)
      return {
        content: "",
        toolCalls: [
          {
            id: "verify",
            name: "run_command",
            arguments: { command: "node", args: ["--version"] },
          },
        ],
      };
    return { content: "Configured and verified PlatformIO.", toolCalls: [] };
  };
  const response = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "user", content: "Create and verify a PlatformIO project." },
    ],
  });
  assert.match(response.content, /Configured and verified/);
  assert.equal(
    response.actions.filter((action) => action.tool === "write_file").length,
    1,
  );
  assert.match(
    await fs.readFile(path.join(root, "platformio.ini"), "utf8"),
    /platform = native/,
  );
  await assert.rejects(fs.stat(path.join(root, "platformio")));
});

test("repeated missing-path command failures expose current project paths and force recovery", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, "test_images"), { recursive: true });
  await fs.writeFile(path.join(root, "test_images", "city.jpg"), "fixture");
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "tests",
  );
  const originalRunTool = service.runTool.bind(service);
  let commandRuns = 0;
  service.runTool = async (call, ...args) => {
    if (call.name !== "run_command") return originalRunTool(call, ...args);
    commandRuns += 1;
    if (call.arguments.args?.includes("missing.jpg"))
      return JSON.stringify({
        exitCode: 1,
        stdout: "",
        stderr: "FileNotFoundError: no such file or directory: missing.jpg",
      });
    return JSON.stringify({ exitCode: 0, stdout: "recovered\n", stderr: "" });
  };
  let turn = 0;
  const failedCall = {
    name: "run_command",
    arguments: { command: "node", args: ["missing.jpg"] },
  };
  service.remoteReply = async (_request, messages) => {
    turn += 1;
    if (turn === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "write-recovery",
            name: "write_file",
            arguments: {
              path: "recover.mjs",
              content: 'console.log("recovered")\n',
            },
          },
        ],
      };
    if (turn === 2 || turn === 3)
      return {
        content: "",
        toolCalls: [{ id: `missing-${turn}`, ...failedCall }],
      };
    if (turn === 4) {
      assert.ok(
        messages.some(
          (message) =>
            message.role === "tool" &&
            /Current project paths:[\s\S]*test_images\\?\/city\.jpg/.test(
              String(message.content || ""),
            ),
        ),
      );
      assert.match(
        String(messages.at(-1)?.content || ""),
        /Failure-recovery correction:[\s\S]*Do not repeat that call again/,
      );
      return {
        content: "",
        toolCalls: [
          {
            id: "verify-recovery",
            name: "run_command",
            arguments: { command: "node", args: ["recover.mjs"] },
          },
        ],
      };
    }
    return { content: "Recovered with the exact project path.", toolCalls: [] };
  };
  const response = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content:
          "Create a script that processes the existing project image and verify it.",
      },
    ],
  });
  assert.equal(commandRuns, 2);
  assert.match(response.content, /Recovered with the exact project path/);
});

test("identical write content is not counted as progress and prompts a real repair", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  const original = 'console.log("broken")\n';
  await fs.writeFile(path.join(root, "app.mjs"), original);
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "tests",
  );
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    turn += 1;
    if (turn === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "unchanged-write",
            name: "write_file",
            arguments: { path: "app.mjs", content: original },
          },
        ],
      };
    if (turn === 2) {
      assert.ok(
        messages.some(
          (message) =>
            message.role === "tool" &&
            /No change:[\s\S]*not implementation progress/.test(
              String(message.content || ""),
            ),
        ),
      );
      return {
        content: "",
        toolCalls: [
          {
            id: "corrected-write",
            name: "write_file",
            arguments: {
              path: "app.mjs",
              content: 'console.log("fixed")\n',
            },
          },
        ],
      };
    }
    if (turn === 3)
      return {
        content: "",
        toolCalls: [
          {
            id: "verify-fixed-write",
            name: "run_command",
            arguments: { command: "node", args: ["app.mjs"] },
          },
        ],
      };
    return {
      content: "Repaired and verified the existing file.",
      toolCalls: [],
    };
  };
  const response = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content: "Repair the existing app.mjs file and verify it.",
      },
    ],
  });
  assert.match(response.content, /Repaired and verified/);
  assert.equal(
    await fs.readFile(path.join(root, "app.mjs"), "utf8"),
    'console.log("fixed")\n',
  );
  assert.equal(
    response.actions.filter(
      (action) => action.tool === "write_file" && action.status === "completed",
    ).length,
    1,
  );
});

test("an unchanged firmware write is forced into compiler-guided PlatformIO recovery", async (t) => {
  let builds = 0;
  const { root, base, service, chat } = await fixture({
    serviceOptions: {
      platformioState: async () => ({
        installed: true,
        project: true,
        environments: ["doit-esp32"],
      }),
      platformioRun: async (action, environment) => {
        builds += 1;
        assert.equal(action, "build");
        assert.equal(environment, "doit-esp32");
        if (builds === 1)
          throw new Error(
            "PlatformIO exited with code 1.\nsrc/main.cpp:8: error: invalid conversion",
          );
        return {
          installed: true,
          project: true,
          action,
          output: "[SUCCESS] firmware.bin",
        };
      },
    },
  });
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  const original = "void loop() { broken(); }\n";
  await fs.writeFile(path.join(root, "src", "main.cpp"), original);
  await fs.writeFile(
    path.join(root, "platformio.ini"),
    "[env:doit-esp32]\nplatform = espressif32\nboard = esp32doit-devkit-v1\nframework = arduino\n",
  );
  await service.grantPermission(
    "platformio.run",
    "conversation",
    chat.id,
    "tests",
  );
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    turn += 1;
    if (turn === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "unchanged-firmware",
            name: "write_file",
            arguments: { path: "src/main.cpp", content: original },
          },
        ],
      };
    if (turn === 2) {
      assert.ok(
        messages.some((message) => {
          const content = String(message.content || "");
          return (
            message.role === "tool" &&
            /src\/main\.cpp:8: error/.test(content) &&
            /COMPILER RECOVERY:/.test(content)
          );
        }),
      );
      return {
        content: "",
        toolCalls: [
          {
            id: "corrected-firmware",
            name: "write_file",
            arguments: {
              path: "src/main.cpp",
              content: "void loop() { /* fixed */ }\n",
            },
          },
        ],
      };
    }
    if (turn === 3)
      return {
        content: "",
        toolCalls: [
          {
            id: "verified-firmware",
            name: "platformio_run",
            arguments: { action: "build", environment: "doit-esp32" },
          },
        ],
      };
    return { content: "Firmware repaired and verified.", toolCalls: [] };
  };
  const response = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content: "Repair this PlatformIO ESP32 firmware and build it.",
      },
    ],
  });
  assert.equal(builds, 2);
  assert.match(response.content, /repaired and verified/i);
  assert.equal(
    await fs.readFile(path.join(root, "src", "main.cpp"), "utf8"),
    "void loop() { /* fixed */ }\n",
  );
});

test("a failed verification command can run again after the project is repaired", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "tests",
  );
  const originalRunTool = service.runTool.bind(service);
  let commandRuns = 0;
  service.runTool = async (call, ...args) => {
    if (call.name !== "run_command") return originalRunTool(call, ...args);
    commandRuns += 1;
    const source = await fs.readFile(path.join(root, "repair.mjs"), "utf8");
    return JSON.stringify({
      command: "node repair.mjs",
      exitCode: source.includes("fixed") ? 0 : 1,
      stdout: source.includes("fixed") ? "fixed\n" : "",
      stderr: source.includes("fixed") ? "" : "broken\n",
    });
  };
  let turn = 0;
  service.remoteReply = async () => {
    turn += 1;
    if (turn === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "write-broken",
            name: "write_file",
            arguments: {
              path: "repair.mjs",
              content: 'console.log("broken")\n',
            },
          },
        ],
      };
    if (turn === 2 || turn === 4)
      return {
        content: "",
        toolCalls: [
          {
            id: `verify-${turn}`,
            name: "run_command",
            arguments: { command: "node", args: ["repair.mjs"] },
          },
        ],
      };
    if (turn === 3)
      return {
        content: "",
        toolCalls: [
          {
            id: "write-fixed",
            name: "write_file",
            arguments: {
              path: "repair.mjs",
              content: 'console.log("fixed")\n',
            },
          },
        ],
      };
    return { content: "Repaired and verified the script.", toolCalls: [] };
  };
  const response = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [{ role: "user", content: "Create and repair repair.mjs." }],
  });
  assert.equal(commandRuns, 2);
  assert.match(response.content, /Repaired and verified/);
  assert.match(
    await fs.readFile(path.join(root, "repair.mjs"), "utf8"),
    /fixed/,
  );
});

test("AI write tool obeys the edit permission", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(
    service.runTool(
      {
        name: "write_file",
        arguments: { path: "src/index.ts", content: "changed" },
      },
      false,
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    /disabled/,
  );
});

test("the agent asks before running global development commands", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(
    service.runTool(
      {
        name: "run_command",
        arguments: { command: "node", args: ["--version"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    (error) => {
      assert.equal(error.message, "Permission required");
      assert.equal(error.kind, "terminal.run");
      assert.equal(error.detail, "node --version");
      return true;
    },
  );
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "node --version",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: "node",
          args: ["--version"],
          purpose: "Check the global Node installation",
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+/);
  const locator = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: process.platform === "win32" ? "where" : "which",
          args: ["node"],
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.equal(locator.exitCode, 0);
  assert.match(locator.stdout.toLowerCase(), /node/);
  const reused = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: { command: "node", args: ["--help"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "ask",
    ),
  );
  assert.equal(reused.exitCode, 0);
});

test("chat terminal grants persist and Python commands use the selected project environment", async (t) => {
  const { root, base, service, chat } = await fixture({
    serviceOptions: {
      getProjectPython: async () => process.execPath,
    },
  });
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "Project commands in this chat",
  );
  const mkdirResult = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: { command: "mkdir", args: ["-p", "images", "outputs"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "ask",
    ),
  );
  assert.equal(mkdirResult.exitCode, 0);
  assert.equal((await fs.stat(path.join(root, "images"))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(root, "outputs"))).isDirectory(), true);

  const pythonResult = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: "python3.12",
          args: ["-e", 'console.log("PROJECT_ENV_OK")'],
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "ask",
    ),
  );
  assert.equal(pythonResult.exitCode, 0);
  assert.match(pythonResult.stdout, /PROJECT_ENV_OK/);
});

test("public image downloads request one scoped Web permission", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await assert.rejects(
    service.runTool(
      {
        name: "web_download_image",
        arguments: {
          url: "https://ultralytics.com/images/bus.jpg",
          path: "images/bus.jpg",
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "ask",
    ),
    (error) => {
      assert.equal(error.kind, "web.search");
      return true;
    },
  );
});

test("agent web discovery is bounded and steers repeated searches into action", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await service.grantPermission("web.search", "conversation", chat.id, "tests");
  await service.grantPermission("terminal.run", "always", chat.id, "tests");
  const originalRunTool = service.runTool.bind(service);
  const searches = [];
  service.runTool = async (call, ...args) => {
    if (call.name === "web_search") {
      searches.push(call.arguments.query);
      return JSON.stringify([
        {
          title: "Public sample gallery",
          url: "https://example.com/public-gallery",
        },
      ]);
    }
    return originalRunTool(call, ...args);
  };
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    turn += 1;
    if (turn <= 3)
      return {
        content: "",
        toolCalls: [
          {
            id: `search-${turn}`,
            name: "web_search",
            arguments: { query: `generic public sample ${turn}` },
          },
        ],
      };
    if (turn === 4) {
      assert.match(
        String(messages.at(-1)?.content || ""),
        /Web progression correction:[\s\S]*Do not call web_search again/,
      );
      return {
        content: "",
        toolCalls: [
          {
            id: "write-catalog",
            name: "write_file",
            arguments: {
              path: "catalog.mjs",
              content: 'console.log("catalog ready")\n',
            },
          },
        ],
      };
    }
    if (turn === 5)
      return {
        content: "",
        toolCalls: [
          {
            id: "verify-catalog",
            name: "run_command",
            arguments: { command: "node", args: ["catalog.mjs"] },
          },
        ],
      };
    return { content: "Created and verified the catalog.", toolCalls: [] };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: true,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content:
          "Research a public sample image, create catalog.mjs using the result, and verify it.",
      },
    ],
  });
  assert.deepEqual(searches, [
    "generic public sample 1",
    "generic public sample 2",
  ]);
  assert.match(result.content, /Created and verified/);
  assert.match(
    await fs.readFile(path.join(root, "catalog.mjs"), "utf8"),
    /catalog ready/,
  );
});

test("requested project images must use guarded downloads before commands run", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await service.grantPermission("web.search", "conversation", chat.id, "tests");
  await service.grantPermission("terminal.run", "always", chat.id, "tests");
  const originalRunTool = service.runTool.bind(service);
  const downloaded = [];
  let executedCommands = 0;
  service.runTool = async (call, ...args) => {
    if (call.name === "web_download_image") {
      downloaded.push(call.arguments.path);
      return `Saved downloaded image to ${call.arguments.path} (100 bytes) from ${call.arguments.url}`;
    }
    if (call.name === "run_command") executedCommands += 1;
    return originalRunTool(call, ...args);
  };
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    turn += 1;
    if (turn === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "write-image-script",
            name: "write_file",
            arguments: {
              path: "image_demo.mjs",
              content: 'console.log("images ready")\n',
            },
          },
        ],
      };
    if (turn === 2 || turn === 4)
      return {
        content: "",
        toolCalls: [
          {
            id: `premature-run-${turn}`,
            name: "run_command",
            arguments: { command: "node", args: ["image_demo.mjs"] },
          },
        ],
      };
    if (turn === 3 || turn === 5) {
      if (turn === 3)
        assert.match(
          String(messages.at(-1)?.content || ""),
          /Asset-delivery correction:[\s\S]*0 of 2/,
        );
      return {
        content: "",
        toolCalls: [
          {
            id: `download-${turn}`,
            name: "web_download_image",
            arguments: {
              url: `https://example.com/sample-${turn}.jpg`,
              path: `images/sample-${turn}.jpg`,
            },
          },
        ],
      };
    }
    if (turn === 6)
      return {
        content: "",
        toolCalls: [
          {
            id: "verified-run",
            name: "run_command",
            arguments: { command: "node", args: ["image_demo.mjs"] },
          },
        ],
      };
    return {
      content: "Created the script, downloaded two images, and verified it.",
      toolCalls: [],
    };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: true,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content:
          "Create image_demo.mjs, download two public images into an images folder inside this project, and run the script.",
      },
    ],
  });
  assert.deepEqual(downloaded, ["images/sample-3.jpg", "images/sample-5.jpg"]);
  assert.equal(executedCommands, 1);
  assert.match(result.content, /downloaded two images/);
  assert.match(
    await fs.readFile(path.join(root, "image_demo.mjs"), "utf8"),
    /images ready/,
  );
});

test("package installers always use their separate exact permission unless Always was granted", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  assert.equal(isPackageInstallCommand("npm", ["install", "react"]), true);
  assert.equal(
    isPackageInstallCommand("python", ["-m", "pip", "install", "ruff"]),
    true,
  );
  assert.equal(isPackageInstallCommand("brew", ["install", "node"]), true);
  assert.equal(isPackageInstallCommand("npm", ["run", "build"]), false);

  const npmLocator = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    ["npm"],
    { stdio: "ignore" },
  );
  if (npmLocator.status !== 0) {
    t.skip("npm is not installed on this build host");
    return;
  }

  await service.grantPermission(
    "packages.install",
    "conversation",
    chat.id,
    "npm install --help",
  );
  await assert.rejects(
    service.runTool(
      {
        name: "run_command",
        arguments: { command: "npm", args: ["install", "--help"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
    (error) => {
      assert.equal(error.kind, "packages.install");
      assert.equal(error.detail, "npm install --help");
      return true;
    },
  );

  await service.grantPermission(
    "packages.install",
    "always",
    chat.id,
    "npm install --help",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: { command: "npm", args: ["install", "--help"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
  );
  assert.equal(result.exitCode, 0);
});

test("dedicated Python package tool uses the app-managed environment installer", async (t) => {
  const requested = [];
  const { base, service, chat } = await fixture({
    installPythonPackages: async (packages) => {
      requested.push(packages);
      return {
        packages,
        output: "installed",
        interpreter: "/app-data/project-environment/bin/python",
        createdEnvironment: true,
      };
    },
  });
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  assert.ok(
    service
      .tools("auto", true, false, false, false)
      .some((item) => item.function.name === "python_install_packages"),
  );
  await service.grantPermission(
    "packages.install",
    "always",
    chat.id,
    "Python packages",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "python_install_packages",
        arguments: {
          packages: ["ultralytics", "opencv-python", "numpy"],
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
  );
  assert.deepEqual(requested, [["ultralytics", "opencv-python", "numpy"]]);
  assert.equal(result.createdEnvironment, true);
  assert.match(result.interpreter, /app-data\/project-environment/);
});

test("already-installed Python packages do not request installation approval", async (t) => {
  let installs = 0;
  const { base, service, chat } = await fixture({
    installPythonPackages: async () => {
      installs += 1;
      throw new Error("installer should not run");
    },
    serviceOptions: {
      getProjectPython: async () => "/app-data/env/bin/python",
    },
  });
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  service.missingPythonPackages = async () => [];
  const result = JSON.parse(
    await service.runTool(
      {
        name: "python_install_packages",
        arguments: { packages: ["ultralytics"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "ask",
    ),
  );
  assert.equal(result.alreadyInstalled, true);
  assert.equal(result.interpreter, "/app-data/env/bin/python");
  assert.equal(installs, 0);
});

test("Python shell install attempts are routed through the selected project environment", async (t) => {
  const requested = [];
  const { base, service, chat } = await fixture({
    installPythonPackages: async (packages) => {
      requested.push(packages);
      return {
        packages,
        output: "installed with bundled uv",
        interpreter: "/app-data/project-environment/bin/python",
        createdEnvironment: false,
      };
    },
  });
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  assert.deepEqual(
    pythonPackageInstallSpecs("uv", [
      "pip",
      "install",
      "ultralytics",
      "opencv-python",
      "numpy",
    ]),
    ["ultralytics", "opencv-python", "numpy"],
  );
  assert.deepEqual(
    pythonPackageInstallSpecs("python3.12", [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "ruff",
    ]),
    ["ruff"],
  );
  await service.grantPermission(
    "packages.install",
    "always",
    chat.id,
    "Python packages",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: "uv",
          args: ["pip", "install", "ultralytics", "opencv-python", "numpy"],
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
  );
  assert.deepEqual(requested, [["ultralytics", "opencv-python", "numpy"]]);
  assert.equal(result.routedThrough, "project-python-environment");
  assert.match(result.interpreter, /app-data\/project-environment/);
});

test("background project commands wait for localhost before browser testing", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 200,
    });
  });
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => reservation.close(resolve));
  const url = `http://127.0.0.1:${port}/`;
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "start preview",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: "node",
          args: [
            "-e",
            `require('node:http').createServer((_q,r)=>r.end('ready')).listen(${port},'127.0.0.1')`,
          ],
          background: true,
          ready_url: url,
          purpose: "Start the test preview",
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.equal(result.background, true);
  assert.equal(result.url, url);
  assert.equal(await fetch(url).then((response) => response.text()), "ready");
});

test("missing project files return exact nearby paths", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "src", "App.jsx"), "export default 1;\n");
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "src/App.js" } },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    /src\/App\.jsx/,
  );
});

test("empty projects direct the model to create a file instead of relisting", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.rm(path.join(root, "src", "index.ts"));
  const listing = await service.runTool(
    { name: "list_files", arguments: {} },
    "auto",
    new Set(),
    [],
    true,
    false,
    chat.id,
  );
  assert.match(listing, /project is empty/i);
  assert.match(listing, /call write_file now/i);
  assert.match(listing, /do not call list_files/i);
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "platformio.ini" } },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    /call write_file now/i,
  );
});

test("AI file permission removes project access and checkpoints never touch Git", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "src/index.ts" } },
      "ask",
      new Set(),
      [],
      false,
      false,
    ),
    /Permission required/,
  );
  await service.runTool(
    {
      name: "write_file",
      arguments: { path: "src/index.ts", content: "export const value = 9;\n" },
    },
    "auto",
    new Set(),
    [],
    true,
    false,
    chat.id,
  );
  const history = await service.listHistory();
  assert.equal(history.length, 1);
  assert.equal(
    await fs
      .stat(path.join(root, ".git"))
      .then(() => true)
      .catch(() => false),
    false,
  );
  assert.deepEqual(await service.revertHistory(history[0].id), [
    "src/index.ts",
  ]);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 1/,
  );
});

test("disabled capabilities remain requestable and project questions ask before model inference", async (t) => {
  const { base, service, chat } = await fixture({ grants: false });
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const names = service
    .tools("ask", false, false, false, false)
    .map((item) => item.function.name);
  for (const name of [
    "list_files",
    "read_file",
    "write_file",
    "web_search",
    "web_fetch",
    "run_command",
  ])
    assert.ok(names.includes(name), `${name} should remain requestable`);

  let modelTurns = 0;
  let resumedMessages = [];
  service.remoteReply = async (_request, messages) => {
    modelTurns += 1;
    resumedMessages = messages;
    return {
      content: "This project exports a value from src/index.ts.",
      toolCalls: [],
    };
  };
  const request = {
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: false,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "user", content: "Can you tell me how this code works?" },
    ],
  };
  const waiting = await service.chat({ ...request, resumePermission: false });
  assert.equal(modelTurns, 0);
  assert.equal(waiting.permissionRequest.kind, "project.read");
  assert.match(waiting.content, /permission to read the project/i);

  await service.grantPermission(
    "project.read",
    "conversation",
    chat.id,
    "Inspect the open project",
  );
  const resumed = await service.chat({
    ...request,
    fileAccess: true,
    resumePermission: true,
  });
  assert.equal(modelTurns, 1);
  assert.match(resumed.content, /exports a value/);
  assert.ok(
    resumedMessages.some(
      (message) =>
        message.role === "tool" && /src\/index\.ts/.test(message.content),
    ),
  );
});

test("permission approval resumes the pending tool without asking the model again", async (t) => {
  const { base, service, chat } = await fixture({ grants: false });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turns = 0;
  let resumedMessages = [];
  service.remoteReply = async (_request, messages) => {
    turns += 1;
    if (turns === 1)
      return {
        content:
          '<oscode_tool>{"name":"read_file","arguments":{"path":"src/index.ts"}}</oscode_tool>',
        toolCalls: [],
      };
    resumedMessages = messages;
    return { content: "The project value is 1.", toolCalls: [] };
  };
  const request = {
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [{ role: "user", content: "Read the project value" }],
  };
  const waiting = await service.chat({ ...request, resumePermission: false });
  assert.equal(waiting.permissionRequest.kind, "project.read");
  await service.grantPermission(
    "project.read",
    "conversation",
    chat.id,
    "src/index.ts",
  );
  const resumed = await service.chat({ ...request, resumePermission: true });
  assert.equal(turns, 2);
  assert.match(resumed.content, /value is 1/);
  assert.ok(
    resumedMessages.some(
      (message) =>
        message.role === "tool" &&
        /export const value = 1/.test(message.content),
    ),
  );
  assert.ok(
    resumedMessages.some(
      (message) =>
        message.role === "assistant" &&
        /<function=read_file>/.test(String(message.content || "")) &&
        /<parameter=path>\nsrc\/index\.ts\n<\/parameter>/.test(
          String(message.content || ""),
        ),
    ),
    "permission continuation must preserve a Qwen-native tool call in history",
  );
});

test("operating-system permission completion retries the exact pending Computer Control call", async (t) => {
  let permissionReady = false;
  let turns = 0;
  const { base, service, chat } = await fixture({
    serviceOptions: {
      computerInspect: async (target) => {
        if (!permissionReady)
          throw new ComputerSystemPermissionError(
            "accessibility",
            "Enable Accessibility in system settings, then return to osCode",
          );
        return `inspected ${target}`;
      },
    },
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await service.grantPermission(
    "computer.external",
    "conversation",
    chat.id,
    "Dictionary",
  );
  await service.grantPermission(
    "computer.control",
    "conversation",
    chat.id,
    "Dictionary",
  );
  service.remoteReply = async () => {
    turns += 1;
    if (turns === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "inspect-dictionary",
            name: "computer_inspect",
            arguments: { target: "Dictionary" },
          },
        ],
      };
    return { content: "Dictionary is visible.", toolCalls: [] };
  };
  const request = {
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "auto",
    terminalMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: true,
    messages: [
      { role: "user", content: "Inspect Dictionary using Computer Control" },
    ],
  };
  const waiting = await service.chat({ ...request, resumePermission: false });
  assert.equal(waiting.permissionRequest.kind, "computer.system");
  assert.match(waiting.permissionRequest.detail, /Accessibility/);
  permissionReady = true;
  const resumed = await service.chat({ ...request, resumePermission: true });
  assert.equal(turns, 2);
  assert.match(resumed.content, /Dictionary is visible/);
  assert.ok(
    resumed.actions.some(
      (action) =>
        action.tool === "computer_inspect" && action.status === "completed",
    ),
  );
});

test("terminal approval preserves file-write evidence across the resumed model turn", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turns = 0;
  service.remoteReply = async () => {
    turns += 1;
    if (turns === 1)
      return {
        content: "",
        toolCalls: [
          {
            id: "write-smoke",
            name: "write_file",
            arguments: {
              path: "agent-smoke.mjs",
              content: 'console.log("verified")\n',
            },
          },
        ],
      };
    if (turns === 2)
      return {
        content: "",
        toolCalls: [
          {
            id: "run-smoke",
            name: "run_command",
            arguments: { command: "node", args: ["agent-smoke.mjs"] },
          },
        ],
      };
    return { content: "Created and verified the smoke file.", toolCalls: [] };
  };
  const request = {
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content: "Create agent-smoke.mjs and verify it with Node.",
      },
    ],
  };
  const waiting = await service.chat(request);
  assert.equal(waiting.permissionRequest.kind, "terminal.run");
  assert.deepEqual(waiting.changedFiles, ["agent-smoke.mjs"]);
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "node agent-smoke.mjs",
  );
  const resumed = await service.chat({ ...request, resumePermission: true });
  assert.equal(turns, 3);
  assert.match(resumed.content, /Created and verified/);
  assert.deepEqual(resumed.changedFiles, ["agent-smoke.mjs"]);
  assert.match(
    await fs.readFile(path.join(root, "agent-smoke.mjs"), "utf8"),
    /verified/,
  );
});

test("fallback agent protocol edits for models without native tools", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  service.remoteReply = async () =>
    turn++ === 0
      ? {
          content:
            '<oscode_tool>{"name":"write_file","arguments":{"path":"src/index.ts","content":"export const value = 3;\\n"}}</oscode_tool>',
          toolCalls: [],
        }
      : { content: "Updated src/index.ts.", toolCalls: [] };
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [{ role: "user", content: "Set value to 3" }],
  });
  assert.deepEqual(result.changedFiles, ["src/index.ts"]);
  assert.deepEqual(result.toolSteps, ["Edited src/index.ts"]);
  assert.match(result.content, /Tool-verified files changed/);
  assert.match(result.content, /`src\/index\.ts`/);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 3/,
  );
});

test("confirmed build requests start a goal, inspect the project, and correct plan-only replies", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    assert.deepEqual(
      messages.flatMap((message, index) =>
        message.role === "system" ? [index] : [],
      ),
      [0],
      "MLX/Qwen requires the single system message to remain first after correction turns",
    );
    if (turn++ === 0) {
      assert.ok(
        messages.some(
          (message) =>
            message.role === "assistant" &&
            message.content ===
              "<tool_call>\n<function=list_files>\n</function>\n</tool_call>",
        ),
        "automatic inspection must use the installed Qwen tool-call template",
      );
      assert.ok(
        messages.some(
          (message) =>
            message.role === "tool" &&
            message.tool_name === "list_files" &&
            /src\/index\.ts/.test(message.content),
        ),
      );
      return {
        content:
          "I should create the React notes structure and implement the editor.",
        toolCalls: [],
      };
    }
    if (turn === 2)
      return {
        content:
          '<tool_call><function=write_file><parameter=path>src/App.jsx</parameter><parameter=content>export default function App() { return "Notes"; }\n</parameter></function></tool_call>',
        toolCalls: [],
      };
    return { content: "Created the notes editor.", toolCalls: [] };
  };
  const request =
    "Create a local React notes app that stores names and verify the finished project";
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "user", content: request },
      { role: "assistant", content: "Should I create it?" },
      { role: "user", content: "yes do that pls" },
    ],
  });
  assert.deepEqual(result.changedFiles, ["src/App.jsx"]);
  assert.ok(result.actions.some((action) => action.tool === "set_goal"));
  assert.ok(result.actions.some((action) => action.tool === "list_files"));
  assert.ok(result.actions.some((action) => action.tool === "write_file"));
  assert.match(
    await fs.readFile(path.join(root, "src", "App.jsx"), "utf8"),
    /Notes/,
  );
});

test("code-only implementation replies are discarded and replaced by real file actions", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  await service.grantPermission(
    "terminal.run",
    "always",
    chat.id,
    "node generated.mjs",
  );
  assert.equal(
    requiresProjectMutation(
      "Generate a JavaScript CLI utility in generated.mjs and test it",
    ),
    true,
  );
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    turn += 1;
    if (turn === 1)
      return {
        content: '```js\nconsole.log("chat only must be rejected")\n```',
        toolCalls: [],
      };
    assert.equal(
      messages.some(
        (message) =>
          message.role === "assistant" &&
          /chat only must be rejected/.test(String(message.content || "")),
      ),
      false,
      "rejected source code must not be reinforced as assistant history",
    );
    if (turn === 2) {
      assert.equal(messages.at(-1)?.role, "user");
      assert.match(
        String(messages.at(-1)?.content || ""),
        /oscode_runtime_correction[\s\S]*Call write_file now/,
        "the correction should be the newest model context instead of rewriting the cached system prefix",
      );
    }
    if (turn === 2)
      return {
        content: "",
        toolCalls: [
          {
            id: "write-generated",
            name: "write_file",
            arguments: {
              path: "generated.mjs",
              content: 'console.log("saved and verified")\n',
            },
          },
        ],
      };
    if (turn === 3)
      return {
        content: "",
        toolCalls: [
          {
            id: "verify-generated",
            name: "run_command",
            arguments: { command: "node", args: ["generated.mjs"] },
          },
        ],
      };
    return { content: "Created and verified the utility.", toolCalls: [] };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    terminalMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      {
        role: "user",
        content:
          "Generate a JavaScript CLI utility in generated.mjs and test it",
      },
    ],
  });
  assert.deepEqual(result.changedFiles, ["generated.mjs"]);
  assert.match(result.content, /Created and verified/);
  assert.match(
    await fs.readFile(path.join(root, "generated.mjs"), "utf8"),
    /saved and verified/,
  );
});

test("granted edit buttons correct stale model permission prose and continue to the write tool", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  const modelMessages = [];
  service.remoteReply = async (_request, messages) => {
    modelMessages.push(messages);
    if (turn++ === 0)
      return {
        content: "First, I need permission to write files.",
        toolCalls: [],
      };
    if (turn === 2)
      return {
        content:
          "<tool_call><function=write_file><parameter=path>src/generated.ts</parameter><parameter=content>export const allowed = true;\n</parameter></function></tool_call>",
        toolCalls: [],
      };
    return { content: "Created src/generated.ts.", toolCalls: [] };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "assistant", content: "I need permission to write files." },
      { role: "user", content: "Create src/generated.ts now" },
    ],
  });
  assert.deepEqual(result.changedFiles, ["src/generated.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "src", "generated.ts"), "utf8"),
    /allowed = true/,
  );
  assert.ok(
    modelMessages[0].some(
      (message) =>
        message.role === "assistant" &&
        /permission request was resolved/i.test(message.content),
    ),
  );
  assert.ok(
    modelMessages[1].some(
      (message) =>
        message.role === "user" &&
        /visible capability buttons already granted/i.test(message.content),
    ),
  );
});

test("256k chats compact locally and preserve Qwen reasoning separately", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  service.remoteReply = async () => ({
    content: "## Answer\n\nThe compacted context is ready.",
    thinking: "I checked the retained conversation context.",
    toolCalls: [],
  });
  const messages = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"context ".repeat(2_500)}`,
  }));
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "osCode-fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 262144,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages,
  });
  assert.equal(result.usage.limit, 262144);
  assert.equal(result.usage.compacted, true);
  assert.ok(result.contextSummary.length > 0);
  assert.ok(result.retainedMessages.length < messages.length);
  assert.equal(result.thinking, "I checked the retained conversation context.");
  assert.match(result.content, /compacted context/);

  const continued = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "osCode-fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 262144,
    contextSummary: result.contextSummary,
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [
      ...result.retainedMessages,
      { role: "assistant", content: result.content, thinking: result.thinking },
      { role: "user", content: "Continue with the next task." },
    ],
  });
  assert.equal(continued.usage.compacted, false);
  assert.equal(continued.contextSummary, result.contextSummary);

  const repeated = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "osCode-fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 262144,
    contextSummary: continued.contextSummary,
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [
      ...result.retainedMessages,
      { role: "assistant", content: continued.content },
      ...Array.from({ length: 80 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `second-window-${index}: ${"new context ".repeat(2_500)}`,
      })),
    ],
  });
  assert.equal(repeated.usage.compacted, true);
  assert.ok(repeated.retainedMessages.length < 82);
  assert.ok(repeated.contextSummary.length <= 64_000);
  assert.ok(
    (repeated.contextSummary.match(/(?:^|\n)user: 0: context/g) || []).length <=
      1,
  );
});

test("ask mode queues file edits until the user approves", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  service.remoteReply = async () =>
    turn++ === 0
      ? {
          content:
            '<oscode_tool>{"name":"write_file","arguments":{"path":"src/index.ts","content":"export const value = 4;\\n"}}</oscode_tool>',
          toolCalls: [],
        }
      : { content: "The edit is ready for approval.", toolCalls: [] };
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [{ role: "user", content: "Set value to 4" }],
  });
  assert.equal(result.pendingEdits.length, 1);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 1/,
  );
  const changed = await service.resolveEdits(
    result.pendingEdits.map((edit) => edit.id),
    true,
  );
  assert.deepEqual(changed, ["src/index.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 4/,
  );
});

test("local models can own a chat goal, queue follow-up work, and schedule it", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  await service.runTool(
    { name: "set_goal", arguments: { text: "Ship the parser" } },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  await service.runTool(
    { name: "queue_task", arguments: { prompt: "Add parser tests" } },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  await service.runTool(
    {
      name: "schedule_task",
      arguments: {
        prompt: "Run parser checks",
        next_run_at: new Date(Date.now() + 60_000).toISOString(),
        cadence: "daily",
      },
    },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  const state = await service.getAgentState();
  assert.equal(state.goals[0].chatId, chat.id);
  assert.equal(state.goals[0].automatic, true);
  assert.equal(state.queue[0].automatic, true);
  assert.equal(state.schedules[0].automatic, true);
  assert.equal(state.schedules[0].cadence, "daily");
  assert.equal(state.goals[0].status, "active");
  await service.runTool(
    {
      name: "complete_goal",
      arguments: { evidence: ["scripts/parser.test.ts passes"] },
    },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  const completed = await service.getAgentState();
  assert.equal(completed.goals[0].status, "complete");
});

test("local models cannot complete a goal without verification evidence", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  await service.runTool(
    { name: "set_goal", arguments: { text: "Verify the parser" } },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  await assert.rejects(
    service.runTool(
      { name: "complete_goal", arguments: { evidence: [] } },
      "auto",
      changed,
      [],
      false,
      false,
      chat.id,
    ),
    /verification evidence/,
  );
  const state = await service.getAgentState();
  assert.equal(state.goals[0].status, "active");
});

test("removing a local model forgets its reference without deleting the file", async (t) => {
  const { root, base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const modelPath = path.join(root, "coder.gguf");
  await fs.writeFile(modelPath, "local model fixture");
  const model = {
    id: `llamacpp:${modelPath}`,
    name: "coder.gguf",
    engine: "llamacpp",
    path: modelPath,
    source: "local",
  };
  await service.registerModel(model);
  assert.ok((await service.listModels()).some((item) => item.id === model.id));
  await service.removeModel(model.id);
  assert.equal(
    (await service.listModels()).some((item) => item.id === model.id),
    false,
  );
  assert.equal(await fs.readFile(modelPath, "utf8"), "local model fixture");
});

test("custom models start at 8k and keep their configured context", async (t) => {
  const { root, base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const modelPath = path.join(root, "custom-coder.gguf");
  await fs.writeFile(modelPath, "local model fixture");
  const model = await service.registerModel({
    id: `llamacpp:${modelPath}`,
    name: "custom-coder.gguf",
    engine: "llamacpp",
    path: modelPath,
    source: "local",
  });
  assert.equal(model.preferredContext, 8192);
  const configured = await service.updateModelContext(model.id, 32768);
  assert.equal(configured.preferredContext, 32768);
  assert.equal(
    (await service.listModels()).find((item) => item.id === model.id)
      ?.preferredContext,
    32768,
  );
});

test("downloaded osCode tiers can be deleted without touching custom models", async (t) => {
  const { root, base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const available = (await service.listModels()).find(
    (item) => item.tier === "small",
  );
  assert.ok(available);
  const tierRoot =
    available.engine === "mlx"
      ? path.join(root, "models", "mlx", "osCode-MLX-Small-Q5")
      : path.join(root, "models", "gguf", "small");
  const variant = modelVariants.find(
    (item) => item.tier === "small" && item.runtime === available.engine,
  );
  assert.ok(variant);
  await fs.mkdir(tierRoot, { recursive: true });
  const files = filesForVariant(variant);
  const shards = files
    .map((file) => path.basename(file))
    .filter((file) => file.endsWith(".safetensors"));
  for (const file of files) {
    const name = path.basename(file);
    const content =
      name === "model.safetensors.index.json"
        ? JSON.stringify({
            weight_map: Object.fromEntries(
              shards.map((shard, index) => [`weight.${index}`, shard]),
            ),
          })
        : "test model";
    await fs.writeFile(path.join(tierRoot, name), content);
  }
  const official = (await service.listModels()).find(
    (item) => item.tier === "small" && item.installed,
  );
  assert.ok(official);
  await service.removeModel(official.id);
  assert.equal(
    await fs
      .stat(tierRoot)
      .then(() => true)
      .catch(() => false),
    false,
  );
});

test("saved chats preserve reasoning, model identity, images, and prior turns", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const history = [
    {
      id: "first",
      role: "user",
      content: "Remember the first requirement.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "second",
      role: "assistant",
      content: "I will keep it in this chat.",
      thinking: "Retain the requirement for the next turn.",
      assistantName: "Custom Model",
      createdAt: new Date().toISOString(),
      attachments: [
        {
          id: "image",
          name: "reference.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
        },
      ],
    },
  ];
  await service.saveChat(chat.id, history, "Earlier work remains relevant.");
  const saved = (await service.getAgentState()).chats[0];
  assert.deepEqual(
    saved.messages.map((message) => message.content),
    history.map((message) => message.content),
  );
  assert.equal(saved.messages[1].thinking, history[1].thinking);
  assert.equal(saved.messages[1].assistantName, "Custom Model");
  assert.equal(saved.messages[1].attachments[0].name, "reference.png");
  assert.equal(saved.contextSummary, "Earlier work remains relevant.");

  let received = [];
  service.remoteReply = async (_request, messages) => {
    received = messages;
    return {
      content: "The first requirement is still in context.",
      toolCalls: [],
    };
  };
  await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: saved.contextSummary,
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [
      ...saved.messages,
      { role: "user", content: "What did I ask first?" },
    ],
  });
  assert.ok(
    received.some(
      (message) => message.content === "Remember the first requirement.",
    ),
  );
  assert.ok(
    received.some((message) =>
      message.content.startsWith("I will keep it in this chat."),
    ),
  );
  assert.match(received[0].content, /Earlier work remains relevant/);
});

test("hardware recommendation starts every fresh installation on Small", async (t) => {
  const { base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  assert.equal((await service.hardwareProfile()).recommendedTier, "small");
});
