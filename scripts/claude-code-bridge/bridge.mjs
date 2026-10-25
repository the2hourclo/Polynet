#!/usr/bin/env node
// Claude Code bridge: lets a LOCAL Polynet answer community-agent turns with the
// owner's own Claude Code login, for testing on their own computer.
//
// It serves one OpenAI-compatible route, POST /v1/chat/completions, on
// 127.0.0.1 only, and answers each request by running `claude -p` headless with
// every built-in tool switched off. Polynet's own agent loop still runs the
// tools; Claude only decides what to say or which tool to call next.
//
// Not for live use: the live app runs on OpenRouter. Never point real members
// at this bridge.
//
//   POLYNET_CLAUDE_CODE_BRIDGE_TOKEN=<secret> node scripts/claude-code-bridge/bridge.mjs
//
// Env:
//   POLYNET_CLAUDE_CODE_BRIDGE_TOKEN  required; Polynet sends it as a bearer token
//   POLYNET_CLAUDE_CODE_BRIDGE_PORT   default 8791
//   POLYNET_CLAUDE_CODE_MODEL         default "sonnet" (a request's model wins)
//   POLYNET_CLAUDE_CODE_MAX_PARALLEL  default 2
//   CLAUDE_BIN                        path to the claude command (default "claude")

import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 8791;
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// Polynet model ids that mean "whatever the bridge runs".
const CLAUDE_MODEL_ALIASES = new Set(["sonnet", "opus", "haiku", "fable"]);

