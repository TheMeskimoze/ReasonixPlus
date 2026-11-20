import { describe, expect, it } from "vitest";
import {
  modelTargetKey,
  readModelTarget,
  resolveModelTarget,
  writeModelTarget,
} from "./model-target";

function fakeStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
}

describe("the model pill's target per session", () => {
  it("remembers each session's own target", () => {
    const storage = fakeStorage();
    writeModelTarget(storage, "chat-a", "subagent");
    expect(readModelTarget(storage, "chat-a")).toBe("subagent");
    // The other chat never inherits it.
    expect(readModelTarget(storage, "chat-b")).toBe("agent");
    writeModelTarget(storage, "chat-b", "agent");
    expect(readModelTarget(storage, "chat-a")).toBe("subagent");
  });

  it("keys the choice by session name", () => {
    const storage = fakeStorage();
    writeModelTarget(storage, "chat-a", "subagent");
    expect([...storage.entries]).toEqual([[modelTargetKey("chat-a"), "subagent"]]);
  });

  it("edits the agent model for a channel with no session and stores nothing", () => {
    const storage = fakeStorage();
    expect(readModelTarget(storage, undefined)).toBe("agent");
    writeModelTarget(storage, undefined, "subagent");
    expect(storage.entries.size).toBe(0);
  });

  it("reads anything but a stored subagent as the agent model", () => {
    const storage = fakeStorage();
    storage.setItem(modelTargetKey("chat-a"), "sideways");
    expect(readModelTarget(storage, "chat-a")).toBe("agent");
  });

  it("falls back to the agent model in a chat without the subagent tool", () => {
    expect(resolveModelTarget("subagent", true)).toBe("subagent");
    expect(resolveModelTarget("subagent", false)).toBe("agent");
    expect(resolveModelTarget("agent", true)).toBe("agent");
  });
});
