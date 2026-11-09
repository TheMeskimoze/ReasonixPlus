import type { SessionsEvent } from "@reasonix/core-utils";
import { t } from "../i18n/index.js";
import type { SessionInfo } from "../memory/session.js";

/** One row of the sidebar's session list, exactly as it crosses the wire. */
export type SessionListItem = SessionsEvent["items"][number];

/** What a session is called, derived once here so no surface has to reconstruct
 *  it: its summary when it has one, else the label its minted name carries. */
export function sessionListTitle(session: Pick<SessionInfo, "name" | "meta">): string {
  if (session.meta.summary?.trim()) return session.meta.summary.trim();
  // Session names are `desktop-<14-digit timestamp>-<tabCounter>` with an optional
  // `-N` dedupe suffix when two chats mint in the same second — match the timestamp
  // first, then let the trailing counters fall through.
  const m = session.name.match(
    /^desktop-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:\d{2})?-(\d+)(?:-\d+)?$/,
  );
  if (m) {
    const label = t("sessions.sessionTitle", {
      month: m[2]!,
      day: m[3]!,
      hour: m[4]!,
      minute: m[5]!,
    });
    return m[6] !== "1" ? `${label} · #${m[6]}` : label;
  }
  // An adopted or CLI-named session keeps its own name, made readable.
  return session.name.replace(/^desktop-/, "").replace(/[-_]+/g, " ");
}

/** Projects workspace sessions onto the wire shape the sidebar renders. */
export function toSessionListItems(sessions: readonly SessionInfo[]): SessionListItem[] {
  return sessions.map((session) => ({
    name: session.name,
    title: sessionListTitle(session),
    messageCount: session.messageCount,
    mtime: session.mtime.toISOString(),
    updatedAt: session.meta.updatedAt,
    createdAt: session.createdAt,
    summary: session.meta.summary,
    workspaceStatus: session.workspaceStatus,
  }));
}
