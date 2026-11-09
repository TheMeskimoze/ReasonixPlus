/** Installs the Bun runtime the OpenCode free tier needs, from Bun's own release
 *  archive, into the directory `bunCommand` already searches first. */

import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { messageOf } from "@reasonix/core-utils";

const run = promisify(execFile);

export const BUN_RELEASES_URL = "https://github.com/oven-sh/bun/releases/latest/download";

/** Bun's release asset name for a platform and cpu. */
export function bunReleaseAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const cpu = arch === "arm64" ? "aarch64" : "x64";
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  return `bun-${os}-${cpu}.zip`;
}

export interface BunInstallOptions {
  /** Directory the binary lands in: the first one `bunCommand` searches. */
  targetDir: string;
  fetchImpl?: typeof fetch;
  /** Unpack `archive` into `destDir`. Injected so the platform extractor is swappable. */
  extract?: (archive: string, destDir: string) => Promise<void>;
  onPhase?: (phase: "downloading" | "extracting") => void;
  /** Scratch directory for the archive; a fresh one is minted and removed by default. */
  workDir?: string;
}

/** Download and unpack Bun, returning the binary that was installed. Throws with the
 *  failing step named, so Settings can say why the install stopped. */
export async function installBun(opts: BunInstallOptions): Promise<{ command: string }> {
  const asset = bunReleaseAsset();
  const mintedWorkDir = opts.workDir === undefined;
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), "reasonix-bun-"));
  try {
    const archive = join(workDir, asset);
    opts.onPhase?.("downloading");
    await download(`${BUN_RELEASES_URL}/${asset}`, archive, opts.fetchImpl ?? fetch);
    opts.onPhase?.("extracting");
    const unpacked = join(workDir, "unpacked");
    mkdirSync(unpacked, { recursive: true });
    await (opts.extract ?? extractArchive)(archive, unpacked);
    const binary = findBunBinary(unpacked);
    if (!binary) throw new Error(`${asset} contained no bun binary`);
    mkdirSync(opts.targetDir, { recursive: true });
    const command = join(opts.targetDir, basename(binary));
    // Copy rather than move: the temp directory can live on another volume.
    copyFileSync(binary, command);
    if (process.platform !== "win32") chmodSync(command, 0o755);
    return { command };
  } finally {
    if (mintedWorkDir) rmSync(workDir, { recursive: true, force: true });
  }
}

async function download(url: string, dest: string, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Bun download failed: HTTP ${res.status} from ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** Windows and macOS tar read a zip; a Linux image without bsdtar falls back to unzip. */
async function extractArchive(archive: string, destDir: string): Promise<void> {
  try {
    await run("tar", ["-xf", archive, "-C", destDir]);
  } catch (tarError) {
    try {
      await run("unzip", ["-q", "-o", archive, "-d", destDir]);
    } catch {
      throw new Error(`Could not unpack ${basename(archive)}: ${messageOf(tarError)}`);
    }
  }
}

const BUN_BINARY = process.platform === "win32" ? "bun.exe" : "bun";

/** The archive nests the binary one directory down (`bun-windows-x64/`). */
function findBunBinary(root: string, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findBunBinary(full, depth + 1);
      if (nested) return nested;
    } else if (entry.name === BUN_BINARY) {
      return full;
    }
  }
  return undefined;
}
