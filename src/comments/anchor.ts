/**
 * Anchor resolution. Pure functions over a list of text blocks so the viewer
 * can feed it blocks read out of the DOM while the server and the tests feed it
 * blocks derived from the parsed document.
 */

import type {
  ViewerDocument,
  ViewerElement,
  ViewerNode,
} from "../parseViewer.js";
import type { CommentSelection, CommentSurface } from "./types.js";

export type TextBlock = {
  tag: string;
  /** Ordinal among blocks carrying the same tag. */
  index: number;
  /** Whitespace-normalized text; selection offsets are in this space. */
  text: string;
  hash: string;
};

export type ResolvedAnchor =
  | {
      status: "exact" | "relocated";
      block: TextBlock;
      start: number;
      length: number;
    }
  | { status: "document" }
  | { status: "stale" };

/** Tags that can hold a reader's selection. Code fences are excluded. */
export const BLOCK_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
] as const;

const blockTags = new Set<string>(BLOCK_TAGS);

export function isBlockTag(tag: string) {
  return blockTags.has(tag);
}

export function normalizeBlockText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * FNV-1a, 32 bits, salted with the length. Hashing has to agree between the
 * browser and Node without a dependency or an async WebCrypto call, and these
 * hashes only ever guard a local sidecar file.
 */
export function textHash(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${value.length.toString(36)}`;
}

export function makeTextBlock(input: {
  tag: string;
  index: number;
  text: string;
}): TextBlock {
  const text = normalizeBlockText(input.text);
  return { tag: input.tag, index: input.index, text, hash: textHash(text) };
}

/** Blocks as parsed from the markdown. The viewer uses the DOM instead. */
export function collectDocumentBlocks(document: ViewerDocument): TextBlock[] {
  const blocks: TextBlock[] = [];
  const counts = new Map<string, number>();
  walk(document.nodes, blocks, counts);
  return blocks;
}

function walk(
  nodes: ViewerNode[],
  blocks: TextBlock[],
  counts: Map<string, number>,
) {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (isBlockTag(node.tag)) {
      const text = normalizeBlockText(elementText(node));
      if (text !== "") {
        const index = counts.get(node.tag) ?? 0;
        counts.set(node.tag, index + 1);
        blocks.push(makeTextBlock({ tag: node.tag, index, text }));
      }
    }
    walk(node.children, blocks, counts);
  }
}

function elementText(node: ViewerNode): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  return (node as ViewerElement).children.map(elementText).join("");
}

/**
 * Re-point a stored selection at the current blocks. Exact matches win; a
 * moved or renumbered block counts as relocated; anything else is stale and is
 * reported as such rather than silently re-pointed at different text.
 */
export function resolveAnchor(input: {
  surface: CommentSurface;
  selection: CommentSelection;
  blocks: TextBlock[];
}): ResolvedAnchor {
  const { selection, surface, blocks } = input;
  if (surface.type === "document") return { status: "document" };
  const length = selection.quote.length;

  const named = blocks.find(
    (block) => block.tag === surface.tag && block.index === surface.index,
  );
  if (
    named !== undefined &&
    named.hash === surface.blockHash &&
    quoteAt(named, selection.start, selection.quote)
  ) {
    return { status: "exact", block: named, start: selection.start, length };
  }

  // The block still exists but its text shifted, or the block moved and kept
  // its text. Both are relocations, not new anchors.
  const candidates = [
    ...(named === undefined ? [] : [named]),
    ...blocks.filter(
      (block) => block !== named && block.hash === surface.blockHash,
    ),
    ...blocks.filter(
      (block) =>
        block !== named &&
        block.hash !== surface.blockHash &&
        block.tag === surface.tag,
    ),
    ...blocks.filter((block) => block !== named && block.tag !== surface.tag),
  ];
  for (const block of candidates) {
    const start = nearestQuoteOffset(block, selection);
    if (start === undefined) continue;
    return { status: "relocated", block, start, length };
  }
  return { status: "stale" };
}

function quoteAt(block: TextBlock, start: number, quote: string) {
  return block.text.slice(start, start + quote.length) === quote;
}

/** The occurrence of the quote closest to where it used to sit. */
function nearestQuoteOffset(block: TextBlock, selection: CommentSelection) {
  if (selection.quote === "") return undefined;
  let best: number | undefined;
  let cursor = block.text.indexOf(selection.quote);
  while (cursor !== -1) {
    if (
      best === undefined ||
      Math.abs(cursor - selection.start) < Math.abs(best - selection.start)
    ) {
      best = cursor;
    }
    cursor = block.text.indexOf(selection.quote, cursor + 1);
  }
  return best;
}
