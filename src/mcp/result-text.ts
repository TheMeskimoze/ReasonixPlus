/** The text of an MCP result, for callers that never relay images. */

import type { CallToolResult, McpContentBlock } from "./types.js";

/** Join a result's text blocks; non-text blocks are skipped. Trimmed, since a
 *  trailing newline from the server is never meaningful to the reader. */
export function mcpTextContent(result: CallToolResult): string {
  return result.content
    .filter((block): block is Extract<McpContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
