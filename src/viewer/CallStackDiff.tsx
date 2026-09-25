import { useState, type ReactNode } from "react";
import { backgroundColor, colors, focusRing, spacing, text } from "maui";
import { style, useStyles } from "purse-styles";
import { codeFontFamily } from "../codeFont.js";
import type {
  SourceAnnotation,
  SourceNavigation,
  StackDetails,
} from "../annotations.js";
import { pierreShell } from "./pierre.js";

export function CallStackDiff(
  props: { lines: SourceAnnotation[] } & SourceNavigation,
) {
  const shell = useStyles(pierreShell, styles.shell);
  const row = useStyles(styles.row);
  const item = useStyles(styles.item);
  const toggle = useStyles(styles.toggle);
  const toolbar = useStyles(styles.toolbar);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const expandable = props.lines.flatMap((line, index) =>
    line.details === undefined ? [] : [index],
  );
  const allOpen =
    expandable.length > 0 && expandable.every((index) => open.has(index));

  function flip(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className={shell} data-diffmap-kind="callstack">
      <div className="stack-track">
        {expandable.length > 1 && (
          <div className={toolbar}>
            <button
              type="button"
              onClick={() => setOpen(allOpen ? new Set() : new Set(expandable))}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
        )}
        {props.lines.map((line, index) => {
          const sign = line.text.startsWith("+")
            ? "+"
            : line.text.startsWith("-")
              ? "-"
              : " ";
          const label = line.text.replace(/^[+ -]/, "");
          const tree = /^[ \t│┃├└─]*/u.exec(label)![0];
          const description = label.slice(tree.length);
          const comment = description.indexOf("#");
          const details = line.details;
          const expanded = open.has(index);
          const content = (
            <>
              <span className="diff-sign" aria-hidden="true">
                {sign}
              </span>
              <span className="stack-content">
                <span className="tree-prefix" aria-hidden="true">
                  {[...tree].map((branch, i) => (
                    <span key={i} data-branch={branch} />
                  ))}
                </span>
                <span className="stack-label">
                  {comment === -1 ? description : description.slice(0, comment)}
                  {comment !== -1 && (
                    <span className="stack-comment">
                      {description.slice(comment)}
                    </span>
                  )}
                </span>
              </span>
              {line.references.length > 0 && (
                <span className="source-indicator" aria-hidden="true">
                  ↗
                </span>
              )}
            </>
          );
          const detailsId = `stack-details-${String(index)}`;
          const main =
            line.references.length === 0 ? (
              details === undefined ? (
                <div className={row} data-change={sign} title={description}>
                  {content}
                </div>
              ) : (
                // A row with notes but no source link opens its notes.
                <button
                  type="button"
                  className={row}
                  data-change={sign}
                  data-toggles
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  title={description}
                  onClick={() => flip(index)}
                >
                  {content}
                </button>
              )
            ) : (
              <button
                type="button"
                className={row}
                data-change={sign}
                aria-pressed={props.selectedAnnotation === line}
                aria-controls="source-diff-panel"
                title={description}
                aria-label={description}
                onClick={() => props.onSelectAnnotation(line)}
              >
                {content}
              </button>
            );
          if (details === undefined) {
            if (expandable.length === 0) return <div key={index}>{main}</div>;
            // Keep the tree aligned with rows that have a disclosure toggle.
            return (
              <div key={index} className={item} data-change={sign}>
                <div className="stack-line">
                  <span className={toggle} aria-hidden="true" />
                  {main}
                </div>
              </div>
            );
          }
          return (
            <div key={index} className={item} data-change={sign}>
              <div className="stack-line">
                <button
                  type="button"
                  className={toggle}
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  aria-label={expanded ? "Hide details" : "Show details"}
                  title={expanded ? "Hide details" : "Show details"}
                  onClick={() => flip(index)}
                >
                  <span aria-hidden="true">▸</span>
                </button>
                {main}
              </div>
              {expanded && (
                <StackRowDetails
                  id={detailsId}
                  details={details}
                  indent={tree.length}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StackRowDetails(props: {
  id: string;
  details: StackDetails;
  indent: number;
}) {
  const panel = useStyles(styles.details);
  const paragraphs = props.details.paragraphs.filter(
    (paragraph) => paragraph !== "",
  );
  return (
    <div
      id={props.id}
      className={panel}
      // Line the notes up under the row's label, past its tree guides.
      style={{ paddingLeft: `calc(${String(props.indent * 0.6)}em + 44px)` }}
    >
      {paragraphs.map((paragraph, index) => (
        <div key={index} className="stack-detail-text">
          {inlineCode(paragraph)}
        </div>
      ))}
      {props.details.example.length > 0 && (
        <pre className="stack-example">
          {props.details.example.map((entry, index) => (
            <span
              key={index}
              className="stack-example-line"
              // A new "in" after an "out" starts another example.
              data-new-example={
                entry.kind === "in" &&
                props.details.example[index - 1]?.kind === "out"
              }
            >
              <span className="stack-example-kind" data-kind={entry.kind}>
                {entry.kind === "in" ? "→ in " : "← out"}
              </span>
              <span className="stack-example-value">
                {exampleValue(entry.text)}
              </span>
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

const INLINE_JSON_WIDTH = 64;

/**
 * An example value reads as JSON when it parses as JSON: short values stay on
 * one line, longer ones are pretty-printed. Anything else is shown as written.
 */
function exampleValue(source: string): ReactNode {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return source;
  }
  const inline = JSON.stringify(value, undefined, 1).replace(/\n\s*/g, " ");
  const formatted =
    inline.length <= INLINE_JSON_WIDTH
      ? inline
      : JSON.stringify(value, undefined, 2);
  return highlightJson(formatted);
}

const jsonToken =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(source: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(jsonToken)) {
    const at = match.index;
    if (at > last) parts.push(source.slice(last, at));
    const [whole, string, colon, keyword, number] = match;
    const kind =
      string === undefined
        ? keyword === undefined
          ? number === undefined
            ? "punct"
            : "number"
          : "keyword"
        : colon === undefined
          ? "string"
          : "key";
    parts.push(
      <span key={at} data-json={kind}>
        {kind === "key" ? string : whole}
      </span>,
    );
    if (kind === "key") parts.push(colon);
    last = at + whole.length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

/** Backtick spans become inline code; everything else stays plain text. */
function inlineCode(source: string): ReactNode[] {
  return source
    .split(/(`[^`]+`)/)
    .map((part, index) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}

const styles = {
  toolbar: style({
    position: "sticky",
    left: 0,
    maxWidth: "100cqw",
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "flex-end",
    padding: "0 12px 4px",
    "& > button": {
      font: "inherit",
      fontSize: "12px",
      fontWeight: 500,
      color: colors.blue[11],
      background: "none",
      border: 0,
      padding: "2px 4px",
      cursor: "pointer",
    },
  }),
  item: style({
    "&[data-change='+']": { backgroundColor: colors.green[3] },
    "&[data-change='-']": { backgroundColor: colors.red[3] },
    "& > .stack-line": { display: "flex", alignItems: "stretch", minWidth: 0 },
    "& > .stack-line > button:last-child, & > .stack-line > div:last-child": {
      flex: "1 1 auto",
      minWidth: 0,
      paddingLeft: 0,
    },
  }),
  toggle: style(
    {
      flexShrink: 0,
      width: "24px",
      padding: 0,
      border: 0,
      background: "none",
      color: colors.gray[11],
      fontSize: "13px",
      cursor: "pointer",
      "& > span": {
        display: "inline-block",
        transition: "transform 120ms ease",
      },
      "&[aria-expanded='true'] > span": { transform: "rotate(90deg)" },
      "&:hover": { color: colors.gray[12] },
    },
    focusRing(),
  ),
  details: style(text({ size: "xs", fontWeight: 400 }), {
    // Stay in view and wrap at the visible width while the rows scroll.
    position: "sticky",
    left: 0,
    maxWidth: "100cqw",
    boxSizing: "border-box",
    paddingRight: "16px",
    paddingBottom: "8px",
    color: colors.gray[11],
    // Same register as the rows' # comments: small, grey, regular weight.
    "& .stack-detail-text": {
      margin: "0 0 6px",
      fontSize: "12px",
      lineHeight: 1.5,
      fontWeight: 400,
      color: colors.gray[11],
    },
    "& code": {
      fontFamily: codeFontFamily,
      fontSize: "0.95em",
      color: colors.gray[12],
      backgroundColor: colors.gray[3],
      borderRadius: "3px",
      padding: "0 3px",
    },
    "& .stack-example": {
      display: "grid",
      rowGap: "2px",
      margin: "2px 0 4px",
      padding: "6px 10px",
      fontFamily: codeFontFamily,
      fontSize: "11.5px",
      lineHeight: 1.5,
      color: colors.gray[12],
      backgroundColor: colors.gray[2],
      border: `1px solid ${colors.gray[5]}`,
      borderRadius: "6px",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
    "& .stack-example-line": {
      display: "grid",
      gridTemplateColumns: "auto minmax(0, 1fr)",
      columnGap: "10px",
    },
    "& .stack-example-line[data-new-example='true']": {
      marginTop: "4px",
      paddingTop: "6px",
      borderTop: `1px dashed ${colors.gray[6]}`,
    },
    "& .stack-example-kind": {
      fontWeight: 600,
      color: colors.blue[10],
      userSelect: "none",
    },
    "& .stack-example-kind[data-kind='out']": { color: colors.green[10] },
    "& [data-json='key']": { color: colors.purple[11] },
    "& [data-json='string']": { color: colors.green[11] },
    "& [data-json='number'], & [data-json='keyword']": {
      color: colors.orange[11],
    },
  }),
  shell: style(
    text({ size: "sm", fontWeight: 500, color: "highContrast" }),
    spacing.padding({ y: 2 }),
    {
      backgroundColor: backgroundColor.app,
      // Long rows scroll sideways instead of being cut off.
      overflowX: "auto",
      maxWidth: "100%",
      containerType: "inline-size",
      "& > .stack-track": { width: "max-content", minWidth: "100%" },
    },
  ),
  row: style(
    spacing.padding({ x: 3 }),
    {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      boxSizing: "border-box",
      width: "100%",
      minWidth: 0,
      textAlign: "left",
      font: "inherit",
      lineHeight: "1.6",
      color: "inherit",
      background: "transparent",
      border: 0,
      "&[data-change='+']": { backgroundColor: colors.green[3] },
      "&[data-change='-']": { backgroundColor: colors.red[3] },
      "&[aria-pressed], &[data-toggles]": { cursor: "pointer" },
      "&[data-toggles]:hover": { backgroundColor: colors.gray[3] },
      "&[aria-pressed]:hover": { backgroundColor: colors.blue[2] },
      "&[aria-pressed='true'], &[aria-pressed='true']:hover": {
        backgroundColor: colors.blue[3],
        boxShadow: `inset 4px 0 ${colors.blue[9]}`,
      },
      "& .stack-content": {
        display: "flex",
        alignItems: "stretch",
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: "28px",
      },
      "& .stack-label": {
        flex: "1 1 auto",
        paddingBlock: "3px",
        paddingRight: "12px",
        whiteSpace: "nowrap",
      },
      "& .stack-comment": { color: colors.gray[11], fontWeight: 400 },
      "& .tree-prefix": { display: "inline-flex", alignSelf: "stretch" },
      "& [data-branch]": {
        position: "relative",
        width: "0.6em",
        flexShrink: 0,
      },
      "& [data-branch='│']::before, & [data-branch='┃']::before, & [data-branch='├']::before, & [data-branch='└']::before":
        {
          content: "''",
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          borderLeft: `1px solid ${colors.gray[9]}`,
        },
      "& [data-branch='└']::before": { bottom: "50%" },
      "& [data-branch='├']::after, & [data-branch='└']::after, & [data-branch='─']::after":
        {
          content: "''",
          position: "absolute",
          left: "50%",
          right: 0,
          top: "50%",
          borderTop: `1px solid ${colors.gray[9]}`,
        },
      "& [data-branch='─']::after": { left: 0 },
      "& .tree-prefix, & .diff-sign": {
        fontFamily: codeFontFamily,
        whiteSpace: "pre",
        flexShrink: 0,
      },
      "& > .diff-sign": { alignSelf: "center" },
      "& > .source-indicator": {
        alignSelf: "center",
        flexShrink: 0,
        marginLeft: "auto",
        color: colors.blue[11],
      },
    },
    focusRing(),
  ),
};
