import { query } from "./_generated/server";
import type { FounderProviderRequestUsage } from "../shared/founderInference";
import { runOpenAiNativeToolCompletion } from "./openAiNativeToolCompletion";
import { runOpenRouterNativeToolCompletion } from "./openRouterNativeTransport";

// Which engine answers for community agents (the community-funded runs).
// - openai (default, unchanged): the OpenAI Responses API with OPENAI_API_KEY.
// - openrouter: OpenRouter chat completions with OPENROUTER_API_KEY and
//   POLYNET_COMMUNITY_INFERENCE_MODEL (an OpenRouter model ref).
// - claude_code_local: a bridge on the same machine that answers with the
//   owner's own Claude Code login. Local testing only: it refuses any bridge
//   address that is not on this machine.
export type CommunityInferenceProvider = "openai" | "openrouter" | "claude_code_local";

export const DEFAULT_OPENROUTER_COMMUNITY_MODEL = "anthropic/claude-sonnet-4.6";
export const DEFAULT_CLAUDE_CODE_BRIDGE_URL = "http://127.0.0.1:8791";
const DEFAULT_CLAUDE_CODE_MODEL = "sonnet";

type ResponsesTool = Parameters<typeof runOpenAiNativeToolCompletion>[0]["tools"][number];
type CompletionInput = Parameters<typeof runOpenAiNativeToolCompletion>[0];
type CompletionResult = Awaited<ReturnType<typeof runOpenAiNativeToolCompletion>>;

function readEnv(name: string): string {
  try {
    const value = (globalThis as any)?.process?.env?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // ignore
  }
  return "";
}

export function readCommunityInferenceProvider(): CommunityInferenceProvider {
  const raw = readEnv("POLYNET_COMMUNITY_INFERENCE_PROVIDER").toLowerCase();
  if (raw === "openrouter") return "openrouter";
  if (raw === "claude_code_local" || raw === "claude-code-local") return "claude_code_local";
  return "openai";
}

export function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export type CommunityInferenceEngine = {
  provider: CommunityInferenceProvider;
  label: string;
  model: string;
  ready: boolean;
  problem: string | null;
  testOnly: boolean;
};

export function describeCommunityInferenceEngine(): CommunityInferenceEngine {
  const provider = readCommunityInferenceProvider();
  if (provider === "openrouter") {
    const ready = Boolean(readEnv("OPENROUTER_API_KEY"));
    return {
      provider,
      label: "OpenRouter",
      model: readEnv("POLYNET_COMMUNITY_INFERENCE_MODEL") || DEFAULT_OPENROUTER_COMMUNITY_MODEL,
      ready,
      problem: ready ? null : "OPENROUTER_API_KEY is not set.",
      testOnly: false,
    };
  }
  if (provider === "claude_code_local") {
    const url = readEnv("POLYNET_CLAUDE_CODE_BRIDGE_URL") || DEFAULT_CLAUDE_CODE_BRIDGE_URL;
    const local = isLoopbackUrl(url);
    const token = Boolean(readEnv("POLYNET_CLAUDE_CODE_BRIDGE_TOKEN"));
    return {
      provider,
      label: "Claude Code on this computer",
      model: readEnv("POLYNET_COMMUNITY_INFERENCE_MODEL") || DEFAULT_CLAUDE_CODE_MODEL,
      ready: local && token,
      problem: !local
        ? "The Claude Code bridge must run on this computer."
        : token ? null : "POLYNET_CLAUDE_CODE_BRIDGE_TOKEN is not set.",
      testOnly: true,
    };
  }
  const ready = Boolean(readEnv("OPENAI_API_KEY"));
  return {
    provider,
    label: "OpenAI",
    model: "",
    ready,
    problem: ready ? null : "OPENAI_API_KEY is not set.",
    testOnly: false,
  };
}

export function toChatCompletionTools(tools: ResponsesTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
    },
  }));
}

// The community-funded runs keep request receipts per provider call. Calls on
// another engine are recorded under the funded model id so the receipt and its
// pricing stay one ledger; the engine's own model is in the engine status.
function withFundedReceipt(
  result: CompletionResult,
  modelId: string,
  requestId: string,
): CompletionResult {
  if (result.promptTokens == null || result.completionTokens == null) return result;
  const providerRequestUsage: FounderProviderRequestUsage = {
    requestId,
    modelId,
    serviceTier: "default",
    promptTokens: Math.max(0, Math.floor(Number(result.promptTokens))),
    completionTokens: Math.max(0, Math.floor(Number(result.completionTokens))),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
  };
  return { ...result, providerRequestUsage } as CompletionResult;
}

// One entry point for community-funded completions. With no provider set this
// is exactly the OpenAI path that ran before.
export async function runCommunityFundedCompletion(input: CompletionInput): Promise<CompletionResult> {
  const engine = describeCommunityInferenceEngine();
  if (engine.provider === "openai") return await runOpenAiNativeToolCompletion(input);
  if (!engine.ready) {
    return {
      ok: false,
      status: 503,
      code: "provider_inference_misconfigured",
      message: engine.problem ?? "The community AI engine is not set up.",
    };
  }

  const bridgeUrl = readEnv("POLYNET_CLAUDE_CODE_BRIDGE_URL") || DEFAULT_CLAUDE_CODE_BRIDGE_URL;
  let responseId = "";
  const result = await runOpenRouterNativeToolCompletion({
    modelRef: engine.model,
    messages: input.messages,
    maxTokens: input.maxTokens,
    tools: toChatCompletionTools(input.tools),
    parallelToolCalls: input.parallelToolCalls,
    toolChoice: input.toolChoice,
    signal: input.signal,
    apiKeyOverride: engine.provider === "claude_code_local"
      ? readEnv("POLYNET_CLAUDE_CODE_BRIDGE_TOKEN")
      : readEnv("OPENROUTER_API_KEY"),
    endpointUrl: engine.provider === "claude_code_local"
      ? `${bridgeUrl.replace(/\/+$/, "")}/v1/chat/completions`
      : undefined,
    onResponseId: (id) => { responseId = id; },
  });
  if (result.ok && result.type === "assistant" && input.onTextDelta && result.assistantText) {
    input.onTextDelta(result.assistantText);
  }
  const requestId = responseId || `${engine.provider}:${crypto.randomUUID()}`;
  return withFundedReceipt(result as CompletionResult, input.modelId, requestId);
}

// Shown to owners in Settings so they can see which engine answers for their
// community. Holds no secrets.
export const getCommunityInferenceEngine = query({
  args: {},
  handler: async (ctx): Promise<CommunityInferenceEngine | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return describeCommunityInferenceEngine();
  },
});
