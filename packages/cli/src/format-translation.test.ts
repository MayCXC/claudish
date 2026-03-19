/**
 * Format Translation Integration Tests
 *
 * Tests the SSE stream parser pipeline by replaying real (or seed) SSE fixtures
 * through the parser stack and asserting correct Claude SSE output.
 *
 * Workflow for adding regression tests from production failures:
 *   1. Run failing model with --debug: claudish --model kimi-k2.5 --debug ...
 *   2. Extract fixtures: bun run src/test-fixtures/extract-sse-from-log.ts logs/claudish_*.log
 *   3. Add a describe() block below referencing the new fixture
 *   4. Run: bun test src/format-translation.test.ts
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Test Helpers ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "test-fixtures", "sse-responses");

/** Parsed Claude SSE event */
interface ClaudeEvent {
  event: string;
  data: any;
}

/**
 * Read an SSE fixture file and return as a Response with streaming body.
 * This simulates the HTTP response from a provider API.
 */
function fixtureToResponse(fixturePath: string): Response {
  const content = readFileSync(fixturePath, "utf-8");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send all SSE lines as a single chunk (simulates buffered response)
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Consume a Claude SSE ReadableStream and parse into structured events.
 * This is the assertion helper — it reads what the parser emits.
 */
async function parseClaudeSseStream(response: Response): Promise<ClaudeEvent[]> {
  const events: ClaudeEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n").filter((l) => l.trim());
      let eventType = "";
      let dataStr = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          dataStr += line.slice(6);
        }
      }

      if (dataStr && dataStr !== "[DONE]") {
        try {
          events.push({ event: eventType, data: JSON.parse(dataStr) });
        } catch {
          // Skip unparseable events
        }
      }
    }
  }

  return events;
}

/** Extract all text content from parsed Claude events */
function extractText(events: ClaudeEvent[]): string {
  return events
    .filter(
      (e) => e.data?.type === "content_block_delta" && e.data?.delta?.type === "text_delta"
    )
    .map((e) => e.data.delta.text)
    .join("");
}

/** Extract tool_use block names from parsed Claude events */
function extractToolNames(events: ClaudeEvent[]): string[] {
  return events
    .filter(
      (e) =>
        e.data?.type === "content_block_start" && e.data?.content_block?.type === "tool_use"
    )
    .map((e) => e.data.content_block.name);
}

/** Extract stop_reason from message_delta event */
function extractStopReason(events: ClaudeEvent[]): string | null {
  const delta = events.find((e) => e.data?.type === "message_delta");
  return delta?.data?.delta?.stop_reason || null;
}

/** Create a minimal mock Hono context for stream parsers */
function createMockContext(): any {
  let capturedBody: ReadableStream | null = null;
  let capturedInit: any = null;

  return {
    body(stream: ReadableStream, init?: any) {
      capturedBody = stream;
      capturedInit = init;
      return new Response(stream, init);
    },
    getCapturedResponse() {
      return capturedBody
        ? new Response(capturedBody, capturedInit)
        : null;
    },
  };
}

// ─── OpenAI SSE Parser Tests ────────────────────────────────────────────────

describe("OpenAI SSE → Claude SSE (createStreamingResponseHandler)", () => {
  // Dynamic import to avoid circular dependency issues at module level
  async function getParser() {
    const mod = await import("./handlers/shared/openai-compat.js");
    return mod.createStreamingResponseHandler;
  }

  async function getDefaultAdapter() {
    const mod = await import("./adapters/base-adapter.js");
    return new mod.DefaultAdapter("test-model");
  }

  test("SEED: text-only response produces text events and stop_reason=end_turn", async () => {
    const createStreamingResponseHandler = await getParser();
    const adapter = await getDefaultAdapter();
    const fixture = fixtureToResponse(join(FIXTURES_DIR, "SEED-openai-text-only.sse"));
    const ctx = createMockContext();

    const response = createStreamingResponseHandler(
      ctx,
      fixture,
      adapter,
      "test-model",
      null, // no middleware
      undefined, // no token callback
      undefined // no tool schemas
    );

    const events = await parseClaudeSseStream(response);

    // Should have message_start
    expect(events.some((e) => e.data?.type === "message_start")).toBe(true);

    // Should have text content
    const text = extractText(events);
    expect(text).toContain("Hello");
    expect(text).toContain("test model");

    // Should have no tool calls
    expect(extractToolNames(events)).toHaveLength(0);

    // Should end with end_turn (not tool_use)
    expect(extractStopReason(events)).toBe("end_turn");

    // Should have message_stop
    expect(events.some((e) => e.data?.type === "message_stop")).toBe(true);
  });

  test("SEED: tool-call response produces tool_use blocks and stop_reason=tool_use", async () => {
    const createStreamingResponseHandler = await getParser();
    const adapter = await getDefaultAdapter();
    const fixture = fixtureToResponse(join(FIXTURES_DIR, "SEED-openai-tool-call.sse"));
    const ctx = createMockContext();

    const response = createStreamingResponseHandler(
      ctx,
      fixture,
      adapter,
      "test-model",
      null,
      undefined,
      undefined
    );

    const events = await parseClaudeSseStream(response);

    // Should have text before tool call
    const text = extractText(events);
    expect(text).toContain("read that file");

    // Should have a Read tool call
    const tools = extractToolNames(events);
    expect(tools).toContain("Read");

    // Should end with tool_use
    expect(extractStopReason(events)).toBe("tool_use");
  });
});

