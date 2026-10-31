import { toPosixPath } from "./posix-path.js";

/** Drive-letter and UNC roots name a case-insensitive filesystem; a POSIX path
 *  keeps its case. */
function foldsCase(posixPath: string): boolean {
  return /^[a-zA-Z]:/.test(posixPath) || posixPath.startsWith("//");
}

/**
 * Canonical identity of a workspace directory: the ONE key every surface
 * compares a workspace by. Separator flavor, trailing separators and (on
 * Windows) letter case are the only ways one directory can arrive spelled
 * differently, and each of those names the same workspace.
 *
 * Distinct directories always keep distinct keys, so a workspace and any
 * directory nested under it are never confused with each other.
 */
export function workspacePathKey(workspaceDir?: string): string {
  const posix = toPosixPath(workspaceDir ?? "");
  if (!posix) return "";
  const trimmed = posix.replace(/\/+$/, "") || "/";
  return foldsCase(trimmed) ? trimmed.toLowerCase() : trimmed;
}
