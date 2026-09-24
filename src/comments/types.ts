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

export type CommentTarget =
  | { kind: "document" }
  | { kind: "text"; surface: CommentSurface; selection: CommentSelection };

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

export function emptyCommentStore(): CommentStore {
  return { version: COMMENT_STORE_VERSION, threads: [] };
}
