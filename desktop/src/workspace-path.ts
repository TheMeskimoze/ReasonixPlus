import { toPosixPath, workspacePathKey } from "@reasonix/core-utils";
import { LruCache } from "./cache";
import { t } from "./i18n";

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

/** Grouping re-normalizes the same handful of workspace dirs many times per
 *  render, so the key work is cached (and bounded, in case dirs churn). */
const normalizedPaths = new LruCache<string, string>(2000);

/** Workspace identity, shared with the daemon through `workspacePathKey`: one
 *  workspace has one key on both sides, so a directory the backend counted as
 *  one workspace is never rendered as two tabs, and two directories are never
 *  rendered as one. */
export function normalizeWorkspacePath(path?: string): string {
  const raw = path ?? "";
  const cached = normalizedPaths.get(raw);
  if (cached !== undefined) return cached;
  const value = workspacePathKey(raw);
  normalizedPaths.set(raw, value);
  return value;
}

/** The workspace's own name, for tab and header labels. Case is preserved: this
 *  is display text, not identity. */
export function workspaceBasename(path?: string): string {
  const posix = toPosixPath(path ?? "");
  const trimmed = posix.replace(/\/+$/, "");
  if (!trimmed) return posix;
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed;
}

/** A workspace as every surface names it. The one phrase for "no workspace yet"
 *  lives here, so no caller invents its own placeholder for it. */
export function workspaceName(path?: string): string {
  return workspaceBasename(path) || t("sidebarPanel.noWorkspace");
}

/** Resolve a workspace-relative path while preserving the workspace platform's separator. */
export function toWorkspaceAbsolute(path: string, workspaceDir?: string): string {
  if (
    !workspaceDir ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\")
  ) {
    return path;
  }
  const windows = isWindowsPath(workspaceDir);
  const separator = windows ? "\\" : "/";
  const base = workspaceDir.replace(/[\\/]+$/, "");
  const relative = path.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator);
  return `${base}${separator}${relative}`;
}

/** Return a workspace-relative path only when the target is at or below the workspace boundary. */
export function toWorkspaceRelative(path: string, workspaceDir?: string): string {
  if (!workspaceDir) return path.replace(/\\/g, "/");
  const target = path.replace(/\\/g, "/");
  const workspace = workspaceDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const targetComparable = normalizeWorkspacePath(path);
  const workspaceComparable = normalizeWorkspacePath(workspaceDir);
  if (targetComparable === workspaceComparable) return ".";
  if (!targetComparable.startsWith(`${workspaceComparable}/`)) return target;
  return target.slice(workspace.length).replace(/^\/+/, "") || ".";
}
