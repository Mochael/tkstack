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

const blockSelector = BLOCK_TAGS.join(",");

export function collectDomBlocks(container: HTMLElement): DomBlock[] {
  const counts = new Map<string, number>();
  const blocks: DomBlock[] = [];
  for (const element of container.querySelectorAll(blockSelector)) {
    if (!(element instanceof HTMLElement)) continue;
    // Code excerpts and diffs render their own markup; they are not prose.
    if (element.closest("pre, code, [data-diffmap-view]") !== null) continue;
    const read = readBlockText(element);
    if (read.text === "") continue;
    const tag = element.tagName.toLowerCase();
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

/** A DOM range covering normalized characters `[start, start + length)`. */
export function rangeForOffsets(
  block: DomBlock,
  start: number,
  length: number,
) {
  const first = block.positions[start];
  const last = block.positions[start + length - 1];
  if (first === undefined || last === undefined) return undefined;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

/** The normalized offsets a live selection covers, if it sits in one block. */
export function offsetsForSelection(blocks: DomBlock[], range: Range) {
  // Last match wins: a nested list item is deeper than its parent.
  const block = blocks.findLast(
    (candidate) =>
      candidate.element.contains(range.startContainer) &&
      candidate.element.contains(range.endContainer),
  );
  if (block === undefined) return undefined;
  let start: number | undefined;
  let end: number | undefined;
  for (const [index, position] of block.positions.entries()) {
    if (!isSelected(range, position)) continue;
    start ??= index;
    end = index + 1;
  }
  if (start === undefined || end === undefined) return undefined;
  return { block, start, length: end - start };
}

function isSelected(range: Range, position: { node: Text; offset: number }) {
  return (
    range.comparePoint(position.node, position.offset) >= 0 &&
    range.comparePoint(position.node, position.offset + 1) <= 0
  );
}
