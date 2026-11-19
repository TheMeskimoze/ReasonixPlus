import { keepStable, sameNumberMap } from "./stable-identity";
import { normalizeWorkspacePath } from "./workspace-path";

/** True when this tab's agent is working. The single source of the "is this tab
 *  running?" rule: the pill's running dot, the clear that must spare it, and the
 *  sidebar dot all read this, so no two surfaces can disagree about one tab. */
export function tabRunning(t: { busy?: boolean }): boolean {
  return t.busy === true;
}

/** The session name of a tab whose agent is actively running, or undefined.
 *  Derived from `tabRunning` so the sidebar dot and its live tokens/second readout
 *  name exactly the tabs the ribbon dots. */
export function runningTabSession(t: { session?: string; busy?: boolean }): string | undefined {
  return tabRunning(t) && t.session ? t.session : undefined;
}

/** Splits the workspace-wide live tokens/second map into one slice per workspace.
 *  A sidebar row reads a rate only for the running sessions of its own workspace,
 *  so each tab takes its slice instead of the whole map: a tick that moved another
 *  workspace's numbers hands this tab the very same object, which is what lets
 *  memo() skip its subtree. A slice whose contents did not move keeps its previous
 *  identity for the same reason. */
export function ratesByWorkspace<
  T extends { workspaceDir?: string; session?: string; busy?: boolean },
>(
  tabs: readonly T[],
  rates: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, Map<string, number>>,
): Map<string, Map<string, number>> {
  const next = new Map<string, Map<string, number>>();
  for (const tab of tabs) {
    const session = runningTabSession(tab);
    if (!session) continue;
    const rate = rates.get(session);
    if (rate === undefined) continue;
    const workspace = normalizeWorkspacePath(tab.workspaceDir);
    const slice = next.get(workspace);
    if (slice) slice.set(session, rate);
    else next.set(workspace, new Map([[session, rate]]));
  }
  for (const [workspace, slice] of next) {
    next.set(workspace, keepStable(previous.get(workspace), slice, sameNumberMap));
  }
  return next;
}
