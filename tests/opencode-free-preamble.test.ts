/** The free-tier system preamble: when it is applied, how it renders, and how it
 *  merges with the harness instructions. */

import { describe, expect, it } from "vitest";
import {
  freePreambleEnabled,
  freePromptFields,
  withFreePreamble,
} from "../src/opencode-free-preamble.js";
import {
  OPENCODE_FREE_PROMPT_TEMPLATE,
  renderOpencodeFreePrompt,
} from "../src/opencode-free-prompt.js";

describe("freePreambleEnabled", () => {
  it("is on by default, because the gateway needs the client prompt", () => {
    expect(freePreambleEnabled({})).toBe(true);
    expect(freePreambleEnabled({ OPENCODE_FREE_PREAMBLE: "off" })).toBe(false);
  });

  it("turns on with the on spellings", () => {
    for (const value of ["1", "on", "ON", "true", "yes"]) {
      expect(freePreambleEnabled({ OPENCODE_FREE_PREAMBLE: value })).toBe(true);
    }
  });
});

describe("renderOpencodeFreePrompt", () => {
  it("substitutes the model block", () => {
    const text = renderOpencodeFreePrompt(freePromptFields("deepseek-v4.1-flash-free"));
    expect(text).toContain("- Name: DeepSeek V4.1 Flash Free");
    expect(text).toContain("- Provider ID: opencode");
    expect(text).toContain("- Model ID: deepseek-v4.1-flash-free");
    expect(text).not.toContain("{{NAME}}");
  });

  it("keeps the template free of placeholders once rendered for any id", () => {
    const text = renderOpencodeFreePrompt(freePromptFields("some-new-free-model"));
    expect(text).not.toMatch(/\{\{[A-Z]+\}\}/);
    expect(OPENCODE_FREE_PROMPT_TEMPLATE).toContain("{{NAME}}");
  });
});

describe("withFreePreamble", () => {
  const fields = freePromptFields("glm-5-free");

  it("merges into the leading system message, keeping ours last", () => {
    const merged = withFreePreamble(
      [
        { role: "system", content: "Harness instructions." },
        { role: "user", content: "hi" },
      ],
      fields,
    );
    expect(merged).toHaveLength(2);
    const content = merged[0]?.content as string;
    expect(content.endsWith("Harness instructions.")).toBe(true);
    expect(content.startsWith("You are an AI agent running in OpenCode")).toBe(true);
  });

  it("adds a system message when the request has none", () => {
    const merged = withFreePreamble([{ role: "user", content: "hi" }], fields);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.role).toBe("system");
    expect(merged[1]).toEqual({ role: "user", content: "hi" });
  });
});
