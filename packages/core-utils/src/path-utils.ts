/** Sandbox path-containment helpers — node:path-dependent, so they live in
 *  their own module: core-utils' root index must stay browser-bundle-safe,
 *  and desktop consumers never touch these (subpath import only). */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { toPosixPath } from "./posix-path.js";

export { toPosixPath };

/** True when `child` is `parent` itself or lexically inside it. Single source
 *  for every sandbox-containment check (edit gate, filesystem tools, shell
 *  redirects) — a copy that drifts here is a sandbox escape waiting to happen. */
export function pathIsUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** True when `child` sits strictly below `parent`; the parent itself is not below. */
export function pathIsStrictlyUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Resolve a tool path argument against the workspace. A recognized system path
 *  stays absolute; everything else is workspace-relative, so `/src/x` and
 *  `src/x` name the same file. Callers gate on `inside`, never on the string. */
export function resolveToolPath(rootDir: string, raw: string): { abs: string; inside: boolean } {
  const root = resolve(rootDir);
  if (looksLikeAbsoluteSystemPath(raw)) {
    const abs = resolve(raw);
    return { abs, inside: pathIsUnder(abs, root) };
  }
  let normalized = raw;
  while (normalized.startsWith("/") || normalized.startsWith("\\")) {
    normalized = normalized.slice(1);
  }
  const abs = resolve(root, normalized.length === 0 ? "." : normalized);
  return { abs, inside: pathIsUnder(abs, root) };
}

/** Display form of a workspace path: forward slashes, relative to the root. A path
 *  outside the root stays absolute, since a `../..` chain reads as a different file. */
export function relativeDisplayPath(rootDir: string, fullPath: string): string {
  const root = resolve(rootDir);
  const full = resolve(fullPath);
  const rel = relative(root, full);
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return toPosixPath(full);
  return toPosixPath(rel);
}

/** Windows drive-letter prefixes always count; POSIX absolutes only count when
 *  their first segment is a known system root. */
export function looksLikeAbsoluteSystemPath(raw: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
  return /^\/(?:home|Users|etc|var|opt|tmp|usr|mnt|Library|Volumes|proc|sys|dev|run|srv|media|Applications|System|root|boot|private)(?:[/\\]|$)/.test(
    raw,
  );
}

/** Basename of a path or argv[0] in either slash style (case preserved). */
export function basenamePosix(p: string): string {
  return toPosixPath(p).split("/").pop() ?? "";
}

/** Lowercased basename of a path or argv[0] in either slash style. */
export function basenameLower(p: string): string {
  return basenamePosix(p).toLowerCase();
}
