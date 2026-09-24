import { useState } from "react";
import {
  Button,
  Sparkles,
  Tooltip,
  border,
  colors,
  flex,
  radius,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import type { CommentAgentStatus } from "../../comments/types.js";

export function CommentComposer(props: {
  agent: CommentAgentStatus;
  placeholder: string;
  submitLabel: string;
  busy?: boolean;
  autoFocus?: boolean;
  onSubmit: (input: { body: string; askAgent: boolean }) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const form = useStyles(styles.form);
  const field = useStyles(styles.field);
  const actions = useStyles(styles.actions);
  const hint = useStyles(styles.hint);
  const empty = body.trim() === "";

  function submit(askAgent: boolean) {
    if (empty) return;
    props.onSubmit({ body: body.trim(), askAgent });
    setBody("");
  }

  return (
    <div className={form}>
      <textarea
        className={field}
        value={body}
        placeholder={props.placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- The composer opens in response to an explicit click.
        autoFocus={props.autoFocus}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel?.();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            submit(false);
          }
        }}
      />
      <div className={actions}>
        {props.onCancel !== undefined && (
          <Button variant="quiet" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          isDisabled={empty || props.busy === true}
          onClick={() => submit(false)}
        >
          {props.submitLabel}
        </Button>
        <Tooltip
          content={
            props.agent.available
              ? "Send this to the agent that wrote the spec"
              : (props.agent.reason ?? "Ask AI is unavailable")
          }
        >
          <Button
            isDisabled={empty || props.busy === true || !props.agent.available}
            onClick={() => submit(true)}
          >
            <Sparkles size="sm" />
            Ask AI
          </Button>
        </Tooltip>
      </div>
      <div className={hint}>Cmd+Enter submits.</div>
    </div>
  );
}

const styles = {
  form: style(flex({ direction: "column", gap: 2 })),
  field: style(
    radius.md,
    spacing.padding({ x: 2, y: 2 }),
    border(["top", "right", "bottom", "left"], "border"),
    {
      width: "100%",
      resize: "vertical",
      font: "inherit",
      fontSize: "13px",
      lineHeight: 1.5,
      color: colors.gray[12],
      backgroundColor: colors.gray[1],
    },
  ),
  actions: style(
    flex({
      direction: "row",
      alignItems: "center",
      gap: 2,
      justifyContent: "end",
    }),
    { flexWrap: "wrap" },
  ),
  hint: style(text({ size: "xs", color: "lowContrast" })),
};
