import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommentPrompt,
  claudeAgentCommand,
  createClaudeDispatcher,
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

test("dispatch fails without ever spawning when no session is configured", async () => {
  let spawned = false;
  const dispatcher = createClaudeDispatcher({
    sessionId: undefined,
    cwd: "/repo",
    run: async () => {
      spawned = true;
      return await Promise.resolve({ code: 0, stdout: "x", stderr: "" });
    },
  });
  assert.equal(dispatcher.status.available, false);
  assert.match(dispatcher.status.reason ?? "", /--agent-session/);
  const result = await dispatcher.dispatch("hello");
  assert.ok(result instanceof DiffmapAgentError);
  assert.equal(spawned, false);
});

test("dispatch surfaces a non-zero exit with its stderr", async () => {
  const dispatcher = createClaudeDispatcher({
    sessionId: "session-1",
    cwd: "/repo",
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
    run: fakeRun({ code: 0, stdout: "  \n", stderr: "" }),
  });
  const result = await dispatcher.dispatch("hello");
  assert.ok(result instanceof Error);
  assert.match(result.message, /no output/);
});
