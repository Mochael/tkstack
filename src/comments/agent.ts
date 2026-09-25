/**
 * Ask AI dispatch. The answering agent is the coding-agent session that
 * launched the viewer, so it already holds the authoring context; the run is
 * forked off that session so it cannot collide with the live interactive one.
 *
 * Everything the process layer needs sits behind `RunAgentCommand`, so tests
 * substitute a fake command and a different agent CLI could be dropped in
 * without touching the routes.
 */

import { execFile } from "node:child_process";
import { DiffmapAgentError } from "../errors.js";
import type { CommentAgentStatus, CommentMessage } from "./types.js";

export type AgentCommand = {
  executable: string;
  args: string[];
  cwd: string;
};

export type AgentRunOutput = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunAgentCommand = (
  input: AgentCommand & { timeoutMs: number },
) => Promise<AgentRunOutput | Error>;

export type AgentDispatcher = {
  status: CommentAgentStatus;
  /** The command that a dispatch would run, recorded on the thread. */
  describe: (prompt: string) => string[];
  dispatch: (prompt: string) => Promise<string | DiffmapAgentError>;
};

export const AGENT_TIMEOUT_MS = 5 * 60 * 1_000;

/** `diffmap-thread-id:` lets the agent tie its answer back to the thread. */
export function commentPromptPrefix(threadId: string) {
  return `diffmap: you are answering a reader's comment on a diffmap spec you authored. Reply with the answer only.
diffmap-thread-id: ${threadId}\n\n`;
}

export function buildCommentPrompt(input: {
  threadId: string;
  quote: string | undefined;
  blockContext: string | undefined;
  messages: readonly CommentMessage[];
}) {
  const parts = [commentPromptPrefix(input.threadId)];
  if (input.quote !== undefined && input.quote !== "") {
    parts.push(`Selected text:\n${input.quote}\n\n`);
  }
  if (input.blockContext !== undefined && input.blockContext !== "") {
    parts.push(`Surrounding block:\n${input.blockContext}\n\n`);
  }
  parts.push("Thread conversation (oldest first):\n");
  for (const message of input.messages) {
    const role = message.role === "agent" ? "Agent" : "Reader";
    parts.push(`\n${role} (${message.by}):\n${message.body}\n`);
  }
  parts.push(
    "\nAnswer the latest reader message using the full conversation above.",
  );
  return parts.join("");
}

export function claudeAgentCommand(input: {
  sessionId: string;
  cwd: string;
  prompt: string;
}): AgentCommand {
  return {
    executable: "claude",
    // `--fork-session` keeps this run off the user's live session.
    args: ["--resume", input.sessionId, "--fork-session", "-p", input.prompt],
    cwd: input.cwd,
  };
}

export function createClaudeDispatcher(input: {
  sessionId: string | undefined;
  cwd: string;
  timeoutMs?: number;
  run?: RunAgentCommand;
}): AgentDispatcher {
  const sessionId = input.sessionId;
  const run = input.run ?? runWithExecFile;
  const timeoutMs = input.timeoutMs ?? AGENT_TIMEOUT_MS;
  const status: CommentAgentStatus =
    sessionId === undefined || sessionId === ""
      ? {
          available: false,
          reason:
            "No agent session. Start diffmap with --agent-session <id> or set DIFFMAP_AGENT_SESSION.",
        }
      : { available: true, reason: undefined };

  function command(prompt: string) {
    return claudeAgentCommand({
      sessionId: sessionId ?? "",
      cwd: input.cwd,
      prompt,
    });
  }

  return {
    status,
    describe(prompt) {
      const built = command(prompt);
      return [built.executable, ...built.args];
    },
    async dispatch(prompt) {
      if (!status.available) {
        return new DiffmapAgentError({
          reason: status.reason ?? "no agent session configured",
        });
      }
      const output = await run({ ...command(prompt), timeoutMs });
      if (output instanceof Error) {
        return output instanceof DiffmapAgentError
          ? output
          : new DiffmapAgentError({ reason: output.message, cause: output });
      }
      if (output.code !== 0) {
        const detail = output.stderr.trim() || output.stdout.trim();
        return new DiffmapAgentError({
          reason: `claude exited with code ${String(output.code)}${detail === "" ? "" : `: ${detail}`}`,
        });
      }
      const text = output.stdout.trim();
      if (text === "") {
        return new DiffmapAgentError({ reason: "claude returned no output" });
      }
      return text;
    },
  };
}

const runWithExecFile: RunAgentCommand = (input) =>
  new Promise<AgentRunOutput | Error>((resolve) => {
    const child = execFile(
      input.executable,
      input.args,
      {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: 8 * 1_024 * 1_024,
        killSignal: "SIGTERM",
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as { code?: unknown }).code;
        if (code === "ENOENT") {
          resolve(
            new DiffmapAgentError({
              reason: `could not run "${input.executable}": the agent CLI is not on PATH`,
              cause: error,
            }),
          );
          return;
        }
        if (child.killed || (error as { signal?: unknown }).signal !== null) {
          resolve(
            new DiffmapAgentError({
              reason: `the agent timed out after ${String(Math.round(input.timeoutMs / 1_000))}s`,
              cause: error,
            }),
          );
          return;
        }
        resolve({
          code: typeof code === "number" ? code : 1,
          stdout,
          stderr,
        });
      },
    );
  });
