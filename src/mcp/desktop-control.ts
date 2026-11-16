/** Identity and launcher for the bundled desktop-control MCP server: the one place that
 *  knows how the daemon finds, spells and re-pins that server's stdio spec. */

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { McpServerConfig } from "../config.js";
import type { McpServerSpec } from "./spec.js";

/** Config name and toggle handle. A chat enables the tools by enabling this server. */
export const DESKTOP_SERVER_NAME = "desktop";

export const COMPUTER_USE_TOOL = "computer_use";
export const SCREEN_CAPTURE_TOOL = "screen_capture";

const ENTRY_BASENAME = "desktop-mcp";
const ENTRY_FILE = `${ENTRY_BASENAME}.js`;
/** Every spelling the launcher can produce: the bundle, an mjs build, and the source entry. */
const ENTRY_FILES: readonly string[] = [
  ENTRY_FILE,
  `${ENTRY_BASENAME}.mjs`,
  `${ENTRY_BASENAME}.ts`,
];

export interface DesktopLauncher {
  command: string;
  args: string[];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when these argv entries launch the bundled server. Identity is the entry
 *  filename, so it survives the `specToRaw` round-trip that the remove guard reads. */
export function isDesktopEntryArgs(args: readonly string[]): boolean {
  return args.some((arg) => ENTRY_FILES.includes(arg.split(/[\\/]/).pop() ?? ""));
}

export function isDesktopControlSpec(spec: McpServerSpec): boolean {
  return (
    spec.transport === "stdio" && spec.name === DESKTOP_SERVER_NAME && isDesktopEntryArgs(spec.args)
  );
}

/** True when a stored config entry is ours: no URL of its own, and either the launcher we
 *  wrote or an empty leftover with no command. A user's server on the same name (its own
 *  command or URL) stays foreign and is never rewritten. */
export function isDesktopConfigEntry(entry: McpServerConfig): boolean {
  if (entry.url) return false;
  if (!entry.command) return true;
  return isDesktopEntryArgs(entry.args ?? []);
}

/** The bundled server runs in one of three shapes: beside the daemon bundle (packaged and
 *  dev-dist), an explicit override, or straight from source through tsx (repo checkouts). */
export function resolveDesktopLauncher(): DesktopLauncher | undefined {
  const candidates: string[] = [];
  const override = process.env.REASONIX_DESKTOP_MCP_ENTRY?.trim();
  if (override) candidates.push(override);
  const running = process.argv[1];
  if (running && /\.[cm]?js$/i.test(running)) {
    candidates.push(join(dirname(running), ENTRY_FILE));
  }
  for (const candidate of candidates) {
    if (isFile(candidate)) return { command: process.execPath, args: [candidate] };
  }

  const sourceEntry = join(
    dirname(fileURLToPath(import.meta.url)),
    "servers",
    `${ENTRY_BASENAME}.ts`,
  );
  if (!isFile(sourceEntry)) return undefined;
  try {
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    return { command: process.execPath, args: ["--import", loader, sourceEntry] };
  } catch {
    return undefined;
  }
}

/** The config entry to seed: always disabled, so no chat gains the tools by upgrading. */
export function desktopControlEntry(): McpServerConfig | undefined {
  const launcher = resolveDesktopLauncher();
  if (!launcher) return undefined;
  return {
    transport: "stdio",
    command: launcher.command,
    args: launcher.args,
    disabled: true,
  };
}

/** Re-pin a stored entry to the runtime that is actually installed: dev, packaged and
 *  upgraded installs disagree about where the bundle lives. */
export function withDesktopControlRuntime(spec: McpServerSpec): McpServerSpec {
  if (!isDesktopControlSpec(spec) || spec.transport !== "stdio") return spec;
  const launcher = resolveDesktopLauncher();
  if (!launcher) return spec;
  return { ...spec, command: launcher.command, args: launcher.args };
}

/** Capture is read-only work; a click is not, so plan mode refuses it. */
export function isDesktopReadOnlyTool(toolName: string): boolean {
  return toolName === SCREEN_CAPTURE_TOOL;
}
