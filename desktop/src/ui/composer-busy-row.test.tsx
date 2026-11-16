// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

afterEach(cleanup);

import { Composer } from "./composer";
import { makeComposerBaseProps } from "./composer-test-fixtures";

function renderStatus(overrides: Parameters<typeof makeComposerBaseProps>[0] = {}) {
  const { container } = render(<Composer {...makeComposerBaseProps(overrides)} />);
  return container;
}

describe("Composer status row", () => {
  it("renders the busy label on its own row, outside the foot", () => {
    const container = renderStatus({ busy: true, busyLabel: "Waiting for model…" });

    const statusRow = container.querySelector(".composer-busy-row");
    expect(statusRow?.textContent).toContain("Waiting for model…");
    // Own row: a direct child of the composer column, never inside the card's foot.
    expect(statusRow?.parentElement?.className).toBe("composer-inner");
    expect(container.querySelector(".composer-foot .composer-busy-label")).toBeNull();
    expect(container.querySelector(".composer-foot .composer-busy-row")).toBeNull();
    expect(statusRow?.querySelector(".composer-foot")).toBeNull();
    // The edit gate pill stays in the foot, where the other pickers are.
    expect(statusRow?.querySelector(".mode-pill")).toBeNull();
    expect(container.querySelector(".composer-foot .mode-pill")).toBeTruthy();
  });

  it("keeps the timer and stuck hint with the label, never in the foot", () => {
    const container = renderStatus({
      busy: true,
      busyLabel: "Reasoning…",
      stuckLabel: {
        sinceMs: Date.now() - 120_000,
        render: (sec) => `Stuck: no response for ${sec}s`,
      },
    });

    const statusRow = container.querySelector(".composer-busy-row");
    expect(statusRow?.querySelector(".composer-busy-pip")).toBeTruthy();
    expect(statusRow?.querySelector(".composer-busy-time")).toBeTruthy();
    expect(statusRow?.querySelector(".composer-busy-stuck")?.textContent).toContain("Stuck:");
    expect(container.querySelector(".composer-foot .composer-busy-stuck")).toBeNull();
  });

  it("keeps the busy keys at the right of the status row", () => {
    const container = renderStatus({ busy: true, busyLabel: "Reasoning…" });

    const hints = container.querySelector(".composer-busy-row .band-hints");
    expect(hints?.textContent).toContain("queue");
    expect(hints?.textContent).toContain("stop");
    expect(hints?.textContent).not.toContain("newline");
    // Last child: the label, timer and stuck hint keep the left side.
    expect(hints?.parentElement?.lastElementChild).toBe(hints);
    // One home: the idle row steps aside while a turn runs.
    expect(container.querySelector(".composer-hints-row")).toBeNull();
    expect(container.querySelector(".composer-foot .band-hints")).toBeNull();
  });

  it("always shows a hint row above the card when nothing else is up", () => {
    const idle = renderStatus();
    const hints = idle.querySelector(".composer-hints-row .band-hints");
    expect(hints?.textContent).toContain("send");
    expect(hints?.textContent).toContain("newline");
    expect(idle.querySelector(".composer-foot .band-hints")).toBeNull();
    expect(idle.querySelector(".hint-row")).toBeNull();
    cleanup();

    // Queued with nothing running: the strip owns the hints instead of a second row.
    const queued = renderStatus({ queuedSends: ["one"] });
    expect(queued.querySelector(".composer-queued .band-hints")?.textContent).toContain("newline");
    expect(queued.querySelector(".composer-hints-row")).toBeNull();
  });
});
