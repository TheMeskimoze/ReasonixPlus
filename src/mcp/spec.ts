/** Plain http:// stays HTTP+SSE for back-compat; Streamable HTTP is opt-in via the `streamable+` URL prefix. */

import { shellSplit } from "./shell-split.js";

export interface StdioMcpSpec {
  transport: "stdio";
  /** Namespace prefix applied to each registered tool, or null if anonymous. */
  name: string | null;
  /** Argv[0]. */
  command: string;
  /** Remaining argv. */
  args: string[];
}

export interface SseMcpSpec {
  transport: "sse";
  name: string | null;
  /** Fully qualified SSE endpoint URL. */
  url: string;
}

export interface StreamableHttpMcpSpec {
  transport: "streamable-http";
  name: string | null;
  /** Fully qualified Streamable HTTP endpoint URL (no `streamable+` prefix). */
  url: string;
}

export type McpSpec = StdioMcpSpec | SseMcpSpec | StreamableHttpMcpSpec;

export type McpServerSpec =
  | (StdioMcpSpec & {
      env?: Record<string, string>;
      disabled?: boolean;
    })
  | (SseMcpSpec & {
      headers?: Record<string, string>;
      disabled?: boolean;
    })
  | (StreamableHttpMcpSpec & {
      headers?: Record<string, string>;
      disabled?: boolean;
    });

export function getMcpServerEnv(spec: McpServerSpec): Record<string, string> | undefined {
  return spec.transport === "stdio" ? spec.env : undefined;
}

export function getMcpServerHeaders(spec: McpServerSpec): Record<string, string> | undefined {
  return spec.transport !== "stdio" ? spec.headers : undefined;
}

/** Sort a record's keys into deterministic `[key, value]` tuples so two configs
 *  compare equal regardless of key insertion order. `undefined` → `null` (JSON-safe). */
export function stableRecord(rec?: Record<string, string>): Array<[string, string]> | null {
  return rec
    ? Object.keys(rec)
        .sort()
        .map((k) => [k, rec[k]!])
    : null;
}

export function overlayMatchedSpec(
  parsed: McpSpec,
  matched: McpServerSpec | undefined,
): McpServerSpec {
  switch (parsed.transport) {
    case "stdio": {
      return matched
        ? { ...parsed, disabled: matched.disabled, env: getMcpServerEnv(matched) }
        : { ...parsed };
    }
    case "sse": {
      return matched
        ? { ...parsed, disabled: matched.disabled, headers: getMcpServerHeaders(matched) }
        : { ...parsed };
    }
    case "streamable-http": {
      return matched
        ? { ...parsed, disabled: matched.disabled, headers: getMcpServerHeaders(matched) }
        : { ...parsed };
    }
  }
}

/** One token of the `--mcp` string form: quoted when it carries a space, tab or quote. */
function quoteRawToken(token: string): string {
  return /[\s"]/.test(token) ? `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : token;
}

/** Serialize a normalized spec back to the `--mcp` string format. Round-trips through `parseMcpSpec`. */
export function specToRaw(spec: McpServerSpec): string {
  if (spec.transport === "stdio") {
    const argv = [spec.command, ...spec.args].map(quoteRawToken).join(" ");
    return spec.name ? `${spec.name}=${argv}` : argv;
  }
  if (spec.transport === "sse") {
    return spec.name ? `${spec.name}=${spec.url}` : spec.url;
  }
  return spec.name ? `${spec.name}=streamable+${spec.url}` : `streamable+${spec.url}`;
}

const NAME_PREFIX = /^([a-zA-Z_][a-zA-Z0-9_-]*)=(.*)$/;
const HTTP_URL = /^https?:\/\//i;
const STREAMABLE_PREFIX = /^streamable\+(https?:\/\/.+)$/i;

export type EndpointClass =
  | { transport: "streamable-http"; url: string }
  | { transport: "sse"; url: string };

/** Classify a declared endpoint: `streamable+https://...` opts into Streamable HTTP,
 *  a bare http(s) URL stays SSE for back-compat. Null when it is not a URL. */
export function classifyEndpointUrl(raw: string): EndpointClass | null {
  const trimmed = raw.trim();
  const streamMatch = STREAMABLE_PREFIX.exec(trimmed);
  if (streamMatch) return { transport: "streamable-http", url: streamMatch[1]! };
  if (HTTP_URL.test(trimmed)) return { transport: "sse", url: trimmed };
  return null;
}

/** Keep only non-empty string values; undefined when nothing survives. */
export function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.length > 0) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseMcpSpec(input: string): McpSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("empty MCP spec");
  }

  const nameMatch = NAME_PREFIX.exec(trimmed);
  const name = nameMatch ? nameMatch[1]! : null;
  const body = (nameMatch ? nameMatch[2]! : trimmed).trim();

  if (!body) {
    throw new Error(`MCP spec has name but no command: ${input}`);
  }

  const endpoint = classifyEndpointUrl(body);
  if (endpoint) return { transport: endpoint.transport, name, url: endpoint.url };

  const argv = shellSplit(body);
  if (argv.length === 0) {
    throw new Error(`MCP spec has name but no command: ${input}`);
  }
  const [command, ...args] = argv;
  return { transport: "stdio", name, command: command!, args };
}
