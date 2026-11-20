import { describe, expect, it } from "vitest";
import { mcpTextContent } from "../src/mcp/result-text.js";
import type { CallToolResult } from "../src/mcp/types.js";

function result(content: CallToolResult["content"]): CallToolResult {
  return { content };
}

describe("mcpTextContent", () => {
  it("joins text blocks with a newline and trims the result", () => {
    expect(
      mcpTextContent(
        result([
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ]),
      ),
    ).toBe("first\nsecond");
    expect(mcpTextContent(result([{ type: "text", text: "  padded  " }]))).toBe("padded");
  });

  it("skips image blocks", () => {
    expect(
      mcpTextContent(
        result([
          { type: "text", text: "caption" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ]),
      ),
    ).toBe("caption");
  });

  it("returns an empty string when there is no text", () => {
    expect(mcpTextContent(result([]))).toBe("");
    expect(mcpTextContent(result([{ type: "image", data: "abc", mimeType: "image/png" }]))).toBe(
      "",
    );
  });
});
