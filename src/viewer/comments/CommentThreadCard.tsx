import { useState } from "react";
import {
  Badge,
  Button,
  WarningTriangle,
  backgroundColor,
  border,
  colors,
  flex,
  radius,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import type { CommentAgentStatus } from "../../comments/types.js";
import { CommentComposer } from "./CommentComposer.tsx";
import { threadQuote, type ResolvedThread } from "./useComments.js";

export function CommentThreadCard(props: {
  entry: ResolvedThread;
  agent: CommentAgentStatus;
  active: boolean;
  onActivate: () => void;
  onReply: (input: { body: string; askAgent: boolean }) => void;
  onSetStatus: (status: "open" | "resolved") => void;
}) {
  const [replying, setReplying] = useState(false);
  const card = useStyles(styles.card);
  const header = useStyles(styles.header);
  const quoteClass = useStyles(styles.quote);
  const messageClass = useStyles(styles.message);
  const author = useStyles(styles.author);
  const bodyClass = useStyles(styles.body);
  const footer = useStyles(styles.footer);
  const noteClass = useStyles(styles.note);
  const errorClass = useStyles(styles.error);
  const thread = props.entry.thread;
  const quote = threadQuote(thread);
  const stale = props.entry.anchor.status === "stale";
  const relocated = props.entry.anchor.status === "relocated";
  const pending = thread.agent?.state === "pending";

  return (
    <article
      className={card}
      data-active={props.active}
      data-status={thread.status}
      onClick={props.onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onActivate();
      }}
      tabIndex={0}
      aria-label={
        quote === undefined ? "Document comment" : `Comment on “${quote}”`
      }
    >
      <div className={header}>
        {thread.status === "resolved" && <Badge>Resolved</Badge>}
        {stale && (
          <Badge>
            <WarningTriangle size="sm" /> Stale anchor
          </Badge>
        )}
        {relocated && <Badge>Moved</Badge>}
        {quote === undefined && <Badge>Whole document</Badge>}
      </div>
      {quote !== undefined && (
        <blockquote className={quoteClass}>{quote}</blockquote>
      )}
      {stale && (
        <div className={noteClass}>
          The quoted text is no longer in the document. The comment is kept as
          written.
        </div>
      )}
      {thread.messages.map((message) => (
        <div key={message.id} className={messageClass}>
          <div className={author}>
            {message.by} · {formatTime(message.at)}
          </div>
          <div className={bodyClass}>{message.body}</div>
        </div>
      ))}
      {pending && <div className={noteClass}>Asking the agent…</div>}
      {thread.agent?.state === "error" && (
        <div className={errorClass}>
          Ask AI failed: {thread.agent.error ?? "unknown error"}
        </div>
      )}
      {replying ? (
        <CommentComposer
          agent={props.agent}
          placeholder="Reply…"
          submitLabel="Reply"
          autoFocus
          busy={pending}
          onCancel={() => setReplying(false)}
          onSubmit={(input) => {
            setReplying(false);
            props.onReply(input);
          }}
        />
      ) : (
        <div className={footer}>
          <Button variant="quiet" onClick={() => setReplying(true)}>
            Reply
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              props.onSetStatus(
                thread.status === "resolved" ? "open" : "resolved",
              )
            }
          >
            {thread.status === "resolved" ? "Reopen" : "Resolve"}
          </Button>
        </div>
      )}
    </article>
  );
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const styles = {
  card: style(
    flex({ direction: "column", gap: 2 }),
    radius.md,
    spacing.padding({ x: 3, y: 3 }),
    border(["top", "right", "bottom", "left"], "border"),
    {
      backgroundColor: backgroundColor.app,
      cursor: "default",
      "&[data-active='true']": {
        borderColor: colors.blue[8],
      },
      "&[data-status='resolved']": {
        opacity: 0.7,
      },
    },
  ),
  header: style(flex({ direction: "row", alignItems: "center", gap: 2 }), {
    flexWrap: "wrap",
    minHeight: 0,
  }),
  quote: style(text({ size: "xs" }), spacing.padding({ x: 2 }), {
    margin: 0,
    borderLeft: `2px solid ${colors.yellow[8]}`,
    color: colors.gray[11],
  }),
  message: style(flex({ direction: "column", gap: 1 })),
  author: style(text({ size: "2xs", color: "lowContrast" })),
  body: style(text({ size: "sm" }), { whiteSpace: "pre-wrap" }),
  footer: style(flex({ direction: "row", gap: 2, justifyContent: "end" })),
  note: style(text({ size: "xs", color: "lowContrast" })),
  error: style(text({ size: "xs" }), { color: colors.red[11] }),
};
