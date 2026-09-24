import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commentsPathFor,
  parseCommentStore,
  readCommentStore,
  serializeCommentStore,
  writeCommentStore,
} from "./store.js";
import { emptyCommentStore, type CommentStore } from "./types.js";

async function tempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-comments-"));
}

const sample: CommentStore = {
  version: 1,
  threads: [
    {
      threadId: "thread-b",
      target: {
        kind: "text",
        surface: { type: "block", tag: "p", index: 2, blockHash: "block-hash" },
        selection: {
          start: 41,
          length: 12,
          hash: "quote-hash",
          quote: "retries once",
        },
      },
      status: "open",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      messages: [
        {
          id: "m1",
          by: "You",
          at: "2026-01-02T00:00:00.000Z",
          role: "reader",
          body: "Why once?",
        },
      ],
      agent: undefined,
    },
    {
      threadId: "thread-a",
      target: { kind: "document" },
      status: "resolved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      messages: [],
      agent: {
        state: "error",
        requestedAt: "2026-01-01T00:00:00.000Z",
        command: ["claude", "--resume", "abc", "--fork-session", "-p", "hi"],
        error: "claude exited with code 1",
      },
    },
  ],
};

test("commentsPathFor puts the sidecar next to the markdown file", () => {
  assert.equal(
    commentsPathFor("/tmp/specs/review.md"),
    "/tmp/specs/review.comments.json",
  );
  assert.equal(
    commentsPathFor("/tmp/specs/NOTES"),
    "/tmp/specs/NOTES.comments.json",
  );
});

test("readCommentStore returns an empty store when the sidecar is absent", async () => {
  const dir = await tempDir();
  const store = await readCommentStore(path.join(dir, "missing.comments.json"));
  assert.deepEqual(store, emptyCommentStore());
});

test("serializeCommentStore writes stable key order, sorted threads and a trailing newline", () => {
  const serialized = serializeCommentStore(sample);
  assert.ok(serialized.endsWith("}\n"));
  assert.deepEqual(serializeCommentStore(sample), serialized);
  const firstKeys = Object.keys(
    (JSON.parse(serialized) as { threads: object[] }).threads[0]!,
  );
  assert.deepEqual(firstKeys, [
    "threadId",
    "target",
    "status",
    "createdAt",
    "updatedAt",
    "agent",
    "messages",
  ]);
  assert.match(
    serialized,
    /"threadId": "thread-a"[\s\S]*"threadId": "thread-b"/,
  );
});

test("write then read round-trips a store", async () => {
  const dir = await tempDir();
  const sidecar = commentsPathFor(path.join(dir, "review.md"));
  const written = await writeCommentStore(sidecar, sample);
  assert.equal(written, undefined);
  const roundTripped = await readCommentStore(sidecar);
  assert.equal(roundTripped instanceof Error, false);
  if (roundTripped instanceof Error) throw roundTripped;
  assert.equal(roundTripped.threads.length, 2);
  assert.deepEqual(
    roundTripped.threads.map((thread) => thread.threadId),
    ["thread-a", "thread-b"],
  );
  assert.deepEqual(roundTripped.threads[1]?.target, sample.threads[0]?.target);
});

test("writeCommentStore leaves no temporary files behind", async () => {
  const dir = await tempDir();
  const sidecar = commentsPathFor(path.join(dir, "review.md"));
  await writeCommentStore(sidecar, sample);
  await writeCommentStore(sidecar, sample);
  assert.deepEqual(await fs.readdir(dir), ["review.comments.json"]);
});

test("parseCommentStore rejects malformed sidecars", () => {
  assert.ok(parseCommentStore("not json", "x.json") instanceof Error);
  assert.ok(parseCommentStore('{"version":1}', "x.json") instanceof Error);
  assert.ok(
    parseCommentStore('{"version":99,"threads":[]}', "x.json") instanceof Error,
  );
  assert.ok(
    parseCommentStore(
      '{"version":1,"threads":[{"threadId":"a"}]}',
      "x.json",
    ) instanceof Error,
  );
});
