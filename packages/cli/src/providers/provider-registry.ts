/**
 * Provider Registry for Local LLM Providers
 *
 * Supports Ollama and other OpenAI-compatible local providers.
 * Extensible via configuration - no code changes needed to add new providers.
 *
 * New syntax: provider@model[:concurrency]
 * Legacy syntax: prefix/model or prefix:model (with deprecation warnings)
 */

import { parseModelSpec, type ParsedModel } from "./model-parser.js";
import { isLocalProviderName, BUILTIN_PROVIDERS, getProviderByName, type ProviderDefinition } from "./provider-definitions.js";

export interface LocalProvider {
  name: string;
  baseUrl: string;
  apiPath: string;
  envVar: string;
  prefixes: string[];
}

export interface ResolvedProvider {
  provider: LocalProvider;
  modelName: string;
  concurrency?: number;
  isLegacySyntax?: boolean;
}

export interface UrlParsedModel {
  baseUrl: string;
  modelName: string;
}

// Local provider env var defaults (not in BUILTIN_PROVIDERS since they're runtime)
const LOCAL_DEFAULTS: Record<string, { baseUrlEnvVars: string[]; defaultUrl: string }> = {
  ollama: { baseUrlEnvVars: ["OLLAMA_HOST", "OLLAMA_BASE_URL"], defaultUrl: "http://localhost:11434" },
  lmstudio: { baseUrlEnvVars: ["LMSTUDIO_BASE_URL"], defaultUrl: "http://localhost:1234" },
  vllm: { baseUrlEnvVars: ["VLLM_BASE_URL"], defaultUrl: "http://localhost:8000" },
  mlx: { baseUrlEnvVars: ["MLX_BASE_URL"], defaultUrl: "http://127.0.0.1:8080" },
};

// Derived from BUILTIN_PROVIDERS
const getProviders = (): LocalProvider[] =>
  BUILTIN_PROVIDERS
    .filter(p => p.type === "local")
    .map(p => {
      const defaults = LOCAL_DEFAULTS[p.name];
      const baseUrl = defaults?.baseUrlEnvVars
        .map(v => process.env[v])
        .find(Boolean) ?? defaults?.defaultUrl ?? "";
      return {
        name: p.name,
        baseUrl,
        apiPath: "/v1/chat/completions",
        envVar: defaults?.baseUrlEnvVars[defaults.baseUrlEnvVars.length - 1] ?? "",
        prefixes: p.legacyPrefixes,
      };
    });

/**
 * Get all registered providers (refreshes env vars on each call)
 */
export function getRegisteredProviders(): LocalProvider[] {
  return getProviders();
}

/**
 * Resolve a model ID to a local provider
 *
 * Supports both new syntax (provider@model) and legacy syntax (prefix/model)
 */
export function resolveProvider(modelId: string): ResolvedProvider | null {
  const providers = getProviders();

  // Try new model parser first
  const parsed = parseModelSpec(modelId);

  // Check if parsed provider is a local provider
  if (isLocalProviderName(parsed.provider)) {
    const provider = providers.find((p) => p.name.toLowerCase() === parsed.provider.toLowerCase());

    if (provider) {
      return {
        provider,
        modelName: parsed.model,
        concurrency: parsed.concurrency,
        isLegacySyntax: parsed.isLegacySyntax,
      };
    }
  }

  // Legacy: check prefix patterns for backwards compatibility
  for (const provider of providers) {
    for (const prefix of provider.prefixes) {
      if (modelId.startsWith(prefix)) {
        // Check for concurrency suffix
        let modelName = modelId.slice(prefix.length);
        let concurrency: number | undefined;

        const concurrencyMatch = modelName.match(/^(.+):(\d+)$/);
        if (concurrencyMatch) {
          modelName = concurrencyMatch[1];
          concurrency = parseInt(concurrencyMatch[2], 10);
        }

        return {
          provider,
          modelName,
          concurrency,
          isLegacySyntax: true,
        };
      }
    }
  }

  return null;
}

/**
 * Check if a model ID matches any local provider pattern
 */
export function isLocalProvider(modelId: string): boolean {
  // Try model parser first
  const parsed = parseModelSpec(modelId);
  if (isLocalProviderName(parsed.provider)) {
    return true;
  }

  // Check legacy prefix patterns
  if (resolveProvider(modelId) !== null) {
    return true;
  }

  // Check URL patterns
  if (parseUrlModel(modelId) !== null) {
    return true;
  }

  return false;
}

