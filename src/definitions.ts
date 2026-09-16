import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isClassDeclaration,
  isEnumDeclaration,
  isEnumMember,
  isFunctionDeclaration,
  isGetAccessorDeclaration,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isModuleDeclaration,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isSetAccessorDeclaration,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  type Node,
  type SourceFile,
} from "typescript/unstable/ast";
import {
  API,
  SymbolFlags,
  type Project,
  type Symbol as TypeScriptSymbol,
} from "typescript/unstable/sync";
import * as errore from "errore";
import { DiffmapDefinitionError } from "./errors.js";

export type SourceDefinition = {
  path: string;
  contents: string;
  start: number;
  end: number;
};

export type DefinitionResponse = {
  definition?: SourceDefinition;
  error?: string;
};

export function findDefinition(workspaceRoot: string, params: URLSearchParams) {
  const requestedPath = params.get("path");
  const line = Number(params.get("line"));
  const column = Number(params.get("column"));
  const lineText = params.get("text");
  if (
    requestedPath === null ||
    lineText === null ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !Number.isSafeInteger(column) ||
    column < 0
  )
    return new DiffmapDefinitionError({ reason: "Invalid source position." });

  const fileName = path.resolve(workspaceRoot, requestedPath);
  if (!fileName.startsWith(workspaceRoot + path.sep)) {
    return new DiffmapDefinitionError({
      reason: "Path escapes the workspace.",
    });
  }
  if (!/\.[cm]?[jt]sx?$/i.test(fileName)) {
    return new DiffmapDefinitionError({
      reason: "Definition navigation supports TypeScript and JavaScript.",
    });
  }
  const contents = readSource(
    fileName,
    "This file is no longer in the workspace.",
  );
  if (contents instanceof Error) return contents;
  const lines = contents.split(/\r?\n/);
  if (lines[line - 1] !== lineText || column >= lineText.length) {
    return new DiffmapDefinitionError({
      reason:
        "This diff line differs from the current workspace. Its definition cannot be resolved.",
    });
  }
  return withProject(workspaceRoot, fileName, (project, source) => {
    const position = source.getPositionOfLineAndCharacter(line - 1, column);
    let symbol = project.checker.getSymbolAtPosition(fileName, position);
    if (symbol === undefined) return undefined;
    if ((symbol.flags & SymbolFlags.Alias) !== 0) {
      symbol = project.checker.getAliasedSymbol(symbol);
    }
    const handle = symbol.valueDeclaration ?? symbol.declarations[0];
    const declaration = handle?.resolve();
    if (declaration === undefined) return undefined;
    const target = declaration.getSourceFile();
    const name = declarationName(declaration);
    const start = name?.getStart(target) ?? declaration.getStart(target);
    const end = name?.getEnd() ?? declaration.getEnd();
    return {
      path: path.relative(workspaceRoot, target.fileName),
      contents: target.text,
      start: target.getLineAndCharacterOfPosition(start).line + 1,
      end: target.getLineAndCharacterOfPosition(end).line + 1,
    } satisfies SourceDefinition;
  });
}

export function readSourceReference(
  workspaceRoot: string,
  params: URLSearchParams,
) {
  const requestedPath = params.get("path");
  if (requestedPath === null || requestedPath.length === 0)
    return new DiffmapDefinitionError({ reason: "Missing file path." });
  const fileName = path.resolve(workspaceRoot, requestedPath);
  if (!fileName.startsWith(workspaceRoot + path.sep))
    return new DiffmapDefinitionError({
      reason: "Path escapes the workspace.",
    });
  const contents = readSource(fileName, `Could not read ${requestedPath}.`);
  if (contents instanceof Error) return contents;
  const symbol = params.get("symbol");
  if (symbol !== null) {
    if (!/\.[cm]?[jt]sx?$/i.test(fileName))
      return new DiffmapDefinitionError({
        reason: "Symbol references support TypeScript and JavaScript.",
      });
    return withProject(workspaceRoot, fileName, (project, sourceFile) => {
      const matches = sourceDeclarations(project, sourceFile, symbol);
      if (matches.length === 0)
        return new DiffmapDefinitionError({
          reason: `Symbol "${symbol}" was not found in ${requestedPath}.`,
        });
      if (matches.length > 1)
        return new DiffmapDefinitionError({
          reason: `Symbol "${symbol}" is ambiguous. Use a qualified name: ${matches.map((match) => match.name).join(", ")}.`,
        });
      const match = matches[0]!;
      const start = Math.min(
        ...match.nodes.map((node) => node.getStart(sourceFile)),
      );
      const end = Math.max(...match.nodes.map((node) => node.getEnd()));
      return {
        path: path.relative(workspaceRoot, fileName),
        contents,
        start: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        end:
          sourceFile.getLineAndCharacterOfPosition(Math.max(start, end - 1))
            .line + 1,
      } satisfies SourceDefinition;
    });
  }
  const lineCount = contents.split("\n").length;
  const start = params.has("start") ? Number(params.get("start")) : 1;
  const end = params.has("end") ? Number(params.get("end")) : lineCount;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    end > lineCount
  )
    return new DiffmapDefinitionError({
      reason: `Invalid line range for ${requestedPath}.`,
    });
  return {
    path: path.relative(workspaceRoot, fileName),
    contents,
    start,
    end,
  } satisfies SourceDefinition;
}

