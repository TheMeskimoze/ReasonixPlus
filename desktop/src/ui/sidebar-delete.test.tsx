// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../App";
import { Sidebar } from "./sidebar";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

afterEach(cleanup);

const RUNNING = "desktop-20260101000000-1";
const IDLE = "desktop-20260102000000-1";

function session(name: string): SessionInfo {
  return { name, title: name, summary: name, messageCount: 1, mtime: "2026-01-01T00:00:00.000Z" };
}

function renderSidebar(
  over: {
    sessions?: SessionInfo[];
    running?: string[];
    sessionMutation?: { kind: "delete" } | { kind: "clear" } | { kind: "create" } | null;
    onDeleteSession?: (name: string) => void;
    onReorderSession?: (name: string) => void;
  } = {},
) {
  return render(
    <Sidebar
      sessions={over.sessions ?? [session(IDLE), session(RUNNING)]}
      runningSessions={new Set(over.running ?? [RUNNING])}
      sessionMutation={over.sessionMutation ?? null}
      onNewChat={() => {}}
      onLoadSession={() => {}}
      onDeleteSession={over.onDeleteSession ?? (() => {})}
      onClearSessions={() => {}}
      onReorderSession={over.onReorderSession}
      onOpenWorkdir={() => {}}
      onOpenSettings={() => {}}
      onOpenAbout={() => {}}
    />,
  );
}

/** The row for a session, found by the title it carries (a running row appends its
 *  own explanation after the name). */
function rowOf(container: HTMLElement, name: string): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>(".session-item")).find((el) =>
    el.getAttribute("title")?.startsWith(name),
  );
  if (!row) throw new Error(`no sidebar row for ${name}`);
  return row;
}

/** Open a row's 3-dot menu the way the user does: one click on the row's button.
 *  Only one row menu exists at a time, so opening another row replaces it. */
function openRowMenu(container: HTMLElement, name: string): void {
  fireEvent.click(within(rowOf(container, name)).getByRole("button", { name: "Session actions" }));
}

/** One entry of the open row menu, by the wording the user reads. */
function menuItem(container: HTMLElement, label: string): HTMLButtonElement {
  const menu = container.querySelector<HTMLElement>(".session-menu");
  if (!menu) throw new Error("no row menu is open");
  return within(menu).getByRole("menuitem", { name: label }) as HTMLButtonElement;
}

describe("sidebar delete operators", () => {
  it("locks the delete button of a running session and says why", () => {
    const { container } = renderSidebar();
    openRowMenu(container, RUNNING);
    const running = menuItem(container, "Stop this session's agent to delete it");
    expect(running.disabled).toBe(true);
    openRowMenu(container, IDLE);
    expect(menuItem(container, "Delete session").disabled).toBe(false);
  });

  it("names the running state on the row itself", () => {
    // A disabled button is pointer-events:none, so its own tooltip never opens.
    const { container } = renderSidebar();
    const titles = Array.from(container.querySelectorAll(".session-item")).map((row) =>
      row.getAttribute("title"),
    );
    expect(titles).toContain(`${RUNNING} · running, delete disabled`);
    expect(titles).toContain(IDLE);
  });

  it("opens the confirmation for a deletable session and reports the pick", () => {
    const onDeleteSession = vi.fn();
    const { container } = renderSidebar({ onDeleteSession });
    openRowMenu(container, IDLE);
    fireEvent.click(menuItem(container, "Delete session"));
    const confirm = container.querySelector<HTMLButtonElement>(
      ".session-delete-popover button.confirm",
    );
    expect(confirm).not.toBeNull();
    fireEvent.click(confirm!);
    expect(onDeleteSession).toHaveBeenCalledWith(IDLE);
  });

  it("moves a session to the top from its menu and closes the menu", () => {
    const onReorderSession = vi.fn();
    const { container } = renderSidebar({ onReorderSession });
    openRowMenu(container, IDLE);
    fireEvent.click(menuItem(container, "Move to top"));
    expect(onReorderSession).toHaveBeenCalledWith(IDLE);
    expect(container.querySelector(".session-menu")).toBeNull();
  });

  it("locks every delete operator while a delete is in flight", () => {
    const { container } = renderSidebar({ sessionMutation: { kind: "delete" } });
    openRowMenu(container, RUNNING);
    expect(menuItem(container, "Stop this session's agent to delete it").disabled).toBe(true);
    openRowMenu(container, IDLE);
    expect(menuItem(container, "Delete session").disabled).toBe(true);
    const clearAll = screen.getByRole("button", { name: "Clear all sessions" });
    expect((clearAll as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells the user how many running sessions a clear-all keeps", () => {
    const { container } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Clear all sessions" }));
    const popover = container.querySelector(".session-delete-popover");
    expect(popover?.querySelector(".name")?.textContent).toBe("1 session(s) for this workspace");
    expect(popover?.querySelector(".note")?.textContent).toBe("1 running session(s) will be kept");
  });

  it("disables clear-all when every session is running", () => {
    renderSidebar({ sessions: [session(RUNNING)], running: [RUNNING] });
    const clearAll = screen.getByRole("button", { name: "Clear all sessions" });
    expect((clearAll as HTMLButtonElement).disabled).toBe(true);
  });

  it("locks New chat while a session is being created", () => {
    // Creation is a one-at-a-time mutation like a delete: the second click must
    // not stack a session, so the operator goes inert for the duration.
    const idle = renderSidebar().container.querySelector<HTMLButtonElement>(".new-btn");
    expect(idle?.disabled).toBe(false);
    cleanup();

    const creating = renderSidebar({ sessionMutation: { kind: "create" } });
    expect(creating.container.querySelector<HTMLButtonElement>(".new-btn")?.disabled).toBe(true);
  });

  it("locks the workspace switch control while a session mutation runs", () => {
    // Switching mid-mutation re-targets the channel waiting for its settled
    // session list, so the picker must not even open.
    const idle = renderSidebar().container.querySelector<HTMLButtonElement>(".workspace-btn");
    expect(idle?.disabled).toBe(false);
    cleanup();

    const busy = renderSidebar({ sessionMutation: { kind: "clear" } });
    expect(busy.container.querySelector<HTMLButtonElement>(".workspace-btn")?.disabled).toBe(true);
  });
});
