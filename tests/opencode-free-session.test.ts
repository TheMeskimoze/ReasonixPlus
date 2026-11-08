import { describe, expect, it } from "vitest";
import { freeTierSessionHeaders } from "../src/model-client.js";
import {
  isOpencodeSessionId,
  mintOpencodeSessionId,
  opencodeSessionId,
} from "../src/opencode-free-session.js";

const SHAPE = /^ses_[0-9a-f]{12}[0-9a-zA-Z]{14}$/;

describe("opencode free-tier session ids", () => {
  it("mints the shape the gateway accounts for", () => {
    expect(mintOpencodeSessionId(1794159660353)).toMatch(SHAPE);
    expect(mintOpencodeSessionId()).toMatch(SHAPE);
  });

  it("descends with time, so a later mint sorts first", () => {
    const early = mintOpencodeSessionId(1794159660353).slice(4, 16);
    const late = mintOpencodeSessionId(1794159666533).slice(4, 16);
    expect(BigInt(`0x${late}`) < BigInt(`0x${early}`)).toBe(true);
  });

  it("accepts an id its own client would mint and rejects anything else", () => {
    expect(isOpencodeSessionId("ses_e43c032c3ffedzLrPTeSQzE4dB")).toBe(true);
    expect(isOpencodeSessionId(mintOpencodeSessionId())).toBe(true);
    expect(isOpencodeSessionId("ses_0123456789abcdef0123456789ab")).toBe(false);
    expect(isOpencodeSessionId("3f2a6c1e-0000-4000-8000-000000000000")).toBe(false);
    expect(isOpencodeSessionId("")).toBe(false);
    expect(isOpencodeSessionId(undefined)).toBe(false);
  });

  it("keeps a valid id and replaces a chat id the gateway would refuse", () => {
    const valid = "ses_e43c032c3ffedzLrPTeSQzE4dB";
    expect(opencodeSessionId(valid)).toBe(valid);
    const replaced = opencodeSessionId("3f2a6c1e-0000-4000-8000-000000000000");
    expect(replaced).not.toContain("3f2a6c1e");
    expect(replaced).toMatch(SHAPE);
    expect(opencodeSessionId(undefined)).toMatch(SHAPE);
  });

  it("carries the id on every name the gateway reads", () => {
    const headers = freeTierSessionHeaders("3f2a6c1e-0000-4000-8000-000000000000");
    const session = headers["x-opencode-session"];
    expect(session).toMatch(SHAPE);
    expect(headers["x-opencode-session-id"]).toBe(session);
    expect(headers["x-session-affinity"]).toBe(session);
    expect(headers["x-session-id"]).toBe(session);
    expect(headers["x-opencode-client"]).toBe("cli");
  });
});
