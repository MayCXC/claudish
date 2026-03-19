/**
 * Provider Registry for Local LLM Providers
 *
 * Supports Ollama and other OpenAI-compatible local providers.
 * Extensible via configuration - no code changes needed to add new providers.
 *
 * New syntax: provider@model[:concurrency]
 * Legacy syntax: prefix/model or prefix:model (with deprecation warnings)
 */

import { parseModelSpec, isLocalProviderName, type ParsedModel } from "./model-parser.js";
import { BUILTIN_PROVIDERS } from "./provider-definitions.js";

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

// ---- Provider profiles (handler construction) ----
// Co-located here for PR 2 which unifies local + remote resolution with handler construction.

import { PROFILE_REGISTRY, type ProviderProfile, type ProfileContext } from "./provider-profiles.js";
import type { ModelHandler } from "../handlers/types.js";

export type { ProviderProfile, ProfileContext };

/** Map provider name -> profile for handler construction. Derived from BUILTIN_PROVIDERS.profile. */
export const PROVIDER_PROFILES: Record<string, ProviderProfile> = Object.fromEntries(
  BUILTIN_PROVIDERS
    .filter(p => p.profile && PROFILE_REGISTRY[p.profile])
    .map(p => [p.name, PROFILE_REGISTRY[p.profile!]])
);

/** Create a ModelHandler for a resolved provider. */
export function createHandlerForProvider(ctx: ProfileContext): ModelHandler | null {
  const profile = PROVIDER_PROFILES[ctx.provider.name];
  if (!profile) return null;
  return profile.createHandler(ctx);
}
