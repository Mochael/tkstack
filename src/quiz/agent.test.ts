import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentRunOutput, RunAgentCommand } from "../comments/agent.js";
import {
  QUIZ_DIFF_CHAR_LIMIT,
  buildGradePrompt,
  buildPlacePrompt,
  buildQuizPrompt,
  claudeQuizCommand,
  cleanPullRequestBody,
  createQuizAgent,
  type PullRequestContext,
} from "./agent.js";

const pr: PullRequestContext = {
  ref: "283",
  number: 283,
  title: "Recover macOS update downloads",
  url: "https://github.com/acme/app/pull/283",
  body: "Fixes stalled updates.",
  baseRefName: "main",
  headRefName: "fix/updates",
  baseSha: "base123",
  headSha: "head456",
  files: [{ path: "src/updater.ts", additions: 10, deletions: 2 }],
  diff: "diff --git a/src/updater.ts b/src/updater.ts\n+retry()",
};

const question = {
  id: "q1",
  prompt: "What happens when the install stalls?",
  covers: "install watchdog",
  rubric: "2: mentions the 30s watchdog and redownload.",
  referenceAnswer: "A 30s watchdog fires and the update is downloaded again.",
  sectionId: undefined,
};

type Call = Parameters<RunAgentCommand>[0];

function scriptedRun(
  respond: (call: Call) => AgentRunOutput | Error,
  calls: Call[] = [],
): RunAgentCommand {
  return async (input) => {
    calls.push(input);
    return await Promise.resolve(respond(input));
  };
}

function ok(stdout: unknown): AgentRunOutput {
  return {
    code: 0,
    stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
    stderr: "",
  };
}

function prResponder(claude: (call: Call) => AgentRunOutput | Error) {
  return (call: Call) => {
    if (call.executable === "gh" && call.args[1] === "view") {
      return ok({
        number: 283,
        title: pr.title,
        url: pr.url,
        body: "Fixes stalled updates.\n**Walkthrough:** https://diffmap.dev/g/abc",
        baseRefName: "main",
        headRefName: "fix/updates",
        baseRefOid: "base123",
        headRefOid: "head456",
        files: pr.files,
      });
    }
    if (call.executable === "gh" && call.args[1] === "diff") {
      return ok(pr.diff);
    }
    return claude(call);
  };
}

test("buildQuizPrompt carries the change but not the review document", () => {
  const prompt = buildQuizPrompt(pr);
  assert.match(prompt, /^diffmap-quiz:/);
  assert.match(prompt, /you have not seen the document/);
  assert.match(prompt, /git show head456:<path>/);
  assert.match(prompt, /- src\/updater\.ts \(\+10\/-2\)/);
  assert.match(prompt, /\+retry\(\)/);
});

