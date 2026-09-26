import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCommentPrompt,
  claudeAgentCommand,
  createClaudeDispatcher,
  locateClaudeSession,
  type ClaudeSession,
  type AgentRunOutput,
  type RunAgentCommand,
} from "./agent.js";
import { DiffmapAgentError } from "../errors.js";
import type { CommentMessage } from "./types.js";

function message(
  body: string,
  role: CommentMessage["role"] = "reader",
): CommentMessage {
  return {
    id: body,
    by: role === "reader" ? "Sam" : "Agent",
    at: "2026-01-01T00:00:00Z",
    role,
    body,
  };
}

async function found(sessionId: string): Promise<ClaudeSession> {
  return await Promise.resolve({ sessionId, cwd: "/repo" });
}

function fakeRun(
  result: AgentRunOutput | Error,
  calls: Parameters<RunAgentCommand>[0][] = [],
): RunAgentCommand {
  return async (input) => {
    calls.push(input);
    return await Promise.resolve(result);
  };
}

test("claudeAgentCommand forks the launching session", () => {
  const command = claudeAgentCommand({
    sessionId: "session-1",
    cwd: "/repo",
    prompt: "hello",
  });
  assert.deepEqual(command, {
    executable: "claude",
    args: ["--resume", "session-1", "--fork-session", "-p", "hello"],
    cwd: "/repo",
  });
});

test("buildCommentPrompt leads with the machine-readable thread header", () => {
  const prompt = buildCommentPrompt({
    threadId: "t-1",
    quote: "retries once",
    blockContext: "The updater retries once before falling back.",
    messages: [message("Why only once?")],
  });
  assert.equal(prompt.split("\n")[1], "diffmap-thread-id: t-1");
  assert.match(prompt, /Selected text:\nretries once/);
  assert.match(prompt, /Surrounding block:\nThe updater retries once/);
  assert.match(prompt, /Reader \(Sam\):\nWhy only once\?/);
});

test("buildCommentPrompt omits absent context", () => {
  const prompt = buildCommentPrompt({
    threadId: "t-2",
    quote: undefined,
    blockContext: undefined,
    messages: [message("General question.")],
  });
  assert.doesNotMatch(prompt, /Selected text/);
  assert.match(prompt, /Reader \(Sam\):\nGeneral question\./);
});

test("buildCommentPrompt includes every reader and agent message in order", () => {
  const prompt = buildCommentPrompt({
    threadId: "t-3",
    quote: undefined,
    blockContext: undefined,
    messages: [
      message("First question."),
      message("First answer.", "agent"),
      message("A saved note."),
      message("Follow-up question."),
    ],
  });
  assert.ok(
    prompt.includes(
      "Reader (Sam):\nFirst question.\n\nAgent (Agent):\nFirst answer.\n\nReader (Sam):\nA saved note.\n\nReader (Sam):\nFollow-up question.",
    ),
  );
  assert.match(
    prompt,
    /Answer the latest reader message using the full conversation above\.$/,
  );
});

test("dispatch returns trimmed stdout and reports the command it ran", async () => {
  const calls: Parameters<RunAgentCommand>[0][] = [];
  const dispatcher = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: found,
    run: fakeRun({ code: 0, stdout: "  the answer \n", stderr: "" }, calls),
  });
  assert.equal(dispatcher.status.available, true);
  assert.deepEqual(dispatcher.describe("hello"), [
    "claude",
    "--resume",
    "session-1",
    "--fork-session",
    "-p",
    "hello",
  ]);
  assert.equal(await dispatcher.dispatch("hello"), "the answer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cwd, "/repo");
});

test("without a session, dispatch runs a fresh read-only session", async () => {
  const calls: Parameters<RunAgentCommand>[0][] = [];
  const dispatcher = createClaudeDispatcher({
    sessionId: undefined,
    cwd: "/repo",
    documentPath: "/repo/review.md",
    run: fakeRun({ code: 0, stdout: "fresh answer", stderr: "" }, calls),
  });
  assert.equal(dispatcher.status.available, true);
  assert.equal(dispatcher.status.mode, "fresh");
  assert.equal(await dispatcher.dispatch("hello"), "fresh answer");
  const args = calls[0]?.args ?? [];
  assert.ok(!args.includes("--resume"));
  assert.match(
    args[1] ?? "",
    /You did not write this document.*\/repo\/review\.md/,
  );
  assert.match(args[1] ?? "", /hello$/);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(!(args[args.indexOf("--allowedTools") + 1] ?? "").includes("Edit"));
});

