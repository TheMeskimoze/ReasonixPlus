import type { ChatMessage } from "../types.js";
import { lastUserTurnIndex } from "./messages.js";

export interface ReasoningPruneResult {
  messages: ChatMessage[];
  prunedCount: number;
  charsDropped: number;
}

/** The shape the drop rule reads; `ChatMessage` and the tokenizer's template
 *  records both satisfy it. */
export interface ReasoningRecord {
  role?: string;
  tool_calls?: unknown;
  reasoning_content?: string | null;
}

/** The one "this reasoning is stale" rule: an assistant record before the last user
 *  turn that carries no tool calls. Tool-call turns keep theirs, because a continuation
 *  that drops it is rejected. */
export function isStaleReasoning(
  msg: ReasoningRecord,
  index: number,
  lastUserIdx: number,
): boolean {
  return (
    msg.role === "assistant" &&
    index <= lastUserIdx &&
    !(Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) &&
    Object.hasOwn(msg, "reasoning_content")
  );
}

/** Keep tool-call reasoning for validation; drop stale plain-turn reasoning. */
export function stripDroppableReasoningContent(messages: ChatMessage[]): ReasoningPruneResult {
  const lastUser = lastUserTurnIndex(messages);
  if (lastUser < 0) {
    return { messages, prunedCount: 0, charsDropped: 0 };
  }

  let next: ChatMessage[] | null = null;
  let prunedCount = 0;
  let charsDropped = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (!isStaleReasoning(msg, i, lastUser)) continue;
    if (next === null) next = messages.slice();
    const { reasoning_content: dropped, ...replacement } = msg;
    if (typeof dropped === "string") charsDropped += dropped.length;
    next[i] = replacement;
    prunedCount += 1;
  }

  return {
    messages: next ?? messages,
    prunedCount,
    charsDropped,
  };
}
