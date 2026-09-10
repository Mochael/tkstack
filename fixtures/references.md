# Symbol and diagram references

Run from the repository root. These references read the current TK Stack source.

```callstack
 parseViewerDocument [[packages/tkstack/src/parseViewer.ts#parseViewerDocument]]
 └── parseFence [[packages/tkstack/src/parseFence.ts#parseFence]]
     ├── parseCallStack [[packages/tkstack/src/annotations.ts#parseCallStack]]
     └── parseDiagramAnnotations [[packages/tkstack/src/diagramAnnotations.ts#parseDiagramAnnotations]]
```

## The shared source panel

Click a node, connecting line, or line label. Tab and Enter or Space also work.

```mermaid
flowchart LR
  Stack[Call stack] -->|Select row| Panel[Source panel]
  Diagram[Mermaid] -->|Select node or edge| Panel
  %% ref node:Stack [[packages/tkstack/src/viewer/CallStackDiff.tsx#CallStackDiff]]
  %% ref node:Diagram [[packages/tkstack/src/viewer/MermaidBlock.tsx#MermaidBlock]]
  %% ref node:Panel [[packages/tkstack/src/viewer/SourceDiffPanel.tsx#SourceDiffPanel]]
  %% ref edge:0 [[packages/tkstack/src/annotations.ts#SourceAnnotation]]
  %% ref edge:1 [[packages/tkstack/src/viewer/diagramLinks.ts#linkDiagram]] [[packages/tkstack/src/diagramAnnotations.ts]]
```

```mermaid
sequenceDiagram
  participant Panel
  participant Server
  Panel->>Server: Resolve file and symbol
  Server-->>Panel: Source and declaration range
  %% ref node:Panel [[packages/tkstack/src/viewer/SourceDiffPanel.tsx#SourceDiffPanel]]
  %% ref node:Server [[packages/tkstack/src/definitions.ts]]
  %% ref edge:0 [[packages/tkstack/src/viewer/sourceNavigation.ts#requestSource]]
  %% ref edge:1 [[packages/tkstack/src/definitions.ts#readSourceReference]]
```

## Embedded old and new changes

These sample patches are snapshots; their files do not need to exist locally.

```mermaid
flowchart LR
  Input[Input] -->|Old validation| Old[Accept whitespace]
  Input -->|New validation| New[Reject whitespace]
  %% ref node:Old [[validation:old:1-3]]
  %% ref node:New [[validation:new:1-3]]
  %% ref edge:0 [[validation:old:2]]
  %% ref edge:1 [[validation:new:2]]
```

```source-diff:validation:src/validation.ts
diff --git a/src/validation.ts b/src/validation.ts
--- a/src/validation.ts
+++ b/src/validation.ts
@@ -1,3 +1,3 @@
 export function validateInput(input: string) {
-  return input.length > 0;
+  return input.trim().length > 0;
 }
```
