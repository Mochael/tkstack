/**
 * Quiz wire and storage types. No imports, so the viewer can use them.
 *
 * The rubric and reference answer for each question stay on the server: the
 * viewer only ever receives `QuizSnapshot`, which strips them, so the answer
 * key cannot leak into the page before a question is graded.
 */

export const QUIZ_STORE_VERSION = 1;

/** A grade out of 2: fully right, partially right, or wrong. */
export type QuizScore = 0 | 1 | 2;

export const QUIZ_MAX_SCORE_PER_QUESTION = 2;

export type QuizQuestion = {
  id: string;
  prompt: string;
  /** What part of the change the question covers, shown after grading. */
  covers: string;
  rubric: string;
  referenceAnswer: string;
  /**
   * The document section the question renders after, chosen by a separate
   * placement run that sees the question but not its answer. Unset (or a
   * heading that no longer exists) places it at the end of the document.
   */
  sectionId: string | undefined;
};

export type QuizGrade = {
  score: QuizScore;
  explanation: string;
};

export type QuizAnswer = {
  questionId: string;
  answer: string;
  submittedAt: string;
  state: "grading" | "graded" | "error";
  grade: QuizGrade | undefined;
  error: string | undefined;
};

/** The pull request the quiz was written from. */
export type QuizSourceSummary = {
  ref: string;
  title: string | undefined;
  url: string | undefined;
  headSha: string | undefined;
};

export type QuizGeneration = {
  state: "generating" | "ready" | "error";
  requestedAt: string;
  finishedAt: string | undefined;
  error: string | undefined;
  /** The quiz author's session; grading forks it so it keeps the context. */
  sessionId: string | undefined;
  source: QuizSourceSummary | undefined;
};

export type QuizStore = {
  version: typeof QUIZ_STORE_VERSION;
  generation: QuizGeneration | undefined;
  questions: QuizQuestion[];
  answers: QuizAnswer[];
};

export type QuizAvailability = {
  available: boolean;
  reason: string | undefined;
  /** The configured pull request, e.g. `123` or a PR URL. */
  source: string | undefined;
};

export type PublicQuizQuestion = Pick<
  QuizQuestion,
  "id" | "prompt" | "sectionId"
> & {
  /** Only present once the question has been graded. */
  covers: string | undefined;
};

export type QuizSnapshot = {
  status: QuizAvailability;
  generation:
    | Pick<
        QuizGeneration,
        "state" | "requestedAt" | "finishedAt" | "error" | "source"
      >
    | undefined;
  questions: PublicQuizQuestion[];
  answers: QuizAnswer[];
};

export function emptyQuizStore(): QuizStore {
  return {
    version: QUIZ_STORE_VERSION,
    generation: undefined,
    questions: [],
    answers: [],
  };
}