/**
 * Parse a URL-style model specification
 * Supports: http://localhost:11434/modelname or http://host:port/v1/modelname
 */
export function parseUrlModel(modelId: string): UrlParsedModel | null {
  // Check for http:// or https:// prefix
  if (!modelId.startsWith("http://") && !modelId.startsWith("https://")) {
    return null;
  }

  try {
    const url = new URL(modelId);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      return null;
    }

    // Model name is the last path segment
    const modelName = pathParts[pathParts.length - 1];

    // Base URL is everything except the model name
    // Handle cases like /v1/modelname or just /modelname
    let basePath = "";
    if (pathParts.length > 1) {
      // Check if second-to-last is "v1" or similar API version
      const prefix = pathParts.slice(0, -1).join("/");
      if (prefix) basePath = "/" + prefix;
    }

    const baseUrl = `${url.protocol}//${url.host}${basePath}`;

    return {
      baseUrl,
      modelName,
    };
  } catch {
    return null;
  }
}

/**
 * Create an ad-hoc provider config for URL-based models
 */
export function createUrlProvider(parsed: UrlParsedModel): LocalProvider {
  return {
    name: "custom-url",
    baseUrl: parsed.baseUrl,
    apiPath: "/v1/chat/completions",
    envVar: "",
    prefixes: [],
  };
}

// ---- Handler construction (transport + adapter from definition) ----

import type { ModelHandler } from "../handlers/types.js";
import type { ComposedHandlerOptions } from "../handlers/composed-handler.js";

export interface ProfileContext {
  provider: RemoteProvider;
  modelName: string;
  apiKey: string;
  targetModel: string;
  port: number;
  sharedOpts: Pick<ComposedHandlerOptions, "isInteractive" | "invocationMode">;
}

export interface ProviderProfile {
  createHandler(ctx: ProfileContext): ModelHandler | null;
}
import type { ProviderTransport } from "./transport/types.js";
import { BaseModelAdapter, DefaultAdapter } from "../adapters/base-adapter.js";
import { ComposedHandler } from "../handlers/composed-handler.js";
import { GeminiApiKeyProvider } from "./transport/gemini-apikey.js";
import { GeminiCodeAssistProvider } from "./transport/gemini-codeassist.js";
import { GeminiAdapter } from "../adapters/gemini-adapter.js";
import { OpenAIProvider } from "./transport/openai.js";
import { OpenAIAdapter } from "../adapters/openai-adapter.js";
import { AnthropicCompatProvider } from "./transport/anthropic-compat.js";
import { AnthropicPassthroughAdapter } from "../adapters/anthropic-passthrough-adapter.js";
import { OllamaCloudProvider } from "./transport/ollamacloud.js";
import { OllamaCloudAdapter } from "../adapters/ollamacloud-adapter.js";
import { LiteLLMProvider } from "./transport/litellm.js";
import { LiteLLMAdapter } from "../adapters/litellm-adapter.js";
import { VertexOAuthProvider, parseVertexModel } from "./transport/vertex-oauth.js";
import { getVertexConfig, validateVertexOAuthConfig } from "../auth/vertex-auth.js";
import { GrokAdapter } from "../adapters/grok-adapter.js";
import { CodexAdapter } from "../adapters/codex-adapter.js";
import { QwenAdapter } from "../adapters/qwen-adapter.js";
import { MiniMaxAdapter } from "../adapters/minimax-adapter.js";
import { DeepSeekAdapter } from "../adapters/deepseek-adapter.js";
import { GLMAdapter } from "../adapters/glm-adapter.js";
import { OpenRouterProvider } from "./transport/openrouter.js";
import { OpenRouterAdapter } from "../adapters/openrouter-adapter.js";
import { LocalTransport } from "./transport/local.js";
import { LocalModelAdapter } from "../adapters/local-adapter.js";
import { log, logStderr } from "../logger.js";

export type { ProfileContext, ProviderProfile };

/**
 * Resolve the correct model-specific adapter for a given model ID.
 * Iterates registered adapters in priority order; the first whose
 * shouldHandle() returns true wins. Falls back to DefaultAdapter.
 */
export function resolveModelAdapter(modelId: string): BaseModelAdapter {
  // Priority order matters: CodexAdapter must come before OpenAIAdapter
  const adapters: BaseModelAdapter[] = [
    new GrokAdapter(modelId),
    new GeminiAdapter(modelId),
    new CodexAdapter(modelId),
    new OpenAIAdapter(modelId),
    new QwenAdapter(modelId),
    new MiniMaxAdapter(modelId),
    new DeepSeekAdapter(modelId),
    new GLMAdapter(modelId),
  ];

  for (const adapter of adapters) {
    if (adapter.shouldHandle(modelId)) {
      return adapter;
    }
  }
  return new DefaultAdapter(modelId);
}

