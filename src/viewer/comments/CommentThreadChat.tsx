import { useEffect, useRef } from "react";
import { border, colors, flex, spacing, text } from "maui";
import { style, useStyles } from "purse-styles";
import type { CommentAgentStatus } from "../../comments/types.js";
import { CommentComposer } from "./CommentComposer.tsx";
import type { ResolvedThread } from "./useComments.js";
import { agentFailed, anchorNote, relativeTime } from "./threadView.js";

/**
 * One thread as a chat: the quoted context on top, the reader's messages as
 * right-aligned bubbles, the agent's as full-width prose, and the composer
 * docked at the bottom. With no `entry` it is a new thread being started.
 */
export function CommentThreadChat(props: {
  entry: ResolvedThread | undefined;
  quote: string | undefined;
  agent: CommentAgentStatus;
  onSubmit: (input: { body: string; askAgent: boolean }) => void;
  onCancel?: () => void;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const chat = useStyles(styles.chat);
  const context = useStyles(styles.context);
  const bar = useStyles(styles.bar);
  const quoteText = useStyles(styles.quoteText);
  const noteClass = useStyles(styles.note);
  const transcript = useStyles(styles.transcript);
  const user = useStyles(styles.user);
  const bubble = useStyles(styles.bubble);
  const agentMessage = useStyles(styles.agent);
  const prose = useStyles(styles.prose);
  const caption = useStyles(styles.caption);
  const status = useStyles(styles.status);
  const dot = useStyles(styles.dot);
  const line = useStyles(styles.line);
  const composer = useStyles(styles.composer);
  const thread = props.entry?.thread;
  const note = props.entry === undefined ? undefined : anchorNote(props.entry);
  const pending = thread?.agent?.state === "pending";
  const messageCount = thread?.messages.length ?? 0;

  // Keep the newest message in view as replies arrive.
  useEffect(() => {
    if (messageCount === 0 && !pending) return;
    const element = transcriptRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [messageCount, pending]);

  return (
    <div className={chat}>
      <div className={context}>
        <i className={bar} aria-hidden="true" />
        <span className={quoteText}>{props.quote ?? "Whole document"}</span>
      </div>
      {note !== undefined && (
        <div className={noteClass}>
          {note === "stale anchor"
            ? "The quoted text is no longer in the document."
            : note === "moved"
              ? "The quoted text moved; the highlight follows it."
              : "This content cannot be highlighted; the quote is kept as written."}
        </div>
      )}
      <div ref={transcriptRef} className={transcript}>
        {thread?.messages.map((message) => {
          const label = `${message.by} · ${relativeTime(message.at)}`;
          return message.role === "agent" ? (
            <div key={message.id} className={agentMessage}>
              <div className={prose}>{message.body}</div>
              <span className={caption}>{label}</span>
            </div>
          ) : (
            <div key={message.id} className={user}>
              <div className={bubble}>{message.body}</div>
              <span className={caption}>{label}</span>
            </div>
          );
        })}
        {pending && (
          <div className={status}>
            <span className={dot} aria-hidden="true" />
            <span>Asking the agent…</span>
            <span className={line} aria-hidden="true" />
          </div>
        )}
        {props.entry !== undefined && agentFailed(props.entry) && (
          <div className={status} data-tone="error">
            <span>
              Ask AI failed: {thread?.agent?.error ?? "unknown error"}
            </span>
            <span className={line} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className={composer}>
        <CommentComposer
          key={thread?.threadId ?? "new"}
          agent={props.agent}
          placeholder={
            thread === undefined ? "Ask or comment…" : "Reply or ask…"
          }
          autoFocus={thread === undefined}
          busy={pending}
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
        />
      </div>
    </div>
  );
}

const styles = {
  chat: style(flex({ direction: "column" }), {
    flex: "1 1 auto",
    minHeight: 0,
  }),
  context: style(
    flex({ direction: "row", alignItems: "center", gap: 2 }),
    spacing.padding({ x: 4, y: 3 }),
    border(["bottom"], "border"),
    { flexShrink: 0 },
  ),
  bar: style({
    flexShrink: 0,
    alignSelf: "stretch",
    width: "3px",
    minHeight: "14px",
    borderRadius: "2px",
    backgroundColor: colors.blue[9],
  }),
  quoteText: style(text({ size: "sm" }), {
    minWidth: 0,
    color: colors.gray[11],
    fontStyle: "italic",
    display: "-webkit-box",
    overflow: "hidden",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
  }),
  note: style(
    text({ size: "xs", color: "lowContrast" }),
    spacing.padding({ x: 4, y: 2 }),
    border(["bottom"], "border"),
  ),
  transcript: style(
    flex({ direction: "column", gap: 4 }),
    spacing.padding({ x: 4, y: 3 }),
    { flex: "1 1 auto", minHeight: 0, overflowY: "auto" },
  ),
  user: style(flex({ direction: "column", gap: 1 }), {
    alignItems: "flex-end",
    marginLeft: "auto",
    maxWidth: "90%",
    minWidth: 0,
  }),
  bubble: style(text({ size: "sm" }), spacing.padding({ x: 3, y: 2 }), {
    borderRadius: "12px 12px 4px 12px",
    backgroundColor: colors.gray[3],
    color: colors.gray[12],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  }),
  agent: style(flex({ direction: "column", gap: 1 }), { minWidth: 0 }),
  prose: style(text({ size: "sm" }), {
    color: colors.gray[12],
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  }),
  caption: style(text({ size: "2xs", color: "lowContrast" })),
  status: style(
    flex({ direction: "row", alignItems: "center", gap: 2 }),
    text({ size: "xs", color: "lowContrast" }),
    {
      "&[data-tone='error']": { color: colors.red[11] },
    },
  ),
  dot: style({
    flexShrink: 0,
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: colors.blue[9],
  }),
  line: style({
    flex: "1 1 auto",
    height: "1px",
    backgroundColor: colors.gray[5],
  }),
  composer: style(spacing.padding({ x: 3, y: 2 }), border(["top"], "border"), {
    flexShrink: 0,
  }),
};
