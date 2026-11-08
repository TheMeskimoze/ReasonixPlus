import {
  type ProviderAuthStrategy,
  type ProviderTransportStrategy,
  providerSpec,
  stripProviderQualifier,
} from "@reasonix/core-utils";
import { resolveGeminiAuth } from "./antigravity-oauth.js";
import { DeepSeekClient, type DeepSeekClientOptions, type ResolvedTransport } from "./client.js";
import { resolveCodexTransport } from "./codex-backend.js";
import {
  DEFAULT_MIMO_CHAT_URL,
  DEFAULT_OPENCODE_CHAT_URL,
  DEFAULT_ZAI_RESPONSES_URL,
  isOpenAIStandardEndpoint,
  loadEndpointForModel,
  loadMimoProtocol,
  loadOpencodeApiKey,
  providerForModel,
} from "./config.js";
import { resolveOpenAIToken } from "./oauth.js";
import { opencodeAppCredential } from "./opencode-app-credential.js";
import { opencodeSessionId } from "./opencode-free-session.js";
import { isOpencodeFreeModel } from "./opencode-models.js";
import { resolveOpencodeToken } from "./opencode-oauth.js";
import {
  freeTierCredentialError,
  freeTierModel,
  freeTierRelayError,
  opencodeRelay,
  opencodeRelayEnabled,
} from "./opencode-relay.js";
import { opencodeOAuthSession } from "./opencode-session.js";

export interface ResolvedModelClientOptions {
  model: string;
  configPath?: string;
  sessionId?: string;
}

interface AuthContext {
  configPath?: string;
  /** Model id as the endpoint sees it (routing qualifier stripped). */
  wireModel: string;
  /** The model resolves to the provider's own default endpoint, not a proxy. */
  standardEndpoint: boolean;
}

interface TransportContext extends AuthContext {
  endpoint: { baseUrl?: string; apiKey?: string };
}

type AuthResolver = DeepSeekClientOptions["apiKeyResolver"];
type TransportResolver = DeepSeekClientOptions["transportResolver"];

/** Per-request key resolvers, keyed by the `client.auth` strategy in providers.json.
 *  Exhaustive over the strategy union, so a new strategy is a compile error here. */
const AUTH_RESOLVERS: Readonly<
  Record<ProviderAuthStrategy, (ctx: AuthContext) => AuthResolver | undefined>
> = {
  "api-key": () => undefined,
  // OAuth tokens are audience-locked to the provider's own host, so a proxy
  // keeps its static key and no resolver is installed.
  "openai-oauth": (ctx) =>
    ctx.standardEndpoint ? () => resolveOpenAIToken(ctx.configPath) : undefined,
  opencode: (ctx) => async () => {
    // Go / Go+ inference authenticates with the workspace service key (`oc_sk…`).
    // A Console OAuth session token is a different credential and the Go/Zen
    // gateways 401 it, so it is only a fallback when no service key is configured.
    const serviceKey = loadOpencodeApiKey(ctx.configPath);
    if (serviceKey) return serviceKey;
    const session = await resolveOpencodeToken();
    if (session) return session;
    return freeModelAccount(ctx.wireModel);
  },
  // Gemini authenticates through `geminiAuthResolver`, never a bearer key.
  "gemini-oauth": () => undefined,
};

/** Per-request transports, keyed by the `client.transport` strategy in providers.json. */
const TRANSPORT_RESOLVERS: Readonly<
  Record<ProviderTransportStrategy, (ctx: TransportContext) => TransportResolver | undefined>
> = {
  codex: (ctx) => (ctx.standardEndpoint ? () => resolveCodexTransport() : undefined),
  // GLM Coding Plan keys are served in the Responses wire format; the
  // chat-completions paths 401 them (client.ts swaps back when a key rejects it).
  "zai-responses": (ctx) => async () => ({
    endpoint: `${DEFAULT_ZAI_RESPONSES_URL}/responses`,
    headers: { Authorization: `Bearer ${ctx.endpoint.apiKey ?? ""}` },
    api: "responses" as const,
  }),
  // MiMo speaks both wires; MIMO_API_PROTOCOL picks the Responses one.
  "mimo-responses": (ctx) =>
    loadMimoProtocol() === "responses"
      ? async () => ({
          endpoint: `${ctx.endpoint.baseUrl ?? DEFAULT_MIMO_CHAT_URL}/responses`,
          headers: { Authorization: `Bearer ${ctx.endpoint.apiKey ?? ""}` },
          api: "responses" as const,
        })
      : undefined,
  // Muse contributor ids are served on the Responses wire with the Console
  // session token, not the static API key.
  "opencode-muse-responses": (ctx) =>
    ctx.wireModel.startsWith("muse-")
      ? async () => ({
          endpoint: `${ctx.endpoint.baseUrl ?? DEFAULT_OPENCODE_CHAT_URL}/responses`,
          headers: {
            Authorization: `Bearer ${
              (await resolveOpencodeToken()) ?? ctx.endpoint.apiKey ?? "public"
            }`,
          },
          api: "responses" as const,
        })
      : undefined,
};

