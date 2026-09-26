import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DiffmapQuizError } from "../errors.js";
import type { GeneratedQuiz, QuizAgent } from "./agent.js";
import {
  createQuizService,
  matchQuizRoute,
  type QuizRouteResponse,
} from "./service.js";
import { readQuizStore } from "./store.js";
import type { QuizGrade, QuizSnapshot } from "./types.js";

const generated: GeneratedQuiz = {
  sessionId: "author-1",
  source: { ref: "283", title: "Updates", url: undefined, headSha: "abc" },
  questions: [
    {
      prompt: "What does the watchdog do?",
      covers: "install watchdog",
      rubric: "2: redownloads after 30s.",
      referenceAnswer: "It redownloads after 30s.",
    },
    {
      prompt: "Why block downgrades?",
      covers: "downgrade guard",
      rubric: "2: explains the guard.",
      referenceAnswer: "So an older feed cannot replace a newer build.",
    },
  ],
};

function fakeAgent(
  options: {
    available?: boolean;
    generate?: () => Promise<GeneratedQuiz | DiffmapQuizError>;
    grade?: QuizAgent["grade"];
    place?: QuizAgent["place"];
  } = {},
): QuizAgent {
  const available = options.available ?? true;
  return {
    status: {
      available,
      reason: available ? undefined : "no pr",
      source: available ? "283" : undefined,
    },
    generate:
      options.generate ?? (async () => await Promise.resolve(generated)),
    grade:
      options.grade ??
      (async () =>
        await Promise.resolve<QuizGrade>({ score: 2, explanation: "Right." })),
    place:
      options.place ??
      (async () => await Promise.resolve(new Map([["q1", "install"]]))),
  };
}

async function harness(agent: QuizAgent) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-quiz-"));
  const filePath = path.join(dir, "review.md");
  await fs.writeFile(filePath, "# Review\n", "utf8");
  let clock = 0;
  const service = createQuizService({
    filePath,
    agent,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (clock += 1))),
  });
  const post = async (route: string, body: unknown = {}) =>
    await service.handle({
      pathname: `/__diffmap/quiz/${route}`,
      method: "POST",
      body: JSON.stringify(body),
    });
  return { dir, filePath, service, post };
}

function snapshotOf(result: QuizRouteResponse) {
  assert.equal(result.kind, "json");
  return (result as { body: QuizSnapshot }).body;
}

test("matchQuizRoute recognizes the quiz routes only", () => {
  assert.equal(matchQuizRoute("/__diffmap/quiz"), "collection");
  assert.equal(matchQuizRoute("/__diffmap/quiz/stream"), "stream");
  assert.equal(matchQuizRoute("/__diffmap/quiz/answers"), "answers");
  assert.equal(matchQuizRoute("/__diffmap/quiz/nope"), undefined);
  assert.equal(matchQuizRoute("/__diffmap/comments"), undefined);
});

test("generate writes the quiz and never sends the answer key", async () => {
  const { service, post, filePath } = await harness(fakeAgent());
  const started = await post("generate");
  assert.equal(started.kind === "json" && started.status, 202);
  assert.equal(snapshotOf(started).generation?.state, "generating");
  await service.idle();
  const snapshot = await service.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.equal(snapshot.generation?.state, "ready");
  assert.deepEqual(
    snapshot.questions.map((question) => question.id),
    ["q1", "q2"],
  );
  const wire = JSON.stringify(snapshot);
  assert.ok(!wire.includes("redownloads after 30s"));
  assert.ok(!wire.includes("install watchdog"));
  // The key is on disk for the grader.
  const store = await readQuizStore(filePath.replace(/\.md$/, ".quiz.json"));
  assert.ok(!(store instanceof Error));
  assert.equal(
    store.questions[0]?.referenceAnswer,
    "It redownloads after 30s.",
  );
  assert.equal(store.generation?.sessionId, "author-1");
});

test("generate keeps an existing quiz unless asked to regenerate", async () => {
  let runs = 0;
  const { service, post } = await harness(
    fakeAgent({
      generate: async () => {
        runs += 1;
        return await Promise.resolve(generated);
      },
    }),
  );
  await post("generate");
  await service.idle();
  const again = await post("generate");
  assert.equal(again.kind === "json" && again.status, 200);
  await post("generate", { regenerate: true });
  await service.idle();
  assert.equal(runs, 2);
});

test("a failed generation is reported on the snapshot", async () => {
  const { service, post } = await harness(
    fakeAgent({
      generate: async () =>
        await Promise.resolve(new DiffmapQuizError({ reason: "gh failed" })),
    }),
  );
  await post("generate");
  await service.idle();
  const snapshot = await service.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.equal(snapshot.generation?.state, "error");
  assert.match(snapshot.generation?.error ?? "", /gh failed/);
});

test("generate is refused when no pull request is configured", async () => {
  const { post } = await harness(fakeAgent({ available: false }));
  const result = await post("generate");
  assert.equal(result.kind === "json" && result.status, 409);
});

