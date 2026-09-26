/**
 * The sections a quiz question can be placed after. Browser-safe: the server
 * offers these to the placement run, and the viewer uses the same boundaries
 * to render each question at the end of its section.
 */

import type { ViewerDocument } from "../parseViewer.js";

export type DocumentSection = {
  id: string;
  level: number;
  title: string;
  /** Top-level node index the section's questions render before. */
  end: number;
};

const HEADING = /^h([1-6])$/;

/** Top-level headings only; a heading nested in a list or quote has no clean end. */
export function documentSections(document: ViewerDocument): DocumentSection[] {
  const headings: {
    index: number;
    id: string;
    level: number;
    title: string;
  }[] = [];
  document.nodes.forEach((node, index) => {
    if (node.type !== "element") return;
    const level = HEADING.exec(node.tag)?.[1];
    const id = node.attrs.id;
    if (level === undefined || id === undefined || id === "") return;
    headings.push({ index, id, level: Number(level), title: text(node) });
  });
  return headings.map((heading, position) => {
    const next = headings
      .slice(position + 1)
      .find((candidate) => candidate.level <= heading.level);
    return {
      id: heading.id,
      level: heading.level,
      title: heading.title,
      end: next?.index ?? document.nodes.length,
    };
  });
}

function text(node: ViewerDocument["nodes"][number]): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  return node.children.map(text).join("");
}
