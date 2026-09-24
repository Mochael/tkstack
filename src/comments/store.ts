/**
 * The comment sidecar: `<doc>.md` -> `<doc>.comments.json`.
 *
 * Human-readable, stable key order, atomic writes. No database: a reader
 * should be able to open the file in an editor, and a coding agent should be
 * able to diff it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "incur";
import { DiffmapCommentError } from "../errors.js";
import {
  COMMENT_STORE_VERSION,
  emptyCommentStore,
  type CommentStore,
  type CommentThread,
} from "./types.js";

const nonEmpty = z.string().min(1);
const nonNegative = z.coerce.number().int().nonnegative();
const positive = z.coerce.number().int().positive();

const surfaceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("document"), documentHash: nonEmpty }),
  z.strictObject({
    type: z.literal("block"),
    tag: nonEmpty,
    index: nonNegative,
    blockHash: nonEmpty,
  }),
]);

const selectionSchema = z.strictObject({
  start: nonNegative,
  length: positive,
  hash: nonEmpty,
  quote: nonEmpty,
});

export const commentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("document") }),
  z.strictObject({
    kind: z.literal("text"),
    surface: surfaceSchema,
    selection: selectionSchema,
  }),
]);

const messageSchema = z.strictObject({
  id: nonEmpty,
  by: nonEmpty,
  at: nonEmpty,
  role: z.enum(["reader", "agent"]),
  body: z.string(),
});

const agentSchema = z.strictObject({
  state: z.enum(["pending", "done", "error"]),
  requestedAt: nonEmpty,
  command: z.array(z.string()),
  error: z.string().optional(),
});

const threadSchema = z.strictObject({
  threadId: nonEmpty,
  target: commentTargetSchema,
  status: z.enum(["open", "resolved"]),
  createdAt: nonEmpty,
  updatedAt: nonEmpty,
  messages: z.array(messageSchema),
  agent: agentSchema.optional(),
});

const storeSchema = z.strictObject({
  version: z.literal(COMMENT_STORE_VERSION),
  threads: z.array(threadSchema),
});

/** `review.md` -> `review.comments.json`. */
export function commentsPathFor(filePath: string) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  const ext = path.extname(resolved);
  const base =
    ext === "" ? path.basename(resolved) : path.basename(resolved, ext);
  return path.join(dir, `${base}.comments.json`);
}

export async function readCommentStore(sidecarPath: string) {
  const raw = await fs.readFile(sidecarPath, "utf8").catch((cause: unknown) => {
    if (isMissingFile(cause)) return undefined;
    return new DiffmapCommentError({
      reason: `could not read ${sidecarPath}`,
      cause,
    });
  });
  if (raw instanceof Error) return raw;
  if (raw === undefined) return emptyCommentStore();
  return parseCommentStore(raw, sidecarPath);
}

export function parseCommentStore(raw: string, sidecarPath: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    return new DiffmapCommentError({
      reason: `${sidecarPath} is not valid JSON`,
      cause,
    });
  }
  const parsed = storeSchema.safeParse(value);
  if (!parsed.success) {
    return new DiffmapCommentError({
      reason: `${sidecarPath} does not match the comment schema (${parsed.error.issues[0]?.message ?? "invalid"})`,
    });
  }
  return normalizeStore(parsed.data as CommentStore);
}

export async function writeCommentStore(
  sidecarPath: string,
  store: CommentStore,
) {
  const serialized = serializeCommentStore(store);
  // Write beside the target so the rename stays on one filesystem.
  const tempPath = `${sidecarPath}.${randomUUID().slice(0, 8)}.tmp`;
  const written = await fs
    .writeFile(tempPath, serialized, "utf8")
    .then(() => fs.rename(tempPath, sidecarPath))
    .catch(async (cause: unknown) => {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      return new DiffmapCommentError({
        reason: `could not write ${sidecarPath}`,
        cause,
      });
    });
  if (written instanceof Error) return written;
  return undefined;
}

/** Fixed key order, two-space indent, trailing newline. */
export function serializeCommentStore(store: CommentStore) {
  const normalized = normalizeStore(store);
  return `${JSON.stringify(
    {
      version: normalized.version,
      threads: normalized.threads.map(orderedThread),
    },
    undefined,
    2,
  )}\n`;
}

function orderedThread(thread: CommentThread) {
  return {
    threadId: thread.threadId,
    target: orderedTarget(thread.target),
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.agent === undefined
      ? {}
      : {
          agent: {
            state: thread.agent.state,
            requestedAt: thread.agent.requestedAt,
            command: thread.agent.command,
            ...(thread.agent.error === undefined
              ? {}
              : { error: thread.agent.error }),
          },
        }),
    messages: thread.messages.map((message) => ({
      id: message.id,
      by: message.by,
      at: message.at,
      role: message.role,
      body: message.body,
    })),
  };
}

function orderedTarget(target: CommentThread["target"]) {
  if (target.kind === "document") return { kind: target.kind };
  const surface =
    target.surface.type === "document"
      ? { type: target.surface.type, documentHash: target.surface.documentHash }
      : {
          type: target.surface.type,
          tag: target.surface.tag,
          index: target.surface.index,
          blockHash: target.surface.blockHash,
        };
  return {
    kind: target.kind,
    surface,
    selection: {
      start: target.selection.start,
      length: target.selection.length,
      hash: target.selection.hash,
      quote: target.selection.quote,
    },
  };
}

/** Oldest thread first, so the file diffs as an append. */
function normalizeStore(store: CommentStore): CommentStore {
  return {
    version: COMMENT_STORE_VERSION,
    threads: store.threads.toSorted((a, b) =>
      a.createdAt === b.createdAt
        ? a.threadId.localeCompare(b.threadId)
        : a.createdAt.localeCompare(b.createdAt),
    ),
  };
}

function isMissingFile(cause: unknown) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
