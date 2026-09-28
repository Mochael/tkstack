import { useEffect, useMemo, useRef, useState } from "react";
import { colors, backgroundColor, borderColor, focusRing, text } from "maui";
import { style, useStyles } from "purse-styles";
import type { SourceNavigation } from "../annotations.js";
import { codeFontFamily } from "../codeFont.js";
import type { FlowExamples } from "../flowExamples.js";

export function FlowExamplesView(
  props: { flow: FlowExamples } & SourceNavigation,
) {
  const [caseIndex, setCaseIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);
  const flowCase = props.flow.cases[caseIndex]!;
  const step = flowCase.steps[stepIndex]!;
  const node = props.flow.nodes.find((entry) => entry.id === step.node)!;
  const shell = useStyles(styles.shell);
  const header = useStyles(styles.header);
  const tabs = useStyles(styles.tabs);
  const tab = useStyles(styles.tab);
  const graph = useStyles(styles.graph);
  const graphNode = useStyles(styles.graphNode);
  const detail = useStyles(styles.detail);
  const controls = useStyles(styles.controls);
  const control = useStyles(styles.control);
  const sourceButton = useStyles(styles.sourceButton);
  const value = useStyles(styles.value);
  const path = useMemo(
    () =>
      flowCase.steps.map((item) =>
        props.flow.nodes.find((entry) => entry.id === item.node)!,
      ),
    [flowCase, props.flow.nodes],
  );

  useEffect(() => {
    if (!playing) return;
    if (stepIndex >= flowCase.steps.length - 1) return;
    const timer = window.setTimeout(() => {
      setStepIndex((current) => current + 1);
      if (stepIndex === flowCase.steps.length - 2) setPlaying(false);
    }, 1150);
    return () => window.clearTimeout(timer);
  }, [playing, stepIndex, flowCase.steps.length]);

  useEffect(() => {
    const container = graphRef.current;
    const active = container?.querySelector<HTMLElement>(
      `[data-flow-index='${stepIndex}']`,
    );
    if (!container || !active || container.dataset.caseId !== flowCase.id)
      return;
    const outer = container.getBoundingClientRect();
    const inner = active.getBoundingClientRect();
    container.scrollBy({
      left: inner.left - outer.left - outer.width / 2 + inner.width / 2,
      behavior: "smooth",
    });
  }, [stepIndex, flowCase.id]);

  function chooseCase(index: number) {
    setCaseIndex(index);
    setStepIndex(0);
    setPlaying(false);
  }

  function chooseStep(index: number) {
    setStepIndex(index);
    setPlaying(false);
  }

  function next() {
    if (stepIndex === flowCase.steps.length - 1) {
      setStepIndex(0);
    } else {
      setStepIndex(stepIndex + 1);
    }
    setPlaying(false);
  }

  return (
    <section
      className={shell}
      data-diffmap-kind="flow-examples"
      aria-label={props.flow.title}
    >
      <div className={header}>
        <div>
          <span className="flow-eyebrow">INTERACTIVE EXAMPLE</span>
          <h3>{props.flow.title}</h3>
          {props.flow.description && <p>{props.flow.description}</p>}
        </div>
        <span className="flow-count">
          {String(props.flow.cases.length)} paths
        </span>
      </div>

      <div className={tabs} role="tablist" aria-label="Example inputs">
        {props.flow.cases.map((candidate, index) => (
          <button
            key={candidate.id}
            className={tab}
            type="button"
            role="tab"
            aria-selected={index === caseIndex}
            onClick={() => chooseCase(index)}
          >
            <span className="flow-tab-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            {candidate.label}
          </button>
        ))}
      </div>

      <div className="flow-input">
        <span className="flow-label">EXAMPLE INPUT</span>
        <pre>{format(flowCase.input)}</pre>
      </div>

      <div className="flow-graph-heading">
        <span className="flow-label">FUNCTION PATH</span>
        <span>
          {String(stepIndex + 1)} of {String(flowCase.steps.length)} steps
        </span>
      </div>
      <div
        className={graph}
        ref={graphRef}
        data-case-id={flowCase.id}
        aria-label="Function path"
      >
        {path.map((pathNode, index) => (
          <div className="flow-graph-item" key={`${flowCase.id}-${index}`}>
            {index > 0 && (
              <span className="flow-connector" aria-hidden="true">
                →
              </span>
            )}
            <button
              type="button"
              className={graphNode}
              data-flow-index={index}
              data-state={
                index === stepIndex
                  ? "active"
                  : index < stepIndex
                    ? "visited"
                    : "upcoming"
              }
              aria-current={index === stepIndex ? "step" : undefined}
              onClick={() => chooseStep(index)}
            >
              <span className="flow-node-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{pathNode.label}</strong>
              <span className="flow-node-summary">{pathNode.summary}</span>
            </button>
          </div>
        ))}
      </div>

      <div className={detail} aria-live="polite">
        <div className="flow-step-header">
          <div>
            <span className="flow-eyebrow">
              STEP {String(stepIndex + 1).padStart(2, "0")} /{" "}
              {String(flowCase.steps.length).padStart(2, "0")}
            </span>
            <h4>{step.title}</h4>
            {step.detail && <p>{step.detail}</p>}
          </div>
          {node.source && (
            <button
              className={sourceButton}
              type="button"
              onClick={() => props.onSelectAnnotation(node.source!)}
            >
              View full code <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
        <div className="flow-values">
          {Object.hasOwn(step, "input") && (
            <ValuePanel label="IN" value={step.input} className={value} />
          )}
          {Object.hasOwn(step, "output") && (
            <ValuePanel label="OUT" value={step.output} className={value} />
          )}
          {!Object.hasOwn(step, "input") && !Object.hasOwn(step, "output") && (
            <p className="flow-no-values">
              This step changes control flow without a value snapshot.
            </p>
          )}
        </div>
      </div>

      <div className={controls}>
        <div className="flow-control-buttons">
          <button
            className={control}
            type="button"
            aria-label="Previous step"
            disabled={stepIndex === 0}
            onClick={() => chooseStep(stepIndex - 1)}
          >
            ←
          </button>
          <button
            className={control}
            type="button"
            onClick={() => {
              if (stepIndex === flowCase.steps.length - 1) setStepIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "Pause" : "Play path"}
          </button>
          <button
            className={control}
            type="button"
            aria-label="Next step"
            onClick={next}
          >
            →
          </button>
        </div>
        <span className="flow-result">
          {stepIndex === flowCase.steps.length - 1 ? (
            <>
              RESULT <code>{format(flowCase.result)}</code>
            </>
          ) : (
            "Follow the path to reveal the result"
          )}
        </span>
      </div>
    </section>
  );
}

function ValuePanel(props: {
  label: string;
  value: unknown;
  className: string;
}) {
  return (
    <div className={props.className}>
      <span className="flow-value-label">{props.label}</span>
      <pre>{format(props.value)}</pre>
    </div>
  );
}

function format(value: unknown) {
  return JSON.stringify(value, undefined, 2) ?? "undefined";
}

const styles = {
  shell: style(text({ size: "sm" }), {
    border: `1px solid ${borderColor.outline}`,
    borderRadius: "12px",
    backgroundColor: backgroundColor.app,
    overflow: "hidden",
    marginBlock: "22px",
    color: colors.gray[12],
    "& .flow-label": {
      color: colors.gray[10],
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "0.08em",
    },
    "& .flow-input": {
      margin: "0 20px 19px",
      padding: "10px 12px",
      border: `1px solid ${colors.gray[5]}`,
      borderRadius: "7px",
      background: colors.gray[2],
    },
    "& .flow-input pre": {
      margin: "5px 0 0",
      fontFamily: codeFontFamily,
      fontSize: "11px",
      lineHeight: 1.45,
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
    "& .flow-graph-heading": {
      display: "flex",
      justifyContent: "space-between",
      padding: "0 20px 9px",
      color: colors.gray[10],
      fontSize: "11px",
    },
  }),
  header: style({
    padding: "20px 22px 15px",
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    "& h3": { margin: "5px 0 3px", fontSize: "19px", lineHeight: 1.25 },
    "& p": { margin: "5px 0 0", color: colors.gray[11], fontSize: "13px" },
    "& .flow-eyebrow": {
      color: colors.blue[11],
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "0.1em",
    },
    "& .flow-count": {
      alignSelf: "start",
      whiteSpace: "nowrap",
      color: colors.gray[11],
      fontSize: "11px",
    },
  }),
  tabs: style({
    display: "flex",
    gap: "6px",
    padding: "0 20px 14px",
    overflowX: "auto",
  }),
  tab: style(focusRing(), {
    border: `1px solid ${colors.gray[6]}`,
    background: colors.gray[2],
    color: colors.gray[11],
    borderRadius: "6px",
    padding: "7px 11px",
    font: "inherit",
    fontSize: "12px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    "&[aria-selected='true']": {
      background: colors.blue[3],
      borderColor: colors.blue[8],
      color: colors.blue[11],
      fontWeight: 600,
    },
    "&:hover": { background: colors.gray[3] },
    "& .flow-tab-number": {
      fontFamily: codeFontFamily,
      fontSize: "10px",
      opacity: 0.65,
      marginRight: "8px",
    },
  }),
  graph: style({
    display: "flex",
    alignItems: "stretch",
    gap: "0",
    padding: "0 20px 18px",
    overflowX: "auto",
    "& .flow-graph-item": {
      display: "flex",
      alignItems: "center",
      flex: "0 0 auto",
    },
    "& .flow-connector": {
      color: colors.gray[8],
      padding: "0 7px",
      fontSize: "20px",
    },
  }),
  graphNode: style(focusRing(), {
    width: "150px",
    minHeight: "102px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    textAlign: "left",
    padding: "11px",
    border: `1px solid ${colors.gray[6]}`,
    borderRadius: "8px",
    background: colors.gray[2],
    color: colors.gray[12],
    cursor: "pointer",
    font: "inherit",
    "&[data-state='active']": {
      borderColor: colors.blue[9],
      background: colors.blue[2],
      boxShadow: `inset 0 3px ${colors.blue[9]}`,
    },
    "&[data-state='visited']": {
      borderColor: colors.green[8],
      background: colors.green[2],
    },
    "&:hover": { borderColor: colors.blue[8] },
    "& .flow-node-index": {
      color: colors.gray[10],
      fontFamily: codeFontFamily,
      fontSize: "10px",
      marginBottom: "8px",
    },
    "& strong": { fontSize: "12px", lineHeight: 1.25 },
    "& .flow-node-summary": {
      color: colors.gray[11],
      fontSize: "11px",
      lineHeight: 1.35,
      marginTop: "5px",
    },
  }),
  detail: style({
    margin: "0 20px 16px",
    padding: "17px",
    border: `1px solid ${colors.gray[6]}`,
    borderRadius: "8px",
    background: colors.gray[1],
    "& .flow-step-header": {
      display: "flex",
      justifyContent: "space-between",
      gap: "15px",
      alignItems: "start",
    },
    "& .flow-eyebrow": {
      color: colors.blue[11],
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "0.08em",
    },
    "& h4": { margin: "5px 0 4px", fontSize: "15px" },
    "& p": {
      margin: "3px 0 0",
      color: colors.gray[11],
      fontSize: "12px",
      lineHeight: 1.45,
    },
    "& .flow-values": {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))",
      gap: "10px",
      marginTop: "15px",
    },
    "& .flow-no-values": { margin: 0 },
  }),
  sourceButton: style(focusRing(), {
    border: 0,
    background: "transparent",
    color: colors.blue[11],
    font: "inherit",
    fontSize: "11px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    padding: "3px",
    cursor: "pointer",
    "&:hover": { color: colors.blue[12] },
  }),
  value: style({
    border: `1px solid ${colors.gray[5]}`,
    borderRadius: "6px",
    overflow: "hidden",
    "& .flow-value-label": {
      display: "block",
      padding: "5px 9px",
      background: colors.gray[3],
      color: colors.gray[11],
      fontSize: "10px",
      fontWeight: 700,
    },
    "& pre": {
      margin: 0,
      padding: "9px",
      overflowX: "auto",
      fontFamily: codeFontFamily,
      fontSize: "11px",
      lineHeight: 1.45,
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
  }),
  controls: style({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    padding: "12px 20px",
    borderTop: `1px solid ${colors.gray[5]}`,
    background: colors.gray[2],
    "& .flow-control-buttons": { display: "flex", gap: "6px" },
    "& .flow-result": {
      color: colors.gray[10],
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "0.06em",
      display: "flex",
      gap: "8px",
      alignItems: "baseline",
      minWidth: 0,
    },
    "& .flow-result code": {
      color: colors.gray[12],
      fontFamily: codeFontFamily,
      fontSize: "11px",
      fontWeight: 400,
      letterSpacing: "normal",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
  }),
  control: style(focusRing(), {
    border: `1px solid ${colors.gray[6]}`,
    borderRadius: "6px",
    background: backgroundColor.app,
    color: colors.gray[12],
    font: "inherit",
    fontSize: "11px",
    fontWeight: 600,
    padding: "5px 10px",
    cursor: "pointer",
    "&:hover": { background: colors.gray[3] },
    "&:disabled": { opacity: 0.4, cursor: "default" },
  }),
};
