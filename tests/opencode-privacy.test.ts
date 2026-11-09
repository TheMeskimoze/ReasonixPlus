/** Guards that OpenCode request identity and diagnostics stay out of durable storage,
 *  and that a Console sign-in is kept by the flow that owns it. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetOpencodeOAuth,
  opencodeOAuthSession,
  rememberOpencodeOAuth,
} from "../src/opencode-session.js";

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

describe("opencode session store", () => {
  afterEach(() => {
    forgetOpencodeOAuth();
  });

  it("holds the session in memory", () => {
    expect(opencodeOAuthSession()).toBeUndefined();
    rememberOpencodeOAuth({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 1000 });
    expect(opencodeOAuthSession()?.accessToken).toBe("a");
    forgetOpencodeOAuth();
    expect(opencodeOAuthSession()).toBeUndefined();
  });

  it("imports no filesystem API", () => {
    const source = read("src/opencode-session.ts");
    expect(source).not.toMatch(/node:fs|writeFileSync|readFileSync/);
  });
});

describe("durable surfaces", () => {
  it("never dumps a request body to disk", () => {
    expect(read("src/client.ts")).not.toContain("opencode-error-request.json");
  });

  it("keeps auth and org values out of diagnostics", () => {
    const source = read("src/client.ts");
    expect(source).not.toContain("orgHeader");
    expect(source).not.toContain("authPrefix");
  });

  it("writes the opencode sign-in through the same config path as the other OAuth providers", () => {
    const source = read("src/config.ts");
    expect(source).toContain("cfg.opencodeOAuth =");
    expect(source).toContain("export function clearOpencodeOAuth");
    expect(source).not.toContain("purgeOpencodeOAuth");
  });

  it("takes request identity from the single process-wide accessor", () => {
    const source = read("src/client.ts");
    expect(source).not.toContain("createOpencodeIdentity");
    expect(source).toContain("rotateOpencodeIdentity");
  });
});
