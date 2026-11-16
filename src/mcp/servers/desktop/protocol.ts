/** Minimal MCP server for the desktop tools: initialize, ping, tools/list, tools/call.
 *  Pure request -> response so the stdio entry stays a framing loop. */

import { VERSION } from "../../../version.js";
import {
  JSONRPC_VERSION,
  type JsonRpcId,
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
} from "../../types.js";
import { DESKTOP_MCP_TOOLS, type DesktopToolOptions, callDesktopTool } from "./tools.js";

export const SERVER_INFO_NAME = "reasonix-desktop";

function ok(id: JsonRpcId | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id: id ?? 0, result };
}

function fail(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

interface Frame {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** One incoming JSON-RPC frame to one response (null for notifications). */
export async function handleDesktopFrame(
  frame: unknown,
  opts: DesktopToolOptions,
): Promise<JsonRpcResponse | null> {
  if (!frame || typeof frame !== "object") return fail(null, -32600, "invalid request");
  const msg = frame as Frame;
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== JSONRPC_VERSION || typeof msg.method !== "string") {
    return isNotification ? null : fail(id, -32600, "invalid request");
  }
  const method = msg.method;

  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: SERVER_INFO_NAME, version: VERSION },
      capabilities: { tools: { listChanged: false } },
    });
  }

  if (method === "ping") return ok(id, {});

  if (method === "tools/list") return ok(id, { tools: DESKTOP_MCP_TOOLS });

  if (method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof params.name !== "string") return fail(id, -32602, "tools/call requires a tool name");
    const rawArgs = params.arguments;
    if (
      rawArgs !== undefined &&
      (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))
    ) {
      return fail(id, -32602, "tools/call arguments must be an object");
    }
    const result = await callDesktopTool(
      params.name,
      (rawArgs ?? {}) as Record<string, unknown>,
      opts,
    );
    return ok(id, result);
  }

  return isNotification ? null : fail(id, -32601, `method not found: ${method}`);
}
