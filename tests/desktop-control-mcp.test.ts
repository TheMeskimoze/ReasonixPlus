/** The bundled desktop MCP server: protocol handling, both tools, and a real subprocess bridge. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp } from "jimp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { McpClient } from "../src/mcp/client.js";
import { bridgeMcpTools } from "../src/mcp/registry.js";
import { handleDesktopFrame } from "../src/mcp/servers/desktop/protocol.js";
import { DESKTOP_MCP_TOOLS, type DesktopToolOptions } from "../src/mcp/servers/desktop/tools.js";
import { StdioTransport, defaultShellForCommand } from "../src/mcp/stdio.js";
import { ToolRegistry } from "../src/tools.js";
import type { CaptureArea, FocusResult, MonitorInfo } from "../src/tools/screen-capture.js";

const MONITORS: MonitorInfo[] = [
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
];

interface FrameResult {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

function resultOf(response: { result?: unknown } | null): FrameResult {
  return (response as { result: FrameResult }).result;
}

describe("desktop MCP server", () => {
  let root: string | undefined;
  let png: Buffer;
  let captured: Array<{ monitor: MonitorInfo; crop: CaptureArea; outputPath: string }>;
  let actions: unknown[];

  beforeAll(async () => {
    png = await new Jimp({ width: 8, height: 8, color: 0x00ff00ff }).getBuffer("image/png");
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function setup(overrides: Partial<DesktopToolOptions> = {}): DesktopToolOptions {
    root = mkdtempSync(join(tmpdir(), "desktop-mcp-"));
    captured = [];
    actions = [];
    return {
      rootDir: root,
      screen: {
        listMonitors: async () => MONITORS,
        focusRunner: async (_app: string): Promise<FocusResult | undefined> => undefined,
        captureRunner: async (opt) => {
          captured.push(opt);
          writeFileSync(opt.outputPath, png);
        },
      },
      computer: {
        listMonitors: async () => MONITORS,
        actionRunner: async (action) => {
          actions.push(action);
        },
      },
      ...overrides,
    };
  }

  it("lists both tools with the shared schemas", async () => {
    const opts = setup();
    const res = await handleDesktopFrame({ jsonrpc: "2.0", id: 1, method: "tools/list" }, opts);
    const tools = (res as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["computer_use", "screen_capture"]);
    expect(DESKTOP_MCP_TOOLS[0]?.inputSchema.required).toEqual(["action", "monitor"]);
    expect(Object.keys(DESKTOP_MCP_TOOLS[1]?.inputSchema.properties ?? {})).toContain("top_left_x");
  });

  it("answers initialize and ping, and stays silent for notifications", async () => {
    const opts = setup();
    const init = await handleDesktopFrame({ jsonrpc: "2.0", id: 7, method: "initialize" }, opts);
    expect((init as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe(
      "reasonix-desktop",
    );
    const ping = await handleDesktopFrame({ jsonrpc: "2.0", id: 8, method: "ping" }, opts);
    expect(ping).toEqual({ jsonrpc: "2.0", id: 8, result: {} });
    expect(
      await handleDesktopFrame({ jsonrpc: "2.0", method: "notifications/initialized" }, opts),
    ).toBeNull();
  });

  it("skips the shell for an absolute executable on Windows", () => {
    expect(defaultShellForCommand(process.execPath, "win32")).toBe(false);
    expect(defaultShellForCommand("npx", "win32")).toBe(true);
    expect(defaultShellForCommand(process.execPath, "linux")).toBe(false);
  });

  it("rejects unknown methods with -32601", async () => {
    const opts = setup();
    const res = await handleDesktopFrame({ jsonrpc: "2.0", id: 2, method: "resources/list" }, opts);
    expect((res as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("rejects non-object tool arguments with -32602", async () => {
    const opts = setup();
    const res = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 33,
        method: "tools/call",
        params: { name: "computer_use", arguments: [] },
      },
      opts,
    );
    expect((res as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("clicks atomically through the computer tool", async () => {
    const opts = setup();
    const res = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "computer_use", arguments: { action: "click", monitor: 0, x: 10, y: 20 } },
      },
      opts,
    );
    expect(resultOf(res).content?.[0]?.text).toContain("clicked monitor 0");
    expect(actions[0]).toMatchObject({ kind: "click", point: { x: 10, y: 20 } });
  });

  it("refuses a missing monitor and an out-of-bounds click", async () => {
    const opts = setup();
    const missing = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "computer_use", arguments: { action: "click", x: 1, y: 1 } },
      },
      opts,
    );
    expect(resultOf(missing).isError).toBe(true);
    expect(resultOf(missing).content?.[0]?.text).toContain("monitor is required");

    const outside = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: { name: "computer_use", arguments: { action: "click", monitor: 0, x: 1920, y: 1 } },
      },
      opts,
    );
    expect(resultOf(outside).isError).toBe(true);
    expect(resultOf(outside).content?.[0]?.text).toContain("outside monitor");
  });

  it("focuses through the same atomic action seam", async () => {
    const opts = setup();
    const res = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "computer_use",
          arguments: { action: "focus", monitor: 0, app: "Calculator" },
        },
      },
      opts,
    );
    expect(resultOf(res).content?.[0]?.text).toContain("focused and maximized 'Calculator'");
    expect(actions[0]).toMatchObject({ kind: "focus", app: "Calculator", monitor: { index: 0 } });
  });

  it("returns the capture as text plus an image block", async () => {
    const opts = setup();
    const res = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "screen_capture", arguments: { monitor: 0 } },
      },
      opts,
    );
    const content = resultOf(res).content!;
    expect(content[0]?.text).toContain("Screen capture (monitor 0");
    expect(content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(content[1]!.data!, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(captured).toHaveLength(1);
  });

  it("omits the image when the caller asks for text only", async () => {
    const opts = setup({ includeImage: false });
    const res = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "screen_capture", arguments: { monitor: 0 } },
      },
      opts,
    );
    const content = resultOf(res).content!;
    expect(content).toHaveLength(1);
    expect(content[0]?.text).toContain("see_image");
  });

  it("reports tool failures as isError text", async () => {
    const opts = setup();
    const res = await handleDesktopFrame(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "computer_use", arguments: { action: "click", monitor: 9, x: 1, y: 1 } },
      },
      opts,
    );
    expect(resultOf(res).isError).toBe(true);
    expect(resultOf(res).content?.[0]?.text).toContain("invalid monitor");
  });

  it("relays image blocks only when the bridge opts in", async () => {
    const fakeClient = {
      listTools: async () => ({
        tools: [{ name: "shot", description: "screenshot", inputSchema: { type: "object" } }],
      }),
      callTool: async () => ({
        content: [
          { type: "text", text: "took a shot" },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        ],
      }),
    } as unknown as McpClient;

    const textual = new ToolRegistry();
    await bridgeMcpTools(fakeClient, { registry: textual, namePrefix: "x_" });
    const text = await textual.dispatch("x_shot", "{}");
    expect(typeof text).toBe("string");
    expect(text).toContain("[image image/png");

    const visual = new ToolRegistry();
    await bridgeMcpTools(fakeClient, { registry: visual, namePrefix: "x_", imageBlocks: true });
    const parts = (await visual.dispatch("x_shot", "{}")) as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0]?.text).toContain("took a shot");
    expect(parts[1]?.image_url?.url).toMatch(/^data:image\//);
  });

  it("keeps the text and explains an image it could not attach", async () => {
    const fakeClient = {
      listTools: async () => ({
        tools: [{ name: "shot", description: "screenshot", inputSchema: { type: "object" } }],
      }),
      callTool: async () => ({
        content: [
          { type: "text", text: "took a shot" },
          { type: "image", data: "not-an-image", mimeType: "image/png" },
        ],
      }),
    } as unknown as McpClient;

    const registry = new ToolRegistry();
    await bridgeMcpTools(fakeClient, { registry, namePrefix: "x_", imageBlocks: true });
    const out = await registry.dispatch("x_shot", "{}");
    expect(typeof out).toBe("string");
    expect(out).toContain("took a shot");
    expect(out).toContain("image not attached");
  });

  it("bridges both tools into a registry from a real subprocess", async () => {
    const transport = new StdioTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp/servers/desktop-mcp.ts"],
    });
    const client = new McpClient({ transport });
    try {
      await client.initialize();
      const bridged = await bridgeMcpTools(client, { namePrefix: "desktop_" });
      expect(bridged.registeredNames.sort()).toEqual([
        "desktop_computer_use",
        "desktop_screen_capture",
      ]);
    } finally {
      await client.close();
    }
  }, 30_000);
});
