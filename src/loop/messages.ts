import type { ChatMessage, ToolCall } from "../types.js";
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

/** Plain text of a message. `textOnly` drops non-text parts (client systemInstruction /
 *  tool responses); the default substitutes a `[<type> attached]` placeholder for them
 *  (token accounting and compaction summaries count the attachment). */
export function messageText(m: ChatMessage, textOnly = false): string {
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  return textOnly
    ? m.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("\n")
    : m.content
        .map((part) => (part.type === "text" ? part.text : `[${part.type} attached]`))
        .join("\n");
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