test("dispatch resumes the session from its own project directory", async () => {
  const calls: Parameters<RunAgentCommand>[0][] = [];
  const dispatcher = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: async (sessionId) =>
      await Promise.resolve({ sessionId, cwd: "/elsewhere" }),
    run: fakeRun({ code: 0, stdout: "ok", stderr: "" }, calls),
  });
  assert.equal(await dispatcher.dispatch("hello"), "ok");
  assert.equal(calls[0]?.cwd, "/elsewhere");
});

test("a session that cannot be found or resumed falls back to a fresh one", async () => {
  const unknownCalls: Parameters<RunAgentCommand>[0][] = [];
  const unknown = createClaudeDispatcher({
    sessionId: "gone",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: async () => await Promise.resolve(undefined),
    run: fakeRun({ code: 0, stdout: "fresh", stderr: "" }, unknownCalls),
  });
  assert.equal(await unknown.dispatch("hello"), "fresh");
  assert.ok(!unknownCalls[0]?.args.includes("--resume"));

  const calls: Parameters<RunAgentCommand>[0][] = [];
  const broken = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: found,
    run: async (input) => {
      calls.push(input);
      return await Promise.resolve(
        input.args.includes("--resume")
          ? { code: 1, stdout: "", stderr: "No conversation found" }
          : { code: 0, stdout: "fresh", stderr: "" },
      );
    },
  });
  assert.equal(await broken.dispatch("hello"), "fresh");
  assert.equal(calls.length, 2);
});

test("locateClaudeSession reads the cwd from the session transcript", async () => {
  const projects = await fs.mkdtemp(
    path.join(os.tmpdir(), "diffmap-projects-"),
  );
  await fs.mkdir(path.join(projects, "-work-app"));
  await fs.writeFile(
    path.join(projects, "-work-app", "abc-123.jsonl"),
    `${JSON.stringify({ type: "user", cwd: "/work/app", sessionId: "abc-123" })}\n`,
    "utf8",
  );
  assert.deepEqual(await locateClaudeSession("abc-123", projects), {
    sessionId: "abc-123",
    cwd: "/work/app",
  });
  assert.equal(await locateClaudeSession("missing", projects), undefined);
  assert.equal(await locateClaudeSession("../escape", projects), undefined);
});
test("dispatch surfaces a non-zero exit with its stderr", async () => {
  const dispatcher = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: found,
    run: fakeRun({ code: 2, stdout: "", stderr: "no such session" }),
  });
  const result = await dispatcher.dispatch("hello");
  assert.ok(result instanceof Error);
  assert.match(result.message, /exited with code 2: no such session/);
});

test("dispatch surfaces a missing binary or a timeout as an agent error", async () => {
  const missing = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: found,
    run: fakeRun(
      new DiffmapAgentError({
        reason: 'could not run "claude": the agent CLI is not on PATH',
      }),
    ),
  });
  const missingResult = await missing.dispatch("hello");
  assert.ok(missingResult instanceof Error);
  assert.match(missingResult.message, /not on PATH/);

  const slow = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: found,
    run: fakeRun(
      new DiffmapAgentError({ reason: "the agent timed out after 300s" }),
    ),
  });
  const slowResult = await slow.dispatch("hello");
  assert.ok(slowResult instanceof Error);
  assert.match(slowResult.message, /timed out/);
});

test("dispatch rejects empty output rather than posting a blank reply", async () => {
  const dispatcher = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    locate: found,
    run: fakeRun({ code: 0, stdout: "  \n", stderr: "" }),
  });
  const result = await dispatcher.dispatch("hello");
  assert.ok(result instanceof Error);
  assert.match(result.message, /no output/);
});
