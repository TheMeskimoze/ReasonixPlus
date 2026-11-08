/** A free-tier failure has to name its own routing: whether the relay was
 *  enabled, which runtime it would spawn, and where the request went. */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import {
  _resetDiagnosticsForTests,
  closeDiagnostics,
  configureDiagnostics,
  diagnosticsFilePath,
} from "../src/diagnostics.js";
import { recordFreeTierFailure } from "../src/opencode-free-triage.js";

const roots: string[] = [];

function capture(run: () => void): Record<string, unknown>[] {
  const root = mkdtempSync(join(tmpdir(), "reasonix-triage-"));
  roots.push(root);
  configureDiagnostics({ directory: root, source: "test" });
  run();
  const path = diagnosticsFilePath();
  closeDiagnostics();
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const freeLimitBody = JSON.stringify({
  type: "error",
  error: {
    type: "FreeUsageLimitError",
    message: "Free usage limit reached. Free models work in OpenCode.",
  },
});

afterEach(() => {
  _resetDiagnosticsForTests();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function triageOf(records: Record<string, unknown>[]): Record<string, unknown> {
  const record = records.find((line) => line.event === "opencode.free_tier.failure");
  expect(record, "a free-tier failure must be recorded").toBeTruthy();
  return (record as { details: Record<string, unknown> }).details;
}

describe("free-tier failure triage", () => {
  it("records the runtime it needed and the transport that carried the request", () => {
    const details = triageOf(
      capture(() =>
        recordFreeTierFailure({
          model: "opencode/deepseek-v4-flash-free",
          provider: "opencode",
          wireModel: "deepseek-v4-flash-free",
          status: 429,
          endpoint: "http://127.0.0.1:41000/inference/openai/v1/chat/completions",
          viaTransport: "http://127.0.0.1:41000/inference/openai/v1/chat/completions",
          body: freeLimitBody,
          preambleApplied: true,
          env: {},
        }),
      ),
    );

    expect(details).toMatchObject({
      provider: "opencode",
      wireModel: "deepseek-v4-flash-free",
      freeTier: true,
      relayEnabled: true,
      preambleEnabled: true,
      preambleApplied: true,
      status: 429,
      viaTransport: "http://127.0.0.1:41000/inference/openai/v1/chat/completions",
      gatewayError: {
        type: "FreeUsageLimitError",
        message: "Free usage limit reached. Free models work in OpenCode.",
      },
    });
    expect(details.relayRuntime).toEqual({
      command: process.platform === "win32" ? "bun.exe" : "bun",
      source: "path",
    });
  });

  it("names a configured runtime and a switched-off relay", () => {
    const details = triageOf(
      capture(() =>
        recordFreeTierFailure({
          model: "opencode/deepseek-v4.1-flash-free",
          provider: "opencode",
          wireModel: "deepseek-v4.1-flash-free",
          status: 429,
          endpoint: "https://opencode.ai/zen/v1/chat/completions",
          viaTransport: null,
          body: freeLimitBody,
          preambleApplied: false,
          env: { OPENCODE_RELAY_BUN: "C:\\bun\\bun.exe", OPENCODE_FREE_RELAY: "off" },
        }),
      ),
    );

    expect(details.relayRuntime).toEqual({ command: "C:\\bun\\bun.exe", source: "env" });
    expect(details.relayEnabled).toBe(false);
    expect(details.viaTransport).toBeNull();
  });

  it("keeps a non-JSON body out of the record instead of guessing", () => {
    const details = triageOf(
      capture(() =>
        recordFreeTierFailure({
          model: "opencode/deepseek-v4-flash-free",
          provider: "opencode",
          wireModel: "deepseek-v4-flash-free",
          status: 502,
          endpoint: "http://127.0.0.1:41000/inference/openai/v1/chat/completions",
          viaTransport: "http://127.0.0.1:41000/inference/openai/v1/chat/completions",
          body: "<html>bad gateway</html>",
          preambleApplied: true,
          env: {},
        }),
      ),
    );

    expect(details.gatewayError).toBeNull();
    expect(details.status).toBe(502);
  });

  it("fires from a real free-tier turn that the gateway refuses", async () => {
    const root = mkdtempSync(join(tmpdir(), "reasonix-triage-"));
    roots.push(root);
    configureDiagnostics({ directory: root, source: "test" });
    const fetchStub = (async () =>
      new Response(freeLimitBody, {
        status: 429,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const client = new DeepSeekClient({
      apiKey: "public",
      baseUrl: "https://opencode.ai/zen/v1",
      allowMissingKey: true,
      fetch: fetchStub,
    });
    await client
      .chat({ model: "deepseek-v4-flash-free", messages: [{ role: "user", content: "hi" }] })
      .catch(() => undefined);
    const path = diagnosticsFilePath();
    closeDiagnostics();
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const details = triageOf(lines);
    expect(details).toMatchObject({
      wireModel: "deepseek-v4-flash-free",
      freeTier: true,
      status: 429,
    });
  });
});
