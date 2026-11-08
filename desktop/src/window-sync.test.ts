/** The resize listener is the repair path for every transition the titlebar never
 *  sees (snap, Win+Down, double-click restore), so one drag must cost one call. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { watchWindowFrame } from "./window-frame";

const { resizeHandlers, unlisten } = vi.hoisted(() => ({
  resizeHandlers: [] as Array<() => void>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async (_event: string, handler: () => void) => {
      resizeHandlers.push(handler);
      return unlisten;
    },
  }),
}));

vi.mock("./diagnostics", () => ({ recordFrontendFailure: vi.fn() }));

/** Lets the pending `listen()` promise settle without advancing timers. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("window frame watcher", () => {
  beforeEach(() => {
    resizeHandlers.length = 0;
    unlisten.mockClear();
    vi.mocked(invoke).mockClear();
    vi.useFakeTimers();
  });

  it("repairs once on mount", () => {
    watchWindowFrame();
    expect(invoke).toHaveBeenCalledWith("sync_window_frame");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of resizes into one repair", async () => {
    watchWindowFrame();
    await settle();
    expect(resizeHandlers).toHaveLength(1);
    vi.mocked(invoke).mockClear();

    for (let index = 0; index < 8; index++) resizeHandlers[0]!();
    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("sync_window_frame");
  });

  it("keeps repairing later bursts instead of only the first", async () => {
    watchWindowFrame();
    await settle();
    vi.mocked(invoke).mockClear();

    resizeHandlers[0]!();
    await vi.advanceTimersByTimeAsync(150);
    resizeHandlers[0]!();
    await vi.advanceTimersByTimeAsync(150);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("drops a pending repair and the listener when it unwinds", async () => {
    const stop = watchWindowFrame();
    await settle();
    vi.mocked(invoke).mockClear();

    resizeHandlers[0]!();
    stop();
    await vi.advanceTimersByTimeAsync(300);

    expect(invoke).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