test("answers are graded, then reveal what the question covered", async () => {
  const grades: Parameters<QuizAgent["grade"]>[0][] = [];
  const { service, post } = await harness(
    fakeAgent({
      grade: async (input) => {
        grades.push(input);
        return await Promise.resolve<QuizGrade>({
          score: 1,
          explanation: "Partly.",
        });
      },
    }),
  );
  await post("generate");
  await service.idle();
  const submitted = await post("answers", {
    questionId: "q1",
    answer: "  It retries.  ",
  });
  assert.equal(snapshotOf(submitted).answers[0]?.state, "grading");
  await service.idle();
  assert.equal(grades[0]?.sessionId, "author-1");
  assert.equal(grades[0]?.answer, "It retries.");
  assert.equal(grades[0]?.total, 2);
  const snapshot = await service.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.deepEqual(snapshot.answers[0]?.grade, {
    score: 1,
    explanation: "Partly.",
  });
  assert.equal(snapshot.questions[0]?.covers, "install watchdog");
  assert.equal(snapshot.questions[1]?.covers, undefined);
});

test("an answered question is locked; a failed grade can be resubmitted", async () => {
  let fail = true;
  const { service, post } = await harness(
    fakeAgent({
      grade: async () => {
        if (fail) {
          return await Promise.resolve(
            new DiffmapQuizError({ reason: "timed out" }),
          );
        }
        return await Promise.resolve<QuizGrade>({
          score: 2,
          explanation: "Yes.",
        });
      },
    }),
  );
  await post("generate");
  await service.idle();
  await post("answers", { questionId: "q1", answer: "first" });
  await service.idle();
  let snapshot = await service.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.equal(snapshot.answers[0]?.state, "error");
  fail = false;
  await post("answers", { questionId: "q1", answer: "second" });
  await service.idle();
  snapshot = await service.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.equal(snapshot.answers[0]?.state, "graded");
  const locked = await post("answers", { questionId: "q1", answer: "third" });
  assert.equal(locked.kind === "json" && locked.status, 409);
  const unknown = await post("answers", { questionId: "q9", answer: "x" });
  assert.equal(unknown.kind === "json" && unknown.status, 404);
});

test("a grade that lands after a retake is dropped", async () => {
  const started = deferred();
  const release = deferred();
  const { service, post } = await harness(
    fakeAgent({
      grade: async () => {
        started.resolve();
        await release.promise;
        return { score: 2, explanation: "Late." };
      },
    }),
  );
  await post("generate");
  await service.idle();
  await post("answers", { questionId: "q1", answer: "first" });
  await started.promise;
  await post("reset");
  release.resolve();
  await service.idle();
  const snapshot = await service.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.deepEqual(snapshot.answers, []);
});

function deferred() {
  let resolve: () => void = noop;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: () => resolve() };
}

function noop() {}

test("work cut off by a restart reads as an error", async () => {
  const { filePath, post, service } = await harness(fakeAgent());
  await post("generate");
  await service.idle();
  const sidecar = filePath.replace(/\.md$/, ".quiz.json");
  const store = JSON.parse(await fs.readFile(sidecar, "utf8"));
  store.answers = [
    {
      questionId: "q1",
      answer: "x",
      submittedAt: "2026-01-01T00:00:00.000Z",
      state: "grading",
    },
  ];
  await fs.writeFile(sidecar, JSON.stringify(store), "utf8");
  const restarted = createQuizService({ filePath, agent: fakeAgent() });
  const snapshot = await restarted.snapshot();
  assert.ok(!(snapshot instanceof Error));
  assert.equal(snapshot.answers[0]?.state, "error");
  // And it can be answered again.
  const retried = await restarted.handle({
    pathname: "/__diffmap/quiz/answers",
    method: "POST",
    body: JSON.stringify({ questionId: "q1", answer: "again" }),
  });
  assert.equal(retried.kind === "json" && retried.status, 202);
  await restarted.idle();
});

test("questions carry their placement; a failed placement puts them at the end", async () => {
  const placedHarness = await harness(fakeAgent());
  await placedHarness.post("generate");
  await placedHarness.service.idle();
  const placed = await placedHarness.service.snapshot();
  assert.ok(!(placed instanceof Error));
  assert.deepEqual(
    placed.questions.map((question) => question.sectionId),
    ["install", undefined],
  );

  const failing = await harness(
    fakeAgent({
      place: async () =>
        await Promise.resolve(new DiffmapQuizError({ reason: "timed out" })),
    }),
  );
  await failing.post("generate");
  await failing.service.idle();
  const unplaced = await failing.service.snapshot();
  assert.ok(!(unplaced instanceof Error));
  assert.equal(unplaced.generation?.state, "ready");
  assert.deepEqual(
    unplaced.questions.map((question) => question.sectionId),
    [undefined, undefined],
  );
});

test("place re-places existing questions and keeps answers", async () => {
  let target = "install";
  const { service, post } = await harness(
    fakeAgent({
      place: async () => await Promise.resolve(new Map([["q2", target]])),
    }),
  );
  await post("generate");
  await service.idle();
  await post("answers", { questionId: "q1", answer: "kept" });
  await service.idle();
  target = "tests";
  const placed = snapshotOf(await post("place"));
  assert.deepEqual(
    placed.questions.map((question) => question.sectionId),
    [undefined, "tests"],
  );
  assert.equal(placed.answers[0]?.answer, "kept");
});
