/** The clock preamble the loop puts on the wire, `[2026-11-05 13:10:04 UTC]`, is transport
 *  metadata. Tests assert the user's own text through here rather than restating it. */

import type { ChatMessage } from "../../src/types.js";

/** The exact shape the loop writes: UTC, seconds, nothing else inside the brackets. */
export const CLOCK_STAMP = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\]$/;

/** One decision site for "where is the stamp": a leading line for text content, a leading
 *  text part for attachments, and the value itself when there is no stamp. */
function splitStamp(content: ChatMessage["content"]): {
  stamped: boolean;
  rest: ChatMessage["content"];
} {
  if (typeof content === "string") {
    const [head, ...tail] = content.split("\n");
    return head !== undefined && CLOCK_STAMP.test(head)
      ? { stamped: true, rest: tail.join("\n") }
      : { stamped: false, rest: content };
  }
  const first = Array.isArray(content) ? content[0] : undefined;
  return first !== undefined && first.type === "text" && CLOCK_STAMP.test(first.text)
    ? { stamped: true, rest: content.slice(1) }
    : { stamped: false, rest: content };
}

/** True when the content opens with a clock stamp. */
export function hasClockStamp(content: ChatMessage["content"]): boolean {
  return splitStamp(content).stamped;
}

/** The same content with that stamp removed, or untouched when there is none. */
export function withoutClockStamp(content: ChatMessage["content"]): ChatMessage["content"] {
  return splitStamp(content).rest;
}
