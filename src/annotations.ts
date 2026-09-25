type DiffReference = {
  kind: "diff";
  id: string;
  side: "old" | "new";
  start: number;
  end: number;
};

type FileReference = {
  kind: "file";
  path: string;
  symbol?: string;
  start?: number;
  end?: number;
};

export type SourceReference = DiffReference | FileReference;

export type SourceAnnotation = {
  text: string;
  references: SourceReference[];
  /** Collapsible notes under a call stack row, from `>` lines below it. */
  details?: StackDetails;
};

export type StackExample = { kind: "in" | "out"; text: string };

export type StackDetails = {
  /** Description paragraphs; a bare `>` line starts a new one. */
  paragraphs: string[];
  /** `> in:` / `> out:` lines, in order, shown as an example. */
  example: StackExample[];
};

/**
 * `> text`, optionally after a diff sign and the tree's vertical guides so it
 * can line up under its row.
 */
const detailLinePattern = /^[+-]?[ \t│┃]*>(?: (.*)|$)/u;
const exampleLinePattern = /^(in|out):\s?(.*)$/;

export function parseCallStack(source: string): SourceAnnotation[] {
  const rows: SourceAnnotation[] = [];
  for (const line of source.split("\n")) {
    const detail = detailLinePattern.exec(line);
    const owner = rows.at(-1);
    if (detail === null || owner === undefined) {
      rows.push(parseAnnotation(line));
      continue;
    }
    owner.details ??= { paragraphs: [], example: [] };
    addDetail(owner.details, detail[1] ?? "");
  }
  return rows;
}

function addDetail(details: StackDetails, text: string) {
  const example = exampleLinePattern.exec(text);
  if (example !== null) {
    details.example.push({
      kind: example[1] === "in" ? "in" : "out",
      text: example[2]!,
    });
    return;
  }
  const { paragraphs } = details;
  if (text.trim() === "") {
    if (paragraphs.at(-1) !== "") paragraphs.push("");
    return;
  }
  const last = paragraphs.length - 1;
  if (last < 0 || paragraphs[last] === "") {
    if (last >= 0) paragraphs[last] = text;
    else paragraphs.push(text);
    return;
  }
  paragraphs[last] = `${paragraphs[last]} ${text}`;
}

export function parseAnnotation(line: string): SourceAnnotation {
  const references: SourceReference[] = [];
  const text = line.replace(
    /\s*\[\[([^[\]\n]+)\]\]/g,
    (match, value: string) => {
      const reference = parseReference(value);
      if (reference === undefined) return match;
      references.push(reference);
      return "";
    },
  );
  return { text, references };
}

function parseReference(value: string): SourceReference | undefined {
  const diff = /^([\w-]+):(old|new):([1-9]\d*)(?:-([1-9]\d*))?$/.exec(value);
  if (diff !== null)
    return {
      kind: "diff",
      id: diff[1]!,
      side: diff[2] === "old" ? "old" : "new",
      start: Number(diff[3]),
      end: Number(diff[4] === undefined ? diff[3] : diff[4]),
    };
  const file = /^([^#:[\]\n]+)(?:#(.+))?$/.exec(value);
  if (file === null || file[1]!.trim().length === 0) return undefined;
  const path = file[1]!.trim();
  const fragment = file[2];
  if (fragment === undefined) return { kind: "file", path };
  const range = /^L([1-9]\d*)(?:-L?([1-9]\d*))?$/.exec(fragment);
  if (range !== null)
    return {
      kind: "file",
      path,
      start: Number(range[1]),
      end: Number(range[2] === undefined ? range[1] : range[2]),
    };
  if (!/^[\w$]+(?:\.[\w$]+)*$/.test(fragment)) return undefined;
  return { kind: "file", path, symbol: fragment };
}

export function referenceLabel(reference: SourceReference) {
  if (reference.kind === "diff")
    return `${reference.id} · ${reference.side} ${reference.start}–${reference.end}`;
  if (reference.symbol !== undefined)
    return `${reference.path}#${reference.symbol}`;
  if (reference.start !== undefined)
    return `${reference.path}#L${reference.start}-L${reference.end}`;
  return reference.path;
}

export type SourceNavigation = {
  selectedAnnotation: SourceAnnotation | undefined;
  onSelectAnnotation: (annotation: SourceAnnotation) => void;
};
