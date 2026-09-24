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
  resolveAnchor,
  textHash,
  type ResolvedAnchor,
} from "../../comments/anchor.js";
import type {
  CommentTarget,
  CommentThread,
  CommentsSnapshot,
} from "../../comments/types.js";
import {
  collectDomBlocks,
  findDomBlock,
  rangeForOffsets,
  type DomBlock,
} from "./domBlocks.js";

export const COMMENTS_ENDPOINT = "/__diffmap/comments";
const HIGHLIGHT_NAME = "diffmap-comment";
const ACTIVE_HIGHLIGHT_NAME = "diffmap-comment-active";

export type ResolvedThread = {
  thread: CommentThread;
  anchor: ResolvedAnchor;
};

export type CommentsState = {
  threads: ResolvedThread[];
  agent: CommentsSnapshot["agent"];
  error: string | undefined;
  blocks: DomBlock[];
  createThread: (input: {
    target: CommentTarget;
    body: string;
    askAgent: boolean;
  }) => Promise<void>;
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
    return paintHighlights(threads, blocks, input.activeThreadId);
  }, [input.enabled, threads, blocks, input.activeThreadId]);

  const send = useCallback(async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch((cause: unknown) => cause as Error);
    if (response instanceof Error) {
      setError(response.message);
      return;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(payload.error ?? `Request failed (${String(response.status)})`);
      return;
    }
    setError(undefined);
  }, []);

  return {
    threads,
    agent: snapshot.agent,
    error,
    blocks,
    createThread: useCallback(
      async (created) => await send(COMMENTS_ENDPOINT, created),
      [send],
    ),
    reply: useCallback(
      async (replied) =>
        await send(
          `${COMMENTS_ENDPOINT}/${encodeURIComponent(replied.threadId)}/reply`,
          { body: replied.body, askAgent: replied.askAgent },
        ),
      [send],
    ),
    setStatus: useCallback(
      async (next) =>
        await send(
          `${COMMENTS_ENDPOINT}/${encodeURIComponent(next.threadId)}/resolve`,
          { status: next.status },
        ),
      [send],
    ),
  };
}

export function selectionTarget(input: {
  block: DomBlock;
  start: number;
  length: number;
}): CommentTarget {
  const quote = input.block.block.text.slice(
    input.start,
    input.start + input.length,
  );
  return {
    kind: "text",
    surface: {
      type: "block",
      tag: input.block.block.tag,
      index: input.block.block.index,
      blockHash: input.block.block.hash,
    },
    selection: {
      start: input.start,
      length: input.length,
      hash: textHash(quote),
      quote,
    },
  };
}

export function threadQuote(thread: CommentThread) {
  return thread.target.kind === "text"
    ? thread.target.selection.quote
    : undefined;
}

function anchorFor(thread: CommentThread, blocks: DomBlock[]): ResolvedAnchor {
  if (thread.target.kind === "document") return { status: "document" };
  if (blocks.length === 0) return { status: "stale" };
  return resolveAnchor({
    surface: thread.target.surface,
    selection: thread.target.selection,
    blocks: blocks.map((block) => block.block),
  });
}

/**
 * Highlights use the CSS Custom Highlight API so the rendered prose is never
 * mutated. Browsers without it simply show no highlight.
 */
function paintHighlights(
  threads: ResolvedThread[],
  blocks: DomBlock[],
  activeThreadId: string | undefined,
) {
  const registry = highlightRegistry();
  if (registry === undefined) return;
  const ranges: Range[] = [];
  const activeRanges: Range[] = [];
  for (const entry of threads) {
    if (entry.thread.status === "resolved") continue;
    if (
      entry.anchor.status !== "exact" &&
      entry.anchor.status !== "relocated"
    ) {
      continue;
    }
    const domBlock = findDomBlock(blocks, entry.anchor.block);
    if (domBlock === undefined) continue;
    const range = rangeForOffsets(
      domBlock,
      entry.anchor.start,
      entry.anchor.length,
    );
    if (range === undefined) continue;
    if (entry.thread.threadId === activeThreadId) activeRanges.push(range);
    else ranges.push(range);
  }
  registry.set(HIGHLIGHT_NAME, ranges);
  registry.set(ACTIVE_HIGHLIGHT_NAME, activeRanges);
  return () => {
    registry.delete(HIGHLIGHT_NAME);
    registry.delete(ACTIVE_HIGHLIGHT_NAME);
  };
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
