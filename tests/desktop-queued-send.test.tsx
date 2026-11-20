// @vitest-environment jsdom
// The queued-send contract, end to end against a mocked Tauri bridge:
//   * a message typed while a turn runs is QUEUED (and the composer cleared),
//   * the queue drains ONE message per idle edge, strictly FIFO,
//   * a quiet `$tab_status` probe that lands before the daemon picked the send
//     up never releases that gate, so a queued message can't be pushed into a
//     turn that is only just starting.

import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../desktop/src/App";
import {
  WS,
  feed,
  handlers,
  mockDesktopHost,
  resetDesktopHost,
  sent,
  settle,
} from "./support/desktop-harness";

const userInputs = () =>
  sent.filter((command) => command.cmd === "user_input").map((command) => command.text);

const composer = () => screen.getByPlaceholderText(/Ask the agent/) as HTMLTextAreaElement;

async function type(text: string) {
  await act(async () => {
    fireEvent.change(composer(), { target: { value: text } });
  });
}

async function pressEnter() {
  await act(async () => {
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: false });
  });
  await settle();
}

async function startupWithSessionA() {
  await feed({ type: "$connected" });
  await feed({
    type: "$tabs_snapshot",
    tabs: [{ id: "t1", workspaceDir: WS, active: true, groupId: "g1", activeSession: "A" }],
  });
  await feed(
    {
      type: "$tab_opened",
      workspaceDir: WS,
      active: true,
      groupId: "g1",
      sessions: ["A"],
      activeSession: "A",
    },
    "t1",
  );
  await feed(
    {
      type: "$settings",
      reasoningEffort: "medium",
      editMode: "follow",
      quickSendId: "proceed",
      quickSends: [],
      workspaceDir: WS,
      recentWorkspaces: [WS],
      model: "deepseek-v4-flash",
      version: "0.50.1",
    },
    "t1",
  );
  // Lift the startup overlay: until the active tab acks its initialization the app
  // swallows every keydown, so a real user could not type either.
  await feed({ type: "$workspace_initialized", revision: 1 }, "t1");
  await feed({ type: "$ready" }, "t1");
  await feed(
    {
      type: "$session_loaded",
      name: "A",
      messages: [],
      carryover: {
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        totalCompletionTokens: 0,
      },
    },
    "t1",
  );
  await feed(
    {
      type: "$sessions",
      epoch: "e1",
      revision: 1,
      items: [{ name: "A", messageCount: 0, mtime: new Date(1).toISOString() }],
    },
    "t1",
  );
  await settle();
}

const idleProbe = {
  type: "$tab_status",
  busy: false,
  queued: 0,
  compacting: false,
  switching: false,
};

describe("desktop — one queued message per idle turn", () => {
  beforeEach(() => {
    mockDesktopHost();
  });

  afterEach(() => {
    resetDesktopHost();
  });

  it("queues a message typed while busy and sends it only after the turn settles", async () => {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    await startupWithSessionA();

    // First turn goes out immediately and clears the composer.
    await type("first");
    await pressEnter();
    expect(userInputs()).toEqual(["first"]);
    expect(composer().value).toBe("");

    // The daemon owns the turn from here.
    await feed({ type: "$turn_started", turn: 1 }, "t1");

    // A send while busy is parked: no RPC, composer cleared, one chip.
    await type("second");
    await pressEnter();
    expect(userInputs()).toEqual(["first"]);
    expect(composer().value).toBe("");
    expect(screen.getByText("queued 1")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();

    // The turn settles: exactly the queued message goes out, and nothing else.
    await feed({ type: "$turn_complete", outcome: "success", turn: 1 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second"]);
    expect(screen.queryByText("queued 1")).toBeNull();
  });

  it("drains one message per idle turn, in order, never two at once", async () => {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    await startupWithSessionA();

    await type("first");
    await pressEnter();
    await feed({ type: "$turn_started", turn: 1 }, "t1");

    await type("second");
    await pressEnter();
    await type("third");
    await pressEnter();
    expect(userInputs()).toEqual(["first"]);
    expect(screen.getByText("queued 2")).toBeTruthy();

    // Turn 1 ends: only "second" leaves the queue.
    await feed({ type: "$turn_complete", outcome: "success", turn: 1 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second"]);
    expect(screen.getByText("queued 1")).toBeTruthy();
    expect(screen.getByText("third")).toBeTruthy();

    // "second" running keeps "third" parked; its own settle releases it.
    await feed({ type: "$turn_started", turn: 2 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second"]);

    await feed({ type: "$turn_complete", outcome: "success", turn: 2 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second", "third"]);
    expect(screen.queryByText(/queued \d/)).toBeNull();
  });

  it("does not release the queue on an idle probe that lands before the send is acknowledged", async () => {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    await startupWithSessionA();

    await type("first");
    await pressEnter();
    await feed({ type: "$turn_started", turn: 1 }, "t1");
    await type("second");
    await pressEnter();
    expect(screen.getByText("queued 1")).toBeTruthy();

    // Turn 1 settles, so "second" is dispatched — but the daemon has not picked it
    // up yet (an image mention or the MCP bridge parks the turn). A probe answered
    // in that window used to release the optimistic send, which both announced a
    // phantom resync and pushed the next queued message into a turn that was only
    // now starting.
    await feed({ type: "$turn_complete", outcome: "success", turn: 1 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second"]);

    await type("third");
    await pressEnter();
    expect(screen.getByText("queued 1")).toBeTruthy();
    await feed(idleProbe, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second"]);
    expect(screen.getByText("queued 1")).toBeTruthy();
    expect(screen.getByText("third")).toBeTruthy();
    expect(screen.queryByText(/Resynced with the agent/)).toBeNull();

    // The ack does arrive: "third" waits for the second turn to settle.
    await feed({ type: "$turn_started", turn: 2 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second"]);
    await feed({ type: "$turn_complete", outcome: "success", turn: 2 }, "t1");
    await settle();
    expect(userInputs()).toEqual(["first", "second", "third"]);
  });
});
