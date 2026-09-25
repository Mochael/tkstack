/**
 * Comment routes, sidecar persistence and Ask AI orchestration.
 *
 * `handle` returns a plain result so the routes are testable without a socket;
 * `serve.ts` adapts the result onto the Connect response, and the `stream`
 * result becomes a Server-Sent Events subscription.
 */

import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "incur";
import { DiffmapCommentError } from "../errors.js";
import { parseViewerDocument } from "../parseViewer.js";
import { collectDocumentBlocks, type TextBlock } from "./anchor.js";
import { buildCommentPrompt, type AgentDispatcher } from "./agent.js";
import {
  commentsPathFor,
  commentTargetSchema,
  readCommentStore,
  writeCommentStore,
} from "./store.js";
import {
  emptyCommentStore,
  targetQuote,
  type CommentMessage,
  type CommentStore,
  type CommentTarget,
  type CommentThread,
  type CommentsSnapshot,
} from "./types.js";

export const COMMENTS_ROUTE_PREFIX = "/__diffmap/comments";

export type CommentRouteResponse =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "stream" }
  | { kind: "pass" };

export type CommentListener = (snapshot: CommentsSnapshot) => void;

export type CommentService = {
  sidecarPath: string;
  handle: (input: {
    pathname: string;
    method: string;
    body: string;
  }) => Promise<CommentRouteResponse>;
  snapshot: () => Promise<CommentsSnapshot | Error>;
  subscribe: (listener: CommentListener) => () => void;
  /** Resolves once every in-flight agent dispatch has settled. */
  idle: () => Promise<void>;
};

const createBodySchema = z.strictObject({
  target: commentTargetSchema,
  body: z.string().min(1),
  askAgent: z.boolean().optional(),
});

const replyBodySchema = z.strictObject({
  body: z.string().min(1),
  askAgent: z.boolean().optional(),
});

const resolveBodySchema = z.strictObject({
  status: z.enum(["open", "resolved"]).optional(),
});

