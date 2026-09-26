/**
 * The quiz author and grader.
 *
 * The quiz exists to measure whether the review document helped a reader
 * understand the pull request, so it must not be written by the agent that
 * wrote the document. Both runs here are fresh headless `claude -p` sessions:
 * the author reads the pull request itself (never the document), and each
 * grade forks the author's session so the grader keeps what the author
 * learned about the code without inheriting anything from the document.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "incur";
import {
  runAgentCommand,
  type AgentCommand,
  type RunAgentCommand,
} from "../comments/agent.js";
import { DiffmapQuizError } from "../errors.js";
import { parseViewerDocument } from "../parseViewer.js";
import { documentSections, type DocumentSection } from "./sections.js";
import type {
  QuizAvailability,
  QuizGrade,
  QuizQuestion,
  QuizSourceSummary,
} from "./types.js";

export const QUIZ_GENERATE_TIMEOUT_MS = 15 * 60 * 1_000;
export const QUIZ_GRADE_TIMEOUT_MS = 5 * 60 * 1_000;
export const QUIZ_PLACE_TIMEOUT_MS = 5 * 60 * 1_000;
const GH_TIMEOUT_MS = 60 * 1_000;
/** Roughly 50k tokens; larger diffs are truncated and fetched with tools. */
export const QUIZ_DIFF_CHAR_LIMIT = 200_000;

/** Read-only tools: the author may read the repo and the PR, nothing else. */
const QUIZ_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const QUIZ_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(gh pr view:*)",
  "Bash(gh pr diff:*)",
  "Bash(git show:*)",
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git grep:*)",
  "Bash(git ls-tree:*)",
  "Bash(git fetch:*)",
];

export type PullRequestContext = {
  ref: string;
  number: number | undefined;
  title: string;
  url: string | undefined;
  body: string;
  baseRefName: string | undefined;
  headRefName: string | undefined;
  baseSha: string | undefined;
  headSha: string | undefined;
  files: { path: string; additions: number; deletions: number }[];
  diff: string;
};

export type GeneratedQuiz = {
  sessionId: string | undefined;
  source: QuizSourceSummary;
  questions: Omit<QuizQuestion, "id" | "sectionId">[];
};

export type QuizAgent = {
  status: QuizAvailability;
  generate: () => Promise<GeneratedQuiz | DiffmapQuizError>;
  grade: (input: {
    sessionId: string | undefined;
    question: QuizQuestion;
    index: number;
    total: number;
    answer: string;
  }) => Promise<QuizGrade | DiffmapQuizError>;
  /** Question id -> the section it renders after; absent means the end. */
  place: (
    questions: readonly Pick<QuizQuestion, "id" | "prompt">[],
  ) => Promise<Map<string, string> | DiffmapQuizError>;
};

const questionSchema = z.object({
  prompt: z.string().min(1),
  covers: z.string().min(1),
  referenceAnswer: z.string().min(1),
  rubric: z.string().min(1),
});

const quizOutputSchema = z.object({
  questions: z.array(questionSchema).min(1),
});

const placeOutputSchema = z.object({
  placements: z.array(
    z.object({ questionId: z.string(), sectionId: z.string() }),
  ),
});

const gradeOutputSchema = z.object({
  score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  explanation: z.string().min(1),
});

/** JSON Schemas handed to `claude --json-schema`, mirroring the zod ones. */
export const QUIZ_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          covers: { type: "string" },
          referenceAnswer: { type: "string" },
          rubric: { type: "string" },
        },
        required: ["prompt", "covers", "referenceAnswer", "rubric"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export const PLACE_JSON_SCHEMA = {
  type: "object",
  properties: {
    placements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionId: { type: "string" },
          sectionId: { type: "string" },
        },
        required: ["questionId", "sectionId"],
        additionalProperties: false,
      },
    },
  },
  required: ["placements"],
  additionalProperties: false,
};

export const GRADE_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", enum: [0, 1, 2] },
    explanation: { type: "string" },
  },
  required: ["score", "explanation"],
  additionalProperties: false,
};

