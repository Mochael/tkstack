import { PatchDiff } from "@pierre/diffs/react";
import { useTheme } from "maui";
import { style, useStyles } from "purse-styles";
import type {
  ReviewDiff as ReviewDiffModel,
  ReviewNote,
} from "../reviewDiff.js";
import { pierreDiffOptions, pierreShell } from "./pierre.ts";

export function ReviewDiff(props: { path: string; review: ReviewDiffModel }) {
  const { resolvedTheme } = useTheme();
  const shell = useStyles(pierreShell);
  const note = useStyles(styles.note);
  const label = useStyles(styles.label);
  return (
    <div
      className={shell}
      data-file-path={props.path}
      data-diffmap-kind="review-diff"
    >
      <PatchDiff<string>
        patch={props.review.patch}
        disableWorkerPool
        lineAnnotations={props.review.notes}
        renderAnnotation={(annotation: ReviewNote) => (
          <div className={note}>
            <span className={label}>REVIEW NOTE</span>
            {annotation.metadata}
          </div>
        )}
        options={{
          ...pierreDiffOptions({
            themeType: resolvedTheme,
            disableFileHeader: false,
          }),
          diffStyle: "split",
        }}
      />
    </div>
  );
}

const styles = {
  note: style({
    padding: "10px 14px",
    color: "#17324d",
    background: "#ecf6ff",
    borderLeft: "3px solid #3b82c4",
    font: "13px/1.45 system-ui, sans-serif",
    whiteSpace: "normal",
  }),
  label: style({
    display: "block",
    marginBottom: "3px",
    color: "#286894",
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".06em",
  }),
};
