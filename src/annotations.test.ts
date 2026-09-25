import assert from "node:assert/strict";
import test from "node:test";
import { parseCallStack } from "./annotations.js";

test("parseCallStack attaches > lines to the row above as details", () => {
  const rows = parseCallStack(
    [
      " check() [[mac:new:102-109]]",
      " > Runs one update check at a time.",
      " > A second call waits for the first.",
      " >",
      " > Stops while Halo is installing.",
      " > in: check() while another check runs",
      " > out: the same promise as the running check",
      " └── checkUnqueued()",
    ].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]!.references, [
    { kind: "diff", id: "mac", side: "new", start: 102, end: 109 },
  ]);
  assert.deepEqual(rows[0]!.details, {
    paragraphs: [
      "Runs one update check at a time. A second call waits for the first.",
      "Stops while Halo is installing.",
    ],
    example: [
      { kind: "in", text: "check() while another check runs" },
      { kind: "out", text: "the same promise as the running check" },
    ],
  });
  assert.equal(rows[1]!.details, undefined);
});

test("parseCallStack accepts > lines after the tree's vertical guides", () => {
  const rows = parseCallStack(
    [" start()", " └── check()", "     │ > nested note", " └── done"].join(
      "\n",
    ),
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1]!.details?.paragraphs, ["nested note"]);
});

test("parseCallStack accepts a diff sign before a detail line", () => {
  const rows = parseCallStack("+ added()\n+   > what it adds\n- removed()");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]!.details?.paragraphs, ["what it adds"]);
});

test("parseCallStack keeps a leading > line as a row", () => {
  const rows = parseCallStack("> not a detail\n next");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.details, undefined);
});
