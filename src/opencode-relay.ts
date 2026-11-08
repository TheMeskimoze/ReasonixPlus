/** Free-tier requests ride a Bun process: only its TLS handshake is admitted. */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { envFlag } from "./env-flag.js";
import { createLogger } from "./logging.js";

const log = createLogger("opencode-relay");

/** The relay source handed to `bun -e`. It forwards one request per call to the
 *  gateway and streams the answer back unchanged. */
const RELAY_PROGRAM = `
const upstream = "https://opencode.ai";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 240,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("connection");
    let response;
    try {
      response = await fetch(upstream + url.pathname + url.search, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String((error && error.message) || error) }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(response.body, { status: response.status, headers: response.headers });
  },
});
console.log(JSON.stringify({ port: server.port }));
`;

export interface OpencodeRelay {
  /** Loopback origin the client posts to instead of the gateway. */
  origin: string;
}

/** `OPENCODE_FREE_RELAY=off` switches the free tier off outright: it never falls
 *  back to the Node path, which the gateway refuses. */
export function opencodeRelayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env, "OPENCODE_FREE_RELAY", true);
}

/** Whether a model is served by the free tier at all. Free OpenCode chat ids are
 *  served only to the client's own handshake and prompt; muse ids keep their
 *  Responses transport and a paid or Go id needs no free tier. */
export function freeTierModel(input: {
  provider: string;
  wireModel: string;
  freeModel: boolean;
}): boolean {
  return input.provider === "opencode" && input.freeModel && !input.wireModel.startsWith("muse-");
}

/** What a free-tier request reports when the relay cannot carry it. There is no
 *  other route: the gateway refuses every handshake but OpenCode's own. */
export function freeTierRelayError(reason: "disabled" | "missing"): Error {
  return new Error(
    reason === "disabled"
      ? "OpenCode free models are switched off by OPENCODE_FREE_RELAY."
      : "OpenCode free models need a Bun runtime, because the gateway serves them only to OpenCode's own TLS handshake. Install Bun or point OPENCODE_RELAY_BUN at it.",
  );
}

/** The gateway serves free models only to a signed-in account, so an absent
 *  credential is a failure, never a keyless attempt. */
export function freeTierCredentialError(): Error {
  return new Error(
    "OpenCode free models are served only to a signed-in OpenCode account. Sign in from Settings > OpenCode, or use the OpenCode desktop app on this machine so its account can be reused.",
  );
}

let child: ChildProcess | undefined;
let starting: Promise<OpencodeRelay | null> | undefined;

/** The Bun a relay spawn would use, and where that choice came from. */
export interface BunCommand {
  command: string;
  source: "env" | "install" | "path";
}

/** Where the installers put Bun. Each entry reads its root out of the environment
 *  so a test can point the search at a scratch tree. */
const BUN_INSTALLS: ReadonlyArray<(env: NodeJS.ProcessEnv, name: string) => string | undefined> = [
  (env, name) => (env.USERPROFILE ? join(env.USERPROFILE, ".bun", "bin", name) : undefined),
  (env, name) => (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "bun", name) : undefined),
  (env, name) => (env.USERPROFILE ? join(env.USERPROFILE, "scoop", "shims", name) : undefined),
  (env, name) => (env.ProgramData ? join(env.ProgramData, "chocolatey", "bin", name) : undefined),
  (env, name) => (env.HOME ? join(env.HOME, ".bun", "bin", name) : undefined),
  (env, name) => (env.HOME ? join(env.HOME, ".local", "bin", name) : undefined),
];

/** Resolves the runtime without spawning it, so a failure report can name the
 *  exact command it tried. The official installer's directory is the common case
 *  and is not on PATH in every shell, which is why it is searched directly. */
export function bunCommand(env: NodeJS.ProcessEnv = process.env): BunCommand {
  const configured = env.OPENCODE_RELAY_BUN?.trim();
  if (configured) return { command: configured, source: "env" };
  const name = process.platform === "win32" ? "bun.exe" : "bun";
  for (const install of BUN_INSTALLS) {
    const path = install(env, name);
    if (path && existsSync(path)) return { command: path, source: "install" };
  }
  // Nothing installed: let the spawn resolve the name through PATH.
  return { command: name, source: "path" };
}
function relaySpawn(env: NodeJS.ProcessEnv): { command: string; args: string[] } {
  return { command: bunCommand(env).command, args: ["-e", RELAY_PROGRAM] };
}

function firstPort(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    let buffer = "";
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    const settle = (port: number | undefined) => {
      clearTimeout(timer);
      stream.off("data", onData);
      resolve(port);
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as { port?: unknown };
        settle(typeof parsed.port === "number" ? parsed.port : undefined);
      } catch {
        settle(undefined);
      }
    };
    stream.on("data", onData);
  });
}

async function start(env: NodeJS.ProcessEnv): Promise<OpencodeRelay | null> {
  const { command, args } = relaySpawn(env);
  let spawned: ChildProcess;
  try {
    spawned = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env });
  } catch (error) {
    log.verbose(`relay unavailable: ${String(error)}`);
    return null;
  }
  if (!spawned.stdout) return null;

  const failed = new Promise<undefined>((resolve) => {
    spawned.once("error", () => resolve(undefined));
    spawned.once("exit", () => resolve(undefined));
  });
  const port = await Promise.race([firstPort(spawned.stdout, 5_000), failed]);
  if (port === undefined) {
    spawned.kill();
    log.verbose(`relay did not start (${command})`);
    return null;
  }
  child = spawned;
  spawned.once("exit", () => {
    if (child === spawned) child = undefined;
    starting = undefined;
  });
  process.once("exit", () => spawned.kill());
  log.verbose(`relay listening on 127.0.0.1:${port}`);
  return { origin: `http://127.0.0.1:${port}` };
}

/** The loopback relay, started once per process. Undefined when no Bun runtime
 *  is installed, which leaves the client on its ordinary path. */
export function opencodeRelay(env: NodeJS.ProcessEnv = process.env): Promise<OpencodeRelay | null> {
  starting ??= start(env).then((relay) => {
    // A missing runtime is worth retrying later: the user may install Bun.
    if (!relay) starting = undefined;
    return relay;
  });
  return starting;
}

export function stopOpencodeRelay(): void {
  child?.kill();
  child = undefined;
  starting = undefined;
}
