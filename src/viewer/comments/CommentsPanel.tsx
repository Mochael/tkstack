import {
  Button,
  backgroundColor,
  border,
  colors,
  flex,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import type { CommentTarget } from "../../comments/types.js";
import { CommentComposer } from "./CommentComposer.tsx";
import { CommentThreadCard } from "./CommentThreadCard.tsx";
import type { CommentsState } from "./useComments.js";

export type CommentsFilter = "open" | "all";

export function CommentsPanel(props: {
  comments: CommentsState;
  filter: CommentsFilter;
  onFilterChange: (filter: CommentsFilter) => void;
  draft: { target: CommentTarget; quote: string | undefined } | undefined;
  onDraftChange: (
    draft: { target: CommentTarget; quote: string | undefined } | undefined,
  ) => void;
  activeThreadId: string | undefined;
  onActivate: (threadId: string | undefined) => void;
}) {
  const panel = useStyles(styles.panel);
  const header = useStyles(styles.header);
  const heading = useStyles(styles.heading);
  const filters = useStyles(styles.filters);
  const list = useStyles(styles.list);
  const draftBox = useStyles(styles.draft);
  const quoteClass = useStyles(styles.quote);
  const emptyClass = useStyles(styles.empty);
  const errorClass = useStyles(styles.error);

  const visible = props.comments.threads.filter(
    (entry) => props.filter === "all" || entry.thread.status === "open",
  );
  const draft = props.draft;

  return (
    <aside id="diffmap-comments-panel" className={panel} aria-label="Comments">
      <div className={header}>
        <div className={heading}>Comments</div>
        <div className={filters}>
          <Button
            variant="quiet"
            aria-pressed={props.filter === "open"}
            onClick={() => props.onFilterChange("open")}
          >
            Open
          </Button>
          <Button
            variant="quiet"
            aria-pressed={props.filter === "all"}
            onClick={() => props.onFilterChange("all")}
          >
            All
          </Button>
        </div>
      </div>
      {props.comments.error !== undefined && (
        <div className={errorClass}>{props.comments.error}</div>
      )}
      <div className={list}>
        {draft !== undefined && (
          <div className={draftBox}>
            {draft.quote === undefined ? (
              <div className={quoteClass}>Comment on the whole document</div>
            ) : (
              <blockquote className={quoteClass}>{draft.quote}</blockquote>
            )}
            <CommentComposer
              agent={props.comments.agent}
              placeholder="Leave a comment…"
              submitLabel="Submit"
              autoFocus
              onCancel={() => props.onDraftChange(undefined)}
              onSubmit={(input) => {
                props.onDraftChange(undefined);
                // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface on the panel through the hook.
                void props.comments.createThread({
                  target: draft.target,
                  body: input.body,
                  askAgent: input.askAgent,
                });
              }}
            />
          </div>
        )}
        {visible.length === 0 && draft === undefined && (
          <div className={emptyClass}>
            Select text in the document and choose Comment, or start a comment
            on the whole document below.
          </div>
        )}
        {visible.map((entry) => (
          <CommentThreadCard
            key={entry.thread.threadId}
            entry={entry}
            agent={props.comments.agent}
            active={entry.thread.threadId === props.activeThreadId}
            onActivate={() => props.onActivate(entry.thread.threadId)}
            onReply={(input) => {
              // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface on the panel through the hook.
              void props.comments.reply({
                threadId: entry.thread.threadId,
                body: input.body,
                askAgent: input.askAgent,
              });
            }}
            onSetStatus={(status) => {
              // oxlint-disable-next-line typescript/no-floating-promises -- Errors surface on the panel through the hook.
              void props.comments.setStatus({
                threadId: entry.thread.threadId,
                status,
              });
            }}
          />
        ))}
      </div>
      {draft === undefined && (
        <div className={header}>
          <Button
            variant="quiet"
            onClick={() =>
              props.onDraftChange({
                target: { kind: "document" },
                quote: undefined,
              })
            }
          >
            Comment on the document
          </Button>
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
    backgroundColor: colors.gray[2],
  }),
  header: style(
    flex({ direction: "row", alignItems: "center", justifyContent: "between" }),
    spacing.padding({ x: 4, y: 3 }),
    border(["bottom"], "border"),
    { backgroundColor: backgroundColor.app, flexShrink: 0 },
  ),
  heading: style(text({ size: "sm", fontWeight: 600, color: "highContrast" })),
  filters: style(flex({ direction: "row", gap: 1 }), {
    "& button[aria-pressed='true']": {
      backgroundColor: backgroundColor.elementActive,
    },
  }),
  list: style(
    flex({ direction: "column", gap: 3 }),
    spacing.padding({ x: 4, y: 4 }),
    { flex: "1 1 auto", minHeight: 0, overflowY: "auto" },
  ),
  draft: style(flex({ direction: "column", gap: 2 })),
  quote: style(text({ size: "xs" }), spacing.padding({ x: 2 }), {
    margin: 0,
    borderLeft: `2px solid ${colors.yellow[8]}`,
    color: colors.gray[11],
  }),
  empty: style(text({ size: "xs", color: "lowContrast" })),
  error: style(text({ size: "xs" }), spacing.padding({ x: 4, y: 2 }), {
    color: colors.red[11],
  }),
};
