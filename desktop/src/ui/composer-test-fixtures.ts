/** Shared required-prop factory for the composer-* test suites — one place to
 *  update when the Composer required-prop surface changes. */
import type { ComponentProps } from "react";
import { vi } from "vitest";
import type { Composer } from "./composer";

/** The model pill alone: the foot holds the effort and gate pills beside it. */
export const MODEL_PILL = ".composer-foot .model-pill:not(.effort-pill):not(.mode-pill)";

export function makeComposerBaseProps(
  overrides: Partial<ComponentProps<typeof Composer>> = {},
): ComponentProps<typeof Composer> {
  return {
    draft: "",
    setDraft: vi.fn(),
    onSend: vi.fn(),
    onAbort: vi.fn(),
    modelLabel: "deepseek-v4-flash",
    reasoningEffort: "high",
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    editMode: "follow",
    onEditModeChange: vi.fn(),
    onVoiceError: vi.fn(),
    onVoiceEvent: vi.fn(),
    textareaRef: { current: null },
    ...overrides,
  };
}
