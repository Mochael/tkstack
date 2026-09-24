import assert from "node:assert/strict";
import test from "node:test";
import { parseViewerDocument } from "../parseViewer.js";
import {
  collectDocumentBlocks,
  makeTextBlock,
  resolveAnchor,
  textHash,
  type TextBlock,
} from "./anchor.js";
import type { CommentSelection, CommentSurface } from "./types.js";

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
