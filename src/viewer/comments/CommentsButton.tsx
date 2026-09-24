import { Button, Message, backgroundColor, colors, text } from "maui";
import { style, useStyles } from "purse-styles";

export function CommentsButton(props: {
  pressed: boolean;
  openCount: number;
  onClick?: () => void;
}) {
  const className = useStyles(styles.pressed);
  const countClass = useStyles(styles.count);
  return (
    <Button
      className={className}
      aria-pressed={props.pressed}
      aria-expanded={props.pressed}
      aria-controls="diffmap-comments-panel"
      onClick={props.onClick}
    >
      <Message size="sm" />
      Comments
      {props.openCount > 0 && (
        <span className={countClass}>{props.openCount}</span>
      )}
    </Button>
  );
}

const styles = {
  pressed: style({
    "&[aria-pressed='true']": {
      backgroundColor: backgroundColor.elementActive,
    },
  }),
  count: style(text({ size: "xs", fontWeight: 600 }), {
    color: colors.gray[12],
    backgroundColor: colors.gray[5],
    borderRadius: "999px",
    padding: "0 6px",
  }),
};
