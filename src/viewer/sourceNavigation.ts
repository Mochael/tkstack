import { useEffect, useState } from "react";
import type { CodeViewDiffItem, CodeViewLineSelection } from "@pierre/diffs";
import type { SourceReference } from "../annotations.js";
import type { SourceDefinition, DefinitionResponse } from "../definitions.js";
import { TkstackDefinitionError } from "../errors.js";

export async function requestSource(
  endpoint: "source" | "definition",
  params: URLSearchParams,
) {
  const response = await fetch(`/__tkstack/${endpoint}?${params}`).catch(
    (cause) =>
      new TkstackDefinitionError({
        reason: "Could not reach the source service.",
        cause,
      }),
  );
  if (response instanceof Error) return response;
  const result = await response
    .json()
    .then((value) => {
      // SAFETY: the local tkstack source endpoints own this response shape.
      return value as DefinitionResponse;
    })
    .catch(
      (cause) =>
        new TkstackDefinitionError({
          reason: "Could not read the source response.",
          cause,
        }),
    );
  if (result instanceof Error) return result;
  if (result.error !== undefined)
    return new TkstackDefinitionError({ reason: result.error });
  if (result.definition === undefined)
    return new TkstackDefinitionError({ reason: "No definition found." });
  return result.definition;
}

export function useSourceReference(reference: SourceReference | undefined) {
  const [resolution, setResolution] = useState<{
    reference: SourceReference;
    result: SourceDefinition | Error;
  }>();
  useEffect(() => {
    if (reference?.kind !== "file") return;
    const params = new URLSearchParams({ path: reference.path });
    if (reference.symbol !== undefined) params.set("symbol", reference.symbol);
    if (reference.start !== undefined)
      params.set("start", String(reference.start));
    if (reference.end !== undefined) params.set("end", String(reference.end));
    let active = true;
    // oxlint-disable-next-line typescript/no-floating-promises -- The effect owns its asynchronous source result.
    void requestSource("source", params).then((result) => {
      if (active) setResolution({ reference, result });
    });
    return () => {
      active = false;
    };
  }, [reference]);
  return resolution?.reference === reference ? resolution?.result : undefined;
}

export function matchingSourceDiff(
  source: SourceDefinition,
  items: CodeViewDiffItem[],
): CodeViewLineSelection | undefined {
  const lines = source.contents.split(/\r?\n/);
  for (const item of items) {
    const diff = item.fileDiff;
    if (diff.name !== source.path) continue;
    const ranges = diff.hunks.flatMap((hunk) => {
      const start = Math.max(source.start, hunk.additionStart);
      const end = Math.min(
        source.end,
        hunk.additionStart + hunk.additionCount - 1,
      );
      return start <= end ? [{ start, end, hunk }] : [];
    });
    if (ranges.length === 0) continue;
    const matches = ranges.every(({ start, end, hunk }) => {
      for (let line = start; line <= end; line++) {
        const index = diff.isPartial
          ? hunk.additionLineIndex + line - hunk.additionStart
          : line - 1;
        if (
          diff.additionLines[index]?.replace(/\r?\n$/, "") !== lines[line - 1]
        )
          return false;
      }
      return true;
    });
    if (!matches) continue;
    return {
      id: item.id,
      range: {
        start: Math.min(...ranges.map((range) => range.start)),
        end: Math.max(...ranges.map((range) => range.end)),
        side: "additions",
      },
    };
  }
  return undefined;
}
