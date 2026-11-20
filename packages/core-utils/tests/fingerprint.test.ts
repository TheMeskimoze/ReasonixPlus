import { describe, expect, it } from "vitest";
import { credentialFingerprint } from "../src/fingerprint.js";

describe("credentialFingerprint", () => {
  it("returns a stable short hex key", () => {
    const key = credentialFingerprint({ credential: "sk-secret" });
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(credentialFingerprint({ credential: "sk-secret" })).toBe(key);
  });

  it("changes when any named part changes", () => {
    const base = credentialFingerprint({ provider: "deepseek", baseUrl: "https://a" });
    expect(credentialFingerprint({ provider: "deepseek", baseUrl: "https://b" })).not.toBe(base);
    expect(credentialFingerprint({ provider: "openai", baseUrl: "https://a" })).not.toBe(base);
  });

  it("keeps distinct part values from colliding across the separator", () => {
    expect(credentialFingerprint({ a: "x", b: "y" })).not.toBe(credentialFingerprint({ a: "xy" }));
  });

  it("honours the requested length", () => {
    expect(credentialFingerprint({ credential: "k" }, 64)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats an absent part as empty rather than leaking undefined", () => {
    expect(credentialFingerprint({ credential: undefined })).toBe(
      credentialFingerprint({ credential: "" }),
    );
  });
});
