import { describe, expect, it } from "vitest";
import {
  classifyEndpointUrl,
  normalizeStringRecord,
  parseMcpSpec,
  specToRaw,
} from "../src/mcp/spec.js";

describe("specToRaw round-trip", () => {
  it("quotes a launcher path that contains a space", () => {
    const spec = {
      transport: "stdio" as const,
      name: "demo",
      command: "C:\\Program Files\\node.exe",
      args: ["-e", "a b", 'say "hi"'],
    };
    expect(parseMcpSpec(specToRaw(spec))).toEqual(spec);
  });

  it("keeps an anonymous stdio spec nameless", () => {
    const spec = {
      transport: "stdio" as const,
      name: null,
      command: "node",
      args: ["x.js"],
    };
    expect(parseMcpSpec(specToRaw(spec))).toEqual(spec);
  });

  it("round-trips both endpoint transports", () => {
    const stream = {
      transport: "streamable-http" as const,
      name: "remote",
      url: "https://example.test/mcp",
    };
    const sse = { transport: "sse" as const, name: null, url: "https://example.test/sse" };
    expect(parseMcpSpec(specToRaw(stream))).toEqual(stream);
    expect(parseMcpSpec(specToRaw(sse))).toEqual(sse);
  });
});

describe("classifyEndpointUrl", () => {
  it("separates streamable+ from a bare URL and rejects non-URLs", () => {
    expect(classifyEndpointUrl("streamable+https://x.test/mcp")).toEqual({
      transport: "streamable-http",
      url: "https://x.test/mcp",
    });
    expect(classifyEndpointUrl("  https://x.test/sse ")).toEqual({
      transport: "sse",
      url: "https://x.test/sse",
    });
    expect(classifyEndpointUrl("npx -y pkg")).toBeNull();
    expect(classifyEndpointUrl("")).toBeNull();
  });
});

describe("normalizeStringRecord", () => {
  it("drops empty and non-string values, and returns undefined when nothing survives", () => {
    expect(normalizeStringRecord({ A: "1", B: "", C: 2 })).toEqual({ A: "1" });
    expect(normalizeStringRecord({ B: "" })).toBeUndefined();
    expect(normalizeStringRecord(null)).toBeUndefined();
    expect(normalizeStringRecord(["a"])).toBeUndefined();
  });
});
