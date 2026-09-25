import { useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  ChevronDown,
  Menu,
  MenuItem,
  MenuTrigger,
  colors,
  flex,
  radius,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import type { CommentAgentStatus } from "../../comments/types.js";

const VERBS = {
  ask: {
    label: "Ask now",
    description: "The agent answers right away in this thread.",
  },
  post: {
    label: "Post as comment",
    description: "Saved to the thread without asking.",
  },
} as const;

/**
 * A reply row that opens into a textarea. Asking the agent is the primary
 * action (and what Enter does); posting without asking sits behind the
 * chevron. Without an agent session, posting is the only action.
 */
export function CommentComposer(props: {
  agent: CommentAgentStatus;
  placeholder: string;
  busy?: boolean;
  /** Open and focused from the start, e.g. for a brand-new thread. */
  autoFocus?: boolean;
  onSubmit: (input: { body: string; askAgent: boolean }) => void;
  onCancel?: () => void;
}) {
  const [composing, setComposing] = useState(props.autoFocus === true);
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const row = useStyles(styles.row);
  const form = useStyles(styles.form);
  const field = useStyles(styles.field);
  const footer = useStyles(styles.footer);
  const note = useStyles(styles.note);
  const split = useStyles(styles.split);
  const kbd = useStyles(styles.kbd);
  const option = useStyles(styles.option);
  const optionHint = useStyles(styles.optionHint);
  const empty = body.trim() === "";
  const canAsk = props.agent.available;
  const primary = canAsk ? "ask" : "post";

  useLayoutEffect(() => {
    if (!composing) return;
    const textarea = textareaRef.current;
    if (textarea === null) return;
    autosize(textarea);
    textarea.focus();
  }, [composing]);

  function submit(verb: "ask" | "post") {
    if (empty) return;
    if (verb === "ask" && (!canAsk || props.busy === true)) return;
    props.onSubmit({ body: body.trim(), askAgent: verb === "ask" });
    setBody("");
    if (props.autoFocus !== true) setComposing(false);
  }

  function cancel() {
    if (props.onCancel !== undefined) props.onCancel();
    else setComposing(false);
  }

  if (!composing) {
    return (
      <button type="button" className={row} onClick={() => setComposing(true)}>
        {props.placeholder}
      </button>
    );
  }

  return (
    <div className={form}>
      <textarea
        ref={textareaRef}
        className={field}
        value={body}
        placeholder={props.placeholder}
        rows={1}
        onChange={(event) => {
          setBody(event.target.value);
          autosize(event.currentTarget);
        }}
        onBlur={() => {
          if (empty && props.autoFocus !== true) setComposing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (empty) cancel();
            else event.currentTarget.blur();
            return;
          }
          if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit(primary);
        }}
      />
      <div className={footer}>
        <span className={note}>
          {canAsk
            ? props.busy === true
              ? "The agent is answering…"
              : undefined
            : "Ask AI is off: start diffmap with --agent-session"}
        </span>
        <div className={split} data-single={!canAsk}>
          <Button
            variant="primary"
            isDisabled={empty || (primary === "ask" && props.busy === true)}
            onClick={() => submit(primary)}
          >
            {VERBS[primary].label}
            <kbd className={kbd} aria-hidden="true">
              {"\u21A9\uFE0E"}
            </kbd>
          </Button>
          {canAsk && (
            <MenuTrigger placement="bottom end">
              <Button
                variant="primary"
                aria-label="Choose ask action"
                isDisabled={empty}
              >
                <ChevronDown size="sm" />
              </Button>
              <Menu
                onAction={(key) => submit(key === "ask" ? "ask" : "post")}
                disabledKeys={props.busy === true ? ["ask"] : []}
              >
                {(["ask", "post"] as const).map((verb) => (
                  <MenuItem key={verb} id={verb} textValue={VERBS[verb].label}>
                    <span className={option}>
                      <strong>{VERBS[verb].label}</strong>
                      <small className={optionHint}>
                        {VERBS[verb].description}
                      </small>
                    </span>
                  </MenuItem>
                ))}
              </Menu>
            </MenuTrigger>
          )}
        </div>
      </div>
    </div>
  );
}

function autosize(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${String(Math.min(textarea.scrollHeight, 240))}px`;
}

const styles = {
  row: style(text({ size: "sm", color: "lowContrast" }), radius.md, {
    width: "100%",
    padding: "10px",
    border: "1px solid transparent",
    background: "none",
    font: "inherit",
    textAlign: "left",
    cursor: "text",
    "&:hover": { backgroundColor: colors.gray[3] },
  }),
  form: style(flex({ direction: "column", gap: 2 })),
  field: style(radius.md, spacing.padding({ x: 2, y: 2 }), {
    width: "100%",
    resize: "none",
    border: "none",
    outline: "none",
    font: "inherit",
    fontSize: "14px",
    lineHeight: 1.5,
    color: colors.gray[12],
    backgroundColor: "transparent",
  }),
  footer: style(flex({ direction: "row", alignItems: "center", gap: 2 }), {
    justifyContent: "space-between",
  }),
  note: style(text({ size: "xs", color: "lowContrast" }), { minWidth: 0 }),
  // Join the primary button and its chevron into one split control.
  split: style(flex({ direction: "row", alignItems: "stretch" }), {
    flexShrink: 0,
    "&[data-single='false'] > button:first-child": {
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0,
    },
    "&[data-single='false'] > button:last-child": {
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
      borderLeft: `1px solid ${colors.gray[1]}`,
      paddingLeft: "6px",
      paddingRight: "6px",
    },
  }),
  kbd: style({
    marginLeft: "6px",
    fontFamily: "inherit",
    fontSize: "11px",
    opacity: 0.7,
  }),
  option: style(flex({ direction: "column", gap: 1 }), {
    whiteSpace: "normal",
    maxWidth: "240px",
  }),
  optionHint: style(text({ size: "xs", color: "lowContrast" })),
};
