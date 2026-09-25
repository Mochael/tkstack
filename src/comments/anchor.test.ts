import assert from "node:assert/strict";
import test from "node:test";
import { parseViewerDocument } from "../parseViewer.js";
import {
  collectDocumentBlocks,
  makeTextBlock,
  resolveAnchor,
  resolveTarget,
  textHash,
  type TextBlock,
} from "./anchor.js";
import type {
  CommentSelection,
  CommentSurface,
  CommentTarget,
} from "./types.js";

function blocksOf(source: string) {
  const document = parseViewerDocument(source, "spec.md");
  assert.equal(document instanceof Error, false);
  if (document instanceof Error) throw document;
  return collectDocumentBlocks(document);
}

function anchorTo(blocks: TextBlock[], quote: string) {
  const block = blocks.find((item) => item.text.includes(quote));
  assert.ok(block !== undefined, `no block contains ${quote}`);
  const start = block.text.indexOf(quote);
  const surface: CommentSurface = {
    type: "block",
    tag: block.tag,
    index: block.index,
    blockHash: block.hash,
  };
  const selection: CommentSelection = {
    start,
    length: quote.length,
    hash: textHash(quote),
    quote,
  };
  return { surface, selection };
}

const document = `# Recovery

The updater retries once before falling back.

- The queue drains on restart.
- Stale locks expire after five minutes.

## Notes

A closing paragraph.
`;

test("collectDocumentBlocks numbers blocks per tag and normalizes whitespace", () => {
  const blocks = blocksOf("# Title\n\nOne\nline   wrapped.\n\nSecond.\n");
  assert.deepEqual(
    blocks.map((block) => [block.tag, block.index, block.text]),
    [
      ["h1", 0, "Title"],
      ["p", 0, "One line wrapped."],
      ["p", 1, "Second."],
    ],
  );
});

test("collectDocumentBlocks skips code fences", () => {
  const blocks = blocksOf("Prose.\n\n```ts\nconst hidden = 1;\n```\n");
  assert.deepEqual(
    blocks.map((block) => block.text),
    ["Prose."],
  );
});

test("resolveAnchor returns an exact match on an unchanged document", () => {
  const blocks = blocksOf(document);
  const anchor = anchorTo(blocks, "retries once");
  const resolved = resolveAnchor({ ...anchor, blocks });
  assert.equal(resolved.status, "exact");
  assert.ok(resolved.status === "exact");
  assert.equal(
    resolved.block.text.slice(resolved.start, resolved.start + resolved.length),
    "retries once",
  );
});

test("resolveAnchor survives an unrelated rewrite of the document", () => {
  const blocks = blocksOf(document);
  const anchor = anchorTo(blocks, "Stale locks expire");
  const rewritten = blocksOf(
    document
      .replace("# Recovery", "# Recovery and rollback")
      .replace(
        "The updater retries once before falling back.",
        "A brand new paragraph.\n\nThe updater retries once, twice on Windows.",
      ),
  );
  const resolved = resolveAnchor({ ...anchor, blocks: rewritten });
  assert.equal(resolved.status, "exact");
  assert.ok(resolved.status === "exact");
  assert.equal(
    resolved.block.text.slice(resolved.start, resolved.start + resolved.length),
    "Stale locks expire",
  );
});

test("resolveAnchor relocates when the block ordinal shifts", () => {
  const blocks = blocksOf(document);
  const anchor = anchorTo(blocks, "Stale locks expire");
  const rewritten = blocksOf(
    document.replace(
      "- The queue drains on restart.",
      "- A new first bullet.\n- The queue drains on restart.",
    ),
  );
  const resolved = resolveAnchor({ ...anchor, blocks: rewritten });
  assert.equal(resolved.status, "relocated");
  assert.ok(resolved.status === "relocated");
  assert.equal(resolved.block.index, 2);
  assert.equal(
    resolved.block.text.slice(resolved.start, resolved.start + resolved.length),
    "Stale locks expire",
  );
});

