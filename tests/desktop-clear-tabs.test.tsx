// @vitest-environment jsdom
// Clearing the ribbon is a bulk action: a tab whose agent is mid-turn keeps its channel,
// and the clear says how many it left open. The daemon re-checks the same rule, so a
// stale busy flag on the ribbon cannot take a running turn with it either.
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

/** Two tabs on one workspace: "t1" idle, "t2" is given a turn in flight by the caller. */
async function bootTwoTabs() {
  render(<App />);
  await act(async () => {
    await Promise.resolve();
  });
  await feed({ type: "$connected" });
  await feed({
    type: "$tabs_snapshot",
    tabs: [
      { id: "t1", workspaceDir: WS, active: true, groupId: "g1", activeSession: "A" },
      { id: "t2", workspaceDir: WS, active: false, groupId: "g1", activeSession: "B" },
    ],
  });
  for (const id of ["t1", "t2"]) {
    await feed(
      {
        type: "$tab_opened",
        workspaceDir: WS,
        active: id === "t1",
        groupId: "g1",
        sessions: [id === "t1" ? "A" : "B"],
        activeSession: id === "t1" ? "A" : "B",
      },
      id,
    );
    await feed({ type: "$settings", ...settings(WS) }, id);
    await feed({ type: "$ready" }, id);
  }
  await feed({ type: "$workspace_initialized", revision: 1 }, "t1");
  await settle(30);
}

describe("desktop — clearing tabs", () => {
  beforeEach(() => {
    mockDesktopHost();
  });
  afterEach(() => {
    resetDesktopHost();
  });

  /** Open the ribbon's context menu and pick one clear scope. */
  async function clearFromMenu(name: string) {
    await act(async () => {
      fireEvent.contextMenu(document.querySelector(".tabbar")!);
    });
    const item = screen.getByRole("menuitem", { name });
    await act(async () => {
      fireEvent.click(item);
    });
    await settle(30);
  }

  it("closes the idle tab and keeps the one whose agent is running", async () => {
    await bootTwoTabs();
    // t2 starts a turn; the ribbon dots it and the clear must leave it alone.
    await feed({ type: "$turn_started" }, "t2");
    await settle(30);
    const pills = Array.from(document.querySelectorAll(".tabbar .tab"));
    expect(pills[1]?.querySelector(".dot")).toBeTruthy();

    await clearFromMenu("Clear all tabs");

    const closes = sent.filter((c) => c.cmd === "tab_close");
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ tabId: "t1" });
    // The clear asks the daemon for the same rule, so a stale flag cannot beat it.
    expect(closes[0]).toMatchObject({ keepRunning: true });
    // And it says how many it kept instead of closing over the reason.
    expect(screen.getByText(/Kept 1 running tab/)).toBeTruthy();
  });

  it("leaves every running tab open when the whole scope is running", async () => {
    await bootTwoTabs();
    await feed({ type: "$turn_started" }, "t1");
    await feed({ type: "$turn_started" }, "t2");
    await settle(30);

    // The ribbon says why instead of presenting a click that cannot do anything.
    await act(async () => {
      fireEvent.contextMenu(document.querySelector(".tabbar")!);
    });
    const clearAll = screen.getByRole("menuitem", { name: "Clear all tabs" });
    expect(clearAll.getAttribute("aria-disabled")).toBe("true");
    expect(clearAll.getAttribute("title")).toBe(
      "Only idle tabs clear. Stop the running agent first.",
    );
    await act(async () => {
      fireEvent.click(clearAll);
    });
    await settle(20);
    expect(sent.filter((c) => c.cmd === "tab_close")).toHaveLength(0);
  });

  it("still closes a running tab from its own close control", async () => {
    await bootTwoTabs();
    await feed({ type: "$turn_started" }, "t2");
    await settle(30);

    const busyTab = document.querySelectorAll(".tabbar .tab")[1]!;
    await act(async () => {
      (busyTab.querySelector(".close") as HTMLElement).click();
    });
    await settle(20);

    const closes = sent.filter((c) => c.cmd === "tab_close");
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ tabId: "t2" });
    // An explicit click never asks the daemon to spare a live tab.
    expect(closes[0]?.keepRunning).toBeUndefined();
  });
});
