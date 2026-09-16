import { useEffect, useMemo, useRef } from "react";
import { backgroundColor, colors, fontFamily } from "maui";
import { style, useStyles } from "purse-styles";
import { mermaidSvg } from "../mermaid.js";
import type { DiagramAnnotation } from "../diagramAnnotations.js";
import type { SourceNavigation } from "../annotations.js";
import { linkDiagram } from "./diagramLinks.js";

export function MermaidBlock(
  props: {
    source: string;
    annotations: DiagramAnnotation[];
  } & SourceNavigation,
) {
  const container = useRef<HTMLDivElement>(null);
  const shell = useStyles(styles.shell);
  const svg = useMemo(
    () =>
      mermaidSvg({
        source: props.source,
        bg: backgroundColor.app,
        fg: colors.gray[12],
        accent: colors.accent[9],
        muted: colors.gray[11],
        surface: backgroundColor.element,
        border: colors.gray[6],
        font: fontFamily,
      }),
    [props.source],
  );
  const linked = useMemo(
    () => (svg instanceof Error ? svg : linkDiagram(svg, props.annotations)),
    [svg, props.annotations],
  );
  // React replaces innerHTML when this object changes, which drops SVG focus.
  const html = useMemo(
    () => ({ __html: linked instanceof Error ? "" : linked }),
    [linked],
  );
  useEffect(() => {
    if (linked instanceof Error) return;
    for (const target of container.current!.querySelectorAll(
      "[data-source-index]",
    )) {
      const annotation =
        props.annotations[Number(target.getAttribute("data-source-index"))]!
          .annotation;
      target.setAttribute(
        "aria-pressed",
        String(annotation === props.selectedAnnotation),
      );
    }
  }, [linked, props.annotations, props.selectedAnnotation]);
  if (linked instanceof Error) {
    return (
      <div ref={container} className={shell} data-diffmap-kind="mermaid">
        {linked.message}
      </div>
    );
  }
  return (
    <div
      ref={container}
      className={shell}
      data-diffmap-kind="mermaid"
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const element = target.closest("[data-source-index]");
        if (element === null) return;
        props.onSelectAnnotation(
          props.annotations[Number(element.getAttribute("data-source-index"))]!
            .annotation,
        );
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const element = target.closest("[data-source-index]");
        if (element === null) return;
        event.preventDefault();
        props.onSelectAnnotation(
          props.annotations[Number(element.getAttribute("data-source-index"))]!
            .annotation,
        );
      }}
      dangerouslySetInnerHTML={html}
    />
  );
}

const styles = {
  shell: style({
    width: "100%",
    maxHeight: "60vh",
    overflow: "auto",
    minWidth: 0,
    border: 0,
    boxShadow: "none",
    "& .source-target": { cursor: "pointer" },
    "& .source-target:focus, & .source-target:focus-visible": {
      outline: "none",
    },
    "& .source-hit": { pointerEvents: "stroke" },
    "& .source-node:hover > g > rect, & .source-node:hover > g > polygon": {
      fill: colors.blue[2],
      stroke: colors.blue[8],
      strokeWidth: 2,
    },
    "& .source-node:hover text": { fill: colors.blue[10] },
    "& .source-node[aria-pressed='true'] > g > rect, & .source-node[aria-pressed='true'] > g > polygon":
      { fill: colors.blue[3], stroke: colors.blue[9], strokeWidth: 2 },
    "& .source-node[aria-pressed='true'] text": { fill: colors.blue[11] },
    "& .source-edge:hover > .edge, & .source-edge:hover > .message > line, & .source-edge:hover > .message > polyline, & .source-edge:hover > .class-relationship, & .source-edge:hover > .er-relationship":
      { stroke: colors.blue[8], strokeWidth: 1.5 },
    "& .source-edge[aria-pressed='true'] > .edge, & .source-edge[aria-pressed='true'] > .message > line, & .source-edge[aria-pressed='true'] > .message > polyline, & .source-edge[aria-pressed='true'] > .class-relationship, & .source-edge[aria-pressed='true'] > .er-relationship":
      { stroke: colors.blue[9], strokeWidth: 2 },
    "& svg": {
      display: "block",
      width: "100%",
      height: "auto",
      maxHeight: "60vh",
    },
  }),
};