// ─── Anthropic SSE Parser Tests ─────────────────────────────────────────────

describe("Anthropic SSE Passthrough (createAnthropicPassthroughStream)", () => {
  async function getParser() {
    const mod = await import("./handlers/shared/stream-parsers/anthropic-sse.js");
    return mod.createAnthropicPassthroughStream;
  }

  test("SEED: text-only Anthropic response passes through text events", async () => {
    const createAnthropicPassthroughStream = await getParser();
    const fixture = fixtureToResponse(join(FIXTURES_DIR, "SEED-anthropic-text-only.sse"));
    const ctx = createMockContext();

    let tokenInput = 0;
    let tokenOutput = 0;

    const response = createAnthropicPassthroughStream(ctx, fixture, {
      modelName: "test-model",
      onTokenUpdate: (input, output) => {
        tokenInput = input;
        tokenOutput = output;
      },
    });

    const events = await parseClaudeSseStream(response);

    // Should have text content passed through
    const text = extractText(events);
    expect(text).toContain("Hello from");
    expect(text).toContain("Anthropic format");

    // Should have message_start with usage
    const msgStart = events.find((e) => e.data?.type === "message_start");
    expect(msgStart).toBeDefined();
    expect(msgStart?.data?.message?.usage?.input_tokens).toBe(50);

    // Should have stop_reason=end_turn
    const msgDelta = events.find((e) => e.data?.type === "message_delta");
    expect(msgDelta?.data?.delta?.stop_reason).toBe("end_turn");

    // Token callback should have been called
    expect(tokenInput).toBe(50);
    expect(tokenOutput).toBe(5);
  });
});

// ─── Adapter Message Conversion Tests ───────────────────────────────────────

describe("Adapter: convertMessagesToOpenAI", () => {
  async function getConverter() {
    const mod = await import("./handlers/shared/openai-compat.js");
    return mod.convertMessagesToOpenAI;
  }

  test("converts system prompt to system message", async () => {
    const convert = await getConverter();
    const req = {
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
    };

    const messages = convert(req, "test-model");
    expect(messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  test("converts assistant tool_use to OpenAI tool_calls format", async () => {
    const convert = await getConverter();
    const req = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me read that." },
            {
              type: "tool_use",
              id: "call_123",
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
            },
          ],
        },
      ],
    };

    const messages = convert(req, "test-model");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toBe("Let me read that.");
    expect(messages[0].tool_calls).toHaveLength(1);
    expect(messages[0].tool_calls[0].function.name).toBe("Read");
  });

  test("converts user tool_result to OpenAI tool message", async () => {
    const convert = await getConverter();
    const req = {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_123", content: "file contents here" },
          ],
        },
      ],
    };

    const messages = convert(req, "test-model");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("tool");
    expect(messages[0].tool_call_id).toBe("call_123");
    expect(messages[0].content).toBe("file contents here");
  });
});

