import { describe, expect, it } from "vitest";
import {
  GeminiCallLedger,
  SKIP_THOUGHT_SIGNATURE_VALIDATOR,
  appendSystemInstruction,
} from "../src/gemini-transcript.js";
import type { ToolCall } from "../src/types.js";

function call(name: string, id: string): ToolCall {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

describe("GeminiCallLedger", () => {
  it("names a result from its message, its call id, or the pending call", () => {
    const ledger = new GeminiCallLedger("gemini-2.5-flash");
    ledger.noteCall(call("read_file", "c1"), "c1");
    ledger.noteCall(call("write_file", "c2"), "c2");

    expect(ledger.resultFor({ name: "read_file", tool_call_id: "c1" })).toEqual({
      name: "read_file",
      id: "c1",
    });
    expect(ledger.resultFor({ tool_call_id: "c2" })).toEqual({ name: "write_file", id: "c2" });
    expect(ledger.resultFor({ name: "write_file" })).toEqual({ name: "write_file", id: "c2" });
    expect(ledger.resultFor({ name: "unknown" })).toEqual({ name: "unknown", id: undefined });
  });

  it("keeps the call id available after the pending entry is consumed", () => {
    const ledger = new GeminiCallLedger("gemini-2.5-flash");
    ledger.noteCall(call("run_command", "c1"), "c1");
    expect(ledger.resultFor({ name: "run_command", tool_call_id: "c1" }).name).toBe("run_command");
    expect(ledger.resultFor({ tool_call_id: "c1" })).toEqual({ name: "run_command", id: "c1" });
  });

  it("replays the model's own signature, then borrows the carried one", () => {
    const ledger = new GeminiCallLedger("gemini-3-pro");
    expect(ledger.signatureFor({ thoughtSignature: "sig-a" })).toBe("sig-a");
    expect(ledger.signatureFor({})).toBe("sig-a");
    expect(ledger.signatureFor(call("f", "1"))).toBe("sig-a");
  });

  it("uses the sentinel only where the model validates signatures", () => {
    const older = new GeminiCallLedger("gemini-2.5-flash");
    expect(older.signatureFor({})).toBeUndefined();

    const newer = new GeminiCallLedger("gemini-3.8-flash-tiered");
    expect(newer.signatureFor({})).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR);
  });

  it("borrows the first signature in the transcript", () => {
    const ledger = new GeminiCallLedger("gemini-3-pro");
    ledger.rememberFromTranscript([
      { role: "user", content: "q" },
      { role: "assistant", content: "", tool_calls: [call("f", "1")] },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ ...call("g", "2"), thoughtSignature: "sig-first" }],
      },
    ]);
    expect(ledger.signatureFor({})).toBe("sig-first");
  });
});

describe("appendSystemInstruction", () => {
  it("joins consecutive system messages and skips empty ones", () => {
    expect(appendSystemInstruction(undefined, "")).toBeUndefined();
    expect(appendSystemInstruction(undefined, "a")).toBe("a");
    expect(appendSystemInstruction("a", "b")).toBe("a\n\nb");
  });
});
