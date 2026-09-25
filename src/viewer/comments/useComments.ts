/**
 * Local comment state for the viewer: the thread list, live updates over
 * Server-Sent Events, anchor resolution against the rendered prose and the
 * highlight overlay. Only ever mounted in the local viewer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import {
  normalizeBlockText,
  resolveTarget,
  textHash,
  type AnchoredSpan,
  type ResolvedTarget,
} from "../../comments/anchor.js";
import {
  targetQuote,
  type CommentRangeEnd,
  type CommentTarget,
  type CommentThread,
  type CommentsSnapshot,
} from "../../comments/types.js";
import {
  collectDomBlocks,
  findDomBlock,
  rangeForSpans,
  spansForSelection,
  type DomBlock,
  type DomSpan,
} from "./domBlocks.js";

export const COMMENTS_ENDPOINT = "/__diffmap/comments";
const HIGHLIGHT_NAME = "diffmap-comment";
const ACTIVE_HIGHLIGHT_NAME = "diffmap-comment-active";

export type ResolvedThread = {
  thread: CommentThread;
  anchor: ResolvedTarget;
};

export type CommentsState = {
  threads: ResolvedThread[];
  agent: CommentsSnapshot["agent"];
  error: string | undefined;
  blocks: DomBlock[];
  /** Resolves to the new thread's id, or undefined if the request failed. */
  createThread: (input: {
    target: CommentTarget;
    body: string;
    askAgent: boolean;
  }) => Promise<string | undefined>;
  reply: (input: {
    threadId: string;
    body: string;
    askAgent: boolean;
  }) => Promise<void>;
  setStatus: (input: {
    threadId: string;
    status: "open" | "resolved";
  }) => Promise<void>;
};

export function useComments(input: {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  activeThreadId: string | undefined;
  onActivate: (threadId: string) => void;
}): CommentsState {
  const [snapshot, setSnapshot] = useState<CommentsSnapshot>({
    threads: [],
    agent: { available: false, reason: undefined },
  });
  const [error, setError] = useState<string>();
  const [blocks, setBlocks] = useState<DomBlock[]>([]);

  // The served markdown is rewritten under open tabs, and Vite swaps the
  // rendered document in place, so the prose is re-read whenever it mutates.
  useEffect(() => {
    if (!input.enabled) return;
    const container = input.containerRef.current;
    if (container === null) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setBlocks(collectDomBlocks(container));
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(read);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [input.enabled, input.containerRef]);

  useEffect(() => {
    if (!input.enabled) return;
    const source = new EventSource(`${COMMENTS_ENDPOINT}/stream`);
    source.addEventListener("threads", (event) => {
      // SAFETY: the diffmap server is the only publisher on this stream.
      setSnapshot(JSON.parse(event.data) as CommentsSnapshot);
      setError(undefined);
    });
    source.addEventListener("error", () => {
      setError("Lost the comment stream. Reload to reconnect.");
    });
    return () => source.close();
  }, [input.enabled]);

  const threads = useMemo(
    () =>
      snapshot.threads.map((thread) => ({
        thread,
        anchor: anchorFor(thread, blocks),
      })),
    [snapshot.threads, blocks],
  );

  useEffect(() => {
    if (!input.enabled) return;
    const container = input.containerRef.current;
    if (container === null) return;
    return paintHighlights(
      threads,
      blocks,
      input.activeThreadId,
      container,
      input.onActivate,
    );
  }, [
    input.enabled,
    threads,
    blocks,
    input.activeThreadId,
    input.containerRef,
    input.onActivate,
  ]);

  const send = useCallback(async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch((cause: unknown) => cause as Error);
    if (response instanceof Error) {
      setError(response.message);
      return undefined;
    }
    // SAFETY: the diffmap server answers these routes with `{thread}` or `{error}`.
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      thread?: CommentThread;
    };
    if (!response.ok) {
      setError(payload.error ?? `Request failed (${String(response.status)})`);
      return undefined;
    }
    setError(undefined);
    return payload.thread;
  }, []);

  return {
    threads,
    agent: snapshot.agent,
    error,
    blocks,
    createThread: useCallback(
      async (created) => (await send(COMMENTS_ENDPOINT, created))?.threadId,
      [send],
    ),
    reply: useCallback(
      async (replied) => {
        await send(
          `${COMMENTS_ENDPOINT}/${encodeURIComponent(replied.threadId)}/reply`,
          { body: replied.body, askAgent: replied.askAgent },
        );
      },
      [send],
    ),
    setStatus: useCallback(
      async (next) => {
        await send(
          `${COMMENTS_ENDPOINT}/${encodeURIComponent(next.threadId)}/resolve`,
          { status: next.status },
        );
      },
      [send],
    ),
  };
}

/** Longest quote stored for a range or an unanchored selection. */
const MAX_QUOTE_LENGTH = 600;

/**
 * The target for a live selection: one block, a range across blocks, or, for
 * content that cannot be anchored (code excerpts, diffs), an unanchored
 * comment that still keeps the quote.
 */
export function selectionTarget(
  blocks: DomBlock[],
  range: Range,
): CommentTarget | undefined {
  const spans = spansForSelection(blocks, range);
  if (spans === undefined) {
    const quote = clipQuote(normalizeBlockText(range.toString()));
    return quote === "" ? undefined : { kind: "document", quote };
  }
  if (spans.from === spans.to) {
    return { kind: "text", ...rangeEnd(spans.from) };
  }
  const start = rangeEnd(spans.from);
  const end = rangeEnd(spans.to);
  return {
    kind: "range",
    start,
    end,
    quote: clipQuote(rangeQuote(blocks, spans.from, spans.to)),
  };
}