/** Build endpoint-aware client options shared by primary and subagent runtimes. */
export function modelClientOptions(opts: ResolvedModelClientOptions): DeepSeekClientOptions {
  const provider = providerForModel(opts.model, opts.configPath);
  const spec = providerSpec(provider);
  const endpoint = loadEndpointForModel(opts.model, opts.configPath);
  const ctx: TransportContext = {
    configPath: opts.configPath,
    standardEndpoint: isOpenAIStandardEndpoint(opts.model, opts.configPath),
    endpoint,
    wireModel: stripProviderQualifier(opts.model),
  };
  const authResolver = spec ? AUTH_RESOLVERS[spec.client.auth](ctx) : undefined;
  const declaredTransport = spec?.client.transport
    ? TRANSPORT_RESOLVERS[spec.client.transport](ctx)
    : undefined;

  return {
    apiKey: endpoint.apiKey,
    baseUrl: endpoint.baseUrl,
    sessionId: opts.sessionId,
    allowMissingKey: spec?.client.allowMissingKey ?? true,
    apiKeyResolver: authResolver,
    // Only a Console session needs its organization id on the request.
    opencodeOrgResolver:
      spec?.client.auth === "opencode" ? () => opencodeOAuthSession()?.orgId : undefined,
    transportResolver: freeTierTransport({
      provider,
      wireModel: ctx.wireModel,
      declaredTransport,
      sessionId: opts.sessionId,
    }),
    geminiAuthResolver:
      spec?.client.auth === "gemini-oauth" ? () => resolveGeminiAuth(opts.configPath) : undefined,
  };
}

/** Free models refuse keyless traffic, so their only credential sources are the
 *  harness's own sign-in, the OpenCode app's account, then an explicit failure. */
function freeModelAccount(wireModel: string): string | undefined {
  if (!isOpencodeFreeModel(wireModel)) return undefined;
  const app = opencodeAppCredential();
  if (app) return app.access;
  throw freeTierCredentialError();
}

/** Free calls must name a session in the gateway's own id shape, or they 429. */
export function freeTierSessionHeaders(sessionId: string | undefined): Record<string, string> {
  const session = opencodeSessionId(sessionId);
  return {
    "x-opencode-session": session,
    "x-opencode-session-id": session,
    "x-session-affinity": session,
    "x-session-id": session,
    "x-opencode-client": "cli",
  };
}

/** Free OpenCode models only work through the relay; without it the request fails. */
export function freeTierTransport(input: {
  provider: ReturnType<typeof providerForModel>;
  wireModel: string;
  declaredTransport: (() => Promise<ResolvedTransport | null>) | undefined;
  sessionId?: string;
  env?: NodeJS.ProcessEnv;
}): (() => Promise<ResolvedTransport | null>) | undefined {
  const eligible = freeTierModel({
    provider: input.provider,
    wireModel: input.wireModel,
    freeModel: isOpencodeFreeModel(input.wireModel),
  });
  if (!eligible) return input.declaredTransport;
  const env = input.env ?? process.env;
  // One id per client, so repeated turns keep the gateway's prompt cache warm.
  const headers = freeTierSessionHeaders(input.sessionId);
  return async () => {
    if (!opencodeRelayEnabled(env)) throw freeTierRelayError("disabled");
    const relay = await opencodeRelay(env);
    if (!relay) throw freeTierRelayError("missing");
    return {
      endpoint: `${relay.origin}/inference/openai/v1/chat/completions`,
      headers,
      keepAuth: true,
    };
  };
}

/** Construct a client using the canonical endpoint, auth, and transport policy. */
export function createModelClient(opts: ResolvedModelClientOptions): DeepSeekClient {
  return new DeepSeekClient(modelClientOptions(opts));
}
