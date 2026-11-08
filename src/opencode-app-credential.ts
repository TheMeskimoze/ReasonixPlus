/** The credential the installed OpenCode app is already signed in with. */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bunCommand } from "./opencode-relay.js";

export interface AppCredential {
  access: string;
  orgId?: string;
  expiresAt?: number;
  /** Which store answered, so Settings can name it. */
  source: "database" | "cli-export";
}

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; value: AppCredential | null } | null = null;

export function resetAppCredentialCache(): void {
  cached = null;
}

/** The app's SQLite store; the desktop build keeps its account row here. */
export function opencodeAppDatabase(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  return join(home, ".local", "share", "opencode", "opencode.db");
}

// Bun reads its own SQLite format, and Bun is already required for free models.
const READ_ROW = `import { Database } from "bun:sqlite";
const db = new Database(process.env.OPENCODE_CREDENTIAL_DB, { readonly: true });
const row = db.query("SELECT value FROM credential WHERE integration_id = 'opencode' LIMIT 1").get();
process.stdout.write(row && row.value ? String(row.value) : "");`;

function fromDatabase(env: NodeJS.ProcessEnv): AppCredential | null {
  const database = opencodeAppDatabase(env);
  if (!existsSync(database)) return null;
  try {
    const out = execFileSync(bunCommand(env).command, ["-e", READ_ROW], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: { ...env, OPENCODE_CREDENTIAL_DB: database },
    });
    return parseCredential(out, "database");
  } catch {
    return null;
  }
}

function fromCliExport(env: NodeJS.ProcessEnv): AppCredential | null {
  try {
    const out = execFileSync("opencode", ["auth", "export"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env,
    });
    return parseCredential(out, "cli-export");
  } catch {
    return null;
  }
}

/** Accepts the app's credential row, the CLI's export array, or a bare token. */
export function parseCredential(
  raw: string,
  source: AppCredential["source"],
): AppCredential | null {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (text.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    const record = Array.isArray(parsed)
      ? (parsed.find((entry) => entry?.active) ?? parsed[0])
      : (parsed as Record<string, unknown>);
    const value = (record as { value?: unknown })?.value ?? record;
    const box = value as { access?: unknown; expires?: unknown; metadata?: unknown };
    const access = typeof box?.access === "string" ? box.access : "";
    if (access.length === 0) return null;
    const metadata = (box.metadata ?? {}) as Record<string, unknown>;
    return {
      access,
      orgId: typeof metadata.orgID === "string" ? metadata.orgID : undefined,
      expiresAt: typeof box.expires === "number" ? box.expires : undefined,
      source,
    };
  } catch {
    return text.startsWith("st_") ? { access: text, source } : null;
  }
}

/** Cached per process: the store changes rarely and spawning Bun is not free. */
export function opencodeAppCredential(env: NodeJS.ProcessEnv = process.env): AppCredential | null {
  const now = Date.now();
  if (cached !== null && now - cached.at < CACHE_MS) return cached.value;
  const value = fromDatabase(env) ?? fromCliExport(env);
  cached = { at: now, value };
  return value;
}
