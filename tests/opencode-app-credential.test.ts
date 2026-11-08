import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  opencodeAppCredential,
  opencodeAppDatabase,
  parseCredential,
  resetAppCredentialCache,
} from "../src/opencode-app-credential.js";

const ROW = JSON.stringify({
  type: "oauth",
  methodID: "device",
  refresh: "st_refresh",
  access: "st_access_token_value_1234567890abcdefghi",
  expires: 1794241430177,
  metadata: { server: "https://opencode.ai", orgID: "wrk_01M1RWNMPW6VDDP6A1FRE2K70A" },
});

describe("opencode app credential", () => {
  it("reads the app's credential row", () => {
    const credential = parseCredential(ROW, "database");
    expect(credential?.access).toBe("st_access_token_value_1234567890abcdefghi");
    expect(credential?.orgId).toBe("wrk_01M1RWNMPW6VDDP6A1FRE2K70A");
    expect(credential?.expiresAt).toBe(1794241430177);
    expect(credential?.source).toBe("database");
  });

  it("reads the CLI's export array, preferring the active entry", () => {
    const exported = JSON.stringify([
      { id: "opencode", active: false, value: { access: "st_stale" } },
      { id: "opencode", active: true, value: { access: "st_live" } },
    ]);
    expect(parseCredential(exported, "cli-export")?.access).toBe("st_live");
  });

  it("accepts a bare token and rejects everything else", () => {
    expect(parseCredential("st_bare_token", "cli-export")?.access).toBe("st_bare_token");
    expect(parseCredential("", "database")).toBeNull();
    expect(parseCredential("not a token", "database")).toBeNull();
    expect(parseCredential("{}", "database")).toBeNull();
  });

  it("resolves the store under the user's home and returns null when it is absent", () => {
    const home = mkdtempSync(join(tmpdir(), "reasonix-app-cred-"));
    const env = { USERPROFILE: home, HOME: home } as NodeJS.ProcessEnv;
    expect(opencodeAppDatabase(env)).toBe(join(home, ".local", "share", "opencode", "opencode.db"));
    resetAppCredentialCache();
    expect(opencodeAppCredential(env)).toBeNull();
  });

  it("returns null rather than throwing on an unreadable store", () => {
    const home = mkdtempSync(join(tmpdir(), "reasonix-app-cred-"));
    const directory = join(home, ".local", "share", "opencode");
    writeFileSync(join(home, "placeholder"), "");
    expect(opencodeAppDatabase({ USERPROFILE: home } as NodeJS.ProcessEnv)).toBe(
      join(directory, "opencode.db"),
    );
    resetAppCredentialCache();
    const env = { USERPROFILE: home, HOME: home, PATH: "" } as NodeJS.ProcessEnv;
    expect(opencodeAppCredential(env)).toBeNull();
  });
});