const pullRequestSchema = z.object({
  number: z.number().optional(),
  title: z.string(),
  url: z.string().optional(),
  body: z.string().optional(),
  baseRefName: z.string().optional(),
  headRefName: z.string().optional(),
  baseRefOid: z.string().optional(),
  headRefOid: z.string().optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    )
    .optional(),
});

const claudeResultSchema = z.object({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  session_id: z.string().optional(),
  structured_output: z.unknown().optional(),
});

export function buildQuizPrompt(pr: PullRequestContext) {
  const diff =
    pr.diff.length > QUIZ_DIFF_CHAR_LIMIT
      ? `${pr.diff.slice(0, QUIZ_DIFF_CHAR_LIMIT)}\n\n[diff truncated at ${String(QUIZ_DIFF_CHAR_LIMIT)} characters; read the rest with \`gh pr diff ${pr.ref}\` or \`git show\`]`
      : pr.diff;
  const files = pr.files
    .map(
      (file) =>
        `- ${file.path} (+${String(file.additions)}/-${String(file.deletions)})`,
    )
    .join("\n");
  return `diffmap-quiz: write a comprehension quiz for a reviewer of this pull request.

Someone else wrote a review document that explains this pull request to a human reviewer. Your quiz measures whether that document actually left the reviewer understanding the change. So write the quiz from the change itself: you have not seen the document, and you must not look for it or open walkthrough links.

The reviewer takes the quiz open book, with the review document and the code in front of them. Recall of names, or trivia a search would turn up, tells us nothing. Test whether they understand the change well enough to reason with it.

Understanding a pull request usually means knowing:
- the problems it addresses, and why they happened
- how the solution works: the moving parts and how they interact at runtime
- the edge cases and failure modes worth knowing about
- what is tested, and what important behavior is not
- real issues or risks in the change
- what else in the system behaves differently now

Treat that list as areas to consider, not a template. Write the questions this particular change calls for, and skip areas that don't matter for it. Prefer questions that make the reviewer apply what they understand (predict what happens in a concrete scenario, say whether a situation is handled and how, explain why a piece of the design is needed) over questions answered by quoting one sentence.

How many questions: as few as it takes to cover the whole change, with no two questions testing the same understanding. A small, focused change may need one or two questions; a large one may need up to about eight. Every significant part of the change should be exercised by some question.

Ground every answer in the code. Read the files; don't trust the description where it and the code disagree. Each question should be answerable in a few sentences.

Don't give the answer away in the question. Asking the reviewer to find a risk and then naming the risk to look at tests nothing, and neither does listing the conditions you want them to recall. Describe the situation and let them supply the reasoning.

For each question return:
- prompt: the question exactly as the reviewer sees it. Concrete and self-contained. Inline \`code\` is fine; no headings.
- covers: a short label for the part of the change it exercises, e.g. "retry backoff after a failed install".
- referenceAnswer: a complete, correct answer, in a few sentences.
- rubric: what a 2/2 answer must contain, what earns 1/2, and what is 0/2.

## The pull request

Ref: ${pr.ref}${pr.url === undefined ? "" : `\nURL: ${pr.url}`}
Title: ${pr.title}${pr.baseRefName === undefined ? "" : `\nBase branch: ${pr.baseRefName}${pr.baseSha === undefined ? "" : ` (${pr.baseSha})`}`}${pr.headRefName === undefined ? "" : `\nHead branch: ${pr.headRefName}${pr.headSha === undefined ? "" : ` (${pr.headSha})`}`}

The working directory is a checkout of the repository, but it may not be at the head of this pull request. Read files at the head with \`git show ${pr.headSha ?? "<head sha>"}:<path>\` (run \`git fetch\` first if the commit is missing), and surrounding code the same way. The diff below is only this pull request's own change.

### Files changed
${files === "" ? "(unknown)" : files}

### Description
${pr.body.trim() === "" ? "(none)" : pr.body.trim()}

### Diff
\`\`\`diff
${diff}
\`\`\`
`;
}

