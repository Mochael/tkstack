import { Button, Message, radius, shadow } from "maui";
import { style, useStyles } from "purse-styles";

export type SelectionAnchor = { left: number; top: number };

/** Floats over the prose at the end of the reader's selection. */
export function SelectionPopover(props: {
  anchor: SelectionAnchor;
  onComment: () => void;
}) {
  const className = useStyles(styles.popover);
  return (
    <div
      className={className}
      style={{
        left: `${String(props.anchor.left)}px`,
        top: `${String(props.anchor.top)}px`,
      }}
      // Keep the browser selection alive while the button takes the click.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button variant="primary" onClick={props.onComment}>
        <Message size="sm" />
        Comment
      </Button>
    </div>
  );
}

const styles = {
  popover: style(radius.md, shadow.medium, {
    position: "fixed",
    zIndex: 40,
    transform: "translate(-50%, -100%)",
  }),
};
