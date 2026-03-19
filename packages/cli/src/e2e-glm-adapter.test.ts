/**
 * E2E tests for GLM adapter and two-layer adapter architecture.
 *
 * Validates:
 * 1. GLMAdapter model detection, context windows, and vision support
 * 2. resolveModelAdapter correctly selects GLMAdapter for GLM models
 * 3. ComposedHandler two-layer architecture: model adapter provides model-specific
 *    overrides (context window, vision, prepareRequest) even when a provider adapter
 *    (LiteLLMAdapter, OpenRouterAdapter) is set as the explicit adapter
 */

import { describe, test, expect } from "bun:test";
import { GLMAdapter } from "./adapters/glm-adapter.js";
import { resolveModelAdapter } from "./adapters/adapter-manager.js";
import { LiteLLMAdapter } from "./adapters/litellm-adapter.js";
import { DefaultAdapter } from "./adapters/base-adapter.js";

// ─── Group 1: GLMAdapter unit tests ──────────────────────────────────────────

describe("GLMAdapter — Model Detection", () => {
  const adapter = new GLMAdapter("glm-5");

  test("should handle glm-5", () => {
    expect(adapter.shouldHandle("glm-5")).toBe(true);
  });

  test("should handle glm-4-plus", () => {
    expect(adapter.shouldHandle("glm-4-plus")).toBe(true);
  });

  test("should handle glm-4-flash", () => {
    expect(adapter.shouldHandle("glm-4-flash")).toBe(true);
  });

  test("should handle glm-4-long", () => {
    expect(adapter.shouldHandle("glm-4-long")).toBe(true);
  });

  test("should handle glm-3-turbo", () => {
    expect(adapter.shouldHandle("glm-3-turbo")).toBe(true);
  });

  test("should handle zhipu/ prefixed models", () => {
    expect(adapter.shouldHandle("zhipu/glm-5")).toBe(true);
  });

  test("should NOT handle non-GLM models", () => {
    expect(adapter.shouldHandle("gpt-4o")).toBe(false);
    expect(adapter.shouldHandle("gemini-2.0-flash")).toBe(false);
    expect(adapter.shouldHandle("deepseek-r1")).toBe(false);
    expect(adapter.shouldHandle("grok-3")).toBe(false);
  });

  test("should return correct adapter name", () => {
    expect(adapter.getName()).toBe("GLMAdapter");
  });
});

describe("GLMAdapter — Context Windows", () => {
  test("glm-5 → 200K", () => {
    expect(new GLMAdapter("glm-5").getContextWindow()).toBe(204_800);
  });

  test("glm-4-plus → 128K", () => {
    expect(new GLMAdapter("glm-4-plus").getContextWindow()).toBe(128_000);
  });

  test("glm-4-long → 1M", () => {
    expect(new GLMAdapter("glm-4-long").getContextWindow()).toBe(1_000_000);
  });

  test("glm-4-flash → 128K", () => {
    expect(new GLMAdapter("glm-4-flash").getContextWindow()).toBe(128_000);
  });

  test("unknown glm variant → 131K default (glm- catch-all)", () => {
    expect(new GLMAdapter("glm-99").getContextWindow()).toBe(131_072);
  });
});

describe("GLMAdapter — Vision Support", () => {
  test("glm-5 supports vision", () => {
    expect(new GLMAdapter("glm-5").supportsVision()).toBe(true);
  });

  test("glm-4v supports vision", () => {
    expect(new GLMAdapter("glm-4v").supportsVision()).toBe(true);
  });

  test("glm-4v-plus supports vision", () => {
    expect(new GLMAdapter("glm-4v-plus").supportsVision()).toBe(true);
  });

  test("glm-4-flash does NOT support vision", () => {
    expect(new GLMAdapter("glm-4-flash").supportsVision()).toBe(false);
  });

  test("glm-3-turbo does NOT support vision", () => {
    expect(new GLMAdapter("glm-3-turbo").supportsVision()).toBe(false);
  });
});

describe("GLMAdapter — prepareRequest", () => {
  test("strips thinking param from request", () => {
    const adapter = new GLMAdapter("glm-5");
    const request = { model: "glm-5", thinking: { budget: 10000 }, messages: [] };
    const original = { thinking: { budget: 10000 } };

    adapter.prepareRequest(request, original);

    expect(request.thinking).toBeUndefined();
  });

  test("leaves request unchanged without thinking param", () => {
    const adapter = new GLMAdapter("glm-5");
    const request = { model: "glm-5", messages: [] };
    const original = {};

    adapter.prepareRequest(request, original);

    expect(request.model).toBe("glm-5");
    expect(request.messages).toEqual([]);
  });
});

