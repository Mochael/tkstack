import {
  ArrowLeft,
  Button,
  Check,
  Close,
  Message,
  Refresh,
  backgroundColor,
  border,
  colors,
  flex,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import type { CommentTarget } from "../../comments/types.js";
import { CommentThreadChat } from "./CommentThreadChat.tsx";
import { CommentThreadRow } from "./CommentThreadRow.tsx";
import { threadQuote, type CommentsState } from "./useComments.js";

export type CommentDraft = {
  target: CommentTarget;
  quote: string | undefined;
};

/**
 * The comments sidebar has two pages: the thread list, and one thread as a
 * chat (or a new thread being started). The back button returns to the list.
 */
export function CommentsPanel(props: {
  comments: CommentsState;
  draft: CommentDraft | undefined;
  onDraftChange: (draft: CommentDraft | undefined) => void;
  activeThreadId: string | undefined;
  onActivate: (threadId: string | undefined) => void;
  onClose: () => void;
}) {
  const panel = useStyles(styles.panel);
  const header = useStyles(styles.header);
  const headerStart = useStyles(styles.headerStart);
  const headerEnd = useStyles(styles.headerEnd);
  const title = useStyles(styles.title);
  const count = useStyles(styles.count);
  const back = useStyles(styles.back);
  const list = useStyles(styles.list);
  const empty = useStyles(styles.empty);
  const errorClass = useStyles(styles.error);
  const resolvedSection = useStyles(styles.resolved);
  const resolvedSummary = useStyles(styles.resolvedSummary);

  const { comments, draft } = props;
  const open = comments.threads.filter(
    (entry) => entry.thread.status === "open",
  );
  const resolved = comments.threads.filter(
    (entry) => entry.thread.status === "resolved",
  );
  const active = comments.threads.find(
    (entry) => entry.thread.threadId === props.activeThreadId,
  );
  const page =
    draft !== undefined ? "new" : active !== undefined ? "thread" : "list";

  function showList() {
    props.onDraftChange(undefined);
    props.onActivate(undefined);
  }

  const rows = (entries: typeof open) =>
    entries.map((entry) => (
      <CommentThreadRow
        key={entry.thread.threadId}
        entry={entry}
        active={entry.thread.threadId === props.activeThreadId}
        onSelect={() => props.onActivate(entry.thread.threadId)}
      />
    ));

  return (
    <aside id="diffmap-comments-panel" className={panel} aria-label="Comments">
      <div className={header}>
        <div className={headerStart}>
          {page === "list" ? (
            <>
              <span className={title}>Comments</span>
              <span className={count}>{open.length} open</span>
            </>
          ) : (
            <button
              type="button"
              className={back}
              aria-label="Show all comments"
              onClick={showList}
            >
              <ArrowLeft size="sm" />
              <span>Comments</span>
              <span className={count}>{open.length}</span>
            </button>
          )}
        </div>
        <div className={headerEnd}>
          {page === "list" && (
            <Button
              variant="quiet"
              onClick={() => {
                props.onActivate(undefined);
                props.onDraftChange({
                  target: { kind: "document" },
                  quote: undefined,
                });
              }}
            >
              + New comment
            </Button>
          )}
          {page === "thread" && active !== undefined && (
            <Button
              variant="quiet"
              onClick={() => {
                // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface on the panel through the hook.
                void comments.setStatus({
                  threadId: active.thread.threadId,
                  status:
                    active.thread.status === "resolved" ? "open" : "resolved",
                });
              }}
            >
              {active.thread.status === "resolved" ? (
                <Refresh size="sm" />
              ) : (
                <Check size="sm" />
              )}
              {active.thread.status === "resolved" ? "Reopen" : "Resolve"}
            </Button>
          )}
          <Button
            variant="quiet"
            aria-label="Close comments"
            onClick={props.onClose}
          >
            <Close size="sm" />
          </Button>
        </div>
      </div>
      {comments.error !== undefined && (
        <div className={errorClass}>{comments.error}</div>
      )}
      {page === "new" && draft !== undefined && (
        <CommentThreadChat
          entry={undefined}
          quote={draft.quote}
          agent={comments.agent}
          onCancel={showList}
          onSubmit={(input) => {
            // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface on the panel through the hook.
            void comments
              .createThread({
                target: draft.target,
                body: input.body,
                askAgent: input.askAgent,
              })
              .then((threadId) => {
                if (threadId === undefined) return;
                // Asking opens the thread to watch the answer; posting for
                // later goes back to the list.
                props.onActivate(input.askAgent ? threadId : undefined);
                props.onDraftChange(undefined);
              });
          }}
        />
      )}
      {page === "thread" && active !== undefined && (
        <CommentThreadChat
          entry={active}
          quote={threadQuote(active.thread)}
          agent={comments.agent}
          onSubmit={(input) => {
            // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface on the panel through the hook.
            void comments.reply({
              threadId: active.thread.threadId,
              body: input.body,
              askAgent: input.askAgent,
            });
          }}
        />
      )}
      {page === "list" && (
        <div className={list}>
          {open.length === 0 && (
            <div className={empty}>
              <Message size="md" />
              <strong>
                {resolved.length > 0 ? "No open comments" : "No comments yet"}
              </strong>
              <span>
                {resolved.length > 0
                  ? "Resolved comments are listed below."
                  : "Select anything in the document and choose Comment."}
              </span>
            </div>
          )}
          {rows(open)}
          {resolved.length > 0 && (
            <details className={resolvedSection}>
              <summary className={resolvedSummary}>
                Resolved <span className={count}>{resolved.length}</span>
              </summary>
              {rows(resolved)}
            </details>
          )}
        </div>
      )}
    </aside>
  );
}

const styles = {
  panel: style(flex({ direction: "column" }), border(["left"], "border"), {
    gridArea: "comments",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: backgroundColor.app,
  }),
  header: style(
    flex({ direction: "row", alignItems: "center", gap: 2 }),
    spacing.padding({ x: 3, y: 2 }),
    border(["bottom"], "border"),
    { justifyContent: "space-between", flexShrink: 0, minHeight: "48px" },
  ),
  headerStart: style(
    flex({ direction: "row", alignItems: "baseline", gap: 2 }),
    {
      minWidth: 0,
      paddingLeft: "4px",
    },
  ),
  headerEnd: style(flex({ direction: "row", alignItems: "center", gap: 1 })),
  title: style(text({ size: "sm", fontWeight: 600, color: "highContrast" })),
  count: style(text({ size: "xs", color: "lowContrast" })),
  back: style(
    flex({ direction: "row", alignItems: "center", gap: 2 }),
    text({ size: "sm", color: "highContrast" }),
    {
      padding: 0,
      border: "none",
      background: "none",
      font: "inherit",
      cursor: "pointer",
      "&:hover": { color: colors.blue[11] },
    },
  ),
  list: style(
    flex({ direction: "column", gap: 2 }),
    spacing.padding({ x: 3, y: 3 }),
    { flex: "1 1 auto", minHeight: 0, overflowY: "auto" },
  ),
  empty: style(
    flex({ direction: "column", alignItems: "center", gap: 1 }),
    text({ size: "xs", color: "lowContrast" }),
    { padding: "32px 16px", textAlign: "center" },
  ),
  error: style(text({ size: "xs" }), spacing.padding({ x: 4, y: 2 }), {
    color: colors.red[11],
    flexShrink: 0,
  }),
  resolved: style(flex({ direction: "column", gap: 2 }), {
    "& > summary": { listStylePosition: "inside" },
  }),
  resolvedSummary: style(text({ size: "xs", color: "lowContrast" }), {
    cursor: "pointer",
    padding: "4px 0",
  }),
};
