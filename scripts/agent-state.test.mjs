import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentStateStore } from "../dist-electron/main/agent-state.js";

test("agent chats, goals, queue, schedules, and permission scopes persist locally", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-agent-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  await fs.mkdir(project);
  const store = new AgentStateStore(root);
  const chat = await store.createChat(project);
  await store.saveChat(
    chat.id,
    project,
    [{ role: "user", content: "Build a parser" }],
    "",
  );
  const goal = await store.setGoal(chat.id, "Build a parser", true);
  const queued = await store.addQueue(chat.id, "Add tests");
  const schedule = await store.addSchedule(
    chat.id,
    "Run checks",
    new Date(Date.now() - 1000).toISOString(),
    "once",
  );
  const once = await store.grantPermission(
    "project.write",
    "once",
    chat.id,
    project,
    "src/parser.ts",
  );

  assert.equal(
    await store.usePermission("project.write", chat.id, project),
    true,
  );
  assert.equal(
    await store.usePermission("project.write", chat.id, project),
    false,
  );
  assert.equal(await store.collectDue(project), 1);
  const state = await store.state(project);
  assert.equal(state.chats[0].title, "Build a parser");
  assert.equal(state.goals[0].id, goal.id);
  assert.equal(
    state.queue.some((item) => item.id === queued.id),
    true,
  );
  assert.equal(
    state.queue.some((item) => item.prompt === "Run checks"),
    true,
  );
  assert.equal(
    state.schedules.find((item) => item.id === schedule.id)?.enabled,
    false,
  );
  assert.equal(
    state.permissions.some((item) => item.id === once.id),
    false,
  );
  const stored = await fs.readFile(
    path.join(root, "secure", "state", "agent-state.oscode-data"),
  );
  assert.equal(stored.includes(Buffer.from("Build a parser")), false);
  const projectFolders = await fs.readdir(
    path.join(root, "secure", "projects"),
  );
  const chatFolders = await fs.readdir(
    path.join(root, "secure", "projects", projectFolders[0], "chats"),
  );
  assert.match(chatFolders[0], /^\d{4}-\d{2}-\d{2}-\d{3}$/);
  assert.equal(
    (
      await fs.stat(
        path.join(
          root,
          "secure",
          "projects",
          projectFolders[0],
          "chats",
          chatFolders[0],
          "agentCode",
        ),
      )
    ).isDirectory(),
    true,
  );
});

test("conversation permissions do not cross chats and always stays project scoped", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "oscode-agent-permission-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AgentStateStore(root);
  const first = await store.createChat("C:/project-a");
  const second = await store.createChat("C:/project-a");
  await store.grantPermission(
    "web.search",
    "conversation",
    first.id,
    "C:/project-a",
    "docs",
  );
  assert.equal(
    await store.usePermission("web.search", second.id, "C:/project-a"),
    false,
  );
  await store.grantPermission(
    "project.read",
    "always",
    first.id,
    "C:/project-a",
    "project files",
  );
  assert.equal(
    await store.usePermission("project.read", second.id, "C:/project-a"),
    true,
  );
  assert.equal(
    await store.usePermission("project.read", second.id, "C:/project-b"),
    false,
  );
});

test("concurrent empty-chat requests share one transient draft until first input", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-empty-chat-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AgentStateStore(root);
  const [first, second] = await Promise.all([
    store.ensureEmptyChat("C:/project"),
    store.ensureEmptyChat("C:/project"),
  ]);
  assert.equal(first.id, second.id);
  assert.equal((await store.state("C:/project")).chats.length, 1);
  assert.equal((await store.state("C:/project")).chats[0].id, first.id);
  assert.equal(
    (await new AgentStateStore(root).state("C:/project")).chats.length,
    0,
    "the visible draft must remain memory-only until the user sends input",
  );
  await store.saveChat(
    first.id,
    "C:/project",
    [{ role: "user", content: "Start working" }],
    "",
  );
  const next = await store.ensureEmptyChat("C:/project");
  assert.notEqual(next.id, first.id);
  assert.deepEqual(
    (await store.state("C:/project")).chats.map((chat) => chat.id),
    [next.id, first.id],
  );
  assert.deepEqual(
    (await new AgentStateStore(root).state("C:/project")).chats.map(
      (chat) => chat.id,
    ),
    [first.id],
    "only the chat with real user input should survive a process restart",
  );
});

test("first queued work materializes a valid transient chat", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-draft-queue-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AgentStateStore(root);
  const draft = await store.ensureEmptyChat("C:/project");

  const queued = await store.addQueue(draft.id, "Answer after the active chat");
  const state = await store.state("C:/project");

  assert.equal(
    state.chats.some((chat) => chat.id === draft.id),
    true,
  );
  assert.equal(
    state.queue.find((item) => item.id === queued.id)?.chatId,
    draft.id,
  );
  assert.equal(
    (await new AgentStateStore(root).state("C:/project")).chats[0]?.id,
    draft.id,
    "queued user work makes the chat durable before the renderer can detach",
  );
});

test("goals, queues, and schedules stay owned by their chat", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-chat-work-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AgentStateStore(root);
  const first = await store.createChat("C:/project");
  const second = await store.createChat("C:/project");
  await store.saveChat(
    first.id,
    "C:/project",
    [{ role: "user", content: "Finish the parser" }],
    "",
  );
  await store.saveChat(
    second.id,
    "C:/project",
    [{ role: "user", content: "Review the parser" }],
    "",
  );
  const goal = await store.setGoal(first.id, "Finish the parser", true);
  await store.addQueue(first.id, "Add tests", undefined, true);
  await store.addSchedule(
    first.id,
    "Run checks",
    new Date(Date.now() + 60_000).toISOString(),
    "daily",
    true,
  );

  const state = await store.state("C:/project");
  assert.equal(
    state.goals.filter((item) => item.chatId === first.id).length,
    1,
  );
  assert.equal(
    state.goals.filter((item) => item.chatId === second.id).length,
    0,
  );
  assert.equal(state.queue[0].automatic, true);
  assert.equal(state.schedules[0].automatic, true);
  assert.equal(await store.removeGoal(goal.id), true);
  assert.equal((await store.state("C:/project")).goals.length, 0);
  await assert.rejects(
    store.addSchedule(
      "missing-chat",
      "Never run",
      new Date().toISOString(),
      "once",
    ),
    /Chat was not found/,
  );
});

test("a queued chat message can be promoted without losing the stack", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-chat-steer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AgentStateStore(root);
  const chat = await store.createChat("C:/project");
  await store.saveChat(
    chat.id,
    "C:/project",
    [{ role: "user", content: "Explain the current code" }],
    "",
  );
  const first = await store.addQueue(chat.id, "Explain the current code");
  const second = await store.addQueue(chat.id, "Improve the error handling");

  assert.equal(await store.prioritizeQueue(second.id), true);
  let state = await store.state("C:/project");
  assert.deepEqual(
    state.queue.map((item) => item.id),
    [second.id, first.id],
  );
  assert.equal(state.queue[0].prompt, "Improve the error handling");

  await store.updateQueue(second.id, "running");
  assert.equal(await store.prioritizeQueue(second.id), false);
  state = await store.state("C:/project");
  assert.equal(state.queue[0].status, "running");
});
