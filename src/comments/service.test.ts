import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClaudeDispatcher, type RunAgentCommand } from "./agent.js";
import {
  createCommentService,
  matchRoute,
  type CommentService,
} from "./service.js";
import { readCommentStore } from "./store.js";
import type { CommentTarget, CommentsSnapshot } from "./types.js";

const markdown = `# Recovery

The updater retries once before falling back.
`;

const textTarget: CommentTarget = {
  kind: "text",
  surface: { type: "block", tag: "p", index: 0, blockHash: "block-hash" },
  selection: {
    start: 12,
    length: 12,
    hash: "quote-hash",
    quote: "retries once",
  },
};

async function harness(
  options: { run?: RunAgentCommand; session?: string } = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-service-"));
  const filePath = path.join(dir, "review.md");
  await fs.writeFile(filePath, markdown, "utf8");
  let clock = 0;
  let ids = 0;
  const service = createCommentService({
    filePath,
    dispatcher: createClaudeDispatcher({
      sessionId: "session" in options ? options.session : "session-1",
      cwd: dir,
      ...(options.run === undefined ? {} : { run: options.run }),
    }),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (clock += 1))),
    newId: () => `id-${String((ids += 1))}`,
  });
  return { dir, filePath, service };
}

async function post(service: CommentService, pathname: string, body: unknown) {
  return await service.handle({
    pathname,
    method: "POST",
    body: JSON.stringify(body),
  });
}

function jsonBody(result: Awaited<ReturnType<CommentService["handle"]>>) {
  assert.equal(result.kind, "json");
  assert.ok(result.kind === "json");
  return result;
}

test("matchRoute recognises the comment routes and nothing else", () => {
  assert.deepEqual(matchRoute("/__diffmap/comments"), { kind: "collection" });
  assert.deepEqual(matchRoute("/__diffmap/comments/stream"), {
    kind: "stream",
  });
  assert.deepEqual(matchRoute("/__diffmap/comments/t-1/reply"), {
    kind: "reply",
    threadId: "t-1",
  });
  assert.deepEqual(matchRoute("/__diffmap/comments/t-1/resolve"), {
    kind: "resolve",
    threadId: "t-1",
  });
  assert.equal(matchRoute("/__diffmap/file"), undefined);
  assert.equal(matchRoute("/__diffmap/comments/t-1/delete"), undefined);
  assert.equal(matchRoute("/__diffmap/comments/t-1/reply/extra"), undefined);
});

test("create, read, reply and resolve a thread", async () => {
  const { service, filePath } = await harness();

  const created = jsonBody(
    await post(service, "/__diffmap/comments", {
      target: textTarget,
      body: "Why only once?",
    }),
  );
  assert.equal(created.status, 201);
  const thread = (created.body as { thread: { threadId: string } }).thread;
  assert.equal(thread.threadId, "id-1");

  const listed = jsonBody(
    await service.handle({
      pathname: "/__diffmap/comments",
      method: "GET",
      body: "",
    }),
  );
  const snapshot = listed.body as CommentsSnapshot;
  assert.equal(snapshot.threads.length, 1);
  assert.equal(snapshot.agent.available, true);
  assert.deepEqual(snapshot.threads[0]?.target, textTarget);
  assert.equal(snapshot.threads[0]?.messages[0]?.body, "Why only once?");
  assert.equal(snapshot.threads[0]?.messages[0]?.role, "reader");

  const replied = jsonBody(
    await post(service, `/__diffmap/comments/${thread.threadId}/reply`, {
      body: "Windows retries twice.",
    }),
  );
  assert.equal(replied.status, 200);

  const resolved = jsonBody(
    await post(service, `/__diffmap/comments/${thread.threadId}/resolve`, {}),
  );
  assert.equal(resolved.status, 200);

  const stored = await readCommentStore(
    path.join(path.dirname(filePath), "review.comments.json"),
  );
  assert.equal(stored instanceof Error, false);
  if (stored instanceof Error) throw stored;
  assert.equal(stored.version, 1);
  assert.equal(stored.threads.length, 1);
  assert.equal(stored.threads[0]?.status, "resolved");
  assert.deepEqual(
    stored.threads[0]?.messages.map((message) => message.body),
    ["Why only once?", "Windows retries twice."],
  );
});

