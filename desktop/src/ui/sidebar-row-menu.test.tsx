// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../App";
import { Sidebar } from "./sidebar";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

afterEach(cleanup);

const ACTIVE = "desktop-20260101000000-1";
const IDLE = "desktop-20260102000000-1";

function session(name: string, title: string, messageCount = 2): SessionInfo {
  return { name, title, summary: title, messageCount, mtime: "2026-01-01T00:00:00.000Z" };
}

function renderSidebar(
  over: {
    sessions?: SessionInfo[];
    activeName?: string;
    onRenameSession?: (name: string, title: string) => void;
    onDuplicateSession?: () => void;
    onExportSession?: () => void;
  } = {},
) {
  return render(
    <Sidebar
      sessions={over.sessions ?? [session(ACTIVE, "Active chat"), session(IDLE, "Idle chat")]}
      activeName={over.activeName ?? ACTIVE}
      onNewChat={() => {}}
      onLoadSession={() => {}}
      onDeleteSession={() => {}}
      onClearSessions={() => {}}
      onReorderSession={() => {}}
      onRenameSession={over.onRenameSession ?? (() => {})}
      onDuplicateSession={over.onDuplicateSession}
      onExportSession={over.onExportSession}
      onOpenWorkdir={() => {}}
      onOpenSettings={() => {}}
      onOpenAbout={() => {}}
    />,
  );
}

function rowOf(container: HTMLElement, name: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`.session-item[title="${name}"]`);
  if (!row) throw new Error(`no sidebar row for ${name}`);
  return row;
}

function openRowMenu(container: HTMLElement, name: string): void {
  fireEvent.click(within(rowOf(container, name)).getByRole("button", { name: "Session actions" }));
}

function menuItem(container: HTMLElement, label: string): HTMLButtonElement {
  const menu = container.querySelector<HTMLElement>(".session-menu");
  if (!menu) throw new Error("no row menu is open");
  return within(menu).getByRole("menuitem", { name: label }) as HTMLButtonElement;
}

describe("sidebar row menu actions", () => {
  it("offers duplicate and export on the open session and reports each pick", () => {
    const onDuplicateSession = vi.fn();
    const onExportSession = vi.fn();
    const { container } = renderSidebar({ onDuplicateSession, onExportSession });

    openRowMenu(container, ACTIVE);
    const duplicate = menuItem(container, "Duplicate");
    expect(duplicate.disabled).toBe(false);
    fireEvent.click(duplicate);
    expect(onDuplicateSession).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".session-menu")).toBeNull();

    openRowMenu(container, ACTIVE);
    fireEvent.click(menuItem(container, "Export"));
    expect(onExportSession).toHaveBeenCalledTimes(1);
  });

  it("refuses duplicate and export on a row that is not the open session", () => {
    // Both read the transcript the tab holds, so an idle row has nothing to give
    // them: the entries stay visible but inert, with the reason on the pointer.
    const onDuplicateSession = vi.fn();
    const onExportSession = vi.fn();
    const { container } = renderSidebar({ onDuplicateSession, onExportSession });

    openRowMenu(container, IDLE);
    const duplicate = menuItem(container, "Duplicate");
    const exp = menuItem(container, "Export");
    expect(duplicate.disabled).toBe(true);
    expect(exp.disabled).toBe(true);
    expect(duplicate.title).toBe("Open this session first");

    fireEvent.click(duplicate);
    fireEvent.click(exp);
    expect(onDuplicateSession).not.toHaveBeenCalled();
    expect(onExportSession).not.toHaveBeenCalled();
  });

  it("locks duplicate and export on a session with nothing in it", () => {
    const { container } = renderSidebar({ sessions: [session(ACTIVE, "Empty chat", 0)] });
    openRowMenu(container, ACTIVE);
    expect(menuItem(container, "Duplicate").disabled).toBe(true);
    expect(menuItem(container, "Export").disabled).toBe(true);
  });

  it("renames the open session from a double click on its title", () => {
    const onRenameSession = vi.fn();
    const { container } = renderSidebar({ onRenameSession });

    fireEvent.doubleClick(within(rowOf(container, ACTIVE)).getByText("Active chat"));
    const input = container.querySelector<HTMLInputElement>("input.title-edit");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Active chat");

    fireEvent.change(input!, { target: { value: "  Renamed   chat  " } });
    fireEvent.keyDown(input!, { key: "Enter" });

    expect(onRenameSession).toHaveBeenCalledWith(ACTIVE, "Renamed chat");
    expect(container.querySelector("input.title-edit")).toBeNull();
  });

  it("ignores a double click on a row that is not the open session", () => {
    const onRenameSession = vi.fn();
    const { container } = renderSidebar({ onRenameSession });

    fireEvent.doubleClick(within(rowOf(container, IDLE)).getByText("Idle chat"));
    expect(container.querySelector("input.title-edit")).toBeNull();
  });

  it("cancels the rename on Escape and keeps the old title", () => {
    const onRenameSession = vi.fn();
    const { container } = renderSidebar({ onRenameSession });

    fireEvent.doubleClick(within(rowOf(container, ACTIVE)).getByText("Active chat"));
    const input = container.querySelector<HTMLInputElement>("input.title-edit")!;
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRenameSession).not.toHaveBeenCalled();
    expect(container.querySelector("input.title-edit")).toBeNull();
    expect(screen.getByText("Active chat")).toBeTruthy();
  });
});
