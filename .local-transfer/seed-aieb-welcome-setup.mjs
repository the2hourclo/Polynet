// Puts "Set up your AI Employee Builder" first on the AIEB welcome page of the
// local build: a choice of app (Claude, the default, or Codex), each with its steps.
// Run from the polynet-local repo root (the convex dev deployment must be up):
//   node .local-transfer/seed-aieb-welcome-setup.mjs [community-slug]
// Safe to run again: it replaces its own screen and keeps the rest of the page.
import { execFileSync } from "node:child_process";

const slug = process.argv[2] ?? "ai-employee-builders";
// No shell: on Windows cmd strips the JSON's quotes before convex sees them.
const run = (fn, args) => JSON.parse(execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "run", fn, JSON.stringify(args)], { encoding: "utf8" }).trim());

const PROMPT = "Which app will your AI Employees run in?";
const INTRO = `**First, set up your AI Employee Builder.** It takes 10 to 20 minutes, and every step is guided.

Pick the app you use and you'll only see your steps. Stuck at any point? Type \`check my setup\` in your AI, or post in the community.`;

const CONNECT = `When the AI Employee Builder sign-in page opens, sign in with the same email you use here on Polynet. That's how it finds your membership. If it asks for a key instead, make one in **Settings → Your access** here, and paste it on that page only, never into the chat.`;

const codex = `1. **Open Codex** on the project where your AI Employees will work. New to Codex? [Open the Codex setup guide](https://developers.openai.com/codex/).
2. **Paste this into a Codex thread.** Codex adds the plugin and tells you when to open a fresh thread.

\`\`\`prompt
You are setting up AI Employee Builder in Codex for me. It uses a free thin plugin shell plus a hosted, licensed MCP server. Do as much as you can yourself, verify every step, and never ask me to paste a license key into chat.
1. Add the official AIEB plugin marketplace with:
   codex plugin marketplace add the2hourclo/aieb-thin-plugin
2. Install or update the plugin with:
   codex plugin add ai-employee-builder@aieb-thin-plugin
3. Verify that it is v0.31.0 or newer and contains \`.codex-plugin/plugin.json\`, \`skills/setup-aieb/SKILL.md\`, and \`.mcp.json\`. Its MCP entry must be remote HTTP at \`https://api.chiefleverageofficers.com/mcp\`; do not launch the legacy local proxy or require Node for the connector.
4. Tell me to start one fresh Codex thread in this same project and paste exactly: \`Set up AIEB\`
Stop after giving me that one fresh-thread instruction. The new thread connects AIEB first, then runs onboarding. It must check for saved Get Access intake before asking questions. If the four answers are already saved, it must not repeat them. If they are missing, it asks conversationally what my business sells, which recurring job I want to remove, how often it happens and how much time it takes, and what a good finished result looks like; then it calls \`complete_aieb_onboarding\` with my answers before continuing. Never request or repeat a license key in chat.
\`\`\`

3. **In a fresh Codex thread in the same project, paste:**

\`\`\`prompt
Set up AIEB
\`\`\`

4. **Connect.** ${CONNECT}

**You're done when** Codex confirms AI Employee Builder loads from its server and your workspace is saved.`;