export function createCommentService(input: {
  filePath: string;
  dispatcher: AgentDispatcher;
  now?: () => Date;
  newId?: () => string;
}): CommentService {
  const sidecarPath = commentsPathFor(input.filePath);
  const now = input.now ?? (() => new Date());
  const newId = input.newId ?? (() => randomUUID());
  const listeners = new Set<CommentListener>();
  const pending = new Set<Promise<void>>();
  // Every mutation runs through this chain so concurrent requests cannot
  // interleave a read-modify-write on the sidecar.
  let queue: Promise<unknown> = Promise.resolve();

  function timestamp() {
    return now().toISOString();
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  async function load() {
    return await readCommentStore(sidecarPath);
  }

  async function save(store: CommentStore) {
    const written = await writeCommentStore(sidecarPath, store);
    if (written instanceof Error) return written;
    return undefined;
  }

  function toSnapshot(store: CommentStore): CommentsSnapshot {
    return { threads: store.threads, agent: input.dispatcher.status };
  }

  function publish(store: CommentStore) {
    const snapshot = toSnapshot(store);
    for (const listener of listeners) listener(snapshot);
  }

  async function mutate(
    apply: (store: CommentStore) => CommentStore | Error,
  ): Promise<CommentStore | Error> {
    const store = await load();
    if (store instanceof Error) return store;
    const next = apply(store);
    if (next instanceof Error) return next;
    const written = await save(next);
    if (written instanceof Error) return written;
    publish(next);
    return next;
  }

  function message(role: CommentMessage["role"], body: string): CommentMessage {
    return {
      id: newId(),
      by: role === "agent" ? "Agent" : "You",
      at: timestamp(),
      role,
      body,
    };
  }

  /** The block text the thread points at, for the agent prompt. */
  async function blockContext(target: CommentTarget) {
    const anchored =
      target.kind === "text"
        ? target
        : target.kind === "range"
          ? target.start
          : undefined;
    if (anchored === undefined || anchored.surface.type !== "block") {
      return undefined;
    }
    const surface = anchored.surface;
    const source = await fs
      .readFile(input.filePath, "utf8")
      .catch(() => undefined);
    if (source === undefined) return undefined;
    const document = parseViewerDocument(source, input.filePath);
    if (document instanceof Error) return undefined;
    const blocks = collectDocumentBlocks(document);
    const match =
      blocks.find((block: TextBlock) => block.hash === surface.blockHash) ??
      blocks.find(
        (block: TextBlock) =>
          block.tag === surface.tag && block.index === surface.index,
      );
    return match?.text;
  }

  function askAgent(threadId: string) {
    const run = (async () => {
      const prepared = await enqueue(async () => {
        const store = await load();
        if (store instanceof Error) return store;
        const thread = store.threads.find((item) => item.threadId === threadId);
        if (thread === undefined) {
          return new DiffmapCommentError({
            reason: `unknown thread ${threadId}`,
          });
        }
        const prompt = buildCommentPrompt({
          threadId,
          quote: targetQuote(thread.target),
          blockContext: await blockContext(thread.target),
          messages: thread.messages,
        });
        const updated = await mutate((current) =>
          updateThread(current, threadId, (item) => ({
            ...item,
            updatedAt: timestamp(),
            agent: {
              state: "pending",
              requestedAt: timestamp(),
              command: input.dispatcher.describe(prompt),
              error: undefined,
            },
          })),
        );
        if (updated instanceof Error) return updated;
        return prompt;
      });
      if (prepared instanceof Error) {
        console.error(prepared.message);
        return;
      }
      const answer = await input.dispatcher.dispatch(prepared);
      const settled = await enqueue(() =>
        mutate((current) =>
          updateThread(current, threadId, (item) =>
            answer instanceof Error
              ? {
                  ...item,
                  updatedAt: timestamp(),
                  agent: {
                    state: "error",
                    requestedAt: item.agent?.requestedAt ?? timestamp(),
                    command: item.agent?.command ?? [],
                    error: answer.message,
                  },
                }
              : {
                  ...item,
                  updatedAt: timestamp(),
                  messages: [...item.messages, message("agent", answer)],
                  agent: {
                    state: "done",
                    requestedAt: item.agent?.requestedAt ?? timestamp(),
                    command: item.agent?.command ?? [],
                    error: undefined,
                  },
                },
          ),
        ),
      );
      if (settled instanceof Error) console.error(settled.message);
    })();
    pending.add(run);
    // oxlint-disable-next-line typescript/no-floating-promises -- `idle()` awaits these; failures are already logged above.
    void run.finally(() => pending.delete(run));
  }

  async function handle(request: {
    pathname: string;
    method: string;
    body: string;
  }): Promise<CommentRouteResponse> {
    const route = matchRoute(request.pathname);
    if (route === undefined) return { kind: "pass" };
    if (route.kind === "stream") {
      if (request.method !== "GET") return methodNotAllowed();
      return { kind: "stream" };
    }
    if (route.kind === "collection" && request.method === "GET") {
      const store = await enqueue(load);
      if (store instanceof Error) return failed(store);
      return { kind: "json", status: 200, body: toSnapshot(store) };
    }
    if (route.kind === "collection" && request.method === "POST") {
      const parsed = parseBody(request.body, createBodySchema);
      if (parsed instanceof Error) return badRequest(parsed);
      const threadId = newId();
      const created = await enqueue(() =>
        mutate((store) => ({
          ...store,
          threads: [
            ...store.threads,
            {
              threadId,
              target: parsed.target as CommentTarget,
              status: "open" as const,
              createdAt: timestamp(),
              updatedAt: timestamp(),
              messages: [message("reader", parsed.body)],
              agent: undefined,
            },
          ],
        })),
      );
      if (created instanceof Error) return failed(created);
      if (parsed.askAgent === true) askAgent(threadId);
      return {
        kind: "json",
        status: 201,
        body: { thread: findThread(created, threadId) },
      };
    }
    if (route.kind === "reply" && request.method === "POST") {
      const parsed = parseBody(request.body, replyBodySchema);
      if (parsed instanceof Error) return badRequest(parsed);
      const threadId = route.threadId;
      const replied = await enqueue(() =>
        mutate((store) =>
          updateThread(store, threadId, (thread) => ({
            ...thread,
            updatedAt: timestamp(),
            messages: [...thread.messages, message("reader", parsed.body)],
          })),
        ),
      );
      if (replied instanceof Error) return failed(replied);
      if (parsed.askAgent === true) askAgent(threadId);
      return {
        kind: "json",
        status: 200,
        body: { thread: findThread(replied, threadId) },
      };
    }
    if (route.kind === "resolve" && request.method === "POST") {
      const parsed = parseBody(request.body, resolveBodySchema);
      if (parsed instanceof Error) return badRequest(parsed);
      const threadId = route.threadId;
      const status = parsed.status ?? "resolved";
      const resolved = await enqueue(() =>
        mutate((store) =>
          updateThread(store, threadId, (thread) => ({
            ...thread,
            status,
            updatedAt: timestamp(),
          })),
        ),
      );
      if (resolved instanceof Error) return failed(resolved);
      return {
        kind: "json",
        status: 200,
        body: { thread: findThread(resolved, threadId) },
      };
    }
    return methodNotAllowed();
  }

  return {
    sidecarPath,
    handle,
    async snapshot() {
      const store = await enqueue(load);
      if (store instanceof Error) return store;
      return toSnapshot(store);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async idle() {
      await queue.catch(() => undefined);
      while (pending.size > 0) {
        await Promise.all(pending).catch(() => undefined);
      }
      await queue.catch(() => undefined);
    },
  };
}

type CommentRoute =
  | { kind: "collection" }
  | { kind: "stream" }
  | { kind: "reply"; threadId: string }
  | { kind: "resolve"; threadId: string };

export function matchRoute(pathname: string): CommentRoute | undefined {
  if (pathname === COMMENTS_ROUTE_PREFIX) return { kind: "collection" };
  if (!pathname.startsWith(`${COMMENTS_ROUTE_PREFIX}/`)) return undefined;
  const rest = pathname.slice(COMMENTS_ROUTE_PREFIX.length + 1);
  if (rest === "stream") return { kind: "stream" };
  const [rawId, action, ...extra] = rest.split("/");
  if (rawId === undefined || rawId === "" || extra.length > 0) return undefined;
  const threadId = decodeURIComponent(rawId);
  if (action === "reply") return { kind: "reply", threadId };
  if (action === "resolve") return { kind: "resolve", threadId };
  return undefined;
}

export function emptySnapshot(agent: CommentsSnapshot["agent"]) {
  return { threads: emptyCommentStore().threads, agent };
}

function findThread(store: CommentStore, threadId: string) {
  return store.threads.find((thread) => thread.threadId === threadId);
}

function updateThread(
  store: CommentStore,
  threadId: string,
  apply: (thread: CommentThread) => CommentThread,
): CommentStore | Error {
  const existing = store.threads.find((thread) => thread.threadId === threadId);
  if (existing === undefined) {
    return new DiffmapCommentError({ reason: `unknown thread ${threadId}` });
  }
  return {
    ...store,
    threads: store.threads.map((thread) =>
      thread.threadId === threadId ? apply(thread) : thread,
    ),
  };
}

function parseBody<T extends z.ZodType>(body: string, schema: T) {
  let value: unknown;
  try {
    value = body.trim() === "" ? {} : JSON.parse(body);
  } catch (cause) {
    return new DiffmapCommentError({
      reason: "request body is not JSON",
      cause,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new DiffmapCommentError({
      reason: `invalid request body${issue === undefined ? "" : ` (${issue.path.join(".")} ${issue.message})`}`,
    });
  }
  return parsed.data as z.infer<T>;
}

function badRequest(error: Error): CommentRouteResponse {
  return { kind: "json", status: 400, body: { error: error.message } };
}

function failed(error: Error): CommentRouteResponse {
  const status = error.message.includes("unknown thread") ? 404 : 500;
  return { kind: "json", status, body: { error: error.message } };
}

function methodNotAllowed(): CommentRouteResponse {
  return { kind: "json", status: 405, body: { error: "method not allowed" } };
}
