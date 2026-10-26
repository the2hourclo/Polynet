import { afterEach, expect, test, vi } from "vitest";
import {
  describeCommunityInferenceEngine,
  isLoopbackUrl,
  runCommunityFundedCompletion,
} from "./communityInferenceProvider";
import { runOpenAiNativeToolCompletion } from "./openAiNativeToolCompletion";

vi.mock("./openAiNativeToolCompletion", () => ({ runOpenAiNativeToolCompletion: vi.fn() }));

const ENV_KEYS = [
  "POLYNET_COMMUNITY_INFERENCE_PROVIDER",
  "POLYNET_COMMUNITY_INFERENCE_MODEL",
  "POLYNET_CLAUDE_CODE_BRIDGE_URL",
  "POLYNET_CLAUDE_CODE_BRIDGE_TOKEN",
  "OPENROUTER_API_KEY",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.mocked(runOpenAiNativeToolCompletion).mockReset();
});

const input = {
  modelId: "gpt-6-luna",
  messages: [{ role: "user" as const, content: "What should I do first?" }],
  maxTokens: 500,
  tools: [{ type: "function" as const, name: "get_member_progress", description: "Read progress.", parameters: { type: "object" }, strict: false }],
};

function chatReply(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("no provider set keeps the OpenAI path exactly as before", async () => {
  delete process.env.POLYNET_COMMUNITY_INFERENCE_PROVIDER;
  vi.mocked(runOpenAiNativeToolCompletion).mockResolvedValue({
    ok: true, type: "assistant", assistantText: "hi", promptTokens: 1, completionTokens: 1, resolvedModelId: null,
  });
  const result = await runCommunityFundedCompletion(input);
  expect(runOpenAiNativeToolCompletion).toHaveBeenCalledWith(input);
  expect(result).toMatchObject({ ok: true, assistantText: "hi" });
});

test("claude_code_local calls the bridge with its token and records a funded receipt", async () => {
  process.env.POLYNET_COMMUNITY_INFERENCE_PROVIDER = "claude_code_local";
  process.env.POLYNET_CLAUDE_CODE_BRIDGE_TOKEN = "secret";
  const fetchMock = vi.fn(async () => chatReply({
    id: "ccb_1",
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", function: { name: "get_member_progress", arguments: "{}" } }] } }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await runCommunityFundedCompletion(input);

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:8791/v1/chat/completions");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  const sent = JSON.parse(String(init.body));
  expect(sent.model).toBe("sonnet");
  expect(sent.tools[0]).toMatchObject({ type: "function", function: { name: "get_member_progress" } });
  expect(result).toMatchObject({
    ok: true,
    type: "tool_call",
    toolName: "get_member_progress",
    providerRequestUsage: { requestId: "ccb_1", modelId: "gpt-6-luna", serviceTier: "default", promptTokens: 120, completionTokens: 30 },
  });
  expect(runOpenAiNativeToolCompletion).not.toHaveBeenCalled();
});

test("claude_code_local refuses a bridge that is not on this computer", async () => {
  process.env.POLYNET_COMMUNITY_INFERENCE_PROVIDER = "claude_code_local";
  process.env.POLYNET_CLAUDE_CODE_BRIDGE_TOKEN = "secret";
  process.env.POLYNET_CLAUDE_CODE_BRIDGE_URL = "https://bridge.example.com";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const result = await runCommunityFundedCompletion(input);
  expect(result).toMatchObject({ ok: false, code: "provider_inference_misconfigured" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(describeCommunityInferenceEngine()).toMatchObject({ ready: false, testOnly: true });
});

test("openrouter uses the OpenRouter endpoint, key and model, and streams the text once", async () => {
  process.env.POLYNET_COMMUNITY_INFERENCE_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.POLYNET_COMMUNITY_INFERENCE_MODEL = "anthropic/claude-sonnet-4.6";
  const fetchMock = vi.fn(async () => chatReply({
    id: "gen-1",
    choices: [{ message: { role: "assistant", content: "Start with the X-Ray." } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }));
  vi.stubGlobal("fetch", fetchMock);
  const deltas: string[] = [];
  const result = await runCommunityFundedCompletion({ ...input, onTextDelta: (d) => deltas.push(d) });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
  expect(JSON.parse(String(init.body)).model).toBe("anthropic/claude-sonnet-4.6");
  expect(deltas).toEqual(["Start with the X-Ray."]);
  expect(result).toMatchObject({ ok: true, providerRequestUsage: { requestId: "gen-1", modelId: "gpt-6-luna" } });
});

test("openrouter without a key says what is missing", async () => {
  process.env.POLYNET_COMMUNITY_INFERENCE_PROVIDER = "openrouter";
  delete process.env.OPENROUTER_API_KEY;
  expect(await runCommunityFundedCompletion(input)).toMatchObject({ ok: false, message: "OPENROUTER_API_KEY is not set." });
});

test("loopback check", () => {
  expect(isLoopbackUrl("http://127.0.0.1:8791")).toBe(true);
  expect(isLoopbackUrl("http://localhost:8791")).toBe(true);
  expect(isLoopbackUrl("http://[::1]:8791")).toBe(true);
  expect(isLoopbackUrl("http://192.168.1.4:8791")).toBe(false);
  expect(isLoopbackUrl("not a url")).toBe(false);
});
