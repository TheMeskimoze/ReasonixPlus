import { normalizeWorkspacePath, workspaceBasename } from "./workspace-path";

/** One row of a workspace picker. The pinned Reasonix+ Local row and the recent
 *  list share this shape, so every picker dedupes, marks the current workspace
 *  and names a row by one rule. */
export interface WorkspacePickerRow {
  /** Canonical workspace identity: two rows with one key are one workspace. */
  key: string;
  path: string;
  /** Last path segment. The pinned local row renders a translated label instead. */
  name: string;
  /** True for the pinned Reasonix+ Local row, which is never removable. */
  local: boolean;
  isCurrent: boolean;
  canRemove: boolean;
}

/**
 * The rows a workspace picker offers, pinned local workspace first. Every
 * distinct directory appears exactly once: two spellings of one workspace
 * collapse, and a workspace is never dropped because another row sits inside
 * it or above it.
 */
export function workspacePickerRows({
  local,
  recent,
  current,
}: {
  local?: string;
  recent?: readonly string[];
  current?: string;
}): WorkspacePickerRow[] {
  const currentKey = normalizeWorkspacePath(current);
  const rows: WorkspacePickerRow[] = [];
  const seen = new Set<string>();
  const add = (path: string, isLocal: boolean) => {
    const key = normalizeWorkspacePath(path);
    if (!key || !path.trim() || seen.has(key)) return;
    seen.add(key);
    rows.push({
      key,
      path,
      name: workspaceBasename(path),
      local: isLocal,
      isCurrent: key === currentKey,
      canRemove: !isLocal,
    });
  };

  if (local) add(local, true);
  const offered = recent && recent.length > 0 ? recent : current ? [current] : [];
  for (const path of offered) add(path, false);
  return rows;
}