export function buildGradePrompt(input: {
  question: QuizQuestion;
  index: number;
  total: number;
  answer: string;
  /** Set when there is no author session to fork. */
  sourceRef: string | undefined;
}) {
  const context =
    input.sourceRef === undefined
      ? ""
      : `You are grading a quiz about pull request ${input.sourceRef}. Look at the change with \`gh pr diff\` / \`git show\` if you need to check a claim.\n\n`;
  return `diffmap-quiz-grade: grade the reviewer's answer to question ${String(input.index + 1)} of ${String(input.total)} of the quiz.

${context}Question:
${input.question.prompt}

Reference answer:
${input.question.referenceAnswer}

Rubric:
${input.question.rubric}

The reviewer's answer:
${input.answer}

Score it out of 2:
- 2: fully right. It has everything the rubric requires, and nothing it says is wrong in a way that matters.
- 1: partly right. The core idea is there but something the rubric requires is missing, or part of it is wrong.
- 0: wrong, missing the point, or empty.

Judge substance, not wording, style or length. The reviewer had the code and a review document open. If they make a claim beyond the reference answer, check it against the code: credit correct insight, and count confident wrong claims against them.

explanation: two to five sentences, addressed to the reviewer as "you": what they got right, what was missing or wrong, and the key point to take away. If they got it fully right, say so briefly instead of restating the reference answer.
`;
}

/**
 * Placement is the one run that reads the document. It sees each question's
 * prompt but never its answer or rubric, and it only chooses where the
 * question appears, so it cannot tilt the quiz toward the document.
 */
export function buildPlacePrompt(input: {
  questions: readonly Pick<QuizQuestion, "id" | "prompt">[];
  sections: readonly DocumentSection[];
  document: string;
}) {
  const sections = input.sections
    .map(
      (section) =>
        `- ${section.id} (${"#".repeat(section.level)} ${section.title})`,
    )
    .join("\n");
  const questions = input.questions
    .map((question) => `### ${question.id}\n${question.prompt}`)
    .join("\n\n");
  const document =
    input.document.length > QUIZ_DIFF_CHAR_LIMIT
      ? `${input.document.slice(0, QUIZ_DIFF_CHAR_LIMIT)}\n\n[document truncated]`
      : input.document;
  return `diffmap-quiz-place: place quiz questions inside a review document.

A reviewer reads the document below from top to bottom and answers each quiz question inline, where it appears. For each question, pick the section after which it should appear: the section that explains what the question asks about, so the reviewer has just read the relevant material when they reach it. If a question draws on several sections, pick the last of them. If no section fits, use "" and it will appear at the end of the document.

Only choose positions. Do not answer, rewrite or judge the questions.

Return one placement per question, using a section id from this list exactly:
${sections === "" ? "(no sections)" : sections}

## Questions

${questions}

## The document

${document}
`;
}

