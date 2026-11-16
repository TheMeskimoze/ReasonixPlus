/** Desktop-control server wiring: managed identity, disabled-by-default seeding, and the
 *  one-time correction for chats whose frozen MCP set predates the server. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  capabilityRows,
  chatCapabilitySeed,
  ensureDesktopControlServer,
  sessionMcpOverrides,
} from "../src/cli/commands/desktop.js";
import { createMcpRuntime } from "../src/cli/commands/mcp-runtime.js";
import { type ReasonixConfig, normalizeMcpConfig, readConfig, writeConfig } from "../src/config.js";
import {
  DESKTOP_SERVER_NAME,
  desktopControlEntry,
  isDesktopControlSpec,
  isDesktopReadOnlyTool,
  resolveDesktopLauncher,
  withDesktopControlRuntime,
} from "../src/mcp/desktop-control.js";
import { isManagedMcpSpec } from "../src/mcp/managed.js";
import { parseMcpSpec, specToRaw } from "../src/mcp/spec.js";
import { ensureSessionDir, loadSessionMeta, patchSessionMeta } from "../src/memory/session.js";
import { ToolRegistry } from "../src/tools.js";

describe("desktop-control server identity", () => {
  it("seeds a disabled stdio entry that points at the bundled server", () => {
    const entry = desktopControlEntry();
    expect(entry).toBeDefined();
    expect(entry?.transport).toBe("stdio");
    expect(entry?.disabled).toBe(true);
    expect(entry?.command).toBe(process.execPath);
    expect(entry?.args?.some((arg) => /desktop-mcp\.(js|ts)$/.test(arg))).toBe(true);
  });

  it("normalizes back to a managed spec, including through the raw-spec round trip", () => {
    const entry = desktopControlEntry()!;
    const spec = normalizeMcpConfig({ mcpServers: { [DESKTOP_SERVER_NAME]: entry } })[0]!;
    expect(spec.disabled).toBe(true);
    expect(isDesktopControlSpec(spec)).toBe(true);
    expect(isManagedMcpSpec(spec)).toBe(true);
    // The Settings remove guard reads the spec built from `specToRaw`, which drops the
    // config-only fields; identity must survive that round trip.
    expect(isManagedMcpSpec(parseMcpSpec(specToRaw(spec)))).toBe(true);
  });

  it("treats a user's own server on the same name as unrelated", () => {
    const spec = normalizeMcpConfig({
      mcpServers: { [DESKTOP_SERVER_NAME]: { command: "python", args: ["my_server.py"] } },
    })[0]!;
    expect(isDesktopControlSpec(spec)).toBe(false);
    expect(isManagedMcpSpec(spec)).toBe(false);
  });

  it("resolves a launcher for this checkout", () => {
    const launcher = resolveDesktopLauncher();
    expect(launcher?.command).toBe(process.execPath);
    expect(launcher?.args.length).toBeGreaterThan(0);
  });

  it("re-pins a stored launcher at bridge time", () => {
    const stale = normalizeMcpConfig({
      mcpServers: {
        [DESKTOP_SERVER_NAME]: {
          transport: "stdio",
          command: join("C:", "old", "node.exe"),
          args: [join("C:", "old", "desktop-mcp.js")],
        },
      },
    })[0]!;
    const pinned = withDesktopControlRuntime(stale);
    expect(pinned.transport).toBe("stdio");
    expect(pinned.command).toBe(process.execPath);
    expect(pinned.args?.[0]).not.toContain("old");
  });

  it("keeps capture read-only and a click out of plan mode", () => {
    expect(isDesktopReadOnlyTool("screen_capture")).toBe(true);
    expect(isDesktopReadOnlyTool("computer_use")).toBe(false);
  });
});

describe("ensureDesktopControlServer", () => {
  let root: string;
  let configPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reasonix-desktop-seed-"));
    configPath = join(root, "config.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the entry disabled, stamps the seed, and is idempotent", () => {
    const cfg: ReasonixConfig = {};
    expect(ensureDesktopControlServer(cfg, configPath)).toBe(true);
    expect(cfg.mcpServers?.[DESKTOP_SERVER_NAME]?.disabled).toBe(true);
    expect(cfg.desktopServerSeededAt).toBeTypeOf("number");
    expect(readConfig(configPath).mcpServers?.[DESKTOP_SERVER_NAME]).toBeDefined();

    const again = readConfig(configPath);
    expect(ensureDesktopControlServer(again, configPath)).toBe(false);
  });

  it("keeps the user's toggle and re-pins a stale launcher", () => {
    const cfg: ReasonixConfig = {
      desktopServerSeededAt: 1,
      mcpServers: {
        [DESKTOP_SERVER_NAME]: {
          transport: "stdio",
          command: join(root, "old", "node.exe"),
          args: [join(root, "old", "desktop-mcp.js")],
        },
      },
    };
    expect(ensureDesktopControlServer(cfg, configPath)).toBe(true);
    const entry = cfg.mcpServers?.[DESKTOP_SERVER_NAME];
    expect(entry?.disabled).toBeUndefined();
    expect(entry?.command).toBe(process.execPath);
    expect(entry?.args?.[0]).not.toContain(join(root, "old"));
  });

  it("leaves an unrelated server that already owns the name", () => {
    const cfg: ReasonixConfig = {
      mcpServers: {
        [DESKTOP_SERVER_NAME]: { transport: "stdio", command: "python", args: ["x.py"] },
      },
    };
    expect(ensureDesktopControlServer(cfg, configPath)).toBe(false);
    expect(cfg.mcpServers?.[DESKTOP_SERVER_NAME]?.command).toBe("python");
  });

  it("fills an empty leftover entry instead of treating it as foreign", () => {
    const cfg: ReasonixConfig = { mcpServers: { [DESKTOP_SERVER_NAME]: {} } };
    expect(ensureDesktopControlServer(cfg, configPath)).toBe(true);
    expect(cfg.mcpServers?.[DESKTOP_SERVER_NAME]?.command).toBe(process.execPath);
    expect(cfg.mcpServers?.[DESKTOP_SERVER_NAME]?.disabled).toBe(true);
  });

  it("leaves an HTTP entry on the same name alone", () => {
    const cfg: ReasonixConfig = {
      mcpServers: {
        [DESKTOP_SERVER_NAME]: {
          transport: "streamable-http",
          url: "https://example.test/mcp",
        },
      },
    };
    expect(ensureDesktopControlServer(cfg, configPath)).toBe(false);
    expect(cfg.mcpServers?.[DESKTOP_SERVER_NAME]?.url).toBe("https://example.test/mcp");
  });
});
describe("chats that froze their MCP set before the server existed", () => {
  let home: string;
  const SEEDED_AT = 1_700_000_000_000;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "reasonix-desktop-freeze-"));
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("HOME", home);
    writeConfig({ desktopServerSeededAt: SEEDED_AT });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("appends the server to an older chat's frozen set without touching its activity stamp", () => {
    ensureSessionDir("old-chat");
    patchSessionMeta("old-chat", {
      createdAt: SEEDED_AT - 60_000,
      mcp: { disabledServers: ["ghidra"] },
    });
    const before = loadSessionMeta("old-chat");

    const overrides = sessionMcpOverrides({ rootDir: home, currentSession: "old-chat" });
    expect([...(overrides?.disabledServers ?? [])].sort()).toEqual([DESKTOP_SERVER_NAME, "ghidra"]);
    const after = loadSessionMeta("old-chat");
    expect(after.mcp?.disabledServers).toContain(DESKTOP_SERVER_NAME);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("leaves a chat created after the seed alone, so an explicit enable survives", () => {
    ensureSessionDir("new-chat");
    patchSessionMeta("new-chat", { createdAt: SEEDED_AT + 60_000, mcp: {} });

    const overrides = sessionMcpOverrides({ rootDir: home, currentSession: "new-chat" });
    expect(overrides?.disabledServers && [...overrides.disabledServers]).toEqual([]);
    expect(loadSessionMeta("new-chat").mcp?.disabledServers).toBeUndefined();
  });

  it("pre-fills Duplicate as off for a chat that froze before the server existed", () => {
    ensureDesktopControlServer();
    ensureSessionDir("old-duplicate");
    patchSessionMeta("old-duplicate", {
      createdAt: SEEDED_AT - 60_000,
      mcp: { disabledServers: [] },
    });

    const seed = chatCapabilitySeed({
      rootDir: home,
      currentSession: "old-duplicate",
      subagents: false,
    });
    const rows = capabilityRows(home, seed).servers;
    expect(rows.find((row) => row.name === DESKTOP_SERVER_NAME)?.enabled).toBe(false);

    // A chat that answered after the seed and left it on keeps it on.
    ensureSessionDir("recent-chat");
    patchSessionMeta("recent-chat", { createdAt: SEEDED_AT + 60_000, mcp: {} });
    const recent = chatCapabilitySeed({
      rootDir: home,
      currentSession: "recent-chat",
      subagents: false,
    });
    expect(
      capabilityRows(home, recent).servers.find((row) => row.name === DESKTOP_SERVER_NAME)?.enabled,
    ).toBe(true);
  });

  it("offers the server off in a New chat picker", () => {
    ensureDesktopControlServer();
    expect(
      capabilityRows(home).servers.find((row) => row.name === DESKTOP_SERVER_NAME),
    ).toMatchObject({
      name: DESKTOP_SERVER_NAME,
      enabled: false,
      builtin: true,
    });
  });

  it("never bridges it into a chat whose frozen set predates it", async () => {
    ensureDesktopControlServer();
    ensureSessionDir("old-bridge");
    patchSessionMeta("old-bridge", {
      createdAt: SEEDED_AT - 60_000,
      mcp: { disabledServers: [] },
    });

    const tools = new ToolRegistry();
    const runtime = createMcpRuntime({
      getTools: () => tools,
      getMcpPrefix: () => undefined,
      getRequestedCount: () => 1,
      getWorkspaceDir: () => home,
      getSpecOverrides: () => sessionMcpOverrides({ rootDir: home, currentSession: "old-bridge" }),
      progressSink: { current: null },
    });
    const loaded = await runtime.reloadFromConfig();
    expect(loaded.added).toEqual([]);
    expect(runtime.specs()).toEqual([]);
    expect(tools.specs().map((spec) => spec.function.name)).toEqual([]);
    await runtime.closeAll();
  });
});
