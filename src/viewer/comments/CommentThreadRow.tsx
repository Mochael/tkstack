import {
  backgroundColor,
  border,
  colors,
  flex,
  radius,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import { threadQuote, type ResolvedThread } from "./useComments.js";
import { anchorNote, threadStatus } from "./threadView.js";

/** A thread in the list: its quote, the latest message, and its state. */
export function CommentThreadRow(props: {
  entry: ResolvedThread;
  active: boolean;
  onSelect: () => void;
}) {
  const row = useStyles(styles.row);
  const quoteLine = useStyles(styles.quoteLine);
  const bar = useStyles(styles.bar);
  const quoteText = useStyles(styles.quoteText);
  const preview = useStyles(styles.preview);
  const statusLine = useStyles(styles.statusLine);
  const statusWord = useStyles(styles.statusWord);
  const thread = props.entry.thread;
  const quote = threadQuote(thread);
  const status = threadStatus(props.entry);
  const note = anchorNote(props.entry);
  const count = thread.messages.length;

  return (
    <button
      type="button"
      className={row}
      data-active={props.active}
      data-status={status}
      onClick={props.onSelect}
    >
      <span className={quoteLine}>
        <i className={bar} aria-hidden="true" />
        <span className={quoteText}>{quote ?? "Whole document"}</span>
      </span>
      <span className={preview}>{thread.messages.at(-1)?.body}</span>
      <span className={statusLine}>
        <strong className={statusWord} data-status={status}>
          {status}
        </strong>
        <span>
          {note ?? (count === 1 ? "1 message" : `${String(count)} messages`)}
        </span>
      </span>
    </button>
  );
}

const styles = {
  row: style(
    flex({ direction: "column", gap: 1 }),
    radius.md,
    spacing.padding({ x: 3, y: 3 }),
    border(["top", "right", "bottom", "left"], "border"),
    {
      width: "100%",
      minWidth: 0,
      backgroundColor: backgroundColor.app,
      color: colors.gray[12],
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
      "&:hover": { backgroundColor: colors.gray[2] },
      "&[data-active='true']": { borderColor: colors.blue[8] },
      "&[data-status='resolved']": { opacity: 0.7 },
    },
  ),
  quoteLine: style(flex({ direction: "row", alignItems: "center", gap: 2 }), {
    minWidth: 0,
  }),
  bar: style({
    flexShrink: 0,
    width: "3px",
    height: "13px",
    borderRadius: "2px",
    backgroundColor: colors.yellow[8],
  }),
  quoteText: style(text({ size: "xs" }), {
    minWidth: 0,
    color: colors.gray[11],
    fontStyle: "italic",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  preview: style(text({ size: "sm" }), {
    display: "-webkit-box",
    overflow: "hidden",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  }),
  statusLine: style(
    flex({ direction: "row", alignItems: "baseline", gap: 2 }),
    text({ size: "2xs", color: "lowContrast" }),
  ),
  statusWord: style({
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: colors.gray[11],
    "&[data-status='asking']": { color: colors.yellow[11] },
    "&[data-status='failed']": { color: colors.red[11] },
    "&[data-status='open']": { color: colors.blue[11] },
  }),
};
