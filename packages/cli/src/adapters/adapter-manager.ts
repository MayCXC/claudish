/**
 * Resolve the correct model-specific adapter for a given model ID.
 *
 * Iterates registered adapters in priority order; the first whose
 * shouldHandle() returns true wins. Falls back to DefaultAdapter.
 */

import { BaseModelAdapter, DefaultAdapter } from "./base-adapter";
import { GrokAdapter } from "./grok-adapter";
import { GeminiAdapter } from "./gemini-adapter";
import { CodexAdapter } from "./codex-adapter";
import { OpenAIAdapter } from "./openai-adapter";
import { QwenAdapter } from "./qwen-adapter";
import { MiniMaxAdapter } from "./minimax-adapter";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { GLMAdapter } from "./glm-adapter";

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
