/** Gemini tool-call pairing for both wire shapes (steps and contents). */

import { stripProviderQualifier } from "@reasonix/core-utils";
import type { ChatMessage, ToolCall } from "./types.js";

/** Sentinel for a call with no real signature; a bare part 400s Gemini 3. */
export const SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator";

/** True for models that enforce Gemini 3 thought-signature validation. */
export function requiresThoughtSignature(model: string): boolean {
  const major = model.match(/^gemini-(\d+)/i)?.[1];
  return major !== undefined && Number.parseInt(major, 10) >= 3;
}

export interface SignatureFields {
  thoughtSignature?: string;
  thought_signature?: string;
}

export function callThoughtSignature(call: SignatureFields): string | undefined {
  const own = call.thoughtSignature ?? call.thought_signature;
  return typeof own === "string" && own.length > 0 ? own : undefined;
}

/** Accumulate consecutive system messages into one instruction block. */
export function appendSystemInstruction(
  current: string | undefined,
  text: string,
): string | undefined {
  if (text.length === 0) return current;
  return current ? `${current}\n\n${text}` : text;
}

/** Pairs model calls with their results, and carries the signature a later call
 *  may have to borrow. `noteCall` before a result can name it, in either shape. */
export class GeminiCallLedger {
  private readonly idsByName = new Map<string, string[]>();
  private readonly nameById = new Map<string, string>();
  private readonly needsSignature: boolean;
  private carried: string | undefined;

  constructor(model: string) {
    this.needsSignature = requiresThoughtSignature(stripProviderQualifier(model));
  }

  /** Borrow the first signature in the transcript for calls that lost their own. */
  rememberFromTranscript(messages: readonly ChatMessage[]): void {
    for (const msg of messages) {
      for (const call of msg.tool_calls ?? []) {
        const signature = callThoughtSignature(call);
        if (signature) {
          this.carried = signature;
          return;
        }
      }
    }
  }

  /** Record a model call so its result can name it. */
  noteCall(call: ToolCall, id: string): void {
    const name = call.function.name;
    const pending = this.idsByName.get(name) ?? [];
    pending.push(id);
    this.idsByName.set(name, pending);
    this.nameById.set(id, name);
  }

  /** Signature to replay for one call: its own, the carried one, or the sentinel. */
  signatureFor(call: SignatureFields): string | undefined {
    const signature =
      callThoughtSignature(call) ??
      this.carried ??
      (this.needsSignature ? SKIP_THOUGHT_SIGNATURE_VALIDATOR : undefined);
    if (signature) this.carried = signature;
    return signature;
  }

  /** Name and call id a tool record answers; the pending call is consumed. */
  resultFor(msg: { name?: string; tool_call_id?: string }): {
    name: string;
    id: string | undefined;
  } {
    const direct = msg.name ?? "";
    const pending = direct ? this.idsByName.get(direct) : undefined;
    if (msg.tool_call_id && pending) {
      const matched = pending.indexOf(msg.tool_call_id);
      if (matched >= 0) pending.splice(matched, 1);
    }
    const answered = msg.tool_call_id ? this.nameById.get(msg.tool_call_id) : undefined;
    const name = direct || answered || "";
    let id = msg.tool_call_id;
    if (!id && pending && pending.length > 0) id = pending.shift();
    if (pending && pending.length === 0) this.idsByName.delete(direct);
    return { name, id };
  }
}
