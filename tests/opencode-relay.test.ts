/** The free-tier relay: when it runs, which models need it, and the hard failure
 *  when it cannot. A free model never falls back to the Node path. */

import { afterEach, describe, expect, it } from "vitest";
import { freeTierTransport } from "../src/model-client.js";
import {
  freeTierModel,
  freeTierRelayError,
  opencodeRelay,
  opencodeRelayEnabled,
  stopOpencodeRelay,
} from "../src/opencode-relay.js";

afterEach(() => {
  stopOpencodeRelay();
});

describe("opencodeRelayEnabled", () => {
  it("runs by default", () => {
    expect(opencodeRelayEnabled({})).toBe(true);
  });

  it("accepts the off spellings", () => {
    for (const value of ["0", "off", "OFF", "false", "no"]) {
      expect(opencodeRelayEnabled({ OPENCODE_FREE_RELAY: value })).toBe(false);
    }
  });

  it("stays on for unrecognized values", () => {
    expect(opencodeRelayEnabled({ OPENCODE_FREE_RELAY: "yes" })).toBe(true);
  });
});

describe("freeTierModel", () => {
  const base = { provider: "opencode", freeModel: true };

  it("takes a free chat model", () => {
    expect(freeTierModel({ ...base, wireModel: "deepseek-v4.1-flash-free" })).toBe(true);
  });

  it("leaves muse ids on their Responses transport", () => {
    expect(freeTierModel({ ...base, wireModel: "muse-spark-1.3-contributor-free" })).toBe(false);
  });

  it("leaves paid and Go models alone", () => {
    expect(freeTierModel({ ...base, freeModel: false, wireModel: "gpt-6-luna" })).toBe(false);
  });

  it("never takes another provider's request", () => {
    expect(freeTierModel({ ...base, provider: "deepseek", wireModel: "x-free" })).toBe(false);
  });
});

describe("freeTierTransport", () => {
  const input = {
    provider: "opencode" as const,
    wireModel: "glm-5-free",
    declaredTransport: () => Promise.resolve(null),
  };

  it("fails with the Bun requirement when no runtime is installed", async () => {
    const resolve = freeTierTransport({
      ...input,
      env: { OPENCODE_RELAY_BUN: "definitely-not-a-bun-binary-4f2a", PATH: process.env.PATH },
    });
    await expect(resolve?.()).rejects.toThrow(/Bun runtime/);
  });

  it("fails when the free tier is switched off", async () => {
    const resolve = freeTierTransport({ ...input, env: { OPENCODE_FREE_RELAY: "off" } });
    await expect(resolve?.()).rejects.toThrow(/switched off/);
  });

  it("never leaves a free model to the declared transport", async () => {
    const declared = () =>
      Promise.resolve({ endpoint: "https://opencode.ai/zen/v1/chat/completions", headers: {} });
    const resolve = freeTierTransport({
      ...input,
      declaredTransport: declared,
      env: { OPENCODE_RELAY_BUN: "definitely-not-a-bun-binary-4f2a", PATH: process.env.PATH },
    });
    await expect(resolve?.()).rejects.toThrow(/Bun runtime/);
  });

  it("returns the declared transport for a model that does not need the relay", () => {
    const declared = () => Promise.resolve(null);
    const resolve = freeTierTransport({
      ...input,
      wireModel: "gpt-6-luna",
      declaredTransport: declared,
    });
    expect(resolve).toBe(declared);
  });
});

describe("opencodeRelay", () => {
  it("reports no relay when the Bun command does not exist", async () => {
    const relay = await opencodeRelay({
      OPENCODE_RELAY_BUN: "definitely-not-a-bun-binary-4f2a",
      PATH: process.env.PATH,
    } as NodeJS.ProcessEnv);
    expect(relay).toBeNull();
  });

  it("stops without a running relay", () => {
    expect(() => stopOpencodeRelay()).not.toThrow();
  });
});

describe("freeTierRelayError", () => {
  it("names the runtime and the override for a missing relay", () => {
    expect(freeTierRelayError("missing").message).toMatch(/Bun runtime/);
    expect(freeTierRelayError("missing").message).toMatch(/OPENCODE_RELAY_BUN/);
  });

  it("names the switch when the feature is off", () => {
    expect(freeTierRelayError("disabled").message).toMatch(/OPENCODE_FREE_RELAY/);
  });
});
