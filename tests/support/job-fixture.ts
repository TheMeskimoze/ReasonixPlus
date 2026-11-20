import { makeTempDir, removeTempDirQuietly } from "./temp-dir.js";

/** A per-test job workspace in the OS temp dir. */
export function makeJobDir(): string {
  return makeTempDir("reasonix-job-");
}

/** Windows sometimes holds the cwd handle for a few ms after the child exits. */
export async function disposeJobDir(dir: string): Promise<void> {
  await removeTempDirQuietly(dir);
}

/** Poll until `cond` holds or `timeoutMs` elapses. */
export async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