const claude = `1. **Open the Claude app** (desktop, on a Pro, Max or Team plan). Go to **Customize → Personal plugins → + → Add marketplace**, paste this, then click **Sync**:

\`\`\`copy
the2hourclo/aieb-thin-plugin
\`\`\`

2. **Install AI Employee Builder.** Claude shows a "make sure you trust this plugin" notice for every plugin not made by Anthropic. This one is ours.
3. **Start a new chat and run:**

\`\`\`copy
/ai-employee-builder:setup-aieb
\`\`\`

4. **Connect.** If Claude shows an AIEB **Connect** button, click it. ${CONNECT}
5. **Check it.** Type \`/check-setup\`. You want three green ticks: plugin installed, connection live, membership active.

### Using Claude Code instead?

The same plugin works in Claude Code (VS Code or your terminal).

1. **Have Claude Code running.** You need a Claude plan (Pro, Max or Team), [VS Code](https://code.visualstudio.com/), and the **Claude Code** extension by Anthropic, signed in with your Claude account.
2. **Paste this into the Claude Code chat.** Claude installs the plugin, connects it and checks everything.

\`\`\`prompt
You are setting up AI Employee Builder v0.31.0 or newer in my Claude Code for me. It uses a thin plugin shell plus a hosted remote OAuth MCP server. Do as much as you can yourself, verify every step, and only hand work to me when Claude Code requires a human click or slash command.
MY SETUP: I'm in the Claude Code VS Code extension. You CANNOT type slash commands into my chat for me. When something can ONLY be done by me, give me a short numbered "do this" instruction with the exact text to paste or thing to click, then STOP and wait for me to confirm. Never ask me to paste a license key into chat.
1. THIN PLUGIN SHELL - Install or update the free AI Employee Builder shell. Try the terminal first:
   claude plugin marketplace add https://github.com/the2hourclo/aieb-thin-plugin
   claude plugin install ai-employee-builder@aieb-thin-plugin --scope user
   If that fails, walk me through /plugin -> Manage Plugins -> Marketplaces -> add the GitHub marketplace -> Plugins -> install ai-employee-builder -> "Install for you" -> reload.
2. RELOAD - Run /reload-plugins (or reload the window), then confirm the installed shell reports v0.31.0 or newer.
3. CONNECT FIRST - Trigger the AIEB connector with a protected tool call. If Claude Code asks me to authenticate, tell me to click its native Connect action and finish the secure browser page. Never request or repeat a key in chat.
4. ONBOARD - After the browser connection succeeds, run /setup-aieb (or tell me the exact command to type). Check for saved Get Access intake before asking anything. If my four answers are missing, ask them one at a time: what my business sells; which recurring job I want to remove; how often it happens and how long it takes; and what a good finished result looks like. Then call complete_aieb_onboarding and confirm it succeeded.
5. BUILD THE WORKSPACE - Confirm the current project folder is the workspace I intend to use before changing a non-empty folder. Create only the workspace frame my access supports, then read the saved state back before calling it ready.
6. TEST AND CONFIRM - Tell me to type /check-setup and confirm the plugin, connection, membership, onboarding and saved workspace all check out. Then tell me the Business X-Ray is next, in a NEW window in this same project.
After each step, tell me whether it worked, or show the error and how you're fixing it. Start now with step 1.
\`\`\`

3. **Connect.** When Claude Code shows **Connect**, click it. ${CONNECT}
4. **Check it.** Type \`/check-setup\`. You want three green ticks: plugin installed, connection live, membership active.`;

const setupScreen = [
  { type: "text", markdown: INTRO },
  { type: "choice", prompt: PROMPT, options: [
    { label: "Claude", hint: "The Claude app, or Claude Code. One plugin works in both.", markdown: claude },
    { label: "ChatGPT Codex", hint: "The Codex app or CLI.", markdown: codex },
  ] },
];

const page = run("communityMemberWorkflows:getBuilderWelcomePageBySlugInternal", { slug });
// The page as blocks. A page saved before blocks carries over as the app shows
// it (legacyWelcomeLayout): its words and video first, then each step on a screen.
const mediaLine = (url) => (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(url) ? `![](${url})` : url);
const intro = [page.message?.trim(), page.media_url?.trim() ? mediaLine(page.media_url.trim()) : ""].filter(Boolean).join("\n\n");
const steps = [...page.join_form_keys.map((formKey) => ({ type: "form", formKey })), ...page.lesson_ids.map((resourceId) => ({ type: "lesson", resourceId }))];
let layout = page.layout ?? [...(intro ? [{ type: "text", markdown: intro }] : []), ...steps.flatMap((step, index) => (index ? [{ type: "next" }, step] : [step]))];
if (!page.layout) console.log(`Carried over the page saved before blocks${intro ? " (with its welcome words/video)" : ""}.`);
// Drop this script's earlier screen: everything up to the break after its choice.
const at = layout.findIndex((block) => block.type === "choice" && block.prompt === PROMPT);
if (at >= 0) {
  const end = layout.findIndex((block, index) => index > at && block.type === "next");
  const begin = layout.slice(0, at).findLastIndex((block) => block.type === "next") + 1;
  layout = [...layout.slice(0, begin), ...layout.slice(end < 0 ? layout.length : end + 1)];
}
const next = [...setupScreen, ...(layout.length ? [{ type: "next" }, ...layout] : [])];
const result = run("communityMemberWorkflows:saveBuilderWelcomePageInternal", {
  userId: page.owner_id, communityId: page.community_id, expectedRevision: page.revision,
  title: page.title, message: "", mediaUrl: "", lessonIds: next.filter((block) => block.type === "lesson").map((block) => block.resourceId), layout: next,
});
console.log(`Saved the ${slug} welcome page with setup first (revision ${result.revision}).`);
if (!page.welcome_gate) console.log("Note: \"Show to new members\" is off in Settings → Welcome page, so new members skip it until it's turned on.");
if (!layout.some((block) => block.type === "form" || block.type === "lesson")) console.log("Note: the page has no form or lesson after the setup screen, so members go straight into the community and won't see it.");