/** Resolve transport instance from definition. */
function resolveTransport(
  def: ProviderDefinition, provider: RemoteProvider, modelName: string, apiKey: string,
): ProviderTransport | null {
  if (!def.transport) return null;

  switch (def.transport) {
    case "gemini":       return new GeminiApiKeyProvider(provider, modelName, apiKey);
    case "gemini-oauth": return new GeminiCodeAssistProvider(modelName);
    case "openai":       return new OpenAIProvider(provider, modelName, apiKey);
    case "anthropic":    return new AnthropicCompatProvider(provider, apiKey);
    case "ollamacloud":  return new OllamaCloudProvider(provider, apiKey);
    case "litellm":
      if (!provider.baseUrl) { logStderr("Error: LITELLM_BASE_URL is required."); return null; }
      return new LiteLLMProvider(provider.baseUrl, apiKey, modelName);
    case "vertex": {
      if (process.env.VERTEX_API_KEY) {
        const gemini = getRegisteredRemoteProviders().find(p => p.name === "google");
        return new GeminiApiKeyProvider(gemini || provider, modelName, process.env.VERTEX_API_KEY);
      }
      const cfg = getVertexConfig();
      if (!cfg) { logStderr("Error: VERTEX_PROJECT or VERTEX_API_KEY required."); return null; }
      const err = validateVertexOAuthConfig();
      if (err) { logStderr(`[Proxy] Vertex OAuth: ${err}`); return null; }
      return new VertexOAuthProvider(cfg, parseVertexModel(modelName));
    }
    default: return null;
  }
}

/** Construct the format adapter for a given definition. */
function resolveFormatAdapter(
  def: ProviderDefinition, provider: RemoteProvider, modelName: string,
): BaseModelAdapter | null {
  if (!def.transport) return null;

  switch (def.transport) {
    case "gemini":
    case "gemini-oauth":  return new GeminiAdapter(modelName);
    case "openai":        return new OpenAIAdapter(modelName);
    case "anthropic":     return new AnthropicPassthroughAdapter(modelName, provider.name);
    case "ollamacloud":   return new OllamaCloudAdapter(modelName);
    case "litellm":       return provider.baseUrl ? new LiteLLMAdapter(modelName, provider.baseUrl) : null;
    case "vertex": {
      const parsed = parseVertexModel(modelName);
      if (parsed.publisher === "google") return new GeminiAdapter(modelName);
      if (parsed.publisher === "anthropic") return new AnthropicPassthroughAdapter(parsed.model, "vertex");
      const id = parsed.publisher === "mistralai" ? parsed.model : `${parsed.publisher}/${parsed.model}`;
      return new DefaultAdapter(id);
    }
    default: return null;
  }
}

/**
 * Create a ModelHandler for a resolved provider.
 * Constructs transport + adapter from the definition's transport field.
 */
export function createHandlerForProvider(ctx: ProfileContext): ModelHandler | null {
  let def = getProviderByName(ctx.provider.name);
  if (!def?.transport) return null;

  // Zen minimax models swap to dedicated minimax definitions (anthropic transport + /v1/messages)
  if (def.name === "opencode-zen" && ctx.modelName.toLowerCase().includes("minimax")) {
    def = getProviderByName("opencode-zen-minimax")!;
  } else if (def.name === "opencode-zen-go" && ctx.modelName.toLowerCase().includes("minimax")) {
    def = getProviderByName("opencode-zen-go-minimax")!;
  }

  const apiKey = ctx.apiKey || (def.name.startsWith("opencode-zen") ? "public" : "");

  // Build provider with swapped definition's baseUrl/apiPath
  const provider: RemoteProvider = { ...ctx.provider, baseUrl: def.baseUrl, apiPath: def.apiPath };
  const t = resolveTransport(def, provider, ctx.modelName, apiKey);
  if (!t) return null;

  const a = resolveFormatAdapter(def, provider, ctx.modelName);
  if (!a) return null;

  const handler = new ComposedHandler(t, ctx.targetModel, ctx.modelName, ctx.port, {
    adapter: a,
    modelAdapter: resolveModelAdapter(ctx.modelName),
    ...ctx.sharedOpts,
  });
  log(`[Proxy] Created ${def.displayName} handler (${def.transport}): ${ctx.modelName}`);
  return handler;
}

