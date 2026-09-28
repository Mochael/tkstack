import { parseAnnotation, type SourceAnnotation } from "./annotations.js";

export type FlowNode = {
  id: string;
  label: string;
  summary: string;
  source?: SourceAnnotation;
};

export type FlowStep = {
  node: string;
  title: string;
  detail?: string;
  input?: unknown;
  output?: unknown;
};

export type FlowCase = {
  id: string;
  label: string;
  input: unknown;
  steps: FlowStep[];
  result: unknown;
};

export type FlowExamples = {
  title: string;
  description?: string;
  nodes: FlowNode[];
  cases: FlowCase[];
};

export function parseFlowExamples(source: string): FlowExamples | Error {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    return new Error(`Invalid flow-examples JSON: ${String(cause)}`);
  }
  if (!record(value) || !nonempty(value.title))
    return new Error("flow-examples needs a title.");
  if (value.description !== undefined && typeof value.description !== "string")
    return new Error("flow-examples description must be text.");
  if (!Array.isArray(value.nodes) || value.nodes.length === 0)
    return new Error("flow-examples needs at least one node.");
  if (!Array.isArray(value.cases) || value.cases.length === 0)
    return new Error("flow-examples needs at least one case.");

  const nodes: FlowNode[] = [];
  const nodeIds = new Set<string>();
  for (const [index, raw] of value.nodes.entries()) {
    if (
      !record(raw) ||
      !nonempty(raw.id) ||
      !nonempty(raw.label) ||
      !nonempty(raw.summary)
    )
      return new Error(
        `flow-examples node ${index + 1} needs id, label, and summary.`,
      );
    if (nodeIds.has(raw.id))
      return new Error(`Duplicate flow node "${raw.id}".`);
    nodeIds.add(raw.id);
    let annotation: SourceAnnotation | undefined;
    if (raw.source !== undefined) {
      if (typeof raw.source !== "string")
        return new Error(`flow-examples node "${raw.id}" source must be text.`);
      annotation = parseAnnotation(raw.source);
      if (annotation.references.length !== 1 || annotation.text.trim() !== "")
        return new Error(
          `flow-examples node "${raw.id}" needs one [[source reference]].`,
        );
    }
    nodes.push({
      id: raw.id,
      label: raw.label,
      summary: raw.summary,
      source: annotation,
    });
  }

  const cases: FlowCase[] = [];
  const caseIds = new Set<string>();
  for (const [index, raw] of value.cases.entries()) {
    if (
      !record(raw) ||
      !nonempty(raw.id) ||
      !nonempty(raw.label) ||
      !has(raw, "input") ||
      !has(raw, "result")
    )
      return new Error(
        `flow-examples case ${index + 1} needs id, label, input, and result.`,
      );
    if (caseIds.has(raw.id))
      return new Error(`Duplicate flow case "${raw.id}".`);
    caseIds.add(raw.id);
    if (!Array.isArray(raw.steps) || raw.steps.length === 0)
      return new Error(`flow-examples case "${raw.id}" needs steps.`);
    const steps: FlowStep[] = [];
    for (const [stepIndex, step] of raw.steps.entries()) {
      if (
        !record(step) ||
        !nonempty(step.node) ||
        !nonempty(step.title) ||
        !nodeIds.has(step.node)
      )
        return new Error(
          `Invalid step ${stepIndex + 1} in flow case "${raw.id}".`,
        );
      if (step.detail !== undefined && typeof step.detail !== "string")
        return new Error(`Step ${stepIndex + 1} detail must be text.`);
      steps.push({
        node: step.node,
        title: step.title,
        detail: step.detail,
        ...(has(step, "input") ? { input: step.input } : {}),
        ...(has(step, "output") ? { output: step.output } : {}),
      });
    }
    cases.push({
      id: raw.id,
      label: raw.label,
      input: raw.input,
      steps,
      result: raw.result,
    });
  }
  return { title: value.title, description: value.description, nodes, cases };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}
