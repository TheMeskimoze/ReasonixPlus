import { describe, expect, it, vi } from "vitest";
import { credsFromToken, resolveFreshAccessToken } from "../src/oauth-shared.js";

interface Creds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

describe("credsFromToken", () => {
  it("uses the response expires_in when present", () => {
    const before = Date.now();
    const creds = credsFromToken(
      { access_token: "a", expires_in: 120 },
      { defaultExpiresInSec: 3600 },
    );
    expect(creds.accessToken).toBe("a");
    expect(creds.expiresAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(creds.expiresAt).toBeLessThan(before + 122_000);
  });

  it("falls back to the provider default when expires_in is missing", () => {
    const before = Date.now();
    const creds = credsFromToken({ access_token: "a" }, { defaultExpiresInSec: 600 });
    expect(creds.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(creds.expiresAt).toBeLessThan(before + 602_000);
  });

  it("stores an empty access token when the response omits one", () => {
    expect(credsFromToken({}, { defaultExpiresInSec: 600 }).accessToken).toBe("");
  });

  it("keeps the caller's refresh token when the response does not rotate it", () => {
    expect(
      credsFromToken({ access_token: "a" }, { fallbackRefresh: "r1", defaultExpiresInSec: 600 })
        .refreshToken,
    ).toBe("r1");
    expect(
      credsFromToken(
        { access_token: "a", refresh_token: "r2" },
        { fallbackRefresh: "r1", defaultExpiresInSec: 600 },
      ).refreshToken,
    ).toBe("r2");
  });
});

describe("resolveFreshAccessToken", () => {
  const flight = <T>(task: () => Promise<T>): Promise<T> => task();

  it("returns a fresh token without refreshing", async () => {
    const refresh = vi.fn();
    const save = vi.fn();
    const token = await resolveFreshAccessToken<Creds>({
      read: () => ({ accessToken: "fresh", refreshToken: "r", expiresAt: Date.now() + 600_000 }),
      save,
      refresh,
      flight,
    });
    expect(token).toBe("fresh");
    expect(refresh).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("refreshes, saves with the previous credentials, and returns the new token", async () => {
    const previous: Creds = { accessToken: "old", refreshToken: "r", expiresAt: 0 };
    const next: Creds = { accessToken: "new", refreshToken: "r2", expiresAt: Date.now() + 600_000 };
    const save = vi.fn();
    const token = await resolveFreshAccessToken<Creds>({
      read: () => previous,
      save,
      refresh: async () => next,
      flight,
    });
    expect(token).toBe("new");
    expect(save).toHaveBeenCalledWith(next, previous);
  });

  it("swallows a refresh failure when no policy is given", async () => {
    await expect(
      resolveFreshAccessToken<Creds>({
        read: () => ({ accessToken: "old", refreshToken: "r", expiresAt: 0 }),
        save: vi.fn(),
        refresh: async () => {
          throw new Error("revoked");
        },
        flight,
      }),
    ).resolves.toBeUndefined();
  });

  it("surfaces a refresh failure when the policy throws", async () => {
    await expect(
      resolveFreshAccessToken<Creds>({
        read: () => ({ accessToken: "old", refreshToken: "r", expiresAt: 0 }),
        save: vi.fn(),
        refresh: async () => {
          throw new Error("revoked");
        },
        flight,
        onRefreshError: (error) => {
          throw new Error(`wrapped: ${(error as Error).message}`);
        },
      }),
    ).rejects.toThrow("wrapped: revoked");
  });

  it("returns undefined when there is no stored session", async () => {
    await expect(
      resolveFreshAccessToken<Creds>({
        read: () => undefined,
        save: vi.fn(),
        refresh: vi.fn(),
        flight,
      }),
    ).resolves.toBeUndefined();
  });
});
