import assert from "node:assert/strict";
import test from "node:test";
import { parseViewerDocument } from "../parseViewer.js";
import { documentSections } from "./sections.js";

test("documentSections ends each section at the next heading of its level or higher", () => {
  const document = parseViewerDocument(
    "# Title\n\nIntro.\n\n## Problem\n\nText.\n\n### Detail\n\nMore.\n\n## Fix\n\nDone.\n",
    "review.md",
  );
  assert.ok(!(document instanceof Error));
  const sections = documentSections(document);
  const byId = new Map(sections.map((section) => [section.id, section]));
  const indexOf = (id: string) =>
    document.nodes.findIndex(
      (node) => node.type === "element" && node.attrs.id === id,
    );
  assert.deepEqual(
    sections.map((section) => section.id),
    ["title", "problem", "detail", "fix"],
  );
  assert.equal(byId.get("problem")?.end, indexOf("fix"));
  assert.equal(byId.get("detail")?.end, indexOf("fix"));
  assert.equal(byId.get("fix")?.end, document.nodes.length);
  assert.equal(byId.get("title")?.end, document.nodes.length);
});
