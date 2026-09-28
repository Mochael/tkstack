#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(
  process.argv[2] ?? path.join(here, "../../tmp/tandem-source"),
);
const out = path.join(here, "generated");
const pin = "eb7a3fa9e70adb73fb5b44b8a5baf2997bc78918";
const git = (...args) =>
  execFileSync("git", args, { cwd: sourceRoot, encoding: "utf8" });

function historicalPatch(section) {
  const full = git(
    "show",
    "--format=",
    "--unified=3",
    section.commit,
    "--",
    section.file,
  );
  const firstHunk = full.search(/^@@ /m);
  if (firstHunk < 0)
    throw new Error(`No patch for ${section.file} at ${section.commit}`);
  const header = full.slice(0, firstHunk);
  const hunks = full
    .slice(firstHunk)
    .split(/(?=^@@ )/m)
    .filter(Boolean);
  const selected = section.hunks.map((needle) => {
    const found = hunks.find((hunk) => hunk.includes(needle));
    if (!found)
      throw new Error(`Missing hunk anchor ${needle} in ${section.file}`);
    return found;
  });
  return header + [...new Set(selected)].join("");
}

function addedExcerpt(section) {
  const source = git("show", `${section.commit}:${section.file}`)
    .replace(/\n$/, "")
    .split("\n");
  const { start, end } = section.range;
  if (start < 1 || end > source.length || start > end)
    throw new Error(`Invalid excerpt ${section.file}:${start}-${end}`);
  const lines = source
    .slice(start - 1, end)
    .map((line) => `+${line}`)
    .join("\n");
  if (section.addedInModifiedFile) {
    const full = git(
      "show",
      "--format=",
      "--unified=3",
      section.commit,
      "--",
      section.file,
    );
    const newSide = new Map();
    let newLine = 0;
    for (const line of full.split("\n")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        newLine = Number(hunk[1]);
      } else if (newLine > 0 && line.startsWith("+")) {
        newSide.set(newLine++, line.slice(1));
      } else if (newLine > 0 && line.startsWith(" ")) {
        newSide.set(newLine++, line.slice(1));
      }
    }
    for (let line = start; line <= end; line++) {
      if (newSide.get(line) !== source[line - 1])
        throw new Error(
          `Line ${line} is not on the new side of ${section.commit}:${section.file}`,
        );
    }
  }
  const oldFile = section.addedInModifiedFile
    ? `a/${section.file}`
    : "/dev/null";
  const mode = section.addedInModifiedFile ? "" : "new file mode 100644\n";
  const oldStart = section.addedInModifiedFile ? start - 1 : 0;
  return `diff --git a/${section.file} b/${section.file}\n${mode}--- ${oldFile}\n+++ b/${section.file}\n@@ -${oldStart},0 +${start},${end - start + 1} @@\n${lines}\n`;
}

function anchorLine(patch, note, file) {
  let oldLine = 0;
  let newLine = 0;
  const matches = [];
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode")
    )
      continue;
    if (line.startsWith("+")) {
      if (note.side === "new" && line.includes(note.anchor))
        matches.push(newLine);
      newLine++;
    } else if (line.startsWith("-")) {
      if (note.side === "old" && line.includes(note.anchor))
        matches.push(oldLine);
      oldLine++;
    } else if (line.startsWith(" ")) {
      if (line.includes(note.anchor))
        matches.push(note.side === "new" ? newLine : oldLine);
      oldLine++;
      newLine++;
    }
  }
  if (matches.length !== 1)
    throw new Error(
      `Expected one ${note.side} anchor in ${file}: ${note.anchor}; found ${matches.length}`,
    );
  return matches[0];
}

function codeBlock(block) {
  const patch = block.range ? addedExcerpt(block) : historicalPatch(block);
  const notes = block.notes.map((note) => {
    if (note.text.includes("\n") || note.text.includes("\t"))
      throw new Error("Review notes must be one line");
    return `@${note.side}:${anchorLine(patch, note, block.file)}\t${note.text}`;
  });
  return `**${block.label}**\n\n\`\`\`review-diff:${block.file}\n${notes.join("\n")}\n--- PATCH ---\n${patch.trimEnd()}\n\`\`\`\n`;
}

function codeSection(section) {
  const transition = `**Input:** ${section.input} → **Output:** ${section.output}`;
  return `## ${section.heading}\n\n${transition}\n\n${section.blocks.map(codeBlock).join("\n")}`;
}

await mkdir(out, { recursive: true });
const [current, questions, planText] = await Promise.all([
  readFile(path.join(here, "templates/current.md"), "utf8"),
  readFile(path.join(here, "templates/questions.md"), "utf8"),
  readFile(path.join(here, "code-plan.json"), "utf8"),
]);
const plan = JSON.parse(planText);
const sections = plan.sections.map(codeSection);
const codeView = `# ${plan.title}\n\n\`Tandem @ ${pin.slice(0, 7)}\`\n\n${plan.orientation}\n\n${sections.join("\n")}`;
await Promise.all([
  writeFile(path.join(out, "00-current.md"), current),
  writeFile(path.join(out, "01-questions.md"), questions),
  writeFile(path.join(out, "02-code-centric.md"), codeView),
]);
console.log(`Generated three views in ${out}`);
