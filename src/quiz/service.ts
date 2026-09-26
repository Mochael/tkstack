/**
 * Quiz routes, sidecar persistence, and the author/grader lifecycle.
 *
 * Same shape as the comment service: `handle` returns a plain result so the
 * routes are testable without a socket, and `serve.ts` turns a `stream`
 * result into a Server-Sent Events subscription.
 */

import { z } from "incur";
import { DiffmapQuizError } from "../errors.js";
import type { QuizAgent } from "./agent.js";
import { quizPathFor, readQuizStore, writeQuizStore } from "./store.js";
import type {
  QuizAnswer,
  QuizQuestion,
  QuizSnapshot,
  QuizStore,
} from "./types.js";

export const QUIZ_ROUTE_PREFIX = "/__diffmap/quiz";

export type QuizRouteResponse =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "stream" }
  | { kind: "pass" };

export type QuizListener = (snapshot: QuizSnapshot) => void;

export type QuizService = {
  sidecarPath: string;
  handle: (input: {
    pathname: string;
    method: string;
    body: string;
  }) => Promise<QuizRouteResponse>;
  snapshot: () => Promise<QuizSnapshot | Error>;
  subscribe: (listener: QuizListener) => () => void;
  /** Resolves once generation and every grade in flight have settled. */
  idle: () => Promise<void>;
};

const generateBodySchema = z.strictObject({
  regenerate: z.boolean().optional(),
});

const answerBodySchema = z.strictObject({
  questionId: z.string().min(1),
  answer: z.string().trim().min(1),
});

