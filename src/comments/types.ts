/**
 * Comment threads live in a JSON sidecar next to the served markdown file and
 * are local only: the gist build never sees these types at runtime.
 *
 * The anchor model mirrors dev.fast Review. A text target names the block that
 * contains the selection (tag + ordinal + content hash) plus the offset, length
 * and quoted text inside that block. Line numbers are deliberately absent: the
 * served markdown is regenerated constantly, so every line number moves.
 */

export const COMMENT_STORE_VERSION = 1;

export type CommentSurface =
  | { type: "document"; documentHash: string }
  | { type: "block"; tag: string; index: number; blockHash: string };

export type CommentSelection = {
  start: number;
  length: number;
  hash: string;
  quote: string;
};

/** One end of a selection that spans blocks: the part of that block selected. */
export type CommentRangeEnd = {
  surface: CommentSurface;
  selection: CommentSelection;
};

/**
 * `document` with a quote is a selection in content that cannot be anchored
 * (code excerpts, diffs): the quote is kept for display but never resolved.
 * `range` spans blocks; each end resolves on its own, and `quote` is the whole
 * selected text, for display and for the agent only.
 */
export type CommentTarget =
  | { kind: "document"; quote?: string }
  | { kind: "text"; surface: CommentSurface; selection: CommentSelection }
  | {
      kind: "range";
      start: CommentRangeEnd;
      end: CommentRangeEnd;
      quote: string;
    };

export type CommentRole = "reader" | "agent";

export type CommentMessage = {
  id: string;
  by: string;
  at: string;
  role: CommentRole;
  body: string;
};

export type CommentAgentState = "pending" | "done" | "error";

export type CommentAgentRun = {
  state: CommentAgentState;
  requestedAt: string;
  /** The command the dispatcher ran, kept for debugging a failed run. */
  command: string[];
  error: string | undefined;
};

export type CommentThread = {
  threadId: string;
  target: CommentTarget;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
  messages: CommentMessage[];
  agent: CommentAgentRun | undefined;
};

export type CommentStore = {
  version: number;
  threads: CommentThread[];
};

/** Capability report so the viewer can disable Ask AI instead of failing on click. */
export type CommentAgentStatus = {
  available: boolean;
  reason: string | undefined;
};

export type CommentsSnapshot = {
  threads: CommentThread[];
  agent: CommentAgentStatus;
};

/** The text a target quotes, if any. */
export function targetQuote(target: CommentTarget) {
  if (target.kind === "text") return target.selection.quote;
  return target.quote;
}

export function emptyCommentStore(): CommentStore {
  return { version: COMMENT_STORE_VERSION, threads: [] };
}
