/** screen_capture behaviour, exercised through the desktop MCP tool handler with the
 *  native capture/focus seams injected. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callDesktopTool } from "../src/mcp/servers/desktop/tools.js";
import type { CallToolResult } from "../src/mcp/types.js";
import {
  type CaptureArea,
  type FocusResult,
  type MonitorInfo,
  calculateCaptureArea,
  resolveOutputPath,
  selectMonitor,
} from "../src/tools/screen-capture.js";

function textOf(result: CallToolResult): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

function imagesOf(result: CallToolResult): Array<{ data: string; mimeType: string }> {
  return result.content.filter(
    (block): block is { type: "image"; data: string; mimeType: string } => block.type === "image",
  );
}

describe("screen_capture", () => {
  let root: string;
  let mockMonitors: MonitorInfo[];
  let capturedOptions: Array<{ monitor: MonitorInfo; crop: CaptureArea; outputPath: string }>;
  let focusedApps: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "screen-capture-"));
    mockMonitors = [
      {
        id: "\\\\.\\DISPLAY1",
        name: "\\\\.\\DISPLAY1",
        index: 0,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        primary: true,
      },
      {
        id: "\\\\.\\DISPLAY2",
        name: "\\\\.\\DISPLAY2",
        index: 1,
        x: 1920,
        y: 0,
        width: 2560,
        height: 1440,
        primary: false,
      },
    ];
    capturedOptions = [];
    focusedApps = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function mockPngBuffer(): Promise<Buffer> {
    const img = new Jimp({ width: 10, height: 10, color: 0xff0000ff });
    return await img.getBuffer("image/png");
  }

  function shoot(
    args: Record<string, unknown>,
    opts: {
      focusRunner?: (app: string) => Promise<FocusResult | undefined>;
      includeImage?: boolean;
    } = {},
  ): Promise<CallToolResult> {
    return callDesktopTool("screen_capture", args, {
      rootDir: root,
      includeImage: opts.includeImage ?? true,
      screen: {
        listMonitors: async () => mockMonitors,
        focusRunner:
          opts.focusRunner ??
          (async (app) => {
            focusedApps.push(app);
            return undefined;
          }),
        captureRunner: async (opt) => {
          capturedOptions.push(opt);
          writeFileSync(opt.outputPath, await mockPngBuffer());
        },
      },
    });
  }

  it("captures the explicitly selected primary monitor and returns the PNG", async () => {
    const result = await shoot({ monitor: 0 });

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Screen capture (monitor 0 [\\\\.\\DISPLAY1]");
    expect(textOf(result)).toContain("Pixels attached below");
    const images = imagesOf(result);
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect(Buffer.from(images[0]!.data, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");

    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.monitor.index).toBe(0);
    expect(capturedOptions[0]?.crop.width).toBe(1920);
    expect(capturedOptions[0]?.crop.height).toBe(1080);
  });

  it("captures a specific monitor by index", async () => {
    const result = await shoot({ monitor: 1 });

    expect(result.isError).toBeUndefined();
    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.monitor.index).toBe(1);
    expect(capturedOptions[0]?.crop.width).toBe(2560);
    expect(capturedOptions[0]?.crop.height).toBe(1440);
    expect(capturedOptions[0]?.crop.globalX).toBe(1920);
  });

  it("captures a specific rectangular region using top_left and bottom_right parameters", async () => {
    const result = await shoot({
      monitor: 0,
      top_left_x: 100,
      top_left_y: 150,
      bottom_right_x: 500,
      bottom_right_y: 450,
    });

    expect(result.isError).toBeUndefined();
    expect(capturedOptions).toHaveLength(1);
    const opt = capturedOptions[0]!;
    expect(opt.crop.x).toBe(100);
    expect(opt.crop.y).toBe(150);
    expect(opt.crop.width).toBe(400);
    expect(opt.crop.height).toBe(300);
    expect(opt.crop.globalX).toBe(100);
    expect(opt.crop.globalY).toBe(150);
  });

  it("normalizes inverted corner coordinates", async () => {
    const result = await shoot({
      monitor: 0,
      top_left_x: 500,
      top_left_y: 450,
      bottom_right_x: 100,
      bottom_right_y: 150,
    });

    expect(result.isError).toBeUndefined();
    expect(capturedOptions).toHaveLength(1);
    const opt = capturedOptions[0]!;
    expect(opt.crop.x).toBe(100);
    expect(opt.crop.y).toBe(150);
    expect(opt.crop.width).toBe(400);
    expect(opt.crop.height).toBe(300);
  });

  it("supports array pair coordinates [x, y]", async () => {
    const result = await shoot({
      monitor: 1,
      top_left: [200, 250],
      bottom_right: [600, 650],
    });

    expect(result.isError).toBeUndefined();
    expect(capturedOptions).toHaveLength(1);
    const opt = capturedOptions[0]!;
    expect(opt.monitor.index).toBe(1);
    expect(opt.crop.x).toBe(200);
    expect(opt.crop.y).toBe(250);
    expect(opt.crop.width).toBe(400);
    expect(opt.crop.height).toBe(400);
    expect(opt.crop.globalX).toBe(1920 + 200);
  });

  it("fails fast with loud error on invalid monitor selection", async () => {
    const result = await shoot({ monitor: 99 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("screen_capture: invalid monitor '99'");
    expect(textOf(result)).toContain("Available monitors");
  });

  it("fails fast with loud error when only one corner is provided", async () => {
    const result = await shoot({ monitor: 0, top_left_x: 100, top_left_y: 100 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("both top-left and bottom-right corners must be specified");
  });

  it("fails fast with loud error on zero area crop region", async () => {
    const result = await shoot({
      monitor: 0,
      top_left_x: 100,
      top_left_y: 100,
      bottom_right_x: 100,
      bottom_right_y: 100,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("invalid capture region: width and height must be positive");
  });

  it("fails fast with loud error when region is entirely outside monitor bounds", async () => {
    const result = await shoot({
      monitor: 0,
      top_left_x: 2000,
      top_left_y: 2000,
      bottom_right_x: 2500,
      bottom_right_y: 2500,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("is outside monitor bounds (1920x1080)");
  });

  it("saves screenshot to custom path when provided", async () => {
    const customDest = join(root, "custom-shot.png");
    const result = await shoot({ monitor: 0, path: customDest });

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain(customDest);
    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.outputPath).toBe(customDest);
  });

  it("creates the parent folder of a nested custom path", async () => {
    const customDest = join(root, "shots", "nested", "custom.png");
    mkdirSync(join(root, "shots", "nested"), { recursive: true });
    const result = await shoot({ monitor: 0, path: customDest });

    expect(result.isError).toBeUndefined();
    expect(capturedOptions[0]?.outputPath).toBe(customDest);
  });

  it("brings specified app to foreground before capture and records in metadata", async () => {
    const result = await shoot({ app: "Blender", monitor: 0 });

    expect(result.isError).toBeUndefined();
    expect(focusedApps).toEqual(["Blender"]);
    expect(textOf(result)).toContain('app "Blender"');
    expect(capturedOptions).toHaveLength(1);
  });

  it("follows the focused app's own display instead of a conflicting monitor index", async () => {
    const result = await shoot(
      { app: "Blender", monitor: 0 },
      { focusRunner: async () => ({ monitorName: mockMonitors[1]!.name }) },
    );

    expect(result.isError).toBeUndefined();
    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.monitor.index).toBe(1);
  });

  it("derives the display from the focused app when no monitor is passed", async () => {
    const result = await shoot(
      { app: "Blender" },
      { focusRunner: async () => ({ monitorName: mockMonitors[1]!.name }) },
    );

    expect(result.isError).toBeUndefined();
    expect(capturedOptions[0]?.monitor.index).toBe(1);
  });

  it("requires a monitor when no app is given to derive one from", async () => {
    const result = await shoot({});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("monitor is required when no app is specified");
    expect(capturedOptions).toHaveLength(0);
  });

  it("does not infer a monitor from an unresolved focused app", async () => {
    const result = await shoot(
      { app: "Blender", monitor: 0 },
      { focusRunner: async () => ({ monitorName: "NO_SUCH_DISPLAY" }) },
    );

    expect(result.isError).toBeUndefined();
    expect(capturedOptions[0]?.monitor.index).toBe(0);
  });

  it("supports window and window_title aliases for focusing", async () => {
    await shoot({ window: "UnrealEditor", monitor: 0 });
    expect(focusedApps).toContain("UnrealEditor");

    await shoot({ window_title: "Obsidian", monitor: 0 });
    expect(focusedApps).toContain("Obsidian");
  });

  it("fails fast and loud without capturing if app is not found", async () => {
    const result = await shoot(
      { app: "MissingApp" },
      {
        focusRunner: async (app) => {
          throw new Error(
            `screen_capture: no running application or window matching '${app}' found.`,
          );
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      "no running application or window matching 'MissingApp' found",
    );
    expect(capturedOptions).toHaveLength(0);
  });

  it("fails fast with loud error on non-numeric coordinate values", async () => {
    const result = await shoot({
      monitor: 0,
      top_left_x: "not-a-number",
      top_left_y: 100,
      bottom_right_x: 200,
      bottom_right_y: 200,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("parameter 'top_left_x' must be a valid number");
  });

  it("pure calculateCaptureArea computes coordinates, clamps bounds, and validates area", () => {
    const monitor: MonitorInfo = {
      id: "M0",
      name: "M0",
      index: 0,
      x: 100,
      y: 100,
      width: 1920,
      height: 1080,
      primary: true,
    };

    // Full monitor when no corners specified
    const full = calculateCaptureArea(monitor);
    expect(full).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      globalX: 100,
      globalY: 100,
    });

    // Sub-region with partial clamping
    const clamped = calculateCaptureArea(monitor, { x: 1800, y: 1000 }, { x: 2100, y: 1200 });
    expect(clamped.x).toBe(1800);
    expect(clamped.y).toBe(1000);
    expect(clamped.width).toBe(120); // 1920 - 1800
    expect(clamped.height).toBe(80); // 1080 - 1000
    expect(clamped.globalX).toBe(1900);
    expect(clamped.globalY).toBe(1100);

    // Completely out-of-bounds throws
    expect(() => calculateCaptureArea(monitor, { x: 2000, y: 2000 }, { x: 2100, y: 2100 })).toThrow(
      "outside monitor bounds",
    );

    // Zero area throws
    expect(() => calculateCaptureArea(monitor, { x: 50, y: 50 }, { x: 50, y: 100 })).toThrow(
      "must be positive",
    );
  });

  it("pure selectMonitor selects primary, by index, or by name and lists available on failure", () => {
    // Default primary
    const primary = selectMonitor(mockMonitors, undefined);
    expect(primary.index).toBe(0);

    // By index
    const m1 = selectMonitor(mockMonitors, 1);
    expect(m1.index).toBe(1);

    // By name
    const mName = selectMonitor(mockMonitors, "\\\\.\\DISPLAY2");
    expect(mName.index).toBe(1);

    // Unknown monitor throws with available list
    expect(() => selectMonitor(mockMonitors, "MISSING_DISPLAY")).toThrow("Available monitors: #0:");
  });

  it("pure resolveOutputPath produces project-rooted screenshots", () => {
    const out1 = resolveOutputPath(undefined, root);
    expect(out1.startsWith(join(root, ".reasonix", "screenshots"))).toBe(true);

    const custom = resolveOutputPath("my-capture.png", root);
    expect(custom).toBe(join(root, "my-capture.png"));
  });

  it("focuses an app and reports a missing app without host process calls", async () => {
    const focusRunner = async (app: string): Promise<FocusResult | undefined> => {
      focusedApps.push(app);
      if (app.toLowerCase().includes("fake")) {
        throw new Error(
          "no running application or window matching 'completelyfakenonexistentapp12345' found",
        );
      }
      return { monitorName: mockMonitors[0]?.name };
    };

    const okResult = await shoot(
      {
        app: "explorer",
        monitor: 0,
        top_left_x: 0,
        top_left_y: 0,
        bottom_right_x: 50,
        bottom_right_y: 50,
      },
      { focusRunner },
    );
    expect(okResult.isError).toBeUndefined();
    expect(imagesOf(okResult)).toHaveLength(1);

    const failResult = await shoot({ app: "CompletelyFakeNonExistentApp12345" }, { focusRunner });
    expect(failResult.isError).toBe(true);
    expect(textOf(failResult).toLowerCase()).toContain(
      "no running application or window matching 'completelyfakenonexistentapp12345' found",
    );
    expect(focusedApps).toEqual(["explorer", "CompletelyFakeNonExistentApp12345"]);
  });
});
