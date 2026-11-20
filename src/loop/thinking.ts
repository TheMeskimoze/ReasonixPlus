import { stripProviderQualifier } from "@reasonix/core-utils";

/** DeepSeek's thinking line: official API, an OpenCode resale, or an Ollama-hosted
 *  tag. Keyed on the flash/pro line, not an enumerated version list, so a version
 *  bump cannot silently drop the reasoning round-trip the API demands back. */
function isDeepSeekThinkingFamily(model: string): boolean {
  if (!model.startsWith("deepseek-")) return false;
  if (model === "deepseek-chat" || model.includes("coder")) return false;
  return model.includes("flash") || model.includes("pro");
}

/** The one capability table: `mode` is the value that goes on the wire (`undefined`
 *  omits the field), `requiresRoundTrip` is why a follow-up must carry the field back. */
export interface ThinkingCapability {
  mode: "enabled" | "disabled" | undefined;
  requiresRoundTrip: boolean;
}

const THINKING: ThinkingCapability = { mode: "enabled", requiresRoundTrip: true };
const NO_THINKING: ThinkingCapability = { mode: undefined, requiresRoundTrip: false };
const THINKING_DISABLED: ThinkingCapability = { mode: "disabled", requiresRoundTrip: false };

export function thinkingCapabilityForModel(model: string): ThinkingCapability {
  // Capability checks match the wire id: `opencode/<id>` and the same id bare
  // are one model on different endpoints.
  const id = stripProviderQualifier(model);
  if (id.startsWith("gpt-")) return NO_THINKING;
  if (id === "deepseek-chat") return THINKING_DISABLED;
  if (
    id.startsWith("gemini-") ||
    id.startsWith("glm-") ||
    id.includes("reasoner") ||
    isDeepSeekThinkingFamily(id) ||
    // Ollama DeepSeek R1 models (e.g. ollama/deepseek-r1:14b, deepseek-r1:7b)
    id.includes("deepseek-r1") ||
    // Xiaomi MiMo emits reasoning_content and 400s if a tool-call turn drops it.
    id.startsWith("mimo-")
  ) {
    return THINKING;
  }
  return NO_THINKING;
}

/** True when the model emits reasoning_content and requires it round-tripped on follow-ups. */
export function isThinkingModeModel(model: string): boolean {
  return thinkingCapabilityForModel(model).mode === "enabled";
}

/** Pins extra_body.thinking.type; `undefined` lets third-party endpoints skip the field. */
export function thinkingModeForModel(model: string): "enabled" | "disabled" | undefined {
  return thinkingCapabilityForModel(model).mode;
}

/** Strip hallucinated tool-call envelopes — `tools: undefined` doesn't always force prose. */
export function stripHallucinatedToolMarkup(s: string): string {
  let out = s;
  // DeepSeek's DSML envelope (full-width "｜" is the form R1 emits in practice).
  out = out.replace(
    /<[｜|]DSML[｜|]function_calls>[\s\S]*?<\/?(?:[｜|]DSML[｜|]function_calls)?>/g,
    "",
  );
  out = out.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "");
  // Loose DSML invoke blocks without wrapping function_calls.
  out = out.replace(/<[｜|]DSML[｜|]invoke\s+[^>]*>[\s\S]*?<\/[｜|]DSML[｜|]invoke>/g, "");
  // Lone unpaired DSML opener left over after R1 truncates mid-call.
  out = out.replace(/<[｜|]DSML[｜|][\s\S]*$/g, "");
  return out.trim();
}

/** Extract literal thinking tags (`<think>...</think>`) from content if the model
 *  emitted reasoning directly into the content stream instead of the thinking channel.
 *  Returns the cleaned content and any extracted reasoning text. */
export function extractThinkingTags(content: string): {
  content: string;
  extractedReasoning: string | null;
} {
  const THINK_BLOCK_RE = /<think>([\s\S]*?)<\/think>/gi;
  const thoughts: string[] = [];
  let cleaned = content.replace(THINK_BLOCK_RE, (_, thought: string) => {
    const trimmed = thought.trim();
    if (trimmed) thoughts.push(trimmed);
    return "";
  });

  // Handle open-ended/truncated <think> at the end of content
  const UNCLOSED_THINK_RE = /<think>([\s\S]*)$/i;
  const unclosed = UNCLOSED_THINK_RE.exec(cleaned);
  if (unclosed) {
    const trimmed = unclosed[1]?.trim();
    if (trimmed) thoughts.push(trimmed);
    cleaned = cleaned.replace(UNCLOSED_THINK_RE, "");
  }

  // Also strip stray orphaned closing </think> tags
  cleaned = cleaned.replace(/<\/think>/gi, "");

  const extractedReasoning = thoughts.length > 0 ? thoughts.join("\n\n") : null;
  return {
    content: cleaned.trim(),
    extractedReasoning,
  };
}