/** The selected text block by block, so adjacent blocks do not run together. */
function rangeQuote(blocks: DomBlock[], from: DomSpan, to: DomSpan) {
  const first = blocks.indexOf(from.block);
  const last = blocks.indexOf(to.block);
  const parts: string[] = [];
  let outer: HTMLElement | undefined;
  for (const [index, block] of blocks.entries()) {
    if (index < first || index > last) continue;
    // A nested list item's text is already in its parent's.
    if (outer?.contains(block.element) === true) continue;
    outer = block.element;
    const text = block.block.text;
    if (block === from.block) parts.push(text.slice(from.start));
    else if (block === to.block)
      parts.push(text.slice(0, to.start + to.length));
    else parts.push(text);
  }
  return normalizeBlockText(parts.join(" "));
}

function rangeEnd(span: DomSpan): CommentRangeEnd {
  const quote = span.block.block.text.slice(
    span.start,
    span.start + span.length,
  );
  return {
    surface: {
      type: "block",
      tag: span.block.block.tag,
      index: span.block.block.index,
      blockHash: span.block.block.hash,
    },
    selection: {
      start: span.start,
      length: span.length,
      hash: textHash(quote),
      quote,
    },
  };
}

function clipQuote(quote: string) {
  if (quote.length <= MAX_QUOTE_LENGTH) return quote;
  const half = Math.floor(MAX_QUOTE_LENGTH / 2);
  return `${quote.slice(0, half).trimEnd()} … ${quote.slice(-half).trimStart()}`;
}

export function threadQuote(thread: CommentThread) {
  return targetQuote(thread.target);
}

function anchorFor(thread: CommentThread, blocks: DomBlock[]): ResolvedTarget {
  if (thread.target.kind === "document") return { status: "document" };
  if (blocks.length === 0) return { status: "stale" };
  return resolveTarget(
    thread.target,
    blocks.map((block) => block.block),
  );
}

/**
 * Highlights use the CSS Custom Highlight API so the rendered prose is never
 * mutated. Browsers without it simply show no highlight.
 */
function paintHighlights(
  threads: ResolvedThread[],
  blocks: DomBlock[],
  activeThreadId: string | undefined,
  container: HTMLElement,
  onActivate: (threadId: string) => void,
) {
  const registry = highlightRegistry();
  if (registry === undefined) return;
  const ranges: Range[] = [];
  const activeRanges: Range[] = [];
  const threadRanges: { threadId: string; range: Range }[] = [];
  for (const entry of threads) {
    if (entry.thread.status === "resolved") continue;
    if (
      entry.anchor.status !== "exact" &&
      entry.anchor.status !== "relocated"
    ) {
      continue;
    }
    const from = domSpan(blocks, entry.anchor.from);
    const to = domSpan(blocks, entry.anchor.to);
    if (from === undefined || to === undefined) continue;
    const range = rangeForSpans(from, to);
    if (range === undefined) continue;
    threadRanges.push({ threadId: entry.thread.threadId, range });
    if (entry.thread.threadId === activeThreadId) activeRanges.push(range);
    else ranges.push(range);
  }
  registry.set(HIGHLIGHT_NAME, ranges);
  registry.set(ACTIVE_HIGHLIGHT_NAME, activeRanges);
  const onClick = (event: MouseEvent) => {
    // Leave text selection, modified clicks and embedded controls alone.
    if (
      event.button !== 0 ||
      event.detail !== 1 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      window.getSelection()?.isCollapsed === false
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        "a, button, input, textarea, select, [contenteditable]",
      )
    )
      return;
    // Use individual text rectangles so wrapped lines and cross-block ranges
    // do not make the whitespace between highlighted text clickable.
    const matches = threadRanges.filter(({ range }) =>
      Array.from(range.getClientRects()).some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.left &&
          event.clientX < rect.right &&
          event.clientY >= rect.top &&
          event.clientY < rect.bottom,
      ),
    );
    const hit =
      matches.find(({ threadId }) => threadId === activeThreadId) ?? matches[0];
    if (hit !== undefined) onActivate(hit.threadId);
  };
  container.addEventListener("click", onClick);
  return () => {
    container.removeEventListener("click", onClick);
    registry.delete(HIGHLIGHT_NAME);
    registry.delete(ACTIVE_HIGHLIGHT_NAME);
  };
}

function domSpan(blocks: DomBlock[], span: AnchoredSpan): DomSpan | undefined {
  const block = findDomBlock(blocks, span.block);
  if (block === undefined) return undefined;
  return { block, start: span.start, length: span.length };
}
type HighlightRegistry = {
  set: (name: string, ranges: Range[]) => void;
  delete: (name: string) => void;
};

function highlightRegistry(): HighlightRegistry | undefined {
  // SAFETY: the Custom Highlight API is not in the ambient DOM types yet.
  const css = (globalThis as { CSS?: Record<string, unknown> }).CSS;
  const highlights = css?.["highlights"] as
    | {
        set: (name: string, value: unknown) => void;
        delete: (name: string) => void;
      }
    | undefined;
  const Constructor = (
    globalThis as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (highlights === undefined || Constructor === undefined) return undefined;
  return {
    set(name, ranges) {
      if (ranges.length === 0) {
        highlights.delete(name);
        return;
      }
      highlights.set(name, new Constructor(...ranges));
    },
    delete(name) {
      highlights.delete(name);
    },
  };
}
