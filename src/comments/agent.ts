/**
 * Ask AI dispatch. When diffmap knows the coding-agent session that wrote the
 * document (`--agent-session`, DIFFMAP_AGENT_SESSION, or the
 * CLAUDE_CODE_SESSION_ID Claude Code sets for commands it runs), the answer
 * comes from a fork of that session, so it already holds the authoring
 * context without colliding with the live interactive one. Otherwise, or if
 * that session cannot be resumed, a fresh read-only session answers from the
 * document and the code.
 *
 * Everything the process layer needs sits behind `RunAgentCommand`, so tests
 * substitute a fake command and a different agent CLI could be dropped in
 * without touching the routes.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

/** What a fresh session may use: read the workspace and git history. */
const FRESH_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const FRESH_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git show:*)",
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git grep:*)",
  "Bash(gh pr view:*)",
  "Bash(gh pr diff:*)",
];

/** `diffmap-thread-id:` lets the agent tie its answer back to the thread. */
export function commentPromptPrefix(threadId: string) {
  return `diffmap: you are answering a reader's comment on a diffmap document. Reply with the answer only.
diffmap-thread-id: ${threadId}\n\n`;
}

/** Context a fresh session needs, since it did not write the document. */
export function freshSessionPreamble(documentPath: string) {
  return `You did not write this document and have no earlier context. It is at ${documentPath}; read it and the code in the working directory as needed to answer accurately.\n\n`;
}

export type ClaudeSession = { sessionId: string; cwd: string };

/**
 * Finds a Claude Code session's transcript under ~/.claude/projects.
 * `claude --resume` only finds a session from its own project directory, so
 * the transcript's recorded `cwd` is where the resumed run must start.
 */
export async function locateClaudeSession(
  sessionId: string,
  projectsDir = path.join(os.homedir(), ".claude", "projects"),
): Promise<ClaudeSession | undefined> {
  if (!/^[\w-]+$/.test(sessionId)) return undefined;
  const projects = await fs.readdir(projectsDir).catch(() => []);
  for (const project of projects) {
    const transcript = path.join(projectsDir, project, `${sessionId}.jsonl`);
    const head = await readHead(transcript);
    if (head === undefined) continue;
    const match = /"cwd":("(?:[^"\\]|\\.)*")/.exec(head);
    if (match?.[1] === undefined) return undefined;
    const cwd: unknown = JSON.parse(match[1]);
    return typeof cwd === "string" ? { sessionId, cwd } : undefined;
  }
  return undefined;
}

async function readHead(file: string) {
  const handle = await fs.open(file, "r").catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    const buffer = Buffer.alloc(256 * 1_024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
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

export function freshClaudeCommand(input: {
  cwd: string;
  prompt: string;
  documentPath: string;
}): AgentCommand {
  return {
    executable: "claude",
    args: [
      "-p",
      `${freshSessionPreamble(input.documentPath)}${input.prompt}`,
      "--permission-mode",
      "dontAsk",
      "--tools",
      FRESH_TOOLS.join(","),
      "--allowedTools",
      FRESH_ALLOWED_TOOLS.join(","),
    ],
    cwd: input.cwd,
  };
}

export function createClaudeDispatcher(input: {
  /** The authoring session, if known. Without one, a fresh session answers. */
  sessionId: string | undefined;
  cwd: string;
  /** The document being commented on, for a fresh session to read. */
  documentPath: string;
  timeoutMs?: number;
  run?: RunAgentCommand;
  locate?: (sessionId: string) => Promise<ClaudeSession | undefined>;
}): AgentDispatcher {
  const sessionId =
    input.sessionId === undefined || input.sessionId.trim() === ""
      ? undefined
      : input.sessionId.trim();
  const run = input.run ?? runAgentCommand;
  const locate = input.locate ?? ((id: string) => locateClaudeSession(id));
  const timeoutMs = input.timeoutMs ?? AGENT_TIMEOUT_MS;
  const status: CommentAgentStatus = {
    available: true,
    reason: undefined,
    mode: sessionId === undefined ? "fresh" : "session",
  };

  function fresh(prompt: string) {
    return freshClaudeCommand({
      cwd: input.cwd,
      prompt,
      documentPath: input.documentPath,
    });
  }

  async function attempt(command: AgentCommand) {
    const output = await run({ ...command, timeoutMs });
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
  }

  return {
    status,
    describe(prompt) {
      const built =
        sessionId === undefined
          ? fresh(prompt)
          : claudeAgentCommand({ sessionId, cwd: input.cwd, prompt });
      return [built.executable, ...built.args];
    },
    async dispatch(prompt) {
      const session =
        sessionId === undefined ? undefined : await locate(sessionId);
      if (session === undefined) return await attempt(fresh(prompt));
      const resumed = await attempt(
        claudeAgentCommand({
          sessionId: session.sessionId,
          cwd: session.cwd,
          prompt,
        }),
      );
      // A session that exists but will not resume still deserves an answer;
      // a missing CLI or a timeout would only fail again, so surface those.
      if (
        resumed instanceof Error &&
        /exited with code/.test(resumed.message)
      ) {
        return await attempt(fresh(prompt));
      }
      return resumed;
    },
  };
}

/** Runs an agent CLI with `execFile`; shared with the quiz. */
export const runAgentCommand: RunAgentCommand = (input) =>
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
