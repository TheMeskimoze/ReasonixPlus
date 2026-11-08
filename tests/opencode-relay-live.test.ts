/** Opt-in relay check: OPENCODE_RELAY_LIVE=1 plus OPENCODE_RELAY_BUN. */

import { afterAll, describe, expect, it } from "vitest";
import { opencodeRelay, stopOpencodeRelay } from "../src/opencode-relay.js";

const live = process.env.OPENCODE_RELAY_LIVE === "1";

afterAll(() => {
  stopOpencodeRelay();
});

describe.skipIf(!live)("relay (live)", () => {
  it("starts and answers its health probe", async () => {
    const relay = await opencodeRelay();
    expect(relay?.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const health = await fetch(`${relay?.origin}/healthz`);
    expect(health.status).toBe(200);
  });

  it("serves a free-tier turn when a credential is provided", async () => {
    const token = process.env.OPENCODE_RELAY_TOKEN;
    if (!token) return;
    const relay = await opencodeRelay();
    const session = `ses_${"0".repeat(12)}${"a".repeat(14)}`;
    const resp = await fetch(`${relay?.origin}/inference/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode/latest/2.2.6/cli",
        "x-opencode-client": "cli",
        "x-opencode-project": "0".repeat(40),
        "x-opencode-session": session,
        "x-opencode-session-id": session,
        "x-session-affinity": session,
      },
      body: JSON.stringify({
        model: "deepseek-v4.1-flash-free",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });
    expect([200, 429]).toContain(resp.status);
    await resp.text();
  });
});
