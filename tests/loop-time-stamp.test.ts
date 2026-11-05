/** User turns carry the wall-clock time they were sent; the stored transcript keeps the raw text.
 *  The agent has no other clock, so these stamps are the only time signal it gets. */

import { describe, expect, it } from "vitest";
import { CacheFirstLoop } from "../src/loop.js";
import { formatClockUtc, stampUserTurns } from "../src/loop/messages.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";
import type { ChatMessage } from "../src/types.js";
import { type FakeResponseShape, makeFakeClient } from "./support/fake-client.js";

const T0 = Date.UTC(2026, 10, 5, 13, 10, 4);
const STAMP = "[2026-11-05 13:10:04 UTC]";

function buildLoop(responses: FakeResponseShape[] = [{ content: "ok" }, { content: "ok" }]) {
  const fake = makeFakeClient(responses);
  const loop = new CacheFirstLoop({
    client: fake.client,
    prefix: new ImmutablePrefix({ system: "System" }),
    model: "deepseek-chat",
    stream: false,
  });
  return { loop, captured: fake.captured };
}

/** Exactly the request the loop would send right now — production's own nextRequest. */
function request(loop: CacheFirstLoop): ChatMessage[] {
  return (loop as unknown as { nextRequest(): ChatMessage[] }).nextRequest();
}

async function runTurn(loop: CacheFirstLoop, text: string): Promise<void> {
  for await (const _event of loop.step(text)) {
    // drain
  }
}

describe("formatClockUtc", () => {
  it("renders UTC to the second, independent of locale", () => {
    expect(formatClockUtc(T0)).toBe("2026-11-05 13:10:04 UTC");
    expect(formatClockUtc(T0 + 59_000)).toBe("2026-11-05 13:11:03 UTC");
  });
});

describe("stampUserTurns", () => {
  it("puts the entry's own time on its own line above a typed prompt", () => {
    const record: ChatMessage = { role: "user", content: "hello", ts: T0 };
    const [stamped] = stampUserTurns([record]);
    expect(String(stamped!.content)).toBe(`${STAMP}\nhello`);
    // Transport metadata: the record it came from keeps the user's own text.
    expect(record.content).toBe("hello");
  });

  it("keeps an attachment stitched to its prompt", () => {
    const [stamped] = stampUserTurns([
      {
        role: "user",
        ts: T0,
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }],
      },
    ]);
    const parts = stamped!.content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: STAMP });
    expect(parts[1]!.type).toBe("image_url");
  });

  it("leaves alone everything nobody typed", () => {
    const records: ChatMessage[] = [
      { role: "user", content: "steer", ts: T0, synthetic: true },
      { role: "user", content: "tool image", ts: T0, injected: true },
      { role: "user", content: "older transcript with no stamp" },
      { role: "assistant", content: "reply", ts: T0 },
      { role: "tool", content: "result", ts: T0, tool_call_id: "c1" },
    ];
    const stamped = stampUserTurns(records);
    // Identity, not just equality: an unrelated record must not be rebuilt either.
    stamped.forEach((message, i) => expect(message).toBe(records[i]));
  });

  it("leaves a corrupt stamp alone instead of throwing on it", () => {
    // A finite value outside Date's range survives session.ts's repaired-stamp check, so
    // the renderer is total: one bad record must not break the whole request build.
    const records: ChatMessage[] = [
      { role: "user", content: "nan", ts: Number.NaN },
      { role: "user", content: "out of range", ts: 9e15 },
    ];
    stampUserTurns(records).forEach((message, i) => expect(message).toBe(records[i]));
    expect(formatClockUtc(9e15)).toBe("");
  });

  it("returns the same bytes for the same input, so the cache prefix cannot churn", () => {
    const records: ChatMessage[] = [{ role: "user", content: "hello", ts: T0 }];
    expect(stampUserTurns(records)).toEqual(stampUserTurns(records));
  });
});

describe("the loop stamps the request, not the transcript", () => {
  it("sends the prompt under its stamp and stores the plain text", async () => {
    const { loop, captured } = buildLoop();
    await runTurn(loop, "hello");

    const entry = loop.log.entries.find((m) => m.role === "user")!;
    expect(entry.role).toBe("user");
    expect(entry.content).toBe("hello");
    expect(typeof entry.ts).toBe("number");

    const sent = captured[0]!.messages.at(-1)!;
    expect(String(sent.content)).toBe(`[${formatClockUtc(entry.ts!)}]\nhello`);
  });

  it("reuses the stored stamp on later requests instead of reading the clock", async () => {
    const { loop, captured } = buildLoop();
    await runTurn(loop, "first");
    await runTurn(loop, "second");

    const stampOf = (turn: number, text: string): string => {
      const sent = captured[turn]!.messages.find((m) => String(m.content).endsWith(text));
      return String(sent!.content);
    };
    const firstStamp = /^\[[^\]]+\]/.exec(stampOf(0, "first"))![0];
    // More wall-clock time has passed by the second request; the first prompt's stamp
    // must not move with it, or every request would miss the provider cache.
    expect(stampOf(1, "first").startsWith(firstStamp)).toBe(true);
    expect(stampOf(1, "second")).toMatch(/^\[/);
  });

  it("sends a record with no recorded time exactly as it was written", () => {
    const { loop } = buildLoop();
    loop.log.append({ role: "user", content: "old prompt" });
    const sent = request(loop).find((m) => String(m.content) === "old prompt");
    expect(sent?.content).toBe("old prompt");
  });
});
