/**
 * Provider Definitions: single source of truth for all provider identity.
 *
 * Every builtin provider is described by a ProviderDefinition. All other
 * provider constants (PROVIDER_SHORTCUTS, DIRECT_API_PROVIDERS, LOCAL_PROVIDERS,
 * getRemoteProviders, providerNameMap) are derived from this array.
 *
 * To add a new provider: add one entry here.
 */

export interface ProviderDefinition {
  /** Canonical name used by model-parser routing (e.g. "google", "openai") */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Shortcut aliases for @ syntax (e.g. ["g", "gemini"] -> google) */
  shortcuts: string[];
  /** Legacy slash-prefixes (e.g. ["g/", "gemini/"]) */
  legacyPrefixes: string[];
  /** Auto-detect provider from bare model name */
  nativeModelPatterns?: RegExp[];
  /** Base URL for the API */
  baseUrl: string;
  /** API path template */
  apiPath: string;
  /** Environment variable for the API key ("" = no key) */
  apiKeyEnvVar: string;
  /** Alternative env vars that also satisfy the key requirement */
  apiKeyAliases?: string[];
  /** Human-readable key description */
  apiKeyDescription?: string;
  /** URL where user can obtain the key */
  apiKeyUrl?: string;
  /** OAuth credential file under ~/.claudish/ to check as auth fallback */
  oauthFallback?: string;
  /** Provider type */
  type: "remote" | "local";
  /** Whether this provider supports direct API access */
  directApi?: boolean;
  /** Auth header scheme */
  authScheme?: "bearer" | "x-api-key";
  /** Extra HTTP headers */
  headers?: Record<string, string>;
  /** Transport type for handler construction. Determines which transport class
   *  and format adapter to use. Model adapter is selected independently by model name. */
  transport?: "gemini" | "gemini-oauth" | "openai" | "anthropic" | "ollamacloud" | "litellm" | "vertex";
}

