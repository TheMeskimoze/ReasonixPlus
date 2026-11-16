/** The desktop server's two model-facing tools: one atomic pointer/window action and
 *  one monitor-bounded capture. Both execute inside the server process. */

import { readFileSync, statSync } from "node:fs";
import { MAX_IMAGE_BYTES, formatBytes, messageOf } from "@reasonix/core-utils";
import { type ComputerUseOptions, runComputerUse } from "../../../tools/computer-use.js";
import {
  type ScreenCaptureToolOptions,
  captureScreen,
  describeCapture,
} from "../../../tools/screen-capture.js";
import { COMPUTER_USE_TOOL, SCREEN_CAPTURE_TOOL } from "../../desktop-control.js";
import type { CallToolResult, McpContentBlock, McpTool } from "../../types.js";

const COMPUTER_USE_DESCRIPTION =
  "Perform one atomic computer-use action on an explicitly selected monitor. For click, the host positions the pointer and presses/releases the button in the same native operation, so do not call a separate mouse-move tool first. Coordinates are relative to the selected monitor and must be inside it. For focus, bring the named window to the foreground and maximize it on the selected monitor.";

const COMPUTER_USE_PARAMETERS = {
  type: "object",
  required: ["action", "monitor"],
  properties: {
    action: { type: "string", enum: ["click", "focus"] },
    monitor: { type: "integer", description: "Required monitor index." },
    x: { type: "integer", description: "Click X relative to the monitor." },
    y: { type: "integer", description: "Click Y relative to the monitor." },
    app: { type: "string", description: "Window title or process name for focus." },
  },
};

const SCREEN_CAPTURE_DESCRIPTION =
  "Capture one monitor, with optional top-left and bottom-right crop coordinates relative to that monitor, never the virtual desktop. When an app/window is given it is focused first and the capture follows that window's own display, so no monitor index has to be guessed; pass `monitor` only to target a display explicitly when no app is given. Returns the captured PNG as an image block plus its on-disk path.";

const SCREEN_CAPTURE_PARAMETERS = {
  type: "object",
  properties: {
    app: {
      type: "string",
      description:
        "Optional: Application name, process name, or window title substring to bring to the foreground before capturing the screenshot.",
    },
    monitor: {
      type: "integer",
      description:
        "Optional: monitor index (0 for primary/first monitor, 1 for second, etc.), used only when no app is given. When an app/window is focused the capture follows that window's own display. Coordinates are relative to the selected monitor.",
    },
    top_left_x: {
      type: "number",
      description:
        "Optional: Top-left corner X coordinate in pixels relative to the monitor's top-left corner.",
    },
    top_left_y: {
      type: "number",
      description:
        "Optional: Top-left corner Y coordinate in pixels relative to the monitor's top-left corner.",
    },
    bottom_right_x: {
      type: "number",
      description:
        "Optional: Bottom-right corner X coordinate in pixels relative to the monitor's top-left corner.",
    },
    bottom_right_y: {
      type: "number",
      description:
        "Optional: Bottom-right corner Y coordinate in pixels relative to the monitor's top-left corner.",
    },
    path: {
      type: "string",
      description:
        "Optional PNG destination path. Relative paths resolve under the workspace; absolute paths are accepted. If omitted, saves to .reasonix/screenshots/.",
    },
  },
};

export const DESKTOP_MCP_TOOLS: McpTool[] = [
  {
    name: COMPUTER_USE_TOOL,
    description: COMPUTER_USE_DESCRIPTION,
    inputSchema: COMPUTER_USE_PARAMETERS,
  },
  {
    name: SCREEN_CAPTURE_TOOL,
    description: SCREEN_CAPTURE_DESCRIPTION,
    inputSchema: SCREEN_CAPTURE_PARAMETERS,
  },
];

export interface DesktopToolOptions {
  /** Workspace root: relative capture paths and the default screenshot folder resolve here. */
  rootDir: string;
  /** Test seams, forwarded to the implementations. */
  screen?: ScreenCaptureToolOptions;
  computer?: ComputerUseOptions;
  /** Read the PNG back as a base64 image block. Default true. */
  includeImage?: boolean;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The PNG as a base64 block, or the reason it was left out. */
function pngBlock(path: string): McpContentBlock | string {
  const bytes = statSync(path).size;
  if (bytes > MAX_IMAGE_BYTES) {
    return `The PNG is ${formatBytes(bytes)}, over the ${formatBytes(MAX_IMAGE_BYTES)} image cap, so its pixels were not attached. Call see_image with the path to load it.`;
  }
  return { type: "image", data: readFileSync(path).toString("base64"), mimeType: "image/png" };
}

export async function callDesktopTool(
  name: string,
  args: Record<string, unknown>,
  opts: DesktopToolOptions,
): Promise<CallToolResult> {
  if (name === COMPUTER_USE_TOOL) {
    try {
      return textResult(await runComputerUse(args, opts.computer));
    } catch (err) {
      return errorResult(messageOf(err));
    }
  }

  if (name === SCREEN_CAPTURE_TOOL) {
    let outcome: Awaited<ReturnType<typeof captureScreen>>;
    try {
      outcome = await captureScreen(args, { ...opts.screen, rootDir: opts.rootDir });
    } catch (err) {
      return errorResult(messageOf(err));
    }
    const header = `${describeCapture(outcome)}. Saved to ${outcome.path}.`;
    if (opts.includeImage === false) {
      return textResult(`${header} Call see_image with that path to load the pixels.`);
    }
    try {
      const block = pngBlock(outcome.path);
      if (typeof block === "string") return textResult(`${header} ${block}`);
      return { content: [{ type: "text", text: `${header} Pixels attached below.` }, block] };
    } catch (err) {
      return textResult(
        `${header} The pixels could not be read (${messageOf(err)}); call see_image with the path to load them.`,
      );
    }
  }

  return errorResult(`unknown tool: ${name}`);
}
