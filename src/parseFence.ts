import { parseCallStack, type SourceAnnotation } from "./annotations.js";
import {
  parseDiagramAnnotations,
  type DiagramAnnotation,
} from "./diagramAnnotations.js";
import { parseFlowExamples, type FlowExamples } from "./flowExamples.js";
import { parseReviewDiff, type ReviewDiff } from "./reviewDiff.js";

export type Fence =
  | { kind: "mermaid"; source: string; annotations: DiagramAnnotation[] }
  | { kind: "html"; source: string }
  | { kind: "callstack"; source: string; lines: SourceAnnotation[] }
  | { kind: "flow-examples"; source: string; flow: FlowExamples | Error }
  | { kind: "source-diff"; id: string; path: string; source: string }
  | { kind: "review-diff"; path: string; review: ReviewDiff | Error }
  | { kind: "file"; path: string; start: number; end: number; source: string }
  | { kind: "diff"; path: string | undefined; source: string }
  | { kind: "code"; lang: string; source: string };

const fileRefPattern = /^(\d+):(\d+):(.+)$/;
const diffPathPattern = /^diff:(.+)$/;

export function isCallStackSource(source: string) {
  return source.includes("└──") || source.includes("├──");
}

export function pathFromDiffSource(source: string) {
  const plus = /^\+\+\+ [ab]\/(.+)$/m.exec(source);
  if (plus?.[1] !== undefined) return plus[1];
  const minus = /^--- [ab]\/(.+)$/m.exec(source);
  if (minus?.[1] !== undefined) return minus[1];
  const comment = /^\/\/ (.+\S)\s*$/m.exec(source);
  if (comment?.[1] !== undefined) return comment[1];
  return undefined;
}

export function parseFence(lang: string, source: string): Fence {
  const trimmed = source.replace(/\n$/, "");
  if (lang === "mermaid")
    return {
      kind: "mermaid",
      source: trimmed,
      annotations: parseDiagramAnnotations(trimmed),
    };
  if (lang === "html") return { kind: "html", source: trimmed };
  if (lang === "flow-examples")
    return {
      kind: "flow-examples",
      source: trimmed,
      flow: parseFlowExamples(trimmed),
    };
  if (lang === "callstack")
    return {
      kind: "callstack",
      source: trimmed,
      lines: parseCallStack(trimmed),
    };

  const reviewDiff = /^review-diff:(.+)$/.exec(lang);
  if (reviewDiff !== null)
    return {
      kind: "review-diff",
      path: reviewDiff[1]!,
      review: parseReviewDiff(trimmed, reviewDiff[1]!),
    };

  const sourceDiff = /^source-diff:([\w-]+):(.+)$/.exec(lang);
  if (sourceDiff !== null) {
    return {
      kind: "source-diff",
      id: sourceDiff[1]!,
      path: sourceDiff[2]!,
      source: trimmed,
    };
  }

  const fileRef = fileRefPattern.exec(lang);
  if (fileRef !== null) {
    return {
      kind: "file",
      start: Number(fileRef[1]),
      end: Number(fileRef[2]),
      path: fileRef[3]!,
      source: trimmed,
    };
  }

  const diffPath = diffPathPattern.exec(lang);
  if (lang === "diff" || diffPath !== null) {
    if (isCallStackSource(trimmed)) {
      return {
        kind: "callstack",
        source: trimmed,
        lines: parseCallStack(trimmed),
      };
    }
    return {
      kind: "diff",
      path: diffPath === null ? pathFromDiffSource(trimmed) : diffPath[1],
      source: trimmed,
    };
  }

  return {
    kind: "code",
    lang: lang.length === 0 ? "text" : lang,
    source: trimmed,
  };
}
