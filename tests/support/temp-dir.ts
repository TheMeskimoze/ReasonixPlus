/** Temp workspace helpers: creation, and removal that survives the Windows EBUSY
 *  race a just-closed handle causes. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTempDir(prefix = "reasonix-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Teardown variant for directories a just-killed child may still hold open on Windows:
 *  retries past the synchronous window and never fails the test over leftover scratch. */
export async function removeTempDirQuietly(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