/** Create a handler for an OpenRouter model. */
export function createOpenRouterHandler(
  modelId: string, apiKey: string, port: number,
  opts: Pick<ComposedHandlerOptions, "isInteractive" | "invocationMode">,
): ModelHandler {
  const ma = resolveModelAdapter(modelId);
  const transport = new OpenRouterProvider(apiKey);
  const adapter = new OpenRouterAdapter(modelId, ma);
  return new ComposedHandler(transport, modelId, modelId, port, { adapter, modelAdapter: ma, ...opts });
}

/** Create a handler for a resolved local provider. */
export function createLocalHandler(
  resolved: ResolvedProvider, port: number,
  opts: Pick<ComposedHandlerOptions, "isInteractive" | "invocationMode" | "summarizeTools">,
): ModelHandler {
  const ma = resolveModelAdapter(resolved.modelName);
  const transport = new LocalTransport(resolved.provider, resolved.modelName, {
    concurrency: resolved.concurrency,
  });
  const adapter = new LocalModelAdapter(resolved.modelName, resolved.provider.name, ma);
  return new ComposedHandler(transport, resolved.modelName, resolved.modelName, port, {
    adapter, modelAdapter: ma, tokenStrategy: "local", ...opts,
  });
}

/** Create a handler for a URL-based local model. */
export function createUrlLocalHandler(
  urlParsed: UrlParsedModel, port: number,
  opts: Pick<ComposedHandlerOptions, "isInteractive" | "invocationMode" | "summarizeTools">,
): ModelHandler {
  const ma = resolveModelAdapter(urlParsed.modelName);
  const providerConfig = createUrlProvider(urlParsed);
  const transport = new LocalTransport(providerConfig, urlParsed.modelName);
  const adapter = new LocalModelAdapter(urlParsed.modelName, providerConfig.name, ma);
  return new ComposedHandler(transport, urlParsed.modelName, urlParsed.modelName, port, {
    adapter, modelAdapter: ma, tokenStrategy: "local", ...opts,
  });
}

// Backwards compatibility: PROVIDER_PROFILES for tests that check table completeness
export const PROVIDER_PROFILES: Record<string, ProviderProfile> = Object.fromEntries(
  BUILTIN_PROVIDERS
    .filter(p => p.transport)
    .map(p => [p.name, { createHandler: createHandlerForProvider }])
);

// ---- Remote provider resolution (merged from remote-provider-registry.ts) ----

import type {
  RemoteProvider,
  ResolvedRemoteProvider,
} from "../handlers/shared/remote-provider-types.js";
import { getRemoteProviders, API_KEY_INFO } from "./provider-definitions.js";

export function resolveRemoteProvider(modelId: string): ResolvedRemoteProvider | null {
  const providers = getRemoteProviders() as RemoteProvider[];
  const parsed = parseModelSpec(modelId);

  if (isLocalProviderName(parsed.provider)) return null;
  if (parsed.provider === "custom-url") return null;

  const provider = providers.find((p) => p.name === parsed.provider);
  if (provider) {
    return { provider, modelName: parsed.model, isLegacySyntax: parsed.isLegacySyntax };
  }

  for (const provider of providers) {
    for (const prefix of provider.prefixes) {
      if (modelId.startsWith(prefix)) {
        return { provider, modelName: modelId.slice(prefix.length), isLegacySyntax: true };
      }
    }
  }

  return null;
}

export function hasRemoteProviderPrefix(modelId: string): boolean {
  return resolveRemoteProvider(modelId) !== null;
}

export function getRemoteProviderType(modelId: string): string | null {
  return resolveRemoteProvider(modelId)?.provider.name || null;
}

export function validateRemoteProviderApiKey(provider: RemoteProvider): string | null {
  if (provider.apiKeyEnvVar === "") return null;
  if (process.env[provider.apiKeyEnvVar]) return null;

  const info = API_KEY_INFO[provider.name];
  const example = info
    ? `export ${provider.apiKeyEnvVar}='your-key' (get from ${info.url})`
    : `export ${provider.apiKeyEnvVar}='your-key'`;
  return `Missing ${provider.apiKeyEnvVar} environment variable.\n\nSet it with:\n  ${example}`;
}

export function getRegisteredRemoteProviders(): RemoteProvider[] {
  return getRemoteProviders() as RemoteProvider[];
}