test("resolveAnchor relocates when the block keeps its text but moves", () => {
  const blocks = blocksOf("Alpha sentence.\n\nBeta sentence.\n");
  const anchor = anchorTo(blocks, "Beta");
  const reordered = blocksOf("Beta sentence.\n\nAlpha sentence.\n");
  const resolved = resolveAnchor({ ...anchor, blocks: reordered });
  assert.equal(resolved.status, "relocated");
  assert.ok(resolved.status === "relocated");
  assert.equal(resolved.block.index, 0);
  assert.equal(resolved.start, 0);
});

test("resolveAnchor reports stale when the quoted text is gone", () => {
  const blocks = blocksOf(document);
  const anchor = anchorTo(blocks, "retries once");
  const rewritten = blocksOf(
    document.replace(
      "The updater retries once before falling back.",
      "The updater gives up immediately.",
    ),
  );
  const resolved = resolveAnchor({ ...anchor, blocks: rewritten });
  assert.equal(resolved.status, "stale");
});

test("resolveAnchor never re-points at different text", () => {
  const blocks = [
    makeTextBlock({ tag: "p", index: 0, text: "Totally other." }),
  ];
  const resolved = resolveAnchor({
    surface: { type: "block", tag: "p", index: 0, blockHash: "stale-hash" },
    selection: { start: 0, length: 5, hash: "x", quote: "gone!" },
    blocks,
  });
  assert.equal(resolved.status, "stale");
});

test("resolveAnchor treats a document surface as document-wide", () => {
  const resolved = resolveAnchor({
    surface: { type: "document", documentHash: "abc" },
    selection: { start: 0, length: 3, hash: "x", quote: "abc" },
    blocks: [],
  });
  assert.equal(resolved.status, "document");
});

test("textHash is stable and length-salted", () => {
  assert.equal(textHash("hello"), textHash("hello"));
  assert.notEqual(textHash("hello"), textHash("hello "));
});

function rangeTo(blocks: TextBlock[], first: string, last: string) {
  return {
    kind: "range",
    start: anchorTo(blocks, first),
    end: anchorTo(blocks, last),
    quote: `${first} … ${last}`,
  } satisfies CommentTarget;
}

test("collectDocumentBlocks counts markdown table cells", () => {
  const blocks = blocksOf(
    "| Name | Value |\n| --- | --- |\n| alpha | one |\n| beta | two |\n",
  );
  assert.deepEqual(
    blocks.map((block) => [block.tag, block.index, block.text]),
    [
      ["th", 0, "Name"],
      ["th", 1, "Value"],
      ["td", 0, "alpha"],
      ["td", 1, "one"],
      ["td", 2, "beta"],
      ["td", 3, "two"],
    ],
  );
});

test("resolveTarget anchors a range across blocks exactly", () => {
  const blocks = blocksOf(document);
  const resolved = resolveTarget(
    rangeTo(blocks, "falling back.", "The queue drains"),
    blocks,
  );
  assert.equal(resolved.status, "exact");
  if (resolved.status !== "exact") return;
  assert.equal(resolved.from.block.tag, "p");
  assert.equal(resolved.to.block.tag, "li");
  assert.equal(resolved.to.start, 0);
});

test("resolveTarget relocates a range when a block is inserted above", () => {
  const before = blocksOf(document);
  const target = rangeTo(before, "falling back.", "The queue drains");
  const after = blocksOf(
    document.replace("# Recovery\n", "# Recovery\n\nA new intro.\n"),
  );
  assert.equal(resolveTarget(target, after).status, "relocated");
});

test("resolveTarget reports a range stale when either end is gone", () => {
  const before = blocksOf(document);
  const target = rangeTo(before, "falling back.", "The queue drains");
  const after = blocksOf(document.replace("The queue drains", "Jobs resume"));
  assert.equal(resolveTarget(target, after).status, "stale");
});

test("resolveTarget reports a range stale when its ends swap order", () => {
  const before = blocksOf(document);
  const target = rangeTo(before, "falling back.", "A closing paragraph.");
  const swapped = blocksOf(
    "# Recovery\n\nA closing paragraph.\n\nThe updater retries once before falling back.\n",
  );
  assert.equal(resolveTarget(target, swapped).status, "stale");
});

test("resolveTarget keeps unanchored quotes document-wide", () => {
  const blocks = blocksOf(document);
  assert.deepEqual(
    resolveTarget({ kind: "document", quote: "const x = 1;" }, blocks),
    { status: "document" },
  );
});
