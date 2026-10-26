# Claude Code bridge (local testing only)

Lets a Polynet running on your own computer answer community-agent turns
(agent chat, Workflow "Ask the agent" steps, goal reviews, memory) with your
own Claude Code login instead of a paid API key.

Live Polynet does not use this. There the engine is OpenAI (today's default)
or OpenRouter, picked with `POLYNET_COMMUNITY_INFERENCE_PROVIDER`.

## How it works

Polynet's agent loop is unchanged: it builds the prompt, offers its tools,
and runs whichever tool the model picks. Only the "ask the model" step is
switched. With `claude_code_local`, that step goes to this bridge on
`127.0.0.1:8791`, which runs `claude -p` headless with every built-in Claude
Code tool switched off and returns an OpenAI-style answer. Polynet refuses
any bridge address that is not on the same computer.

The bridge removes `ANTHROPIC_API_KEY` from what it passes to `claude`, so it
always uses your Claude Code login and never bills an API key.

## Run it

1. Make sure `claude` works in a terminal and you're logged in (`claude`, then `/login`).
2. Pick a secret, for example `node -e "console.log(crypto.randomUUID())"`.
3. Start the bridge:

   ```powershell
   $env:POLYNET_CLAUDE_CODE_BRIDGE_TOKEN = "<secret>"
   node scripts/claude-code-bridge/bridge.mjs
   ```

   Check it: `curl http://127.0.0.1:8791/health`.
   If Windows can't find `claude`, set `$env:CLAUDE_BIN` to the full path of `claude.exe`.

4. Point the local Convex backend at it:

   ```powershell
   npx convex env set POLYNET_COMMUNITY_INFERENCE_PROVIDER claude_code_local
   npx convex env set POLYNET_CLAUDE_CODE_BRIDGE_TOKEN <secret>
   # Community agent runs are metered per community. Locally the meter only
   # needs numbers; nothing is charged.
   npx convex env set POLYNET_LUNA_INPUT_COST_MICROS_PER_MILLION_TOKENS 1
   npx convex env set POLYNET_LUNA_OUTPUT_COST_MICROS_PER_MILLION_TOKENS 1
   npx convex env set POLYNET_FOUNDER_MAX_RUN_RESERVATION_COST_MICROS 1000
   ```

5. Settings → Agent shows **AI engine: Claude Code on this computer**.

Optional: `POLYNET_COMMUNITY_INFERENCE_MODEL` (default `sonnet`; `opus`,
`haiku` work too), `POLYNET_CLAUDE_CODE_MAX_PARALLEL` (default 2).

## Moving to OpenRouter (live)

```
POLYNET_COMMUNITY_INFERENCE_PROVIDER=openrouter
OPENROUTER_API_KEY=<key>
POLYNET_COMMUNITY_INFERENCE_MODEL=anthropic/claude-sonnet-4.6   # any OpenRouter model ref
```

Runs keep the same per-community receipts. Set the `POLYNET_LUNA_*` prices to
the chosen OpenRouter model's prices so the meter matches what OpenRouter bills.
