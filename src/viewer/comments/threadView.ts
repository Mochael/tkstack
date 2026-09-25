import { threadQuote, type ResolvedThread } from "./useComments.js";

export type ThreadStatus = "open" | "asking" | "failed" | "resolved";

/** One word for a thread's state, as shown in the list. */
export function threadStatus(entry: ResolvedThread): ThreadStatus {
  const thread = entry.thread;
  if (thread.status === "resolved") return "resolved";
  if (thread.agent?.state === "pending") return "asking";
  if (agentFailed(entry)) return "failed";
  return "open";
}

/**
 * The last Ask AI run failed and nothing has been said since, so the failure
 * is still the thread's latest event. A newer message supersedes it.
 */
export function agentFailed(entry: ResolvedThread) {
  const agent = entry.thread.agent;
  if (agent?.state !== "error") return false;
  const last = entry.thread.messages.at(-1);
  return last === undefined || last.at <= agent.requestedAt;
}

/** Why a thread might not be where the reader expects it, if anything. */
export function anchorNote(entry: ResolvedThread): string | undefined {
  if (entry.anchor.status === "stale") return "stale anchor";
  if (entry.anchor.status === "relocated") return "moved";
  if (
    entry.thread.target.kind === "document" &&
    threadQuote(entry.thread) !== undefined
  ) {
    return "not anchored";
  }
  return undefined;
}

/** `now`, `12m`, `3h`, `2d`, then a date. */
export function relativeTime(value: string, now = Date.now()) {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return value;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