test("resolve can reopen a thread", async () => {
  const { service } = await harness();
  const created = jsonBody(
    await post(service, "/__diffmap/comments", {
      target: { kind: "document" },
      body: "General note.",
    }),
  );
  const threadId = (created.body as { thread: { threadId: string } }).thread
    .threadId;
  await post(service, `/__diffmap/comments/${threadId}/resolve`, {});
  const reopened = jsonBody(
    await post(service, `/__diffmap/comments/${threadId}/resolve`, {
      status: "open",
    }),
  );
  assert.equal(
    (reopened.body as { thread: { status: string } }).thread.status,
    "open",
  );
});

test("routes reject bad bodies, unknown threads and wrong methods", async () => {
  const { service } = await harness();
  assert.equal(
    jsonBody(await post(service, "/__diffmap/comments", { body: "no target" }))
      .status,
    400,
  );
  assert.equal(
    jsonBody(
      await post(service, "/__diffmap/comments", {
        target: textTarget,
        body: "",
      }),
    ).status,
    400,
  );
  assert.equal(
    jsonBody(
      await post(service, "/__diffmap/comments/missing/reply", { body: "hi" }),
    ).status,
    404,
  );
  assert.equal(
    jsonBody(
      await service.handle({
        pathname: "/__diffmap/comments/stream",
        method: "POST",
        body: "",
      }),
    ).status,
    405,
  );
  assert.deepEqual(
    await service.handle({
      pathname: "/__diffmap/file",
      method: "GET",
      body: "",
    }),
    { kind: "pass" },
  );
});

test("the stream route asks for an SSE subscription", async () => {
  const { service } = await harness();
  assert.deepEqual(
    await service.handle({
      pathname: "/__diffmap/comments/stream",
      method: "GET",
      body: "",
    }),
    { kind: "stream" },
  );
});

test("subscribers see every mutation", async () => {
  const { service } = await harness();
  const seen: number[] = [];
  const unsubscribe = service.subscribe((snapshot) => {
    seen.push(snapshot.threads.length);
  });
  await post(service, "/__diffmap/comments", {
    target: { kind: "document" },
    body: "One.",
  });
  await post(service, "/__diffmap/comments", {
    target: { kind: "document" },
    body: "Two.",
  });
  unsubscribe();
  await post(service, "/__diffmap/comments", {
    target: { kind: "document" },
    body: "Three.",
  });
  assert.deepEqual(seen, [1, 2]);
});

test("askAgent records the forked command, appends the reply and notifies", async () => {
  const prompts: string[] = [];
  const { service } = await harness({
    run: async (input) => {
      prompts.push(input.args.at(-1) ?? "");
      return await Promise.resolve({
        code: 0,
        stdout: "Because the second retry is handled by the OS.",
        stderr: "",
      });
    },
  });
  const states: (string | undefined)[] = [];
  service.subscribe((snapshot) => {
    states.push(snapshot.threads[0]?.agent?.state);
  });
  const created = jsonBody(
    await post(service, "/__diffmap/comments", {
      target: textTarget,
      body: "Why only once?",
      askAgent: true,
    }),
  );
  const threadId = (created.body as { thread: { threadId: string } }).thread
    .threadId;
  await service.idle();

  const snapshot = await service.snapshot();
  assert.equal(snapshot instanceof Error, false);
  if (snapshot instanceof Error) throw snapshot;
  const thread = snapshot.threads.find((item) => item.threadId === threadId);
  assert.equal(thread?.agent?.state, "done");
  assert.deepEqual(thread?.agent?.command, [
    "claude",
    "--resume",
    "session-1",
    "--fork-session",
    "-p",
    prompts[0],
  ]);
  assert.equal(thread?.messages.at(-1)?.role, "agent");
  assert.equal(thread?.messages.at(-1)?.by, "Agent");
  assert.equal(
    thread?.messages.at(-1)?.body,
    "Because the second retry is handled by the OS.",
  );
  // The prompt carries the thread id, the quote and the block from the file.
  assert.match(prompts[0] ?? "", new RegExp(`diffmap-thread-id: ${threadId}`));
  assert.match(prompts[0] ?? "", /retries once/);
  assert.match(
    prompts[0] ?? "",
    /Surrounding block:\nThe updater retries once before falling back\./,
  );
  assert.deepEqual(states, [undefined, "pending", "done"]);
});

