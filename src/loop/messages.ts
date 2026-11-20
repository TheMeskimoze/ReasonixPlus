import type { ChatMessage, ToolCall, UserContentPart } from "../types.js";
import { isThinkingModeModel } from "./thinking.js";

/** Thinking-mode producer ⇒ reasoning_content MUST be set (even ""), or next call 400s. */
export function buildAssistantMessage(
  content: string,
  toolCalls: ToolCall[],
  producingModel: string,
  reasoningContent?: string | null,
  image?: { dataUrl: string; mimeType: string },
): ChatMessage {
  const msgContent: ChatMessage["content"] = image
    ? [
        ...(content ? [{ type: "text" as const, text: content }] : []),
        { type: "image" as const, data_url: image.dataUrl, mime_type: image.mimeType },
      ]
    : content;
  const msg: ChatMessage = { role: "assistant", content: msgContent, model: producingModel };
  if (toolCalls.length > 0) msg.tool_calls = toolCalls;
  // V4-era deepseek-chat returns reasoning_content even with thinking.type
  // disabled, and the API rejects round-trips that drop it. Whitelist on
  // model name is too brittle — preserve whenever the producer emitted any.
  if (isThinkingModeModel(producingModel) || (reasoningContent && reasoningContent.length > 0)) {
    msg.reasoning_content = reasoningContent ?? "";
  }
  return msg;
}

/** Abort notices etc — caller passes its current model as the thinking-mode stamp. */
export function buildSyntheticAssistantMessage(
  content: string,
  fallbackModel: string,
): ChatMessage {
  return buildAssistantMessage(content, [], fallbackModel, "");
}

/** The shape the turn rules read. `ChatMessage` and the tokenizer's template
 *  records both satisfy it, so one rule serves both without a cast. */
export interface TurnRecord {
  role?: string;
  synthetic?: boolean;
  content?: string | UserContentPart[] | null;
}

export interface UserTurnOptions {
  /** Count a steer or nudge, which the loop marks `synthetic`. */
  includeSynthetic?: boolean;
  /** Count a `developer` instruction as a turn boundary. */
  includeDeveloper?: boolean;
  /** Require non-blank text, so a record with no prompt is not a turn. */
  requireText?: boolean;
}

/** One definition of a user turn: the rule behind turn numbering, retry targets,
 *  the reasoning boundary and the fold's prompt survival. */
export function isUserTurn(m: TurnRecord, opts: UserTurnOptions = {}): boolean {
  if (m.role === "developer") return opts.includeDeveloper === true;
  if (m.role !== "user") return false;
  if (!opts.includeSynthetic && m.synthetic) return false;
  if (opts.requireText && turnText(m).trim().length === 0) return false;
  return true;
}

/** Index of the newest record {@link isUserTurn} accepts, or -1 when there is none. */
export function lastUserTurnIndex(
  messages: readonly TurnRecord[],
  opts: UserTurnOptions = {},
): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isUserTurn(messages[i]!, opts)) return i;
  }
  return -1;
}

function turnText(m: TurnRecord): string {
  return joinedContent(m.content, false);
}

function joinedContent(content: TurnRecord["content"], textOnly: boolean): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = textOnly ? content.filter((part) => part.type === "text") : content;
  return parts
    .map((part) => (part.type === "text" ? part.text : `[${part.type} attached]`))
    .join("\n");
}

/** Plain text of a message. `textOnly` drops non-text parts (client systemInstruction /
 *  tool responses); the default substitutes a `[<type> attached]` placeholder for them
 *  (token accounting and compaction summaries count the attachment). */
export function messageText(m: ChatMessage, textOnly = false): string {
  return joinedContent(m.content, textOnly);
}

/** `2026-11-05 13:10:04 UTC`: UTC and second precision, so no locale data is involved and
 *  two prompts inside one minute still order. "" for an unusable instant, so a corrupt
 *  stamp can never throw inside a request build. */
export function formatClockUtc(ts: number): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return "";
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** Stamp the outgoing copy with when each real prompt was written, so the model can read
 *  elapsed time off consecutive turns. `ts` is the only clock: a send-time stamp would
 *  churn the cache and invent gaps. Records nobody typed and stamp-less ones pass through. */
export function stampUserTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || message.synthetic === true || message.injected === true) {
      return message;
    }
    const { ts } = message;
    if (typeof ts !== "number") return message;
    const clock = formatClockUtc(ts);
    if (!clock) return message;
    const header = `[${clock}]`;
    if (typeof message.content === "string") {
      return { ...message, content: `${header}\n${message.content}` };
    }
    if (Array.isArray(message.content)) {
      return { ...message, content: [{ type: "text" as const, text: header }, ...message.content] };
    }
    return message;
  });
}