/** Drop the review walkthrough link and bot-generated summaries. */
export function cleanPullRequestBody(body: string) {
  return body
    .replace(/<!--\s*([\w:-]+)\s*-->[\s\S]*?<!--\s*\/\1\s*-->/g, "")
    .split("\n")
    .filter((line) => !/diffmap\.dev|gist\.github\.com/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function claudeQuizCommand(input: {
  prompt: string;
  cwd: string;
  schema: object;
  model: string | undefined;
  resumeSessionId: string | undefined;
  documentPath: string;
  /** Placement reads only what is in its prompt. */
  tools?: boolean;
}): AgentCommand {
  // Keep the review document, and its comment and quiz sidecars, unreadable.
  const documentGlob = path.join(
    path.dirname(input.documentPath),
    `${path.basename(input.documentPath, path.extname(input.documentPath))}.*`,
  );
  return {
    executable: "claude",
    args: [
      ...(input.resumeSessionId === undefined
        ? []
        : ["--resume", input.resumeSessionId, "--fork-session"]),
      "-p",
      input.prompt,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(input.schema),
      "--permission-mode",
      "dontAsk",
      "--tools",
      ...(input.tools === false
        ? [""]
        : [
            QUIZ_TOOLS.join(","),
            "--allowedTools",
            QUIZ_ALLOWED_TOOLS.join(","),
            "--disallowedTools",
            `Read(/${input.documentPath}),Read(/${documentGlob})`,
          ]),
      ...(input.model === undefined ? [] : ["--model", input.model]),
    ],
    cwd: input.cwd,
  };
}

export function createQuizAgent(input: {
  /** A pull request `gh` understands: a number, URL or branch. */
  source: string | undefined;
  cwd: string;
  documentPath: string;
  model?: string;
  run?: RunAgentCommand;
}): QuizAgent {
  const run = input.run ?? runAgentCommand;
  const source = input.source?.trim();
  const status: QuizAvailability =
    source === undefined || source === ""
      ? {
          available: false,
          reason:
            "No pull request to quiz on. Start diffmap with --quiz-pr <number|url> or set DIFFMAP_QUIZ_PR.",
          source: undefined,
        }
      : { available: true, reason: undefined, source };

  async function runClaude(command: AgentCommand, timeoutMs: number) {
    const output = await run({ ...command, timeoutMs });
    if (output instanceof Error) {
      return new DiffmapQuizError({ reason: output.message, cause: output });
    }
    const parsed = parseClaudeOutput(output.stdout);
    if (parsed instanceof Error || output.code !== 0) {
      const detail =
        (parsed instanceof Error ? undefined : parsed.result) ??
        (output.stderr.trim() || output.stdout.trim().slice(0, 500));
      return new DiffmapQuizError({
        reason: `claude exited with code ${String(output.code)}${detail === "" ? "" : `: ${detail}`}`,
      });
    }
    if (parsed.is_error === true) {
      return new DiffmapQuizError({
        reason: parsed.result ?? "claude reported an error",
      });
    }
    return parsed;
  }

  async function loadPullRequest(ref: string) {
    const viewed = await run({
      executable: "gh",
      args: [
        "pr",
        "view",
        ref,
        "--json",
        "number,title,url,body,baseRefName,headRefName,baseRefOid,headRefOid,files",
      ],
      cwd: input.cwd,
      timeoutMs: GH_TIMEOUT_MS,
    });
    if (viewed instanceof Error || viewed.code !== 0) {
      return new DiffmapQuizError({
        reason: `gh pr view ${ref} failed: ${viewed instanceof Error ? viewed.message : viewed.stderr.trim()}`,
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(viewed.stdout);
    } catch (cause) {
      return new DiffmapQuizError({
        reason: "gh pr view returned invalid JSON",
        cause,
      });
    }
    const meta = pullRequestSchema.safeParse(json);
    if (!meta.success) {
      return new DiffmapQuizError({
        reason: "gh pr view returned an unexpected shape",
      });
    }
    const diffed = await run({
      executable: "gh",
      args: ["pr", "diff", ref],
      cwd: input.cwd,
      timeoutMs: GH_TIMEOUT_MS,
    });
    if (diffed instanceof Error || diffed.code !== 0) {
      return new DiffmapQuizError({
        reason: `gh pr diff ${ref} failed: ${diffed instanceof Error ? diffed.message : diffed.stderr.trim()}`,
      });
    }
    const pr: PullRequestContext = {
      ref,
      number: meta.data.number,
      title: meta.data.title,
      url: meta.data.url,
      body: cleanPullRequestBody(meta.data.body ?? ""),
      baseRefName: meta.data.baseRefName,
      headRefName: meta.data.headRefName,
      baseSha: meta.data.baseRefOid,
      headSha: meta.data.headRefOid,
      files: meta.data.files ?? [],
      diff: diffed.stdout,
    };
    return pr;
  }

  return {
    status,
    async generate() {
      if (source === undefined || !status.available) {
        return new DiffmapQuizError({
          reason: status.reason ?? "no pull request configured",
        });
      }
      const pr = await loadPullRequest(source);
      if (pr instanceof Error) return pr;
      const result = await runClaude(
        claudeQuizCommand({
          prompt: buildQuizPrompt(pr),
          cwd: input.cwd,
          schema: QUIZ_JSON_SCHEMA,
          model: input.model,
          resumeSessionId: undefined,
          documentPath: input.documentPath,
        }),
        QUIZ_GENERATE_TIMEOUT_MS,
      );
      if (result instanceof Error) return result;
      const quiz = quizOutputSchema.safeParse(result.structured_output);
      if (!quiz.success) {
        return new DiffmapQuizError({
          reason: `the quiz author returned an unexpected shape (${quiz.error.issues[0]?.message ?? "invalid"})`,
        });
      }
      return {
        sessionId: result.session_id,
        source: {
          ref: source,
          title: pr.title,
          url: pr.url,
          headSha: pr.headSha,
        },
        questions: quiz.data.questions,
      };
    },
    async grade(request) {
      const attempt = async (resumeSessionId: string | undefined) =>
        await runClaude(
          claudeQuizCommand({
            prompt: buildGradePrompt({
              question: request.question,
              index: request.index,
              total: request.total,
              answer: request.answer,
              sourceRef: resumeSessionId === undefined ? source : undefined,
            }),
            cwd: input.cwd,
            schema: GRADE_JSON_SCHEMA,
            model: input.model,
            resumeSessionId,
            documentPath: input.documentPath,
          }),
          QUIZ_GRADE_TIMEOUT_MS,
        );
      let result = await attempt(request.sessionId);
      // The author session can be gone (pruned, or another machine); grade
      // from a fresh session with the rubric rather than failing.
      if (result instanceof Error && request.sessionId !== undefined) {
        result = await attempt(undefined);
      }
      if (result instanceof Error) return result;
      const grade = gradeOutputSchema.safeParse(result.structured_output);
      if (!grade.success) {
        return new DiffmapQuizError({
          reason: `the grader returned an unexpected shape (${grade.error.issues[0]?.message ?? "invalid"})`,
        });
      }
      return { score: grade.data.score, explanation: grade.data.explanation };
    },
    async place(questions) {
      const markdown = await fs.readFile(input.documentPath, "utf8").catch(
        (cause: unknown) =>
          new DiffmapQuizError({
            reason: `could not read ${input.documentPath}`,
            cause,
          }),
      );
      if (markdown instanceof Error) return markdown;
      const parsed = parseViewerDocument(markdown, input.documentPath);
      if (parsed instanceof Error) {
        return new DiffmapQuizError({ reason: parsed.message, cause: parsed });
      }
      const sections = documentSections(parsed);
      if (sections.length === 0 || questions.length === 0) return new Map();
      const result = await runClaude(
        claudeQuizCommand({
          prompt: buildPlacePrompt({ questions, sections, document: markdown }),
          cwd: input.cwd,
          schema: PLACE_JSON_SCHEMA,
          model: input.model,
          resumeSessionId: undefined,
          documentPath: input.documentPath,
          tools: false,
        }),
        QUIZ_PLACE_TIMEOUT_MS,
      );
      if (result instanceof Error) return result;
      const output = placeOutputSchema.safeParse(result.structured_output);
      if (!output.success) {
        return new DiffmapQuizError({
          reason: "the placement run returned an unexpected shape",
        });
      }
      const known = new Set(sections.map((section) => section.id));
      const ids = new Set(questions.map((question) => question.id));
      return new Map(
        output.data.placements
          .filter(
            (placement) =>
              ids.has(placement.questionId) && known.has(placement.sectionId),
          )
          .map((placement) => [placement.questionId, placement.sectionId]),
      );
    },
  };
}

function parseClaudeOutput(stdout: string) {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (cause) {
    return new DiffmapQuizError({
      reason: "claude did not return JSON",
      cause,
    });
  }
  const parsed = claudeResultSchema.safeParse(json);
  if (!parsed.success) {
    return new DiffmapQuizError({
      reason: "claude returned an unexpected result shape",
    });
  }
  return parsed.data;
}