export function pickClaudeModel(requested, fallback = "sonnet") {
  const value = String(requested ?? "").trim();
  if (CLAUDE_MODEL_ALIASES.has(value) || value.startsWith("claude-")) return value;
  return fallback;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return String(part.text ?? "");
      if (part?.type === "image_url") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolCatalog(tools) {
  return tools
    .map((tool) => {
      const fn = tool?.function ?? {};
      return [
        `### ${fn.name}`,
        String(fn.description ?? "").trim(),
        "Arguments (JSON Schema):",
        JSON.stringify(fn.parameters ?? {}, null, 0),
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

// Turns an OpenAI chat request into one headless Claude Code call.
export function buildClaudeCall(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const choice = body?.tool_choice;
  const allTools = Array.isArray(body?.tools) ? body.tools.filter((t) => t?.function?.name) : [];
  const forcedName = choice && typeof choice === "object" ? choice.function?.name : null;
  const tools = choice === "none"
    ? []
    : forcedName ? allTools.filter((t) => t.function.name === forcedName) : allTools;
  const toolNames = tools.map((t) => t.function.name);

  const systemParts = messages.filter((m) => m?.role === "system").map((m) => textOf(m.content).trim()).filter(Boolean);
  const protocol = [
    "You are the assistant inside a community app. The conversation so far is in the user turn below.",
    "Answer ONLY through the structured output.",
    "Put what you say to the person in `reply`.",
  ];
  if (toolNames.length) {
    protocol.push(
      "You can use the app tools listed below. To use one, add it to `tool_calls` with its `name` and `arguments`; the app runs it and shows you the result in the next turn. Leave `reply` empty when you only call a tool.",
      "Never claim a tool ran or invent its result. Call at most one tool per turn unless the tools are independent.",
      forcedName ? `You must call the tool \`${forcedName}\` now.` : "Call a tool only when it helps; otherwise answer and leave `tool_calls` empty.",
      "",
      "## App tools",
      toolCatalog(tools),
    );
  }
  const systemPrompt = [...systemParts, "", "## How to answer", ...protocol].join("\n").trim();

  const transcript = [];
  for (const message of messages) {
    const role = message?.role;
    if (role === "system") continue;
    if (role === "user") transcript.push(`## Person\n${textOf(message.content)}`);
    else if (role === "assistant") {
      const said = textOf(message.content).trim();
      if (said) transcript.push(`## You (assistant)\n${said}`);
      for (const call of message.tool_calls ?? []) {
        transcript.push(`## You called tool \`${call?.function?.name}\` (call ${call?.id})\n${call?.function?.arguments ?? "{}"}`);
      }
    } else if (role === "tool") {
      transcript.push(`## Result of tool call ${message.tool_call_id}\n${textOf(message.content)}`);
    }
  }
  transcript.push("## Your turn\nReply now as the assistant.");

  const schema = toolNames.length
    ? {
        type: "object",
        properties: {
          reply: { type: "string" },
          tool_calls: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string", enum: toolNames }, arguments: { type: "object" } },
              required: ["name", "arguments"],
            },
          },
        },
        required: ["reply", "tool_calls"],
      }
    : { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] };

  return { systemPrompt, prompt: transcript.join("\n\n"), schema, toolNames, parallel: body?.parallel_tool_calls === true };
}

// Turns `claude -p --output-format json` output into an OpenAI chat completion.
export function toChatCompletion(cliJson, call, model) {
  if (!cliJson || cliJson.is_error) {
    const message = String(cliJson?.result ?? "Claude Code returned an error.");
    const error = new Error(message);
    error.status = /login|auth|credential/i.test(message) ? 401 : /limit|quota/i.test(message) ? 429 : 502;
    throw error;
  }
  let out = cliJson.structured_output;
  if (!out && typeof cliJson.result === "string") {
    try { out = JSON.parse(cliJson.result); } catch { out = { reply: cliJson.result }; }
  }
  const reply = String(out?.reply ?? "").trim();
  let calls = Array.isArray(out?.tool_calls)
    ? out.tool_calls.filter((c) => call.toolNames.includes(c?.name))
    : [];
  if (!call.parallel) calls = calls.slice(0, 1);
  const usage = cliJson.usage ?? {};
  const promptTokens = Number(usage.input_tokens ?? 0)
    + Number(usage.cache_read_input_tokens ?? 0)
    + Number(usage.cache_creation_input_tokens ?? 0);
  return {
    id: `ccb_${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: reply || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
              })),
            }
          : {}),
      },
      finish_reason: calls.length ? "tool_calls" : "stop",
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: Number(usage.output_tokens ?? 0) },
  };
}

function runClaude({ bin, model, call }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Use the Claude Code login on this computer, never a paid API key.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const args = [
      "-p",
      "--output-format", "json",
      "--model", model,
      "--system-prompt", call.systemPrompt,
      "--tools", "",
      "--json-schema", JSON.stringify(call.schema),
      "--no-session-persistence",
      "--setting-sources", "",
      "--strict-mcp-config",
    ];
    const child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error("Claude Code took too long to answer."), { status: 504 }));
    }, REQUEST_TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (error) => {
      clearTimeout(timer);
      const hint = error.code === "ENOENT"
        ? `Couldn't find the claude command (${bin}). Install Claude Code or set CLAUDE_BIN to its path.`
        : error.message;
      reject(Object.assign(new Error(hint), { status: 503 }));
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(Object.assign(new Error((stderr || stdout || "Claude Code gave no answer.").trim().slice(0, 500)), { status: 502 }));
      }
    });
    child.stdin.end(call.prompt);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function createBridgeServer({ token, defaultModel = "sonnet", maxParallel = 2, bin = "claude", run = runClaude } = {}) {
  if (!token) throw new Error("POLYNET_CLAUDE_CODE_BRIDGE_TOKEN is required.");
  let active = 0;
  const waiting = [];
  const acquire = () => new Promise((resolve) => {
    if (active < maxParallel) { active += 1; resolve(); } else waiting.push(resolve);
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else active -= 1;
  };

  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true, engine: "claude_code_local", model: defaultModel, running: active, waiting: waiting.length });
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      return sendJson(res, 404, { error: { message: "Not found" } });
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      return sendJson(res, 401, { error: { message: "Wrong bridge token." } });
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) return sendJson(res, 413, { error: { message: "Request too large." } });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { error: { message: "Invalid JSON." } }); }
    const model = pickClaudeModel(body.model, defaultModel);
    const call = buildClaudeCall(body);
    await acquire();
    const started = Date.now();
    try {
      const cliJson = await run({ bin, model, call });
      const completion = toChatCompletion(cliJson, call, model);
      const msg = completion.choices[0].message;
      console.log(`[bridge] ${model} ${Date.now() - started}ms ${msg.tool_calls ? `tool ${msg.tool_calls.map((c) => c.function.name).join(",")}` : "reply"}`);
      sendJson(res, 200, completion);
    } catch (error) {
      console.error(`[bridge] failed: ${error.message}`);
      sendJson(res, error.status ?? 502, { error: { message: error.message } });
    } finally {
      release();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.POLYNET_CLAUDE_CODE_BRIDGE_PORT || DEFAULT_PORT);
  const server = createBridgeServer({
    token: process.env.POLYNET_CLAUDE_CODE_BRIDGE_TOKEN,
    defaultModel: process.env.POLYNET_CLAUDE_CODE_MODEL || "sonnet",
    maxParallel: Number(process.env.POLYNET_CLAUDE_CODE_MAX_PARALLEL || 2),
    bin: process.env.CLAUDE_BIN || "claude",
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[bridge] Claude Code bridge on http://127.0.0.1:${port} (local testing only)`);
  });
}
