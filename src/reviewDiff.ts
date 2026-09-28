import { parsePatchFiles } from "@pierre/diffs";

export type ReviewNote = {
  side: "deletions" | "additions";
  lineNumber: number;
  metadata: string;
};

export type ReviewDiff = { patch: string; notes: ReviewNote[] };

export function parseReviewDiff(
  source: string,
  path: string,
): ReviewDiff | Error {
  const separator = "\n--- PATCH ---\n";
  const at = source.indexOf(separator);
  if (at < 0) return new Error(`Review diff for ${path} needs --- PATCH ---`);
  const notes: ReviewNote[] = [];
  for (const line of source.slice(0, at).split("\n")) {
    if (line.trim() === "") continue;
    const match = /^@(old|new):(\d+)\t(.+)$/.exec(line);
    if (!match) return new Error(`Invalid review note in ${path}: ${line}`);
    notes.push({
      side: match[1] === "old" ? "deletions" : "additions",
      lineNumber: Number(match[2]),
      metadata: match[3]!,
    });
  }
  const patch = source.slice(at + separator.length);
  try {
    const files = parsePatchFiles(patch, undefined, true).flatMap(
      (item) => item.files,
    );
    if (
      files.length !== 1 ||
      files[0]?.name !== path ||
      files[0].hunks.length === 0
    ) {
      return new Error(
        `Review diff for ${path} must contain one matching file with hunks`,
      );
    }
    for (const note of notes) {
      const inHunk = files[0].hunks.some((hunk) => {
        const start =
          note.side === "deletions" ? hunk.deletionStart : hunk.additionStart;
        const count =
          note.side === "deletions" ? hunk.deletionCount : hunk.additionCount;
        return note.lineNumber >= start && note.lineNumber < start + count;
      });
      if (!inHunk)
        return new Error(
          `Review note ${note.side}:${note.lineNumber} is outside ${path}`,
        );
    }
  } catch (cause) {
    return new Error(`Invalid review patch for ${path}`, { cause });
  }
  return { patch, notes };
}