describe("Adapter: AnthropicPassthroughAdapter", () => {
  async function getAdapter() {
    const mod = await import("./adapters/anthropic-passthrough-adapter.js");
    return mod.AnthropicPassthroughAdapter;
  }

  test("passes messages through without OpenAI conversion", async () => {
    const AnthropicPassthroughAdapter = await getAdapter();
    const adapter = new AnthropicPassthroughAdapter("test-model", "minimax");

    const claudeRequest = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there" }],
        },
      ],
    };

    const messages = adapter.convertMessages(claudeRequest);
    // Should be the same messages (not converted to OpenAI format)
    expect(messages).toHaveLength(2);
    expect(messages[0].content[0].type).toBe("text");
    expect(messages[0].content[0].text).toBe("Hello");
  });

  test("strips tool_reference content types", async () => {
    const AnthropicPassthroughAdapter = await getAdapter();
    const adapter = new AnthropicPassthroughAdapter("test-model", "kimi");

    const claudeRequest = {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: [
              { type: "text", text: "result" },
              { type: "tool_reference", tool_use_id: "t0" },
            ]},
          ],
        },
      ],
    };

    const messages = adapter.convertMessages(claudeRequest);
    // tool_reference should be stripped from tool_result content
    const toolResult = messages[0].content[0];
    expect(toolResult.content).toHaveLength(1);
    expect(toolResult.content[0].type).toBe("text");
  });

  test("builds Anthropic-format payload (not OpenAI)", async () => {
    const AnthropicPassthroughAdapter = await getAdapter();
    const adapter = new AnthropicPassthroughAdapter("minimax-m2.5", "minimax");

    const claudeRequest = {
      model: "claude-3-opus",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 4096,
      system: "Be helpful.",
      tools: [{ name: "Read", input_schema: {} }],
    };

    const messages = adapter.convertMessages(claudeRequest);
    const tools = adapter.convertTools(claudeRequest);
    const payload = adapter.buildPayload(claudeRequest, messages, tools);

    // Model should be overridden to target
    expect(payload.model).toBe("minimax-m2.5");
    expect(payload.stream).toBe(true);
    expect(payload.max_tokens).toBe(4096);
    expect(payload.system).toBe("Be helpful.");
    // Tools should be Claude format (not OpenAI function format)
    expect(payload.tools[0].name).toBe("Read");
    // Should NOT have messages in OpenAI format
    expect(payload.messages).toBeDefined();
  });
});

// ─── Model Adapter Quirks Tests ─────────────────────────────────────────────

describe("Model Adapter Quirks", () => {
  test("MiniMaxAdapter: thinking → reasoning_split", async () => {
    const { MiniMaxAdapter } = await import("./adapters/minimax-adapter.js");
    const adapter = new MiniMaxAdapter("minimax-m2.5");

    const request: any = { model: "minimax-m2.5", messages: [] };
    const original = { thinking: { budget_tokens: 10000 } };

    adapter.prepareRequest(request, original);
    expect(request.reasoning_split).toBe(true);
    expect(request.thinking).toBeUndefined();
  });

  test("OpenAIAdapter: thinking → reasoning_effort for o3", async () => {
    const { OpenAIAdapter } = await import("./adapters/openai-adapter.js");
    const adapter = new OpenAIAdapter("o3-mini");

    const request: any = { model: "o3-mini", messages: [] };
    const original = { thinking: { budget_tokens: 32000 } };

    adapter.prepareRequest(request, original);
    expect(request.reasoning_effort).toBe("high");
    expect(request.thinking).toBeUndefined();
  });

  test("GLMAdapter: strips thinking params", async () => {
    const { GLMAdapter } = await import("./adapters/glm-adapter.js");
    const adapter = new GLMAdapter("glm-5");

    const request: any = { model: "glm-5", messages: [], thinking: { budget_tokens: 10000 } };
    const original = { thinking: { budget_tokens: 10000 } };

    adapter.prepareRequest(request, original);
    expect(request.thinking).toBeUndefined();
  });

  test("AdapterManager selects correct adapter for model IDs", async () => {
    const { AdapterManager } = await import("./adapters/adapter-manager.js");

    expect(new AdapterManager("glm-5").getAdapter().getName()).toBe("GLMAdapter");
    expect(new AdapterManager("grok-3").getAdapter().getName()).toBe("GrokAdapter");
    expect(new AdapterManager("minimax-m2.5").getAdapter().getName()).toBe("MiniMaxAdapter");
    expect(new AdapterManager("qwen3.5-plus").getAdapter().getName()).toBe("QwenAdapter");
    expect(new AdapterManager("deepseek-r1").getAdapter().getName()).toBe("DeepSeekAdapter");
    expect(new AdapterManager("unknown-model").getAdapter().getName()).toBe("DefaultAdapter");
  });
});

// ─── FormatConverter: getStreamFormat() Tests ────────────────────────────────

describe("FormatConverter: getStreamFormat()", () => {
  test("DefaultAdapter returns openai-sse", async () => {
    const { DefaultAdapter } = await import("./adapters/base-adapter.js");
    expect(new DefaultAdapter("test").getStreamFormat()).toBe("openai-sse");
  });

  test("AnthropicPassthroughAdapter returns anthropic-sse", async () => {
    const { AnthropicPassthroughAdapter } = await import(
      "./adapters/anthropic-passthrough-adapter.js"
    );
    expect(new AnthropicPassthroughAdapter("test", "minimax").getStreamFormat()).toBe(
      "anthropic-sse"
    );
  });

  test("GeminiAdapter returns gemini-sse", async () => {
    const { GeminiAdapter } = await import("./adapters/gemini-adapter.js");
    expect(new GeminiAdapter("gemini-2.0-flash").getStreamFormat()).toBe("gemini-sse");
  });

  test("OllamaCloudAdapter returns ollama-jsonl", async () => {
    const { OllamaCloudAdapter } = await import("./adapters/ollamacloud-adapter.js");
    expect(new OllamaCloudAdapter("llama3.2").getStreamFormat()).toBe("ollama-jsonl");
  });

  test("OpenAIAdapter returns openai-sse for GPT models", async () => {
    const { OpenAIAdapter } = await import("./adapters/openai-adapter.js");
    expect(new OpenAIAdapter("gpt-5.4").getStreamFormat()).toBe("openai-sse");
  });

  test("CodexAdapter returns openai-responses-sse", async () => {
    const { CodexAdapter } = await import("./adapters/codex-adapter.js");
    expect(new CodexAdapter("codex-mini").getStreamFormat()).toBe("openai-responses-sse");
  });

  test("GLMAdapter inherits openai-sse (uses OpenAI-compat API)", async () => {
    const { GLMAdapter } = await import("./adapters/glm-adapter.js");
    expect(new GLMAdapter("glm-5").getStreamFormat()).toBe("openai-sse");
  });
});

