import { Button, Checklist, colors, text } from "maui";
import { style, useStyles } from "purse-styles";

export function QuizButton(props: {
  label: string;
  answered: number;
  total: number;
  onClick?: () => void;
}) {
  const countClass = useStyles(styles.count);
  return (
    <Button aria-controls="diffmap-quiz" onClick={props.onClick}>
      <Checklist size="sm" />
      {props.label}
      {props.total > 0 && (
        <span className={countClass}>
          {props.answered}/{props.total}
        </span>
      )}
    </Button>
  );
}

const styles = {
  count: style(text({ size: "xs", fontWeight: 600 }), {
    color: colors.gray[12],
    backgroundColor: colors.gray[5],
    borderRadius: "999px",
    padding: "0 6px",
  }),
};
