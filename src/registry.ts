import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as errore from "errore";
import { DiffmapRegistryError } from "./errors.js";

type RunningDiffmap = {
  pid: number;
  title: string;
  url: string;
  file: string;
};

const registryDirectory = path.join(
  os.tmpdir(),
  `diffmap-${os.userInfo().uid}`,
);

export async function registerRunningDiffmap(entry: RunningDiffmap) {
  const created = await fs
    .mkdir(registryDirectory, { recursive: true, mode: 0o700 })
    .catch(
      (cause) =>
        new DiffmapRegistryError({ reason: "create directory", cause }),
    );
  if (created instanceof Error) return created;

  const registryPath = path.join(registryDirectory, `${entry.pid}.json`);
  const written = await fs
    .writeFile(registryPath, JSON.stringify(entry), { mode: 0o600 })
    .catch(
      (cause) => new DiffmapRegistryError({ reason: "write entry", cause }),
    );
  if (written instanceof Error) return written;
  return registryPath;
}

export async function unregisterRunningDiffmap(registryPath: string) {
  return await fs
    .unlink(registryPath)
    .catch(
      (cause) => new DiffmapRegistryError({ reason: "remove entry", cause }),
    );
}

export async function listRunningDiffmaps() {
  const names = await fs.readdir(registryDirectory).catch((cause: unknown) => {
    if (isFileSystemError(cause) && cause.code === "ENOENT") return [];
    return new DiffmapRegistryError({ reason: "read directory", cause });
  });
  if (names instanceof Error) return names;

  const [entries, readErrors] = errore.partition(
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => readRegistryEntry(path.join(registryDirectory, name))),
    ),
  );
  const readError = readErrors.at(0);
  if (readError !== undefined) return readError;

  const [running, cleanupErrors] = errore.partition(
    await Promise.all(
      entries.map(async (entry) => {
        const reachable = await isRunning(entry);
        if (reachable) return entry;

        const removed = await unregisterRunningDiffmap(
          path.join(registryDirectory, `${entry.pid}.json`),
        );
        if (removed instanceof Error) return removed;
        return undefined;
      }),
    ),
  );
  const cleanupError = cleanupErrors.at(0);
  if (cleanupError !== undefined) return cleanupError;
  return running.filter((entry) => entry !== undefined);
}

async function readRegistryEntry(registryPath: string) {
  const source = await fs
    .readFile(registryPath, "utf8")
    .catch(
      (cause) => new DiffmapRegistryError({ reason: "read entry", cause }),
    );
  if (source instanceof Error) return source;
  return errore.try({
    // SAFETY: registerRunningDiffmap is the only writer for registry entries.
    try: () => JSON.parse(source) as RunningDiffmap,
    catch: (cause) =>
      new DiffmapRegistryError({ reason: "parse entry", cause }),
  });
}

async function isRunning(entry: RunningDiffmap) {
  const response = await fetch(`${entry.url}/__diffmap/meta`, {
    signal: AbortSignal.timeout(500),
  }).catch(
    (cause) => new DiffmapRegistryError({ reason: "reach server", cause }),
  );
  if (response instanceof Error) return false;
  if (!response.ok) return false;

  // SAFETY: diffmap serves this shape from its private metadata endpoint.
  const meta = await (
    response.json() as Promise<{
      pid: number;
      file: string;
    }>
  ).catch(
    (cause) => new DiffmapRegistryError({ reason: "read server", cause }),
  );
  if (meta instanceof Error) return false;
  return meta.pid === entry.pid && meta.file === entry.file;
}

function isFileSystemError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause;
}
