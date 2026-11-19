// @vitest-environment jsdom
// A new tab opens on a workspace it has to be given, and the chat that workspace needs is
// created by the first message: typing works before any session exists, and the message
// that minted the chat is the turn the capability picker's answer releases.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../desktop/src/App";
import {
  WS,
  feed,
  mockDesktopHost,
  resetDesktopHost,
  sent,
  appSettings as settings,
  settle,
} from "./support/desktop-harness";

/** The events the daemon sends once a pending tab is given a workspace with no session:
 *  the channel lands NEUTRAL and ready, so its composer takes the first message. */
async function openWorkspaceOnPendingTab() {
  await feed({ type: "$settings", ...settings(WS) }, "t1");
  await feed({ type: "$session_bound", name: "" }, "t1");
  await feed({ type: "$ctx_breakdown", reservedTokens: 10, logTokens: 0 }, "t1");
  await feed({ type: "$mcp_specs", specs: [], bridged: false }, "t1");
  await feed(
    {
      type: "$tab_opened",
      workspaceDir: WS,
      active: true,
      groupId: "g2",
      sessions: [],
      activeSession: "",
    },
    "t1",
  );
  await feed({ type: "$ready" }, "t1");
  await feed({ type: "$sessions", epoch: "e1", revision: 1, items: [] }, "t1");
  await settle(30);
}

describe("desktop — a new tab's first message", () => {
  beforeEach(() => {
    mockDesktopHost();
  });
  afterEach(() => {
    resetDesktopHost();
  });

  /** Boots the app on a workspace-less tab: the state "+" opens. */
  async function bootPendingTab() {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    await feed({ type: "$connected" });
    await feed({
      type: "$tabs_snapshot",
      tabs: [{ id: "t1", workspaceDir: "", active: true, groupId: "g1", activeSession: "" }],
    });
    await feed(
      {
        type: "$tab_opened",
        workspaceDir: "",
        active: true,
        groupId: "g1",
        sessions: [],
        activeSession: "",
      },
      "t1",
    );
    await feed({ type: "$settings", ...settings("") }, "t1");
    await feed({ type: "$workspace_initialized", revision: 1 }, "t1");
    await settle(30);
  }

  it("shows the workspace picker, with no composer, before a workspace exists", async () => {
    await bootPendingTab();
    expect(document.querySelector(".pending-workspace")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Ask the agent/)).toBeNull();
  });

  it("creates the chat from the message and asks for that chat's capabilities", async () => {
    await bootPendingTab();

    // The pick applies to this tab and is persisted as a workspace switch.
    const row = document.querySelector<HTMLElement>(".pending-workspace .wd-row");
    expect(row).not.toBeNull();
    await act(async () => {
      row!.click();
    });
    // Settings saves coalesce for 200 ms before they leave the window.
    await settle(260);
    expect(sent.some((c) => c.cmd === "settings_save" && c.workspaceDir === WS)).toBe(true);

    // The workspace has no session, so the channel comes back NEUTRAL and ready: the
    // composer is live before any chat exists.
    await openWorkspaceOnPendingTab();
    const composer = screen.getByPlaceholderText(/Ask the agent/) as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);

    fireEvent.change(composer, { target: { value: "fix the build" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await settle(30);

    const inputs = sent.filter((c) => c.cmd === "user_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ text: "fix the build" });
    // The echo is on screen before the daemon names the session.
    expect(screen.getByText("fix the build")).toBeTruthy();

    // The send minted the chat, so its capability picker asks for THAT chat, and the
    // message waits as its first turn.
    await feed({ type: "$session_bound", name: "s-1" }, "t1");
    await feed(
      { type: "$mcp_setup", servers: [], plugins: [], skills: [], subagents: false },
      "t1",
    );
    await settle(30);
    expect(screen.getByRole("dialog", { name: "Set up this chat" })).toBeTruthy();
    // The gate parks the send; it does not close the composer the user is typing in.
    expect((screen.getByPlaceholderText(/Ask the agent/) as HTMLTextAreaElement).disabled).toBe(
      false,
    );

    await act(async () => {
      screen.getByText("Confirm and start").click();
    });
    expect(sent.some((c) => c.cmd === "mcp_session_configure")).toBe(true);

    await feed({ type: "$ready" }, "t1");
    await feed({ type: "$turn_started" }, "t1");
    await settle(30);
    expect(screen.queryByRole("dialog", { name: "Set up this chat" })).toBeNull();
    expect(screen.getByText("fix the build")).toBeTruthy();
  });

  it("follows the session the first message minted, from the pill to the running dot", async () => {
    await bootPendingTab();
    const row = document.querySelector<HTMLElement>(".pending-workspace .wd-row");
    await act(async () => {
      row!.click();
    });
    await settle(260);
    await openWorkspaceOnPendingTab();

    const composer = screen.getByPlaceholderText(/Ask the agent/) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "name this chat" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await settle(20);

    // The mint names the chat: the pill reads its row title, not the workspace it sits on.
    await feed({ type: "$session_bound", name: "s-1" }, "t1");
    await feed(
      {
        type: "$sessions",
        epoch: "e1",
        revision: 2,
        items: [
          { name: "s-1", title: "Fresh chat", messageCount: 1, mtime: new Date(1).toISOString() },
        ],
      },
      "t1",
    );
    await settle(30);
    expect(
      document.querySelector<HTMLElement>('.tabbar .tab[data-active="true"] .label')?.textContent,
    ).toBe("Fresh chat");

    // And the running set follows the same binding: the sidebar dots THAT row.
    await feed({ type: "$turn_started" }, "t1");
    await settle(30);
    const runningRows = Array.from(document.querySelectorAll(".session-item")).filter(
      (el) => el.querySelector(".state") !== null,
    );
    expect(runningRows).toHaveLength(1);
    expect(runningRows[0]?.textContent).toContain("Fresh chat");
  });

  it("keeps typing while the tab is still coming up and sends the draft once it can run", async () => {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    await feed({ type: "$connected" });
    await feed({
      type: "$tabs_snapshot",
      tabs: [{ id: "t1", workspaceDir: WS, active: true, groupId: "g1", activeSession: "" }],
    });
    await feed(
      {
        type: "$tab_opened",
        workspaceDir: WS,
        active: true,
        groupId: "g1",
        sessions: [],
        activeSession: "",
      },
      "t1",
    );
    await feed({ type: "$settings", ...settings(WS) }, "t1");
    await feed({ type: "$workspace_initialized", revision: 1 }, "t1");
    await settle(20);

    // Nothing is ready yet, but the tab has a workspace, so its box takes the text
    // instead of swallowing every keystroke.
    const composer = screen.getByPlaceholderText(/Ask the agent/) as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    fireEvent.change(composer, { target: { value: "half-typed" } });
    expect(composer.value).toBe("half-typed");

    // A send before `$ready` is parked, not dropped: it goes out once the tab is ready.
    fireEvent.keyDown(composer, { key: "Enter" });
    await settle(20);
    expect(sent.some((c) => c.cmd === "user_input")).toBe(false);
    expect(document.querySelector(".composer-queued")?.textContent).toContain("half-typed");

    await feed({ type: "$ready" }, "t1");
    await settle(30);
    const inputs = sent.filter((c) => c.cmd === "user_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ text: "half-typed" });
  });
});
