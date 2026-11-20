/** Retention for `.reasonix` scratch directories: one newest-first prune loop. */

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface PruneStateDirOptions {
  /** Only entry names matching this are candidates. */
  match: (name: string) => boolean;
  /** Delete candidates older than this. */
  maxAgeMs?: number;
  /** Keep at most this many of the newest candidates. */
  maxFiles?: number;
  /** Remove one candidate; defaults to unlinking it. Use for sibling artifact sets. */
  remove?: (absPath: string) => void;
}

/** Delete matching entries beyond `maxFiles` or older than `maxAgeMs`, newest kept first.
 *  Returns how many entries went away and how many could not be read or removed. */
export function pruneStateDir(
  dir: string,
  opts: PruneStateDirOptions,
): { removed: number; failed: number } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    const missing = (error as { code?: string }).code === "ENOENT";
    return { removed: 0, failed: missing ? 0 : 1 };
  }
  const entries: Array<{ path: string; mtimeMs: number }> = [];
  let failed = 0;
  for (const name of names) {
    if (!opts.match(name)) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (st.isFile()) entries.push({ path, mtimeMs: st.mtimeMs });
    } catch {
      failed += 1;
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const now = Date.now();
  const remove = opts.remove ?? ((path: string) => rmSync(path, { force: true }));
  let removed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const tooOld = opts.maxAgeMs !== undefined && now - entry.mtimeMs > opts.maxAgeMs;
    const overCount = opts.maxFiles !== undefined && i >= opts.maxFiles;
    if (!tooOld && !overCount) continue;
    try {
      remove(entry.path);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}
