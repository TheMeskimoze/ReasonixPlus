import { describe, expect, it } from "vitest";
import { fetchWithTimeout } from "../src/net/timeout-fetch.js";

function capturingFetcher(): { fetcher: typeof fetch; signal: () => AbortSignal | undefined } {
  let seen: AbortSignal | undefined;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, signal: () => seen };
}

describe("fetchWithTimeout", () => {
  it("does not abort the signal after the headers arrive", async () => {
    const { fetcher, signal } = capturingFetcher();
    const res = await fetchWithTimeout("https://x.test", fetcher, 50);
    expect(signal()?.aborted).toBe(false);
    expect(await res.text()).toBe("body");
  });

  it("still honors the caller's abort signal", async () => {
    const parent = new AbortController();
    const { fetcher, signal } = capturingFetcher();
    await fetchWithTimeout("https://x.test", fetcher, 50, { signal: parent.signal });
    parent.abort();
    expect(signal()?.aborted).toBe(true);
  });
});