function readSource(fileName: string, reason: string) {
  return errore.try({
    try: () => readFileSync(fileName, "utf8"),
    catch: (cause) => new DiffmapDefinitionError({ reason, cause }),
  });
}

function withProject<T>(
  workspaceRoot: string,
  fileName: string,
  run: (project: Project, source: SourceFile) => T,
) {
  return errore.try({
    try: () => {
      using resources = new errore.DisposableStack();
      const api = new API({ cwd: workspaceRoot });
      resources.defer(() => api.close());
      const snapshot = api.updateSnapshot({ openFiles: [fileName] });
      resources.defer(() => snapshot.dispose());
      const project = snapshot.getDefaultProjectForFile(fileName);
      const source = project?.program.getSourceFile(fileName);
      if (project === undefined || source === undefined)
        return new DiffmapDefinitionError({
          reason: "TypeScript could not open this source file.",
        });
      return run(project, source);
    },
    catch: (cause) =>
      new DiffmapDefinitionError({
        reason: "TypeScript could not resolve this source file.",
        cause,
      }),
  });
}

type SourceDeclaration = {
  name: string;
  nodes: Node[];
};

function sourceDeclarations(
  project: Project,
  source: SourceFile,
  requestedName: string,
): SourceDeclaration[] {
  const resolved = resolveSourceSymbol(project, source, requestedName);
  if (resolved.length > 0) return resolved;

  const matches = new Map<string, Node[]>();
  const visit = (node: Node, parents: string[]) => {
    const nameNode = isSourceDeclaration(node)
      ? declarationName(node)
      : undefined;
    const name =
      nameNode === undefined
        ? undefined
        : declarationNameText(nameNode, source);
    const qualifiedName =
      name === undefined ? undefined : [...parents, name].join(".");
    if (
      qualifiedName !== undefined &&
      (qualifiedName === requestedName ||
        qualifiedName.endsWith(`.${requestedName}`))
    ) {
      const declarations = matches.get(qualifiedName) ?? [];
      declarations.push(node);
      matches.set(qualifiedName, declarations);
    }
    const childParents =
      name !== undefined && isDeclarationContainer(node)
        ? [...parents, name]
        : parents;
    node.forEachChild((child) => visit(child, childParents));
  };
  source.forEachChild((child) => visit(child, []));
  return [...matches].map(([name, nodes]) => ({ name, nodes }));
}

function resolveSourceSymbol(
  project: Project,
  source: SourceFile,
  requestedName: string,
): SourceDeclaration[] {
  const [rootName, ...memberNames] = requestedName.split(".");
  if (rootName === undefined || rootName.length === 0) return [];
  let symbol = project.checker.resolveName(
    rootName,
    SymbolFlags.Value | SymbolFlags.Type | SymbolFlags.Namespace,
    { document: source.fileName, position: 0 },
  );
  for (const memberName of memberNames) {
    if (symbol === undefined) return [];
    symbol = symbolMember(symbol, memberName);
  }
  if (symbol === undefined) return [];
  const nodes = symbol.declarations.flatMap((handle) => {
    const node = handle.resolve();
    if (node === undefined || node.getSourceFile().fileName !== source.fileName)
      return [];
    return [node];
  });
  return nodes.length === 0 ? [] : [{ name: requestedName, nodes }];
}

function symbolMember(symbol: TypeScriptSymbol, name: string) {
  return (
    [...symbol.getMembers()].find(([memberName]) => memberName === name)?.[1] ??
    [...symbol.getExports()].find(([exportName]) => exportName === name)?.[1]
  );
}

function declarationName(node: Node): Node | undefined {
  if (!("name" in node)) return undefined;
  return (node as Node & { readonly name?: Node }).name;
}

function declarationNameText(name: Node, source: SourceFile) {
  if ("text" in name) {
    const text = (name as Node & { readonly text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return name.getText(source);
}

function isSourceDeclaration(node: Node) {
  return (
    isClassDeclaration(node) ||
    isEnumDeclaration(node) ||
    isEnumMember(node) ||
    isFunctionDeclaration(node) ||
    isGetAccessorDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isMethodDeclaration(node) ||
    isMethodSignatureDeclaration(node) ||
    isModuleDeclaration(node) ||
    isPropertyDeclaration(node) ||
    isPropertySignatureDeclaration(node) ||
    isSetAccessorDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isVariableDeclaration(node)
  );
}

function isDeclarationContainer(node: Node) {
  return (
    isClassDeclaration(node) ||
    isEnumDeclaration(node) ||
    isFunctionDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isModuleDeclaration(node)
  );
}