export function createQuizService(input: {
  filePath: string;
  agent: QuizAgent;
  now?: () => Date;
}): QuizService {
  const sidecarPath = quizPathFor(input.filePath);
  const now = input.now ?? (() => new Date());
  const listeners = new Set<QuizListener>();
  const pending = new Set<Promise<void>>();
  // Work started by this process. Anything the sidecar says is in flight but
  // is not listed here was cut off by a restart.
  let generating = false;
  const grading = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  function timestamp() {
    return now().toISOString();
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  function track(run: Promise<void>) {
    pending.add(run);
    // oxlint-disable-next-line typescript/no-floating-promises -- `idle()` awaits these; failures are logged where they happen.
    void run.finally(() => pending.delete(run));
  }

  function toSnapshot(store: QuizStore): QuizSnapshot {
    const generation = store.generation;
    const interrupted = generation?.state === "generating" && !generating;
    return {
      status: input.agent.status,
      generation:
        generation === undefined
          ? undefined
          : {
              state: interrupted ? "error" : generation.state,
              requestedAt: generation.requestedAt,
              finishedAt: generation.finishedAt,
              error: interrupted
                ? "The quiz was still being written when diffmap stopped."
                : generation.error,
              source: generation.source,
            },
      questions: store.questions.map((question) => {
        const answer = store.answers.find(
          (item) => item.questionId === question.id,
        );
        return {
          id: question.id,
          prompt: question.prompt,
          sectionId: question.sectionId,
          covers: answer?.state === "graded" ? question.covers : undefined,
        };
      }),
      answers: store.answers.map((answer) =>
        answer.state === "grading" && !grading.has(answer.questionId)
          ? {
              ...answer,
              state: "error" as const,
              error: "Grading was cut off when diffmap stopped.",
            }
          : answer,
      ),
    };
  }

  function publish(store: QuizStore) {
    const snapshot = toSnapshot(store);
    for (const listener of listeners) listener(snapshot);
  }

  async function mutate(
    apply: (store: QuizStore) => QuizStore | Error,
  ): Promise<QuizStore | Error> {
    const store = await readQuizStore(sidecarPath);
    if (store instanceof Error) return store;
    const next = apply(store);
    if (next instanceof Error) return next;
    const written = await writeQuizStore(sidecarPath, next);
    if (written instanceof Error) return written;
    publish(next);
    return next;
  }

  function startGeneration() {
    generating = true;
    const run = (async () => {
      const generated = await input.agent.generate();
      const quiz =
        generated instanceof Error
          ? generated
          : { ...generated, questions: await placed(generated.questions) };
      const settled = await enqueue(() =>
        mutate((store) => {
          const requestedAt = store.generation?.requestedAt ?? timestamp();
          if (quiz instanceof Error) {
            return {
              ...store,
              generation: {
                state: "error",
                requestedAt,
                finishedAt: timestamp(),
                error: quiz.message,
                sessionId: undefined,
                source: undefined,
              },
            };
          }
          return {
            ...store,
            generation: {
              state: "ready",
              requestedAt,
              finishedAt: timestamp(),
              error: undefined,
              sessionId: quiz.sessionId,
              source: quiz.source,
            },
            questions: quiz.questions,
            answers: [],
          };
        }),
      );
      generating = false;
      if (settled instanceof Error) {
        console.error(settled.message);
        // Still tell open tabs that the run is over.
        const store = await enqueue(() => readQuizStore(sidecarPath));
        if (!(store instanceof Error)) publish(store);
      }
    })();
    track(run);
  }

  /** Number the questions and place them; placement failing is not fatal. */
  async function placed(
    questions: Omit<QuizQuestion, "id" | "sectionId">[],
  ): Promise<QuizQuestion[]> {
    const numbered = questions.map((question, index) => ({
      ...question,
      id: `q${String(index + 1)}`,
      sectionId: undefined,
    }));
    const placements = await input.agent.place(numbered);
    if (placements instanceof Error) {
      console.error(placements.message);
      return numbered;
    }
    return numbered.map((question) => ({
      ...question,
      sectionId: placements.get(question.id),
    }));
  }

  function startGrading(questionId: string, submittedAt: string) {
    grading.add(questionId);
    const run = (async () => {
      const store = await enqueue(() => readQuizStore(sidecarPath));
      if (store instanceof Error) {
        grading.delete(questionId);
        console.error(store.message);
        return;
      }
      const index = store.questions.findIndex((item) => item.id === questionId);
      const question = store.questions[index];
      const answer = store.answers.find(
        (item) => item.questionId === questionId,
      );
      const grade =
        question === undefined || answer === undefined
          ? new DiffmapQuizError({ reason: `unknown question ${questionId}` })
          : await input.agent.grade({
              sessionId: store.generation?.sessionId,
              question,
              index,
              total: store.questions.length,
              answer: answer.answer,
            });
      const settled = await enqueue(() =>
        mutate((current) => ({
          ...current,
          answers: current.answers.map((item): QuizAnswer => {
            // A retake or regenerate while grading replaces the answer; drop
            // the stale grade instead of writing it onto the new attempt.
            if (
              item.questionId !== questionId ||
              item.submittedAt !== submittedAt
            ) {
              return item;
            }
            return grade instanceof Error
              ? {
                  ...item,
                  state: "error",
                  grade: undefined,
                  error: grade.message,
                }
              : { ...item, state: "graded", grade, error: undefined };
          }),
        })),
      );
      grading.delete(questionId);
      if (settled instanceof Error) console.error(settled.message);
    })();
    track(run);
  }

  async function handle(request: {
    pathname: string;
    method: string;
    body: string;
  }): Promise<QuizRouteResponse> {
    const route = matchQuizRoute(request.pathname);
    if (route === undefined) return { kind: "pass" };
    if (route === "stream") {
      if (request.method !== "GET") return methodNotAllowed();
      return { kind: "stream" };
    }
    if (route === "collection") {
      if (request.method !== "GET") return methodNotAllowed();
      const store = await enqueue(() => readQuizStore(sidecarPath));
      if (store instanceof Error) return failed(store);
      return { kind: "json", status: 200, body: toSnapshot(store) };
    }
    if (request.method !== "POST") return methodNotAllowed();

    if (route === "generate") {
      const parsed = parseBody(request.body, generateBodySchema);
      if (parsed instanceof Error) return badRequest(parsed);
      if (!input.agent.status.available) {
        return {
          kind: "json",
          status: 409,
          body: { error: input.agent.status.reason },
        };
      }
      let started = false;
      const result = await enqueue(() =>
        mutate((store) => {
          if (generating) return store;
          const hasQuiz =
            store.generation?.state === "ready" && store.questions.length > 0;
          if (hasQuiz && parsed.regenerate !== true) return store;
          started = true;
          return {
            ...store,
            generation: {
              state: "generating",
              requestedAt: timestamp(),
              finishedAt: undefined,
              error: undefined,
              sessionId: undefined,
              source: undefined,
            },
            questions: [],
            answers: [],
          };
        }),
      );
      if (result instanceof Error) return failed(result);
      // Flip the flag before the snapshot so it reads "generating".
      if (started) startGeneration();
      return {
        kind: "json",
        status: started ? 202 : 200,
        body: toSnapshot(result),
      };
    }

    if (route === "answers") {
      const parsed = parseBody(request.body, answerBodySchema);
      if (parsed instanceof Error) return badRequest(parsed);
      const submittedAt = timestamp();
      let conflict: string | undefined;
      const result = await enqueue(() =>
        mutate((store) => {
          if (!store.questions.some((item) => item.id === parsed.questionId)) {
            return new DiffmapQuizError({
              reason: `unknown question ${parsed.questionId}`,
            });
          }
          const existing = store.answers.find(
            (item) => item.questionId === parsed.questionId,
          );
          const retry =
            existing?.state === "error" ||
            (existing?.state === "grading" && !grading.has(parsed.questionId));
          if (existing !== undefined && !retry) {
            conflict = "That question has already been answered.";
            return store;
          }
          const answer: QuizAnswer = {
            questionId: parsed.questionId,
            answer: parsed.answer,
            submittedAt,
            state: "grading",
            grade: undefined,
            error: undefined,
          };
          return {
            ...store,
            answers: [
              ...store.answers.filter(
                (item) => item.questionId !== parsed.questionId,
              ),
              answer,
            ],
          };
        }),
      );
      if (result instanceof Error) return failed(result);
      if (conflict !== undefined) {
        return { kind: "json", status: 409, body: { error: conflict } };
      }
      startGrading(parsed.questionId, submittedAt);
      return { kind: "json", status: 202, body: toSnapshot(result) };
    }

    if (route === "place") {
      // Re-place the same questions, e.g. after the document was rewritten.
      const store = await enqueue(() => readQuizStore(sidecarPath));
      if (store instanceof Error) return failed(store);
      if (store.questions.length === 0) {
        return { kind: "json", status: 409, body: { error: "No quiz yet." } };
      }
      const placements = await input.agent.place(store.questions);
      if (placements instanceof Error) return failed(placements);
      const result = await enqueue(() =>
        mutate((current) => ({
          ...current,
          questions: current.questions.map((question) => ({
            ...question,
            sectionId: placements.get(question.id),
          })),
        })),
      );
      if (result instanceof Error) return failed(result);
      return { kind: "json", status: 200, body: toSnapshot(result) };
    }

    // route === "reset": retake the same questions.
    const result = await enqueue(() =>
      mutate((store) => ({ ...store, answers: [] })),
    );
    if (result instanceof Error) return failed(result);
    return { kind: "json", status: 200, body: toSnapshot(result) };
  }

  return {
    sidecarPath,
    handle,
    async snapshot() {
      const store = await enqueue(() => readQuizStore(sidecarPath));
      if (store instanceof Error) return store;
      return toSnapshot(store);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async idle() {
      await queue.catch(() => undefined);
      while (pending.size > 0) {
        await Promise.all(pending).catch(() => undefined);
      }
      await queue.catch(() => undefined);
    },
  };
}

type QuizRoute =
  | "collection"
  | "stream"
  | "generate"
  | "answers"
  | "place"
  | "reset";

export function matchQuizRoute(pathname: string): QuizRoute | undefined {
  if (pathname === QUIZ_ROUTE_PREFIX) return "collection";
  if (!pathname.startsWith(`${QUIZ_ROUTE_PREFIX}/`)) return undefined;
  const rest = pathname.slice(QUIZ_ROUTE_PREFIX.length + 1);
  if (
    rest === "stream" ||
    rest === "generate" ||
    rest === "answers" ||
    rest === "place" ||
    rest === "reset"
  ) {
    return rest;
  }
  return undefined;
}

function parseBody<T extends z.ZodType>(body: string, schema: T) {
  let value: unknown;
  try {
    value = body.trim() === "" ? {} : JSON.parse(body);
  } catch (cause) {
    return new DiffmapQuizError({ reason: "request body is not JSON", cause });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new DiffmapQuizError({
      reason: `invalid request body${issue === undefined ? "" : ` (${issue.path.join(".")} ${issue.message})`}`,
    });
  }
  return parsed.data as z.infer<T>;
}

function badRequest(error: Error): QuizRouteResponse {
  return { kind: "json", status: 400, body: { error: error.message } };
}

function failed(error: Error): QuizRouteResponse {
  const status = error.message.includes("unknown question") ? 404 : 500;
  return { kind: "json", status, body: { error: error.message } };
}

function methodNotAllowed(): QuizRouteResponse {
  return { kind: "json", status: 405, body: { error: "method not allowed" } };
}
