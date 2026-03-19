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

// Provider registry (local + remote resolution + handler construction)
export {
  resolveProvider,
  isLocalProvider,
  parseUrlModel,
  createUrlProvider,
  getRegisteredProviders,
  resolveRemoteProvider,
  hasRemoteProviderPrefix,
  getRemoteProviderType,
  validateRemoteProviderApiKey,
  getRegisteredRemoteProviders,
  type LocalProvider,
  type ResolvedProvider,
  type UrlParsedModel,
} from "./provider-registry.js";

// Provider definitions - single source of truth for all provider identity
export {
  BUILTIN_PROVIDERS,
  PROVIDER_SHORTCUTS,
  DIRECT_API_PROVIDERS,
  LOCAL_PROVIDERS,
  LEGACY_PREFIX_PATTERNS,
  NATIVE_MODEL_PATTERNS,
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

// Handler construction (derived from BUILTIN_PROVIDERS.transport)
export {
  PROVIDER_PROFILES,
  createHandlerForProvider,
  type ProfileContext,
  type ProviderProfile,
} from "./provider-registry.js";
