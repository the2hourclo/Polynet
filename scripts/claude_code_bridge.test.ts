import { afterEach, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
// @ts-expect-error plain .mjs script
import { buildClaudeCall, createBridgeServer, pickClaudeModel, toChatCompletion } from "./claude-code-bridge/bridge.mjs";

const tools = [{ type: "function", function: { name: "get_member_progress", description: "Read progress.", parameters: { type: "object" } } }];
let server: any = null;
afterEach(() => server?.close());

test("builds one headless call with the tools described and a constrained schema", () => {
  const call = buildClaudeCall({
    messages: [
      { role: "system", content: "You guide members." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "get_member_progress", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{\"lessons_done\":0}" },
    ],
    tools,
  });
  expect(call.systemPrompt).toContain("You guide members.");
  expect(call.systemPrompt).toContain("### get_member_progress");
  expect(call.prompt).toContain("## Result of tool call c1");
  expect(call.schema.properties.tool_calls.items.properties.name.enum).toEqual(["get_member_progress"]);
  expect(buildClaudeCall({ messages: [], tools, tool_choice: "none" }).toolNames).toEqual([]);
});

test("maps Claude Code output to an OpenAI chat completion and drops unknown tools", () => {
  const call = buildClaudeCall({ messages: [{ role: "user", content: "Hi" }], tools });
  const out = toChatCompletion({
    is_error: false,
    structured_output: { reply: "", tool_calls: [{ name: "get_member_progress", arguments: {} }, { name: "rm_rf", arguments: {} }] },
    usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 7 },
  }, call, "sonnet");
  expect(out.choices[0].message.tool_calls).toHaveLength(1);
  expect(out.choices[0].message.tool_calls[0].function.name).toBe("get_member_progress");
  expect(out.usage).toEqual({ prompt_tokens: 112, completion_tokens: 7 });
});

test("model ids that are not Claude fall back to the bridge default", () => {
  expect(pickClaudeModel("gpt-6-luna", "sonnet")).toBe("sonnet");
  expect(pickClaudeModel("opus")).toBe("opus");
});

test("server needs the token and answers through the runner", async () => {
  let seen: any = null;
  server = createBridgeServer({
    token: "t",
    run: async (args: any) => { seen = args; return { is_error: false, structured_output: { reply: "Welcome!", tool_calls: [] }, usage: { input_tokens: 1, output_tokens: 1 } }; },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
  const body = JSON.stringify({ model: "gpt-6-luna", messages: [{ role: "user", content: "Hi" }], tools });
  expect((await fetch(url, { method: "POST", body })).status).toBe(401);
  const res = await fetch(url, { method: "POST", body, headers: { authorization: "Bearer t" } });
  const json = await res.json();
  expect(json.choices[0].message.content).toBe("Welcome!");
  expect(seen.model).toBe("sonnet");
});
