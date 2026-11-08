/** Free-tier turns carry the client's own agent prompt ahead of the harness one. */

import { envFlag } from "./env-flag.js";
import { type FreePromptFields, renderOpencodeFreePrompt } from "./opencode-free-prompt.js";
import type { ChatMessage } from "./types.js";

/** `OPENCODE_FREE_PREAMBLE=off` drops the prefix. It is on by default because the
 *  gateway refuses a free-tier request whose system message does not carry the
 *  client's prompt; turning it off leaves those models refused. */
export function freePreambleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env, "OPENCODE_FREE_PREAMBLE", true);
}

/** Catalog display names for the free ids the picker ships, so the "# Your Model"
 *  block reads the way the client writes it. An id without an entry falls back to
 *  a title-cased form of the id. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "deepseek-v4.1-flash-free": "DeepSeek V4.1 Flash Free",
  "deepseek-v4-flash-free": "DeepSeek V4 Flash Free",
  "glm-5-free": "GLM-5 Free",
  "glm-4.7-free": "GLM-4.7 Free",
  "kimi-k2.5-free": "Kimi K2.5 Free",
  "minimax-m2.5-free": "MiniMax M2.5 Free",
  "minimax-m3-free": "MiniMax M3 Free",
  "mimo-v2.5-free": "MiMo V2.5 Free",
  "qwen3.6-plus-free": "Qwen3.6 Plus Free",
  "big-pickle": "Big Pickle",
};

function titleCase(id: string): string {
  return id
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

export function freePromptFields(modelId: string): FreePromptFields {
  return {
    name: DISPLAY_NAMES[modelId] ?? titleCase(modelId),
    providerId: "opencode",
    modelId,
  };
}

/** The client prompt, then the harness system message, so the model reads one
 *  instruction block and ours comes last. */
export function withFreePreamble(
  messages: readonly ChatMessage[],
  fields: FreePromptFields,
): ChatMessage[] {
  const preamble = renderOpencodeFreePrompt(fields);
  const [first, ...rest] = messages;
  if (first?.role === "system" && typeof first.content === "string") {
    return [{ ...first, content: `${preamble}\n\n${first.content}` }, ...rest];
  }
  return [{ role: "system", content: preamble }, ...messages];
}
