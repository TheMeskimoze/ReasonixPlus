/** One record per free-tier failure: the routing decision, the required runtime,
 *  where the request went, and the gateway's own error. No credentials. */

import { recordDiagnostic } from "./diagnostics.js";
import { freePreambleEnabled } from "./opencode-free-preamble.js";
import { isOpencodeFreeModel } from "./opencode-models.js";
import { bunCommand, freeTierModel, opencodeRelayEnabled } from "./opencode-relay.js";

export interface FreeTierFailure {
  model: string;
  provider: string;
  /** The id without a provider qualifier, which is what routing judges. */
  wireModel: string;
  status: number;
  /** The endpoint the request was addressed to. */
  endpoint: string;
  /** The relay origin when the relay carried it, `null` when it did not. */
  viaTransport: string | null;
  /** The failed response body, already read by the caller. */
  body: string;
  /** Whether the outgoing payload carried the client's prompt, read off the wire. */
  preambleApplied: boolean;
  env?: NodeJS.ProcessEnv;
}

export function recordFreeTierFailure(failure: FreeTierFailure): void {
  const env = failure.env ?? process.env;
  recordDiagnostic("opencode.free_tier.failure", {
    level: "error",
    details: {
      model: failure.model,
      provider: failure.provider,
      wireModel: failure.wireModel,
      freeTier: freeTierModel({
        provider: failure.provider,
        wireModel: failure.wireModel,
        freeModel: isOpencodeFreeModel(failure.wireModel),
      }),
      relayEnabled: opencodeRelayEnabled(env),
      preambleEnabled: freePreambleEnabled(env),
      preambleApplied: failure.preambleApplied,
      relayRuntime: bunCommand(env),
      status: failure.status,
      endpoint: failure.endpoint,
      viaTransport: failure.viaTransport,
      gatewayError: gatewayErrorOf(failure.body),
    },
  });
}

/** The gateway's error identity. The body also echoes request content, so only
 *  the type and a bounded message survive. */
function gatewayErrorOf(body: string): { type: string; message: string } | null {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown; message?: unknown } };
    if (!parsed.error) return null;
    return {
      type: typeof parsed.error.type === "string" ? parsed.error.type : "",
      message: typeof parsed.error.message === "string" ? parsed.error.message.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}
