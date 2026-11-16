/** Atomic monitor-bounded actions combine pointer positioning and clicking in one host operation. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { messageOf } from "@reasonix/core-utils";
import { type MonitorInfo, defaultListMonitors, findMonitor } from "./screen-capture.js";
import {
  PS_WIN_FOCUS_TYPE,
  psMatchWindowStatements,
  psRaiseWindowStatements,
} from "./win-focus.js";

const execFileAsync = promisify(execFile);

type Point = { x: number; y: number };

export interface ComputerUseOptions {
  listMonitors?: () => Promise<MonitorInfo[]>;
  /** Test seam for the complete native action. */
  actionRunner?: (action: {
    kind: "click" | "focus";
    monitor: MonitorInfo;
    point?: Point;
    app?: string;
  }) => Promise<void>;
}

function selectMonitor(monitors: MonitorInfo[], query: unknown): MonitorInfo {
  if (query === undefined || query === null || query === "") {
    throw new Error(
      "computer_use: monitor is required; actions cannot target an ambiguous desktop.",
    );
  }
  const match = findMonitor(monitors, query);
  if (match) return match;
  throw new Error(`computer_use: invalid monitor '${String(query)}'.`);
}

function point(args: Record<string, unknown>, monitor: MonitorInfo): Point {
  const x = Number(args.x);
  const y = Number(args.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(
      "computer_use: click x and y must be integer pixel coordinates relative to the monitor.",
    );
  }
  if (x < 0 || y < 0 || x >= monitor.width || y >= monitor.height) {
    throw new Error(
      `computer_use: click (${x}, ${y}) is outside monitor ${monitor.index} bounds ${monitor.width}x${monitor.height}.`,
    );
  }
  return { x, y };
}

async function nativeAction(action: {
  kind: "click" | "focus";
  monitor: MonitorInfo;
  point?: Point;
  app?: string;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("computer_use: native atomic input is currently implemented on Windows only.");
  }
  const encoded = Buffer.from(JSON.stringify(action), "utf8").toString("base64");
  const script = [
    "$ErrorActionPreference = 'Stop';",
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class RxInput { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra); }\' -ErrorAction SilentlyContinue;',
    PS_WIN_FOCUS_TYPE,
    `$a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json;`,
    "if ($a.kind -eq 'click') { [RxInput]::SetCursorPos([int]$a.monitor.x + [int]$a.point.x, [int]$a.monitor.y + [int]$a.point.y) | Out-Null; [RxInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [RxInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); }",
    "if ($a.kind -eq 'focus') {",
    ...psMatchWindowStatements("$a.app"),
    ...psRaiseWindowStatements(),
    "}",
  ].join("\n");
  await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 5000,
  });
}

/** Run one atomic action. Throws with the caller-facing message on every failure path. */
export async function runComputerUse(
  args: Record<string, unknown>,
  opts: ComputerUseOptions = {},
): Promise<string> {
  const monitors = await (opts.listMonitors ?? defaultListMonitors)();
  const monitor = selectMonitor(monitors, args.monitor);
  const action = args.action === "click" ? "click" : args.action === "focus" ? "focus" : undefined;
  if (!action) throw new Error("computer_use: action must be 'click' or 'focus'.");
  const selected: { kind: "click" | "focus"; monitor: MonitorInfo; point?: Point; app?: string } =
    action === "click"
      ? { kind: action, monitor, point: point(args, monitor) }
      : { kind: action, monitor, app: String(args.app ?? "").trim() };
  if (action === "focus" && !selected.app)
    throw new Error("computer_use: app is required for focus.");
  try {
    await (opts.actionRunner ?? nativeAction)(selected);
  } catch (err) {
    throw new Error(`computer_use: ${messageOf(err)}`);
  }
  return action === "click"
    ? `computer_use: clicked monitor ${monitor.index} at (${(selected as { point: Point }).point.x}, ${(selected as { point: Point }).point.y}) atomically.`
    : `computer_use: focused and maximized '${(selected as { app: string }).app}' on monitor ${monitor.index}.`;
}
