/** Bundled desktop-control MCP server. The daemon spawns it as
 *  `node dist/cli/desktop-mcp.js` with the workspace as cwd; framing is NDJSON. */

import { createInterface } from "node:readline";
import { messageOf } from "@reasonix/core-utils";
import { handleDesktopFrame } from "./desktop/protocol.js";

const opts = { rootDir: process.cwd() };

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let frame: unknown;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  void handleDesktopFrame(frame, opts)
    .then((response) => {
      if (response) send(response);
    })
    .catch((err) => {
      const rawId = frame && typeof frame === "object" ? (frame as { id?: unknown }).id : undefined;
      const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: `internal error: ${messageOf(err)}` },
      });
    });
});

input.on("close", () => process.exit(0));
