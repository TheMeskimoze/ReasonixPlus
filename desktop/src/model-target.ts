/** Which target the composer's one model pill edits. A chat's choice is remembered per
 *  session, so switching tabs or chats shows the target that chat last used. */

export type ModelTarget = "agent" | "subagent";

/** The target a stored choice resolves to: a chat minted without the subagent tool falls
 *  back to the agent model instead of showing a target it cannot serve. */
export function resolveModelTarget(choice: ModelTarget, subagentsEnabled: boolean): ModelTarget {
  return subagentsEnabled && choice === "subagent" ? "subagent" : "agent";
}

export function modelTargetKey(session: string): string {
  return `reasonix.modelTarget.${session}`;
}

/** The target this session last chose. A chat with no stored choice, and a channel with
 *  no session yet, use the agent model. */
export function readModelTarget(
  storage: Pick<Storage, "getItem">,
  session: string | undefined,
): ModelTarget {
  if (!session) return "agent";
  return storage.getItem(modelTargetKey(session)) === "subagent" ? "subagent" : "agent";
}

/** Remember this session's choice, so the pill reads it again on the next tab or chat
 *  switch and one chat's target never shows up in another. */
export function writeModelTarget(
  storage: Pick<Storage, "setItem">,
  session: string | undefined,
  target: ModelTarget,
): void {
  if (!session) return;
  storage.setItem(modelTargetKey(session), target);
}
