import { Fragment, forwardRef, type ReactNode } from "react";
import {
  Button,
  Checklist,
  Close,
  DotsHorizontal,
  Menu,
  MenuItem,
  MenuTrigger,
  colors,
  flex,
  radius,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import {
  QUIZ_MAX_SCORE_PER_QUESTION,
  type PublicQuizQuestion,
  type QuizAnswer,
} from "../../quiz/types.js";
import type { QuizState } from "./useQuiz.js";

/**
 * The reader quiz, rendered inside the document so the Diff panel and code
 * stay in view. Questions come from a separate model that read the pull
 * request, not this document; a placement run then put each one after the
 * section it is about. Each answer is graded out of 2 as soon as it is
 * submitted, but the grade stays folded until the reader opens it, one
 * question at a time or all at once from the summary at the end.
 */

export function quizQuestionElementId(questionId: string) {
  return `diffmap-quiz-${questionId}`;
}

/**
 * The end of the document: what the quiz is doing, progress, Reveal all,
 * the total, and Retake / Write a new quiz.
 */
export const QuizSummary = forwardRef<
  HTMLElement,
  {
    quiz: QuizState;
    /** Questions with no matching section, rendered here instead. */
    unplaced: ReactNode;
    onClose: () => void;
  }
>(function QuizSummary(props, ref) {
  const { quiz } = props;
  const box = useStyles(styles.summaryBox);
  const header = useStyles(styles.header);
  const title = useStyles(styles.title);
  const headerEnd = useStyles(styles.headerEnd);
  const note = useStyles(styles.note);
  const errorClass = useStyles(styles.error);
  const source = useStyles(styles.source);
  const generation = quiz.generation;
  const ready = generation?.state === "ready" && quiz.questions.length > 0;

  return (
    <section
      ref={ref}
      id="diffmap-quiz"
      className={box}
      data-diffmap-quiz=""
      aria-label="Quiz"
    >
      <div className={header}>
        <span className={title}>
          <Checklist size="sm" />
          Quiz
        </span>
        <div className={headerEnd}>
          {ready && (
            <MenuTrigger placement="bottom end">
              <Button variant="quiet" aria-label="Quiz actions">
                <DotsHorizontal size="sm" />
              </Button>
              <Menu
                onAction={(key) => {
                  if (key === "retake") {
                    if (!window.confirm("Clear your answers and retake?")) {
                      return;
                    }
                    // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface here through the hook.
                    void quiz.reset();
                    return;
                  }
                  if (key === "place") {
                    // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface here through the hook.
                    void quiz.place();
                    return;
                  }
                  if (
                    !window.confirm("Discard this quiz and write a new one?")
                  ) {
                    return;
                  }
                  // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface here through the hook.
                  void quiz.generate(true);
                }}
              >
                <MenuItem id="retake">Retake quiz</MenuItem>
                <MenuItem id="place">
                  Re-place questions in the document
                </MenuItem>
                <MenuItem id="regenerate">Write a new quiz</MenuItem>
              </Menu>
            </MenuTrigger>
          )}
          <Button
            variant="quiet"
            aria-label="Hide quiz"
            onClick={props.onClose}
          >
            <Close size="sm" />
          </Button>
        </div>
      </div>
      {quiz.error !== undefined && (
        <div className={errorClass}>{quiz.error}</div>
      )}
      {!quiz.status.available ? (
        <div className={note}>
          {quiz.status.reason ??
            "Start diffmap with --quiz-pr <number|url> to quiz on a pull request."}
        </div>
      ) : generation === undefined || generation.state === "generating" ? (
        <div className={note}>
          Writing your quiz… A separate model is reading pull request{" "}
          {quiz.status.source} (not this document) and writing questions that
          cover it, then placing each one after the section it is about. Keep
          reading; the questions appear in the document when they are ready.
        </div>
      ) : generation.state === "error" || quiz.questions.length === 0 ? (
        <div className={note}>
          <strong>The quiz could not be written.</strong>{" "}
          {generation.error ?? "It came back empty."}{" "}
          <Button
            variant="primary"
            onClick={() => {
              // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface here through the hook.
              void quiz.generate(true);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className={note}>
            {quiz.questions.length}{" "}
            {quiz.questions.length === 1 ? "question" : "questions"}, placed in
            the document next to what they ask about. Open book: use the
            document and the code. Each answer is graded out of{" "}
            {QUIZ_MAX_SCORE_PER_QUESTION} when you submit it; results stay
            folded until you open them.
            {generation.source?.url !== undefined && (
              <>
                {" "}
                <a
                  className={source}
                  href={generation.source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {generation.source.title ?? generation.source.ref}
                </a>
              </>
            )}
          </div>
          {props.unplaced}
          <QuizProgress quiz={quiz} />
        </>
      )}
    </section>
  );
});

function QuizProgress(props: { quiz: QuizState }) {
  const { quiz } = props;
  const footer = useStyles(styles.footer);
  const progress = useStyles(styles.progress);
  const total = useStyles(styles.total);
  const questionCount = quiz.questions.length;
  const answered = quiz.answers.length;
  const allGraded = quiz.questions.every(
    (question) => answerFor(quiz, question.id)?.state === "graded",
  );
  const allRevealed =
    allGraded &&
    quiz.questions.every((question) => quiz.revealed.has(question.id));
  const points = quiz.answers.reduce(
    (sum, answer) => sum + (answer.grade?.score ?? 0),
    0,
  );
  return (
    <div className={footer}>
      {allRevealed ? (
        <div className={total}>
          Score: {points}/{questionCount * QUIZ_MAX_SCORE_PER_QUESTION}
        </div>
      ) : (
        <span className={progress}>
          {answered} of {questionCount} answered
          {answered === questionCount && !allGraded ? " · grading…" : ""}
        </span>
      )}
      {allGraded && !allRevealed && (
        <Button
          variant="primary"
          onClick={() => quiz.revealAll(quiz.questions.map((item) => item.id))}
        >
          Reveal all results
        </Button>
      )}
    </div>
  );
}

export function QuizQuestionCard(props: {
  quiz: QuizState;
  question: PublicQuizQuestion;
  index: number;
  total: number;
}) {
  const { quiz, question } = props;
  const card = useStyles(styles.card);
  const label = useStyles(styles.label);
  const prompt = useStyles(styles.prompt);
  const field = useStyles(styles.field);
  const actions = useStyles(styles.actions);
  const hint = useStyles(styles.hint);
  const submitted = useStyles(styles.submitted);
  const status = useStyles(styles.status);
  const failed = useStyles(styles.failed);
  const answer = answerFor(quiz, question.id);
  const draft = quiz.drafts[question.id] ?? answer?.answer ?? "";
  const editable = answer === undefined || answer.state === "error";

  function submit() {
    if (draft.trim() === "") return;
    // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface in the quiz summary through the hook.
    void quiz.answer(question.id, draft.trim());
  }

  return (
    <section
      id={quizQuestionElementId(question.id)}
      className={card}
      data-state={answer?.state ?? "open"}
      data-diffmap-quiz=""
      aria-label={`Quiz question ${String(props.index + 1)}`}
    >
      <div className={label}>
        <Checklist size="sm" />
        Quiz · question {props.index + 1} of {props.total}
      </div>
      <div className={prompt}>{inlineMarkdown(question.prompt)}</div>
      {editable ? (
        <>
          {answer?.state === "error" && (
            <div className={failed}>
              Grading failed: {answer.error ?? "unknown error"}. Submit again.
            </div>
          )}
          <textarea
            className={field}
            value={draft}
            rows={4}
            placeholder="Your answer"
            aria-label={`Answer to question ${String(props.index + 1)}`}
            onChange={(event) => quiz.setDraft(question.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
                return;
              }
              event.preventDefault();
              submit();
            }}
          />
          <div className={actions}>
            <span className={hint}>⌘↩ to submit</span>
            <Button
              variant="primary"
              isDisabled={draft.trim() === ""}
              onClick={submit}
            >
              Submit
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={submitted}>{answer.answer}</div>
          {answer.state === "grading" && <div className={status}>Grading…</div>}
          {answer.state === "graded" && answer.grade !== undefined && (
            <GradeDetails quiz={quiz} question={question} answer={answer} />
          )}
        </>
      )}
    </section>
  );
}

function GradeDetails(props: {
  quiz: QuizState;
  question: PublicQuizQuestion;
  answer: QuizAnswer;
}) {
  const { quiz, question, answer } = props;
  const details = useStyles(styles.details);
  const result = useStyles(styles.result);
  const summary = useStyles(styles.summary);
  const score = useStyles(styles.score);
  const covers = useStyles(styles.covers);
  const explanation = useStyles(styles.explanation);
  const open = quiz.revealed.has(question.id);
  const grade = answer.grade;
  if (grade === undefined) return undefined;
  return (
    <details
      className={details}
      open={open}
      onToggle={(event) =>
        quiz.setRevealed(question.id, event.currentTarget.open)
      }
    >
      <summary className={summary}>
        {open ? "Hide result" : "Graded · show result"}
      </summary>
      <div className={result}>
        <div className={score} data-score={grade.score}>
          {grade.score}/{QUIZ_MAX_SCORE_PER_QUESTION}
        </div>
        {question.covers !== undefined && (
          <div className={covers}>Covers: {question.covers}</div>
        )}
        <div className={explanation}>{inlineMarkdown(grade.explanation)}</div>
      </div>
    </details>
  );
}

function answerFor(quiz: QuizState, questionId: string) {
  return quiz.answers.find((answer) => answer.questionId === questionId);
}

/** Paragraphs and inline `code`; the quiz author is told to keep to that. */
function inlineMarkdown(value: string): ReactNode {
  return value
    .split(/\n{2,}/)
    .map((paragraph, index) => (
      <p key={index}>
        {paragraph
          .split(/(`[^`\n]+`)/)
          .map((part, partIndex) =>
            part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
              <code key={partIndex}>{part.slice(1, -1)}</code>
            ) : (
              <Fragment key={partIndex}>{part}</Fragment>
            ),
          )}
      </p>
    ));
}

const styles = {
  summaryBox: style(
    flex({ direction: "column", gap: 3 }),
    radius.md,
    spacing.padding({ x: 4, y: 4 }),
    {
      // Sits in the viewer's prose grid, beside the document column.
      gridColumn: "2 / 3",
      marginTop: "48px",
      border: `1px solid ${colors.blue[6]}`,
      backgroundColor: colors.blue[2],
      "& p": { margin: 0 },
    },
  ),
  note: style(text({ size: "sm", color: "lowContrast" }), { lineHeight: 1.5 }),
  card: style(
    flex({ direction: "column", gap: 2 }),
    radius.md,
    spacing.padding({ x: 4, y: 3 }),
    {
      margin: "24px 0",
      border: `1px solid ${colors.blue[6]}`,
      borderLeftWidth: "3px",
      backgroundColor: colors.blue[2],
      scrollMarginTop: "16px",
      "& p": { margin: 0 },
    },
  ),
  label: style(
    flex({ direction: "row", alignItems: "center", gap: 1 }),
    text({ size: "xs", fontWeight: 600 }),
    {
      color: colors.blue[11],
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    },
  ),
  header: style(flex({ direction: "row", alignItems: "center", gap: 2 }), {
    justifyContent: "space-between",
  }),
  headerEnd: style(flex({ direction: "row", alignItems: "center", gap: 1 })),
  title: style(
    flex({ direction: "row", alignItems: "center", gap: 2 }),
    text({ size: "md", fontWeight: 600, color: "highContrast" }),
  ),
  error: style(text({ size: "xs" }), { color: colors.red[11] }),
  source: style({ color: colors.blue[11] }),
  prompt: style(text({ size: "sm", color: "highContrast" }), {
    lineHeight: 1.5,
    "& p": { margin: "0 0 8px" },
    "& p:last-child": { marginBottom: 0 },
    "& code": {
      fontSize: "12px",
      padding: "1px 4px",
      borderRadius: "4px",
      backgroundColor: colors.gray[3],
    },
  }),
  field: style(radius.md, spacing.padding({ x: 2, y: 2 }), {
    width: "100%",
    minHeight: "96px",
    resize: "vertical",
    border: `1px solid ${colors.gray[6]}`,
    outline: "none",
    font: "inherit",
    fontSize: "14px",
    lineHeight: 1.5,
    color: colors.gray[12],
    backgroundColor: "transparent",
    "&:focus": { borderColor: colors.blue[8] },
  }),
  actions: style(flex({ direction: "row", alignItems: "center", gap: 2 }), {
    justifyContent: "space-between",
  }),
  hint: style(text({ size: "xs", color: "lowContrast" })),
  submitted: style(
    text({ size: "sm" }),
    radius.md,
    spacing.padding({ x: 2, y: 2 }),
    {
      whiteSpace: "pre-wrap",
      color: colors.gray[12],
      backgroundColor: colors.gray[3],
    },
  ),
  status: style(text({ size: "xs", color: "lowContrast" })),
  failed: style(text({ size: "xs" }), { color: colors.red[11] }),
  details: style({
    "&[open] > summary": { marginBottom: "8px" },
  }),
  // <details> ignores display: flex in some engines; lay out the body here.
  result: style(flex({ direction: "column", alignItems: "start", gap: 2 })),
  summary: style(text({ size: "xs", color: "lowContrast" }), {
    cursor: "pointer",
    listStylePosition: "inside",
  }),
  score: style(text({ size: "sm", fontWeight: 600 }), {
    alignSelf: "flex-start",
    padding: "2px 8px",
    borderRadius: "999px",
    "&[data-score='2']": {
      color: colors.green[11],
      backgroundColor: colors.green[3],
    },
    "&[data-score='1']": {
      color: colors.amber[11],
      backgroundColor: colors.amber[3],
    },
    "&[data-score='0']": {
      color: colors.red[11],
      backgroundColor: colors.red[3],
    },
  }),
  covers: style(text({ size: "xs", color: "lowContrast" })),
  explanation: style(text({ size: "sm" }), {
    lineHeight: 1.5,
    color: colors.gray[12],
    "& p": { margin: "0 0 8px" },
    "& p:last-child": { marginBottom: 0 },
    "& code": {
      fontSize: "12px",
      padding: "1px 4px",
      borderRadius: "4px",
      backgroundColor: colors.gray[3],
    },
  }),
  footer: style(flex({ direction: "row", alignItems: "center", gap: 2 }), {
    justifyContent: "space-between",
    paddingTop: "4px",
  }),
  progress: style(text({ size: "xs", color: "lowContrast" })),
  total: style(text({ size: "md", fontWeight: 600, color: "highContrast" })),
};
