import { describe, expect, it } from "vitest";
import { mcpServerName, splitMcpToolName } from "../src/tool-name.js";

describe("mcpServerName", () => {
  it("strips exactly the one separator the bridge appended", () => {
    expect(mcpServerName("github_")).toBe("github");
    expect(mcpServerName("my_server_")).toBe("my_server");
    expect(mcpServerName("trailing___")).toBe("trailing__");
  });

  it("falls back when the prefix is empty or only the separator", () => {
    expect(mcpServerName("")).toBe("anon");
    expect(mcpServerName("_")).toBe("anon");
    expect(mcpServerName("", "MCP")).toBe("MCP");
  });
});

describe("splitMcpToolName", () => {
  it("returns the bare name behind the prefix", () => {
    expect(splitMcpToolName("github_create_issue", "github_")).toBe("create_issue");
  });

  it("returns null when the prefix does not match or is empty", () => {
    expect(splitMcpToolName("other_tool", "github_")).toBeNull();
    expect(splitMcpToolName("github_tool", "")).toBeNull();
  });
});
