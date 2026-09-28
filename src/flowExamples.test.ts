import assert from "node:assert/strict";
import test from "node:test";
import { parseFlowExamples } from "./flowExamples.js";
import { parseViewerDocument } from "./parseViewer.js";

const example = {
  title: "Write through sync",
  nodes: [
    {
      id: "start",
      label: "Start",
      summary: "Open the run",
      source: "[[src/flowExamples.ts#parseFlowExamples]]",
    },
    { id: "end", label: "Finish", summary: "Check the result" },
  ],
  cases: [
    {
      id: "success",
      label: "Accepted write",
      input: { value: 1 },
      steps: [
        { node: "start", title: "Begin", input: { value: 1 } },
        { node: "end", title: "Accepted", output: { value: 1 } },
      ],
      result: { value: 1 },
    },
  ],
};

test("flow examples parse cases, values, and source references", () => {
  const parsed = parseFlowExamples(JSON.stringify(example));
  assert.equal(parsed instanceof Error, false);
  if (parsed instanceof Error) return;
  assert.equal(parsed.cases[0]?.steps[1]?.node, "end");
  assert.deepEqual(parsed.cases[0]?.result, { value: 1 });
  assert.equal(parsed.nodes[0]?.source?.references[0]?.kind, "file");
  const document = parseViewerDocument(
    `\`\`\`flow-examples\n${JSON.stringify(example)}\n\`\`\``,
  );
  assert.equal(document instanceof Error, false);
  if (document instanceof Error) return;
  assert.equal(document.hasReferences, true);
});

test("flow examples reject unknown nodes and duplicate ids", () => {
  const unknown = structuredClone(example);
  unknown.cases[0]!.steps[0]!.node = "missing";
  assert.match(
    String(parseFlowExamples(JSON.stringify(unknown))),
    /Invalid step 1/,
  );
  const duplicate = structuredClone(example);
  duplicate.nodes.push(duplicate.nodes[0]!);
  assert.match(
    String(parseFlowExamples(JSON.stringify(duplicate))),
    /Duplicate flow node/,
  );
});

test("invalid flow examples fail document parsing", () => {
  const result = parseViewerDocument(
    "```flow-examples\n{broken\n```",
    "example.md",
  );
  assert.equal(result instanceof Error, true);
  assert.match(String(result), /Invalid flow-examples JSON/);
});
