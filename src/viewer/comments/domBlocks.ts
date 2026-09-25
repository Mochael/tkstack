/**
 * The bridge between a browser selection and the stored anchor.
 *
 * Each commentable element is read into the same whitespace-normalized text
 * the anchor model uses, together with a per-character map back into the DOM,
 * so an offset can become a `Range` again for highlighting.
 */

import {
  BLOCK_TAGS,
  makeTextBlock,
  type TextBlock,
} from "../../comments/anchor.js";

export type DomBlock = {
  block: TextBlock;
  element: HTMLElement;
  /** `positions[i]` is where normalized character `i` lives in the DOM. */
  positions: { node: Text; offset: number }[];
};

export type DomSpan = { block: DomBlock; start: number; length: number };

/**
 * Fences (call stacks, diagrams, excerpts, trusted HTML) render their own
 * markup. Each one is a single block named after its kind, and the prose tags
 * inside it are not counted, so fence markup never shifts prose ordinals.
 */
const VIEW_KINDS = ["callstack", "mermaid", "file", "diff", "html"] as const;
const viewSelector = VIEW_KINDS.map(
  (kind) => `[data-diffmap-kind="${kind}"]`,
).join(",");
const blockSelector = [...BLOCK_TAGS, viewSelector].join(",");

export function collectDomBlocks(container: HTMLElement): DomBlock[] {
  const counts = new Map<string, number>();
  const blocks: DomBlock[] = [];
  for (const element of container.querySelectorAll(blockSelector)) {
    if (!(element instanceof HTMLElement)) continue;
    const view = element.matches(viewSelector);
    const outerView = (view ? element.parentElement : element)?.closest(
      viewSelector,
    );
    if (outerView !== null && outerView !== undefined) continue;
    if (!view && element.closest("pre, code") !== null) continue;
    const read = readBlockText(element);
    if (read.text === "") continue;
    const tag = view
      ? (element.dataset["diffmapKind"] ?? "view")
      : element.tagName.toLowerCase();
    const index = counts.get(tag) ?? 0;
    counts.set(tag, index + 1);
    blocks.push({
      block: makeTextBlock({ tag, index, text: read.text }),
      element,
      positions: read.positions,
    });
  }
  return blocks;
}
/** Mirrors `normalizeBlockText` while remembering where each character came from. */
function readBlockText(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const characters: string[] = [];
  const positions: { node: Text; offset: number }[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    const text = node as Text;
    const value = text.data;
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset]!;
      if (/\s/.test(character)) {
        if (characters.length === 0 || characters.at(-1) === " ") continue;
        characters.push(" ");
      } else {
        characters.push(character);
      }
      positions.push({ node: text, offset });
    }
    node = walker.nextNode();
  }
  while (characters.at(-1) === " ") {
    characters.pop();
    positions.pop();
  }
  return { text: characters.join(""), positions };
}

export function findDomBlock(blocks: DomBlock[], block: TextBlock) {
  return blocks.find(
    (candidate) =>
      candidate.block.tag === block.tag &&
      candidate.block.index === block.index,
  );
}

/** A DOM range from the start of `from` to the end of `to`. */
export function rangeForSpans(from: DomSpan, to: DomSpan) {
  const first = from.block.positions[from.start];
  const last = to.block.positions[to.start + to.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

type Touched = { block: DomBlock; first: number; last: number };

/**
 * The spans a live selection covers, trimmed to characters that are actually
 * selected, so a triple-click that ends at offset 0 of the next block still
 * lands in one block. `from` and `to` are the same span unless the selection
 * crosses blocks.
 */
export function spansForSelection(blocks: DomBlock[], range: Range) {
  const touched: Touched[] = [];
  for (const block of blocks) {
    if (!range.intersectsNode(block.element)) continue;
    let first: number | undefined;
    let last: number | undefined;
    for (const [index, position] of block.positions.entries()) {
      if (!isSelected(range, position)) continue;
      first ??= index;
      last = index;
    }
    if (first !== undefined && last !== undefined) {
      touched.push({ block, first, last });
    }
  }
  // Blocks are in document order, so on a tie the later one is the deeper.
  let start: Touched | undefined;
  let end: Touched | undefined;
  for (const entry of touched) {
    if (
      start === undefined ||
      comparePositions(firstPosition(entry), firstPosition(start)) <= 0
    ) {
      start = entry;
    }
    if (
      end === undefined ||
      comparePositions(lastPosition(entry), lastPosition(end)) >= 0
    ) {
      end = entry;
    }
  }
  if (start === undefined || end === undefined) return undefined;
  // A selection from a list item into its nested list stays in the outer item.
  if (start.block.element.contains(end.block.element)) end = start;
  else if (end.block.element.contains(start.block.element)) start = end;
  if (start === end) {
    const span = spanOf(start);
    return { from: span, to: span };
  }
  return { from: spanOf(start), to: spanOf(end) };
}

function spanOf(entry: Touched): DomSpan {
  return {
    block: entry.block,
    start: entry.first,
    length: entry.last - entry.first + 1,
  };
}

function firstPosition(entry: Touched) {
  return entry.block.positions[entry.first]!;
}

function lastPosition(entry: Touched) {
  return entry.block.positions[entry.last]!;
}

function comparePositions(
  a: { node: Text; offset: number },
  b: { node: Text; offset: number },
) {
  if (a.node === b.node) return a.offset - b.offset;
  return a.node.compareDocumentPosition(b.node) &
    Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

function isSelected(range: Range, position: { node: Text; offset: number }) {
  return (
    range.comparePoint(position.node, position.offset) >= 0 &&
    range.comparePoint(position.node, position.offset + 1) <= 0
  );
}
