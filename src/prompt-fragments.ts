/** Shared prompt fragments — single source so house-style rules can't drift across the agent and subagent prompts. */

import { formatClockUtc } from "./loop/messages.js";

/** Embedded literally — no interpolation, so prefix-cache hash stays stable across sessions. */
export const TUI_FORMATTING_RULES = `Formatting (rendered in a TUI markdown renderer):
- Tables: GitHub-Flavored Markdown with ASCII pipes (\`| a | b |\` and a \`| --- | --- |\` separator). Never use Unicode box-drawing characters (│ ─ ┼ ┌ ┐ └ ┘ ├ ┤): they break word-wrap into garbled columns.
- One phrase per cell. Explaining a cell belongs in bullets below the table.
- Code and shell commands: fenced code blocks (\`\`\`). A \`path:line\` evidence citation stays inline.
- No decorative frames or ASCII art (no \`┌──┐\` boxes): the renderer draws its own borders and art shatters at narrow widths.
- Diagrams: a plain bullet list with ASCII \`->\` between steps.
- Never use em dashes (or en dashes): rewrite with a comma, colon, parentheses, or hyphen.
- Never use emojis or pictographs: write plain words instead.`;

/** Model identity note used by session prompts. Models must complete work directly. */
export function escalationContract(modelId: string): string {
  return `You are running on \`${modelId}\`. Deliver the strongest answer you can directly. Do not stop merely because a task is difficult, uncertain, or long. If asked which model you are, answer \`${modelId}\`.`;
}

/** Backward-compatible export retained for public API consumers. */
export const ESCALATION_CONTRACT = escalationContract("deepseek-v4-flash");

export const SHARED_WORKSPACE_SAFETY = `Multiple agents or the user may change the same workspace concurrently. Treat unexpected changes, including files appearing or disappearing, as someone else's work unless verified otherwise. Preserve them and use minimal, non-destructive edits against current file contents. Never use git stash or git stash pop. Do not revert, reset, clean, overwrite, or delete unrelated work. If a conflict prevents a safe edit, stop and ask the user.`;

/** The harness has no effort budget. Shared so a parent and a child cannot tell
 *  different stories about why the agent should keep working. */
export const NO_EFFORT_LIMIT_RULE =
  "This harness enforces no turn, step, tool-call, or effort budget. Nothing stops you for working long, and no counter is running that you should conserve against. Never mention or act on a limit you believe you are near: keep working at full scope until the task is done.";

export const NEGATIVE_CLAIM_RULE = `Negative claims ("X is missing", "Y isn't implemented") are the #1 hallucination shape: they feel safe because no citation seems possible, which is exactly why they must not be instinct.

With a search tool (\`search_content\`, \`grep\`, web search), search FIRST:
- Matches → you were wrong; correct and cite them.
- Nothing → state the absence WITH the query as evidence: \`No callers of \\\`foo()\\\` found (search_content "foo").\`

With no search tool, qualify: "I have not verified this." Never assert absence with fake authority.`;

/** When a session's main agent splits work out. One text for the prompt section and the
 *  tool spec, so a hard task reads the same on both surfaces. The decision follows the
 *  shape of the work, never a context limit. */
export const DELEGATION_TRIGGER =
  "Spawn when the work splits into 2+ independent subtasks that can run at once, or when a subtask is self-contained and wide: several unknowns that can be settled separately, or a sweep across many files or servers. Do a single grep, 1-3 file cross-references, work that needs the user, and work whose intermediate results inform your next step, yourself. Choose delegation by the shape of the task, never by how much conversation or output you think you can afford.";

/** A fan-out is one batch or it degrades into serial spawns. */
export const DELEGATION_WAVE_RULE =
  "Issue independent spawns together, with no write, shell or MCP call between them: an interleaved unsafe call splits the burst, so the later spawns start only after the earlier ones finish.";

/** The instant the instructions show as an example, derived so a format change cannot
 *  leave the rule describing a shape nothing writes. */
const STAMP_EXAMPLE = formatClockUtc(Date.UTC(2026, 10, 5, 13, 10, 4));

/** How to read the only clock the agent gets. Every prompt is stamped on the wire with
 *  the time its transcript entry was written; nothing else carries a time. */
export const TIME_STAMP_RULE = `Each prompt you receive is stamped with the host clock at the moment it was sent, in UTC, on a bracketed line above the text: \`[${STAMP_EXAMPLE}]\`. That stamp is the only clock you have. Read elapsed time by subtracting two stamps and treat the difference as the real gap it is: a gap of hours means hours passed, not that the conversation paused. Nothing else you receive is stamped, and the stamps follow the host clock even when it jumps, so do not reason about time from anything else.`;