describe("CodexAdapter", () => {
  test("shouldHandle returns true for codex models", async () => {
    const { CodexAdapter } = await import("./adapters/codex-adapter.js");
    expect(new CodexAdapter("codex-mini").shouldHandle("codex-mini")).toBe(true);
    expect(new CodexAdapter("codex-mini").shouldHandle("codex-davinci-002")).toBe(true);
  });

  test("shouldHandle returns false for non-codex models", async () => {
    const { CodexAdapter } = await import("./adapters/codex-adapter.js");
    expect(new CodexAdapter("gpt-5.4").shouldHandle("gpt-5.4")).toBe(false);
    expect(new CodexAdapter("o3").shouldHandle("o3")).toBe(false);
  });

  test("getStreamFormat returns openai-responses-sse", async () => {
    const { CodexAdapter } = await import("./adapters/codex-adapter.js");
    expect(new CodexAdapter("codex-mini").getStreamFormat()).toBe("openai-responses-sse");
  });

  test("getName returns CodexAdapter", async () => {
    const { CodexAdapter } = await import("./adapters/codex-adapter.js");
    expect(new CodexAdapter("codex-mini").getName()).toBe("CodexAdapter");
  });

  test("AdapterManager selects CodexAdapter for codex-mini", async () => {
    const { AdapterManager } = await import("./adapters/adapter-manager.js");
    expect(new AdapterManager("codex-mini").getAdapter().getName()).toBe("CodexAdapter");
  });
});

describe("ModelTranslator interface compliance", () => {
  test("GLMAdapter implements translator methods", async () => {
    const { GLMAdapter } = await import("./adapters/glm-adapter.js");
    const t = new GLMAdapter("glm-5");
    expect(typeof t.getContextWindow()).toBe("number");
    expect(typeof t.supportsVision()).toBe("boolean");
    expect(typeof t.prepareRequest).toBe("function");
    expect(typeof t.shouldHandle).toBe("function");
    expect(typeof t.getName).toBe("function");
  });
});

// ─── ProviderProfile Table Tests ─────────────────────────────────────────────

describe("ProviderProfile table completeness", () => {
  test("all expected providers are registered", async () => {
    const { PROVIDER_PROFILES } = await import("./providers/provider-registry.js");

    const expectedProviders = [
      "google", "gemini-codeassist", "openai",
      "minimax", "minimax-coding", "kimi", "kimi-coding", "zai",
      "glm", "glm-coding",
      "opencode-zen", "opencode-zen-go",
      "ollamacloud", "litellm", "vertex",
    ];

    for (const provider of expectedProviders) {
      expect(PROVIDER_PROFILES).toHaveProperty(provider);
    }
  });

  test("each profile has a createHandler function", async () => {
    const { PROVIDER_PROFILES } = await import("./providers/provider-registry.js");

    for (const [name, profile] of Object.entries(PROVIDER_PROFILES)) {
      expect(typeof profile.createHandler).toBe("function");
    }
  });
});

// ─── Regression: Production Fixture Tests ───────────────────────────────────
//
// Add new describe() blocks here when extracting fixtures from production logs.
// Each block references a fixture file extracted by extract-sse-from-log.ts.
//
// Template:
//
// describe("Regression: <model> - <issue description>", () => {
//   test("text content reaches output", async () => {
//     const parser = (await import("./handlers/shared/openai-compat.js")).createStreamingResponseHandler;
//     const adapter = new (await import("./adapters/base-adapter.js")).DefaultAdapter("<model>");
//     const fixture = fixtureToResponse(join(FIXTURES_DIR, "<model>-openai-turn1.sse"));
//     const ctx = createMockContext();
//     const response = parser(ctx, fixture, adapter, "<model>", null);
//     const events = await parseClaudeSseStream(response);
//     expect(extractText(events).length).toBeGreaterThan(0);
//   });
// });