test("follow-up Ask AI includes the full persisted thread and excludes other threads", async () => {
  const prompts: string[] = [];
  const { service } = await harness({
    run: async (input) => {
      prompts.push(input.args.at(-1) ?? "");
      return {
        code: 0,
        stdout: "The OS handles the second retry.",
        stderr: "",
      };
    },
  });
  await post(service, "/__diffmap/comments", {
    target: { kind: "document" },
    body: "An unrelated thread.",
  });
  const created = jsonBody(
    await post(service, "/__diffmap/comments", {
      target: textTarget,
      body: "Why only once?",
      askAgent: true,
    }),
  );
  const { threadId } = (created.body as { thread: { threadId: string } })
    .thread;
  await service.idle();
  await post(service, `/__diffmap/comments/${threadId}/reply`, {
    body: "Windows retries twice.",
  });
  await post(service, `/__diffmap/comments/${threadId}/reply`, {
    body: "Does your answer also apply to Windows?",
    askAgent: true,
  });
  await service.idle();

  assert.equal(prompts.length, 2);
  const followUp = prompts[1]!;
  const bodies = [
    "Why only once?",
    "The OS handles the second retry.",
    "Windows retries twice.",
    "Does your answer also apply to Windows?",
  ];
  let previous = -1;
  for (const body of bodies) {
    const index = followUp.indexOf(body);
    assert.ok(index > previous, `Missing or out-of-order message: ${body}`);
    assert.equal(followUp.indexOf(body, index + body.length), -1);
    previous = index;
  }
  assert.doesNotMatch(followUp, /An unrelated thread/);
  assert.match(followUp, /Agent \(Agent\):\nThe OS handles/);
  assert.match(followUp, /Selected text:\nretries once/);
  assert.match(followUp, /Surrounding block:\nThe updater retries once/);
});

test("a failed agent run stores an error state instead of hanging", async () => {
  const { service } = await harness({
    run: async () =>
      await Promise.resolve({ code: 1, stdout: "", stderr: "session gone" }),
  });
  await post(service, "/__diffmap/comments", {
    target: { kind: "document" },
    body: "Anything?",
    askAgent: true,
  });
  await service.idle();
  const snapshot = await service.snapshot();
  if (snapshot instanceof Error) throw snapshot;
  assert.equal(snapshot.threads[0]?.agent?.state, "error");
  assert.match(snapshot.threads[0]?.agent?.error ?? "", /session gone/);
  assert.equal(snapshot.threads[0]?.messages.length, 1);
});

test("without a session the snapshot reports Ask AI as unavailable", async () => {
  const { service } = await harness({ session: undefined });
  const snapshot = await service.snapshot();
  if (snapshot instanceof Error) throw snapshot;
  assert.equal(snapshot.agent.available, false);
  assert.match(snapshot.agent.reason ?? "", /DIFFMAP_AGENT_SESSION/);
});

test("threads survive a restart of the service", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-restart-"));
  const filePath = path.join(dir, "review.md");
  await fs.writeFile(filePath, markdown, "utf8");
  const dispatcher = createClaudeDispatcher({ sessionId: "s", cwd: dir });
  const first = createCommentService({ filePath, dispatcher });
  await post(first, "/__diffmap/comments", {
    target: textTarget,
    body: "Persisted?",
  });
  const second = createCommentService({ filePath, dispatcher });
  const snapshot = await second.snapshot();
  if (snapshot instanceof Error) throw snapshot;
  assert.equal(snapshot.threads.length, 1);
  assert.equal(snapshot.threads[0]?.messages[0]?.body, "Persisted?");
});
