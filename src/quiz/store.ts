/**
 * The quiz sidecar: `<doc>.md` -> `<doc>.quiz.json`, beside the comments one.
 *
 * It holds the answer key, so it is read only by the server. Same rules as the
 * comment sidecar: readable JSON, fixed key order, atomic writes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "incur";
import { DiffmapQuizError } from "../errors.js";
import {
  QUIZ_STORE_VERSION,
  emptyQuizStore,
  type QuizAnswer,
  type QuizGeneration,
  type QuizStore,
} from "./types.js";

const nonEmpty = z.string().min(1);

const sourceSchema = z.strictObject({
  ref: nonEmpty,
  title: z.string().optional(),
  url: z.string().optional(),
  headSha: z.string().optional(),
});

const generationSchema = z.strictObject({
  state: z.enum(["generating", "ready", "error"]),
  requestedAt: nonEmpty,
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  sessionId: z.string().optional(),
  source: sourceSchema.optional(),
});

const questionSchema = z.strictObject({
  id: nonEmpty,
  prompt: nonEmpty,
  covers: z.string(),
  rubric: z.string(),
  referenceAnswer: z.string(),
  sectionId: z.string().optional(),
});

const answerSchema = z.strictObject({
  questionId: nonEmpty,
  answer: z.string(),
  submittedAt: nonEmpty,
  state: z.enum(["grading", "graded", "error"]),
  grade: z
    .strictObject({
      score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      explanation: z.string(),
    })
    .optional(),
  error: z.string().optional(),
});

const storeSchema = z.strictObject({
  version: z.literal(QUIZ_STORE_VERSION),
  generation: generationSchema.optional(),
  questions: z.array(questionSchema),
  answers: z.array(answerSchema),
});

/** `review.md` -> `review.quiz.json`. */
export function quizPathFor(filePath: string) {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved);
  const base =
    ext === "" ? path.basename(resolved) : path.basename(resolved, ext);
  return path.join(path.dirname(resolved), `${base}.quiz.json`);
}

export async function readQuizStore(sidecarPath: string) {
  const raw = await fs.readFile(sidecarPath, "utf8").catch((cause: unknown) => {
    if (isMissingFile(cause)) return undefined;
    return new DiffmapQuizError({
      reason: `could not read ${sidecarPath}`,
      cause,
    });
  });
  if (raw instanceof Error) return raw;
  if (raw === undefined) return emptyQuizStore();
  return parseQuizStore(raw, sidecarPath);
}

export function parseQuizStore(raw: string, sidecarPath: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    return new DiffmapQuizError({
      reason: `${sidecarPath} is not valid JSON`,
      cause,
    });
  }
  const parsed = storeSchema.safeParse(value);
  if (!parsed.success) {
    return new DiffmapQuizError({
      reason: `${sidecarPath} does not match the quiz schema (${parsed.error.issues[0]?.message ?? "invalid"})`,
    });
  }
  const data = parsed.data;
  return {
    version: QUIZ_STORE_VERSION,
    generation:
      data.generation === undefined
        ? undefined
        : {
            state: data.generation.state,
            requestedAt: data.generation.requestedAt,
            finishedAt: data.generation.finishedAt,
            error: data.generation.error,
            sessionId: data.generation.sessionId,
            source:
              data.generation.source === undefined
                ? undefined
                : {
                    ref: data.generation.source.ref,
                    title: data.generation.source.title,
                    url: data.generation.source.url,
                    headSha: data.generation.source.headSha,
                  },
          },
    questions: data.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      covers: question.covers,
      rubric: question.rubric,
      referenceAnswer: question.referenceAnswer,
      sectionId: question.sectionId,
    })),
    answers: data.answers.map((answer) => ({
      questionId: answer.questionId,
      answer: answer.answer,
      submittedAt: answer.submittedAt,
      state: answer.state,
      grade: answer.grade,
      error: answer.error,
    })),
  } satisfies QuizStore;
}

export async function writeQuizStore(sidecarPath: string, store: QuizStore) {
  // Write beside the target so the rename stays on one filesystem.
  const tempPath = `${sidecarPath}.${randomUUID().slice(0, 8)}.tmp`;
  const written = await fs
    .writeFile(tempPath, serializeQuizStore(store), "utf8")
    .then(() => fs.rename(tempPath, sidecarPath))
    .catch(async (cause: unknown) => {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      return new DiffmapQuizError({
        reason: `could not write ${sidecarPath}`,
        cause,
      });
    });
  if (written instanceof Error) return written;
  return undefined;
}

/** Fixed key order, two-space indent, trailing newline. */
export function serializeQuizStore(store: QuizStore) {
  return `${JSON.stringify(
    {
      version: QUIZ_STORE_VERSION,
      ...(store.generation === undefined
        ? {}
        : { generation: orderedGeneration(store.generation) }),
      questions: store.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        covers: question.covers,
        rubric: question.rubric,
        referenceAnswer: question.referenceAnswer,
        ...optional("sectionId", question.sectionId),
      })),
      answers: store.answers.map(orderedAnswer),
    },
    undefined,
    2,
  )}\n`;
}

function orderedGeneration(generation: QuizGeneration) {
  return {
    state: generation.state,
    requestedAt: generation.requestedAt,
    ...optional("finishedAt", generation.finishedAt),
    ...optional("error", generation.error),
    ...optional("sessionId", generation.sessionId),
    ...(generation.source === undefined
      ? {}
      : {
          source: {
            ref: generation.source.ref,
            ...optional("title", generation.source.title),
            ...optional("url", generation.source.url),
            ...optional("headSha", generation.source.headSha),
          },
        }),
  };
}

function orderedAnswer(answer: QuizAnswer) {
  return {
    questionId: answer.questionId,
    answer: answer.answer,
    submittedAt: answer.submittedAt,
    state: answer.state,
    ...(answer.grade === undefined
      ? {}
      : {
          grade: {
            score: answer.grade.score,
            explanation: answer.grade.explanation,
          },
        }),
    ...optional("error", answer.error),
  };
}

function optional<K extends string>(key: K, value: string | undefined) {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function isMissingFile(cause: unknown) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
