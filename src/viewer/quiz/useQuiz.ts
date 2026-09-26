import { useCallback, useEffect, useState } from "react";
import type { QuizSnapshot } from "../../quiz/types.js";

const QUIZ_ENDPOINT = "/__diffmap/quiz";

const EMPTY: QuizSnapshot = {
  status: { available: false, reason: undefined, source: undefined },
  generation: undefined,
  questions: [],
  answers: [],
};

export type QuizState = ReturnType<typeof useQuiz>;

/** Quiz state for the viewer, kept live over the quiz event stream. */
export function useQuiz(input: { enabled: boolean }) {
  const [snapshot, setSnapshot] = useState<QuizSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  // Unsent answers and opened results live here, not in the panel, so they
  // survive closing and reopening it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!input.enabled) return;
    const source = new EventSource(`${QUIZ_ENDPOINT}/stream`);
    source.addEventListener("quiz", (event) => {
      // SAFETY: the diffmap server is the only publisher on this stream.
      setSnapshot(JSON.parse(event.data) as QuizSnapshot);
      setLoaded(true);
      setError(undefined);
    });
    source.addEventListener("error", () => {
      setError("Lost the quiz stream. Reload to reconnect.");
    });
    return () => source.close();
  }, [input.enabled]);

  const send = useCallback(async (route: string, body: unknown) => {
    const response = await fetch(`${QUIZ_ENDPOINT}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch((cause: unknown) => cause as Error);
    if (response instanceof Error) {
      setError(response.message);
      return false;
    }
    // SAFETY: the quiz routes answer with a snapshot or `{error}`.
    const payload = (await response.json().catch(() => ({}))) as
      | QuizSnapshot
      | { error?: string };
    if (!response.ok) {
      setError(
        ("error" in payload ? payload.error : undefined) ??
          `Request failed (${String(response.status)})`,
      );
      return false;
    }
    setSnapshot(payload as QuizSnapshot);
    setError(undefined);
    return true;
  }, []);

  return {
    ...snapshot,
    loaded,
    error,
    generate: useCallback(
      async (regenerate: boolean) => {
        const ok = await send("generate", { regenerate });
        if (ok && regenerate) {
          setDrafts({});
          setRevealed(new Set());
        }
        return ok;
      },
      [send],
    ),
    answer: useCallback(
      (questionId: string, answer: string) =>
        send("answers", { questionId, answer }),
      [send],
    ),
    place: useCallback(() => send("place", {}), [send]),
    reset: useCallback(async () => {
      const ok = await send("reset", {});
      if (ok) setRevealed(new Set());
      return ok;
    }, [send]),
    drafts,
    setDraft: useCallback((questionId: string, value: string) => {
      setDrafts((current) => ({ ...current, [questionId]: value }));
    }, []),
    revealed,
    setRevealed: useCallback((questionId: string, open: boolean) => {
      setRevealed((current) => {
        if (current.has(questionId) === open) return current;
        const next = new Set(current);
        if (open) next.add(questionId);
        else next.delete(questionId);
        return next;
      });
    }, []),
    revealAll: useCallback((questionIds: readonly string[]) => {
      setRevealed(new Set(questionIds));
    }, []),
  };
}
