import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appCredential = { access: "st_from_app_store_0123456789abcdef", source: "database" as const };

vi.mock("../src/opencode-app-credential.js", () => ({
  opencodeAppCredential: () => appCredential.value,
  opencodeAppDatabase: () => "",
  parseCredential: () => null,
  resetAppCredentialCache: () => undefined,
}));

const { modelClientOptions } = await import("../src/model-client.js");
const { forgetOpencodeOAuth, rememberOpencodeOAuth } = await import("../src/opencode-session.js");

const TEST_DIR = join(process.cwd(), ".tmp-test-free-credential");
const CONFIG_PATH = join(TEST_DIR, "config.json");

describe("free-tier credential resolution", () => {
  beforeEach(() => {
    forgetOpencodeOAuth();
    mkdirSync(TEST_DIR, { recursive: true });
    Reflect.deleteProperty(process.env, "OPENCODE_API_KEY");
    appCredential.value = { access: "st_from_app_store_0123456789abcdef", source: "database" };
  });

  afterEach(() => {
    forgetOpencodeOAuth();
    rmSync(TEST_DIR, { recursive: true, force: true });
    Reflect.deleteProperty(process.env, "OPENCODE_API_KEY");
  });

  it("uses the account the OpenCode app already holds, never the keyless placeholder", async () => {
    const opts = modelClientOptions({ model: "deepseek-v4-flash-free", configPath: CONFIG_PATH });
    expect(opts.apiKey).toBe("public");
    expect(await opts.apiKeyResolver?.()).toBe("st_from_app_store_0123456789abcdef");
  });

  it("prefers the harness's own sign-in over the app's account", async () => {
    rememberOpencodeOAuth({
      accessToken: "session-access",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const opts = modelClientOptions({ model: "deepseek-v4-flash-free", configPath: CONFIG_PATH });
    expect(await opts.apiKeyResolver?.()).toBe("session-access");
  });

  it("fails with a sign-in instruction when no credential exists at all", async () => {
    appCredential.value = null;
    const opts = modelClientOptions({ model: "deepseek-v4-flash-free", configPath: CONFIG_PATH });
    await expect(opts.apiKeyResolver?.()).rejects.toThrow(/signed-in OpenCode account/);
  });

  it("leaves paid OpenCode ids on the configured-key path", async () => {
    appCredential.value = null;
    const opts = modelClientOptions({ model: "deepseek-v4.1-flash", configPath: CONFIG_PATH });
    expect(await opts.apiKeyResolver?.()).toBeUndefined();
  });
});