test("buildQuizPrompt truncates a diff past the limit", () => {
  const prompt = buildQuizPrompt({
    ...pr,
    diff: "x".repeat(QUIZ_DIFF_CHAR_LIMIT + 50),
  });
  assert.match(prompt, /\[diff truncated at \d+ characters; read the rest/);
  assert.ok(!prompt.includes("x".repeat(QUIZ_DIFF_CHAR_LIMIT + 1)));
});

test("buildGradePrompt includes the key and only names the PR without a session", () => {
  const forked = buildGradePrompt({
    question,
    index: 0,
    total: 3,
    answer: "It retries.",
    sourceRef: undefined,
  });
  assert.match(forked, /question 1 of 3/);
  assert.match(forked, /Reference answer:\nA 30s watchdog/);
  assert.match(forked, /The reviewer's answer:\nIt retries\./);
  assert.ok(!forked.includes("pull request 283"));
  const fresh = buildGradePrompt({
    question,
    index: 0,
    total: 3,
    answer: "It retries.",
    sourceRef: "283",
  });
  assert.match(fresh, /quiz about pull request 283/);
});

test("cleanPullRequestBody drops walkthrough links and bot summaries", () => {
  const cleaned = cleanPullRequestBody(
    [
      "**Walkthrough:** https://diffmap.dev/g/abc",
      "",
      "Real description.",
      "<!-- CURSOR_SUMMARY -->",
      "AI summary",
      "<!-- /CURSOR_SUMMARY -->",
    ].join("\n"),
  );
  assert.equal(cleaned, "Real description.");
});

test("claudeQuizCommand is read-only and hides the review document", () => {
  const command = claudeQuizCommand({
    prompt: "p",
    cwd: "/repo",
    schema: { type: "object" },
    model: "opus",
    resumeSessionId: "author-1",
    documentPath: "/repo/tmp/review.md",
  });
  assert.deepEqual(command.args.slice(0, 5), [
    "--resume",
    "author-1",
    "--fork-session",
    "-p",
    "p",
  ]);
  const flag = (name: string) => command.args[command.args.indexOf(name) + 1];
  assert.equal(flag("--permission-mode"), "dontAsk");
  assert.equal(flag("--tools"), "Read,Grep,Glob,Bash");
  assert.ok(!flag("--allowedTools")?.includes("Edit"));
  assert.equal(
    flag("--disallowedTools"),
    "Read(//repo/tmp/review.md),Read(//repo/tmp/review.*)",
  );
  assert.equal(flag("--model"), "opus");
});

test("createQuizAgent is unavailable without a pull request", async () => {
  const agent = createQuizAgent({
    source: undefined,
    cwd: "/repo",
    documentPath: "/repo/review.md",
  });
  assert.equal(agent.status.available, false);
  assert.match(agent.status.reason ?? "", /--quiz-pr/);
  const result = await agent.generate();
  assert.ok(result instanceof Error);
});

test("generate reads the PR with gh and returns the structured quiz", async () => {
  const calls: Call[] = [];
  const agent = createQuizAgent({
    source: "283",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    run: scriptedRun(
      prResponder(() =>
        ok({
          is_error: false,
          session_id: "author-1",
          structured_output: {
            questions: [
              {
                prompt: question.prompt,
                covers: question.covers,
                referenceAnswer: question.referenceAnswer,
                rubric: question.rubric,
              },
            ],
          },
        }),
      ),
      calls,
    ),
  });
  const quiz = await agent.generate();
  assert.ok(!(quiz instanceof Error));
  assert.equal(quiz.sessionId, "author-1");
  assert.equal(quiz.source.headSha, "head456");
  assert.equal(quiz.questions.length, 1);
  const claude = calls.find((call) => call.executable === "claude");
  const prompt = claude?.args[claude.args.indexOf("-p") + 1] ?? "";
  assert.ok(!prompt.includes("diffmap.dev"));
  assert.ok(!claude?.args.includes("--resume"));
});

test("generate surfaces a malformed quiz as an error", async () => {
  const agent = createQuizAgent({
    source: "283",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    run: scriptedRun(
      prResponder(() => ok({ structured_output: { questions: [] } })),
    ),
  });
  const quiz = await agent.generate();
  assert.ok(quiz instanceof Error);
  assert.match(quiz.message, /unexpected shape/);
});

test("grade forks the author session and falls back to a fresh one", async () => {
  const calls: Call[] = [];
  const agent = createQuizAgent({
    source: "283",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    run: scriptedRun((call) => {
      if (call.args.includes("--resume")) {
        return { code: 1, stdout: "", stderr: "No conversation found" };
      }
      return ok({
        structured_output: { score: 1, explanation: "Half right." },
      });
    }, calls),
  });
  const grade = await agent.grade({
    sessionId: "author-1",
    question,
    index: 0,
    total: 1,
    answer: "It retries.",
  });
  assert.deepEqual(grade, { score: 1, explanation: "Half right." });
  assert.equal(calls.length, 2);
  assert.ok(calls[0]?.args.includes("--resume"));
  assert.ok(!calls[1]?.args.includes("--resume"));
});

test("grade rejects a score outside 0-2", async () => {
  const agent = createQuizAgent({
    source: "283",
    cwd: "/repo",
    documentPath: "/repo/review.md",
    run: scriptedRun(() =>
      ok({ structured_output: { score: 3, explanation: "?" } }),
    ),
  });
  const grade = await agent.grade({
    sessionId: undefined,
    question,
    index: 0,
    total: 1,
    answer: "x",
  });
  assert.ok(grade instanceof Error);
});

test("buildPlacePrompt shows prompts and sections but never the answer key", () => {
  const prompt = buildPlacePrompt({
    questions: [{ id: "q1", prompt: question.prompt }],
    sections: [{ id: "install", level: 2, title: "Install", end: 3 }],
    document: "# Review\n\n## Install\n\nThe watchdog.",
  });
  assert.match(prompt, /^diffmap-quiz-place:/);
  assert.match(prompt, /- install \(## Install\)/);
  assert.match(prompt, /### q1\nWhat happens when the install stalls\?/);
  assert.ok(!prompt.includes(question.referenceAnswer));
  assert.ok(!prompt.includes(question.rubric));
});

test("place runs without tools and keeps only known sections", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-place-"));
  const documentPath = path.join(dir, "review.md");
  await fs.writeFile(
    documentPath,
    "# Review\n\n## Install\n\nWatchdog.\n\n## Tests\n\nFakes.\n",
    "utf8",
  );
  const calls: Call[] = [];
  const agent = createQuizAgent({
    source: "283",
    cwd: dir,
    documentPath,
    run: scriptedRun(
      () =>
        ok({
          structured_output: {
            placements: [
              { questionId: "q1", sectionId: "install" },
              { questionId: "q2", sectionId: "nope" },
              { questionId: "q3", sectionId: "" },
              { questionId: "q9", sectionId: "tests" },
            ],
          },
        }),
      calls,
    ),
  });
  const placements = await agent.place([
    { id: "q1", prompt: "a" },
    { id: "q2", prompt: "b" },
    { id: "q3", prompt: "c" },
  ]);
  assert.ok(!(placements instanceof Error));
  assert.deepEqual([...placements], [["q1", "install"]]);
  const args = calls[0]?.args ?? [];
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(!args.includes("--allowedTools"));
});
