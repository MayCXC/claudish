// Centralized provider resolution - THE single source of truth
export {
  resolveModelProvider,
  validateApiKeysForModels,
  getMissingKeyError,
  getMissingKeysError,
  getMissingKeyResolutions,
  requiresOpenRouterKey,
  isLocalModel,
  type ProviderCategory,
  type ProviderResolution,
} from "./provider-resolver.js";

// Local provider registry
export {
  resolveProvider,
  isLocalProvider,
  parseUrlModel,
  createUrlProvider,
  getRegisteredProviders,
  type LocalProvider,
  type ResolvedProvider,
  type UrlParsedModel,
} from "./provider-registry.js";

// Remote provider registry
export {
  resolveRemoteProvider,
  getRegisteredRemoteProviders,
} from "./remote-provider-registry.js";

// Provider definitions - single source of truth for all provider identity
export {
  BUILTIN_PROVIDERS,
  PROVIDER_SHORTCUTS,
  DIRECT_API_PROVIDERS,
  LOCAL_PROVIDERS,
  NATIVE_MODEL_PATTERNS,
  LEGACY_PREFIX_PATTERNS,
  API_KEY_INFO,
  LOCAL_PREFIXES,
  PROVIDER_DISPLAY_NAMES,
  getProviderByName,
  getRemoteProviders,
  isLocalProviderName,
  isDirectApiProvider,
  type ProviderDefinition,
  type ApiKeyInfo,
} from "./provider-definitions.js";

// Model parser - unified syntax for provider@model[:concurrency]
export {
  parseModelSpec,
  getLegacySyntaxWarning,
  formatModelSpec,
  type ParsedModel,
} from "./model-parser.js";

// Provider profiles - handler construction (derived from BUILTIN_PROVIDERS.profile)
// PR 2 replaces this with provider-selector.ts (selectProviderComponents pattern)
export {
  PROVIDER_PROFILES,
  createHandlerForProvider,
  type ProfileContext,
  type ProviderProfile,
} from "./provider-registry.js";
