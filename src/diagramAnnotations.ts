import { parseAnnotation, type SourceAnnotation } from "./annotations.js";

export type DiagramAnnotation = {
  target: "node" | "edge";
  id: string;
  annotation: SourceAnnotation;
};

export function parseDiagramAnnotations(source: string): DiagramAnnotation[] {
  return source.split("\n").flatMap((line) => {
    const directive = /^\s*%%\s+ref\s+(node|edge):([^\s]+)\s+(.+)$/.exec(line);
    if (directive === null) {
      if (/^\s*%%\s+ref\b/.test(line))
        return [
          {
            target: "node",
            id: "",
            annotation: { text: line, references: [] },
          },
        ];
      return [];
    }
    const annotation = parseAnnotation(directive[3]!);
    if (annotation.text.trim().length === 0)
      annotation.text = `${directive[1]} ${directive[2]}`;
    return [
      {
        target: directive[1] === "node" ? "node" : "edge",
        id: directive[2]!,
        annotation,
      },
    ];
  });
}