describe("GLMAdapter — processTextContent", () => {
  test("passes through text unchanged (no transformation)", () => {
    const adapter = new GLMAdapter("glm-5");
    const result = adapter.processTextContent("Hello, world!", "");

    expect(result.cleanedText).toBe("Hello, world!");
    expect(result.extractedToolCalls).toHaveLength(0);
    expect(result.wasTransformed).toBe(false);
  });
});

// ─── Group 2: resolveModelAdapter selects GLMAdapter ──────────────────────────

describe("resolveModelAdapter — GLM routing", () => {
  test("selects GLMAdapter for glm-5", () => {
    expect(resolveModelAdapter("glm-5").getName()).toBe("GLMAdapter");
  });

  test("selects GLMAdapter for glm-4-long", () => {
    expect(resolveModelAdapter("glm-4-long").getName()).toBe("GLMAdapter");
  });

  test("does NOT select GLMAdapter for gpt-4o", () => {
    expect(resolveModelAdapter("gpt-4o").getName()).not.toBe("GLMAdapter");
  });

  test("GLM model resolves to non-default adapter", () => {
    expect(resolveModelAdapter("glm-5").getName()).not.toBe("DefaultAdapter");
  });
});

// ─── Group 3: Two-layer adapter architecture ─────────────────────────────────
//
// When a provider adapter (LiteLLMAdapter) is the explicit adapter, the model
// adapter (GLMAdapter) should still be resolved by resolveModelAdapter for model-
// specific concerns.

describe("Two-layer adapter — model adapter overrides provider adapter", () => {
  test("resolveModelAdapter returns GLMAdapter even when LiteLLMAdapter would be used", () => {
    // Simulate what ComposedHandler does:
    // 1. Explicit adapter = LiteLLMAdapter (provider transport)
    // 2. resolveModelAdapter() = GLMAdapter (model quirks)
    const litellmAdapter = new LiteLLMAdapter("glm-5", "https://example.com");
    const modelAdapter = resolveModelAdapter("glm-5");

    // Provider adapter handles transport
    expect(litellmAdapter.getName()).toBe("LiteLLMAdapter");

    // Model adapter handles model-specific concerns
    expect(modelAdapter.getName()).toBe("GLMAdapter");
    expect(modelAdapter.getContextWindow()).toBe(204_800);
    expect(modelAdapter.supportsVision()).toBe(true);
  });

  test("LiteLLMAdapter returns generic defaults (model adapter should override)", () => {
    const litellmAdapter = new LiteLLMAdapter("glm-5", "https://example.com");

    // LiteLLMAdapter returns generic 200K — model adapter should win
    expect(litellmAdapter.getContextWindow()).toBe(200_000);
  });

  test("model adapter provides correct context window for glm-4-long via LiteLLM", () => {
    const modelAdapter = resolveModelAdapter("glm-4-long");

    expect(modelAdapter.getName()).toBe("GLMAdapter");
    expect(modelAdapter.getContextWindow()).toBe(1_000_000);
  });

  test("model adapter correctly reports no vision for glm-4-flash via LiteLLM", () => {
    const modelAdapter = resolveModelAdapter("glm-4-flash");

    expect(modelAdapter.getName()).toBe("GLMAdapter");
    expect(modelAdapter.supportsVision()).toBe(false);
  });

  test("non-GLM model via LiteLLM falls back to DefaultAdapter", () => {
    const modelAdapter = resolveModelAdapter("some-unknown-model");

    // Should be DefaultAdapter, not GLMAdapter
    expect(modelAdapter.getName()).toBe("DefaultAdapter");
  });

  test("model adapter strips thinking, provider adapter does not", () => {
    const litellmAdapter = new LiteLLMAdapter("glm-5", "https://example.com");
    const modelAdapter = resolveModelAdapter("glm-5");

    // Provider adapter does not strip thinking (no override)
    const request1 = { model: "glm-5", thinking: { budget: 10000 }, messages: [] };
    litellmAdapter.prepareRequest(request1, { thinking: { budget: 10000 } });
    expect(request1.thinking).toBeDefined(); // LiteLLMAdapter doesn't touch thinking

    // Model adapter strips thinking
    const request2 = { model: "glm-5", thinking: { budget: 10000 }, messages: [] };
    modelAdapter.prepareRequest(request2, { thinking: { budget: 10000 } });
    expect(request2.thinking).toBeUndefined(); // GLMAdapter strips it
  });
});
