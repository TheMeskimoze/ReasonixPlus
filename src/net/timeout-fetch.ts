/** fetch() with an abort-timer — shared by the version checker and the MCP registry fetcher. */

import { deadlineSignal } from "../core/with-deadline.js";

/** Run `fetcher` under an abort timeout. The timer is always cleared, even on throw. */
export async function fetchWithTimeout(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const deadline = deadlineSignal(
    timeoutMs,
    `request timed out after ${timeoutMs}ms`,
    init?.signal ?? undefined,
  );
  try {
    return await fetcher(url, { ...init, signal: deadline.signal });
  } finally {
    // Only the wait for headers is timed; aborting here would kill the body read.
    deadline.clearTimer();
  }
}

/** GET `url` as JSON under an abort timeout, announcing `accept: application/json`.
 *  Throws on a non-2xx response (`HTTP <status>: <statusText>`) or an invalid body. */
export async function fetchJson(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetchWithTimeout(url, fetcher, timeoutMs, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
