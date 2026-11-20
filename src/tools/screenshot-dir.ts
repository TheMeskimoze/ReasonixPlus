/** Shared scratch location for tool-generated PNGs: the workspace when there is one,
 *  the OS temp directory otherwise. */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneStateDir } from "../core/state-dir.js";

export const SCREENSHOTS_DIRNAME = ".reasonix/screenshots";

/** The directory screenshots go in, created if missing. Falls back to temp when the
 *  workspace directory cannot be made (read-only checkout, permissions). */
export function screenshotDir(rootDir: string | undefined): string {
  if (rootDir) {
    const workspace = join(rootDir, ".reasonix", "screenshots");
    try {
      mkdirSync(workspace, { recursive: true });
      return workspace;
    } catch {
      // Fall through to temp.
    }
  }
  const fallback = join(tmpdir(), "reasonix-screenshots");
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

/** Delete `prefix*.png` beyond `maxFiles` or older than `maxAgeMs`, newest kept first. */
export function pruneScreenshots(
  dir: string,
  prefix: string,
  maxFiles = 30,
  maxAgeMs = 3 * 86400 * 1000,
): void {
  pruneStateDir(dir, {
    match: (name) => name.startsWith(prefix) && name.endsWith(".png"),
    maxAgeMs,
    maxFiles,
  });
}