export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  {
    name: "google",
    displayName: "Google Gemini",
    shortcuts: ["g", "gemini"],
    legacyPrefixes: ["g/", "gemini/"],
    baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com",
    apiPath: "/v1beta/models/{model}:streamGenerateContent?alt=sse",
    apiKeyEnvVar: "GEMINI_API_KEY",
    apiKeyDescription: "Google Gemini API Key",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    nativeModelPatterns: [/^google\//i, /^gemini-/i],
    transport: "gemini",
    type: "remote",
    directApi: true,
  },
  {
    name: "gemini-codeassist",
    displayName: "Gemini Code Assist",
    shortcuts: ["go"],
    legacyPrefixes: ["go/"],
    baseUrl: "https://cloudcode-pa.googleapis.com",
    apiPath: "/v1internal:streamGenerateContent?alt=sse",
    apiKeyEnvVar: "",
    apiKeyDescription: "Gemini Code Assist (OAuth)",
    apiKeyUrl: "https://cloud.google.com/code-assist",
    transport: "gemini-oauth",
    type: "remote",
    directApi: true,
  },
  {
    name: "openai",
    displayName: "OpenAI",
    shortcuts: ["oai"],
    legacyPrefixes: ["oai/"],
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com",
    apiPath: "/v1/chat/completions",
    apiKeyEnvVar: "OPENAI_API_KEY",
    apiKeyDescription: "OpenAI API Key",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    nativeModelPatterns: [/^openai\//i, /^gpt-/i, /^o1(-|$)/i, /^o3(-|$)/i, /^chatgpt-/i],
    transport: "openai",
    type: "remote",
    directApi: true,
  },
  {
    name: "openrouter",
    displayName: "OpenRouter",
    shortcuts: ["or"],
    legacyPrefixes: ["or/"],
    baseUrl: "https://openrouter.ai",
    apiPath: "/api/v1/chat/completions",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    apiKeyDescription: "OpenRouter API Key",
    apiKeyUrl: "https://openrouter.ai/keys",
    nativeModelPatterns: [/^openrouter\//i],
    type: "remote",
    headers: {
      "HTTP-Referer": "https://claudish.com",
      "X-Title": "Claudish - OpenRouter Proxy",
    },
  },
  {
    name: "minimax",
    displayName: "MiniMax",
    shortcuts: ["mm", "mmax"],
    legacyPrefixes: ["mmax/", "mm/"],
    baseUrl: process.env.MINIMAX_BASE_URL || "https://api.minimax.io",
    apiPath: "/anthropic/v1/messages",
    apiKeyEnvVar: "MINIMAX_API_KEY",
    apiKeyDescription: "MiniMax API Key",
    apiKeyUrl: "https://www.minimaxi.com/",
    nativeModelPatterns: [/^minimax\//i, /^minimax-/i, /^abab-/i],
    transport: "anthropic",
    type: "remote",
    directApi: true,
    authScheme: "bearer",
  },
  {
    name: "minimax-coding",
    displayName: "MiniMax Coding",
    shortcuts: ["mmc"],
    legacyPrefixes: ["mmc/"],
    baseUrl: process.env.MINIMAX_CODING_BASE_URL || "https://api.minimax.io",
    apiPath: "/anthropic/v1/messages",
    apiKeyEnvVar: "MINIMAX_CODING_API_KEY",
    apiKeyDescription: "MiniMax Coding Plan API Key",
    apiKeyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    transport: "anthropic",
    type: "remote",
    directApi: true,
    authScheme: "bearer",
  },
  {
    name: "kimi",
    displayName: "Kimi",
    shortcuts: ["kimi", "moon", "moonshot"],
    legacyPrefixes: ["kimi/", "moonshot/"],
    baseUrl: process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || "https://api.moonshot.ai",
    apiPath: "/anthropic/v1/messages",
    apiKeyEnvVar: "MOONSHOT_API_KEY",
    apiKeyAliases: ['KIMI_API_KEY'],
    apiKeyDescription: "Kimi/Moonshot API Key",
    apiKeyUrl: "https://platform.moonshot.cn/",
    nativeModelPatterns: [/^moonshot(ai)?\//i, /^moonshot-/i, /^kimi-/i],
    transport: "anthropic",
    type: "remote",
    directApi: true,
  },
  {
    name: "kimi-coding",
    displayName: "Kimi Coding",
    shortcuts: ["kc"],
    legacyPrefixes: ["kc/"],
    baseUrl: "https://api.kimi.com/coding/v1",
    apiPath: "/messages",
    apiKeyEnvVar: "KIMI_CODING_API_KEY",
    apiKeyDescription: "Kimi Coding API Key",
    apiKeyUrl: "https://kimi.com/code",
    oauthFallback: "kimi-oauth.json",
    transport: "anthropic",
    type: "remote",
    directApi: true,
  },
  {
    name: "glm",
    displayName: "GLM",
    shortcuts: ["glm", "zhipu"],
    legacyPrefixes: ["glm/", "zhipu/"],
    baseUrl: process.env.ZHIPU_BASE_URL || process.env.GLM_BASE_URL || "https://open.bigmodel.cn",
    apiPath: "/api/paas/v4/chat/completions",
    apiKeyEnvVar: "ZHIPU_API_KEY",
    apiKeyAliases: ['GLM_API_KEY'],
    apiKeyDescription: "GLM/Zhipu API Key",
    apiKeyUrl: "https://open.bigmodel.cn/",
    nativeModelPatterns: [/^zhipu\//i, /^glm-/i, /^chatglm-/i],
    transport: "openai",
    type: "remote",
    directApi: true,
  },
  {
    name: "glm-coding",
    displayName: "GLM Coding",
    shortcuts: ["gc"],
    legacyPrefixes: ["gc/"],
    baseUrl: "https://api.z.ai",
    apiPath: "/api/coding/paas/v4/chat/completions",
    apiKeyEnvVar: "GLM_CODING_API_KEY",
    apiKeyAliases: ['ZAI_CODING_API_KEY'],
    apiKeyDescription: "GLM Coding Plan API Key",
    apiKeyUrl: "https://z.ai/subscribe",
    transport: "openai",
    type: "remote",
    directApi: true,
  },
  {
    name: "zai",
    displayName: "Z.AI",
    shortcuts: ["zai"],
    legacyPrefixes: ["zai/"],
    baseUrl: process.env.ZAI_BASE_URL || "https://api.z.ai",
    apiPath: "/api/anthropic/v1/messages",
    apiKeyEnvVar: "ZAI_API_KEY",
    apiKeyDescription: "Z.AI API Key",
    apiKeyUrl: "https://z.ai/",
    transport: "anthropic",
    type: "remote",
    directApi: true,
  },
  {
    name: "ollamacloud",
    displayName: "OllamaCloud",
    shortcuts: ["oc", "llama", "lc", "meta"],
    legacyPrefixes: ["oc/"],
    baseUrl: process.env.OLLAMACLOUD_BASE_URL || "https://ollama.com",
    apiPath: "/api/chat",
    apiKeyEnvVar: "OLLAMA_API_KEY",
    apiKeyDescription: "OllamaCloud API Key",
    apiKeyUrl: "https://ollama.com/account",
    nativeModelPatterns: [/^ollamacloud\//i, /^meta-llama\//i, /^llama-/i, /^llama3/i],
    transport: "ollamacloud",
    type: "remote",
    directApi: true,
  },
  {
    name: "opencode-zen",
    displayName: "OpenCode Zen",
    shortcuts: ["zen"],
    legacyPrefixes: ["zen/"],
    baseUrl: process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen",
    apiPath: "/v1/chat/completions",
    apiKeyEnvVar: "OPENCODE_API_KEY",
    apiKeyDescription: "OpenCode Zen (Free)",
    apiKeyUrl: "https://opencode.ai/",
    transport: "openai",
    type: "remote",
    directApi: true,
  },
  {
    name: "opencode-zen-minimax",
    displayName: "OpenCode Zen (MiniMax)",
    shortcuts: [],
    legacyPrefixes: [],
    baseUrl: process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen",
    apiPath: "/v1/messages",
    apiKeyEnvVar: "OPENCODE_API_KEY",
    transport: "anthropic",
    type: "remote",
    directApi: true,
  },
  {
    name: "opencode-zen-go",
    displayName: "OpenCode Zen Go",
    shortcuts: ["zengo", "zgo"],
    legacyPrefixes: ["zengo/", "zgo/"],
    baseUrl: process.env.OPENCODE_BASE_URL
      ? process.env.OPENCODE_BASE_URL.replace("/zen", "/zen/go")
      : "https://opencode.ai/zen/go",
    apiPath: "/v1/chat/completions",
    apiKeyEnvVar: "OPENCODE_API_KEY",
    transport: "openai",
    type: "remote",
    directApi: true,
  },
  {
    name: "opencode-zen-go-minimax",
    displayName: "OpenCode Zen Go (MiniMax)",
    shortcuts: [],
    legacyPrefixes: [],
    baseUrl: process.env.OPENCODE_BASE_URL
      ? process.env.OPENCODE_BASE_URL.replace("/zen", "/zen/go")
      : "https://opencode.ai/zen/go",
    apiPath: "/v1/messages",
    apiKeyEnvVar: "OPENCODE_API_KEY",
    transport: "anthropic",
    type: "remote",
    directApi: true,
  },
  {
    name: "vertex",
    displayName: "Vertex AI",
    shortcuts: ["v", "vertex"],
    legacyPrefixes: ["v/", "vertex/"],
    baseUrl: "",
    apiPath: "",
    apiKeyEnvVar: "VERTEX_PROJECT",
    apiKeyAliases: ['VERTEX_PROJECT'],
    apiKeyDescription: "Vertex AI API Key",
    apiKeyUrl: "https://console.cloud.google.com/vertex-ai",
    transport: "vertex",
    type: "remote",
    directApi: true,
  },
  {
    name: "litellm",
    displayName: "LiteLLM",
    shortcuts: ["litellm", "ll"],
    legacyPrefixes: ["litellm/", "ll/"],
    baseUrl: process.env.LITELLM_BASE_URL || "",
    apiPath: "/v1/chat/completions",
    apiKeyEnvVar: "LITELLM_API_KEY",
    apiKeyDescription: "LiteLLM API Key",
    apiKeyUrl: "https://docs.litellm.ai/",
    transport: "litellm",
    type: "remote",
    directApi: true,
  },
  {
    name: "poe",
    displayName: "Poe",
    shortcuts: ["poe"],
    legacyPrefixes: [],
    baseUrl: "",
    apiPath: "",
    apiKeyEnvVar: "",
    nativeModelPatterns: [/^poe:/i],
    type: "remote",
    directApi: true,
  },
  // Local providers
  {
    name: "ollama",
    displayName: "Ollama",
    shortcuts: ["ollama"],
    legacyPrefixes: ["ollama/", "ollama:"],
    baseUrl: "",
    apiPath: "",
    apiKeyEnvVar: "",
    type: "local",
  },
  {
    name: "lmstudio",
    displayName: "LM Studio",
    shortcuts: ["lms", "lmstudio", "mlstudio"],
    legacyPrefixes: ["lmstudio/", "lmstudio:", "mlstudio/", "mlstudio:"],
    baseUrl: "",
    apiPath: "",
    apiKeyEnvVar: "",
    type: "local",
  },
  {
    name: "vllm",
    displayName: "vLLM",
    shortcuts: ["vllm"],
    legacyPrefixes: ["vllm/", "vllm:"],
    baseUrl: "",
    apiPath: "",
    apiKeyEnvVar: "",
    type: "local",
  },
  {
    name: "mlx",
    displayName: "MLX",
    shortcuts: ["mlx"],
    legacyPrefixes: ["mlx/", "mlx:"],
    baseUrl: "",
    apiPath: "",
    apiKeyEnvVar: "",
    type: "local",
  },
];

// ---- Derived constants ----

/** Map shortcut -> canonical provider name. */
export const PROVIDER_SHORTCUTS: Record<string, string> = Object.fromEntries(
  BUILTIN_PROVIDERS.flatMap(p => p.shortcuts.map(s => [s, p.name]))
);

/** Providers with direct API access. */
export const DIRECT_API_PROVIDERS = new Set(
  BUILTIN_PROVIDERS.filter(p => p.directApi).map(p => p.name)
);

/** Local providers. */
export const LOCAL_PROVIDERS = new Set(
  BUILTIN_PROVIDERS.filter(p => p.type === "local").map(p => p.name)
);

/** Legacy prefix patterns for backwards compatibility. */
export const LEGACY_PREFIX_PATTERNS: Array<{ prefix: string; provider: string; stripPrefix: boolean }> =
  BUILTIN_PROVIDERS.flatMap(p =>
    p.legacyPrefixes.map(prefix => ({ prefix, provider: p.name, stripPrefix: true }))
  );

/** Native model patterns for auto-detection. Derived from definitions + routing-only extras. */
export const NATIVE_MODEL_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  ...BUILTIN_PROVIDERS
    .filter(p => p.nativeModelPatterns)
    .flatMap(p => p.nativeModelPatterns!.map(pattern => ({ pattern, provider: p.name }))),
  { pattern: /^qwen/i, provider: "qwen" },
  { pattern: /^anthropic\//i, provider: "native-anthropic" },
  { pattern: /^claude-/i, provider: "native-anthropic" },
];

/** API key info for a provider. */
export interface ApiKeyInfo {
  envVar: string;
  description: string;
  url: string;
  aliases?: string[];
  oauthFallback?: string;
}

export const API_KEY_INFO: Record<string, ApiKeyInfo> = Object.fromEntries(
  BUILTIN_PROVIDERS
    .filter(p => p.type === "remote")
    .map(p => [p.name, {
      envVar: p.apiKeyEnvVar,
      description: p.apiKeyDescription ?? `${p.displayName} API Key`,
      url: p.apiKeyUrl ?? "",
      ...(p.apiKeyAliases ? { aliases: p.apiKeyAliases } : {}),
      ...(p.oauthFallback ? { oauthFallback: p.oauthFallback } : {}),
    }])
);

/** Local provider prefixes for quick API key skip checks. */
export const LOCAL_PREFIXES: string[] = [
  ...BUILTIN_PROVIDERS
    .filter(p => p.type === "local")
    .flatMap(p => p.legacyPrefixes),
  "http://",
  "https://localhost",
];

/** Display names for providers. */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  BUILTIN_PROVIDERS.map(p => [p.name, p.displayName])
);

/** Look up a provider definition by canonical name */
export function getProviderByName(name: string): ProviderDefinition | undefined {
  return BUILTIN_PROVIDERS.find(p => p.name === name);
}

/** Check if a provider is a local provider */
export function isLocalProviderName(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider.toLowerCase());
}

/** Check if a provider supports direct API access */
export function isDirectApiProvider(provider: string): boolean {
  return DIRECT_API_PROVIDERS.has(provider.toLowerCase());
}

/** Build RemoteProvider configs from definitions (for provider-registry). */
export function getRemoteProviders(): Array<{
  name: string; baseUrl: string; apiPath: string; apiKeyEnvVar: string;
  prefixes: string[]; authScheme?: "bearer" | "x-api-key"; headers?: Record<string, string>;
}> {
  return BUILTIN_PROVIDERS
    .filter(p => p.type === "remote")
    .map(p => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiPath: p.apiPath,
      apiKeyEnvVar: p.apiKeyEnvVar,
      prefixes: p.legacyPrefixes,
      ...(p.authScheme ? { authScheme: p.authScheme } : {}),
      ...(p.headers ? { headers: p.headers } : {}),
    }));
}

