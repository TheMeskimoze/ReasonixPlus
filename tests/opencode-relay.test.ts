/** The free-tier relay: when it runs, which models need it, and the hard failure
 *  when it cannot. A free model never falls back to the Node path. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freeTierTransport } from "../src/model-client.js";
import {
  bunCommand,
  freeTierModel,
  freeTierRelayError,
  opencodeRelay,
  opencodeRelayEnabled,
  stopOpencodeRelay,
} from "../src/opencode-relay.js";

const roots: string[] = [];

afterEach(() => {
  stopOpencodeRelay();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bunCommand", () => {
  const name = process.platform === "win32" ? "bun.exe" : "bun";

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), "reasonix-bun-"));
    roots.push(root);
    return root;
  }

  it("prefers the configured binary", () => {
    expect(bunCommand({ OPENCODE_RELAY_BUN: "C:\\custom\\bun.exe" })).toEqual({
      command: "C:\\custom\\bun.exe",
      source: "env",
    });
  });

  it("finds the official installer's directory without PATH", () => {
    const home = scratch();
    mkdirSync(join(home, ".bun", "bin"), { recursive: true });
    writeFileSync(join(home, ".bun", "bin", name), "");

    expect(bunCommand({ USERPROFILE: home })).toEqual({
      command: join(home, ".bun", "bin", name),
      source: "install",
    });
  });

  it("finds a scoop or winget install before falling back to PATH", () => {
    const home = scratch();
    const local = scratch();
    mkdirSync(join(local, "Programs", "bun"), { recursive: true });
    writeFileSync(join(local, "Programs", "bun", name), "");

    expect(bunCommand({ USERPROFILE: home, LOCALAPPDATA: local })).toEqual({
      command: join(local, "Programs", "bun", name),
      source: "install",
    });
  });

  it("falls back to the name on PATH when nothing is installed", () => {
    const home = scratch();
    expect(bunCommand({ USERPROFILE: home, LOCALAPPDATA: home })).toEqual({
      command: name,
      source: "path",
    });
  });
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

  it("routes an id the catalog has not seen, on its -free suffix alone", async () => {
    const declared = () =>
      Promise.resolve({ endpoint: "https://opencode.ai/zen/v1/chat/completions", headers: {} });
    const resolve = freeTierTransport({
      ...input,
      wireModel: "brand-new-model-free",
      declaredTransport: declared,
      env: { OPENCODE_RELAY_BUN: "definitely-not-a-bun-binary-4f2a", PATH: process.env.PATH },
    });
    await expect(resolve?.()).rejects.toThrow(/Bun runtime/);
  });

  it("keeps a Go-only id off the free tier even though its id ends in -free", () => {
    const declared = () =>
      Promise.resolve({ endpoint: "https://opencode.ai/zen/v1/chat/completions", headers: {} });
    const resolve = freeTierTransport({
      ...input,
      wireModel: "step-5-preview-free",
      declaredTransport: declared,
      env: { OPENCODE_RELAY_BUN: "definitely-not-a-bun-binary-4f2a", PATH: process.env.PATH },
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
