import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { describeCommunityInferenceEngine, runCommunityFundedCompletion } from "./communityInferenceProvider";

// Persona Autoplay: when the owner says who a test member is and the agent
// runs free (the local Claude Code engine), Autoplay's form answers and intro
// posts are written in that person's words instead of "Sample answer". The
// text is made before the step is issued (the member's tab types exactly what
// the plan holds), and anything the model gets wrong falls back to the sample.

export type PersonaQuestion = { key: string; title: string; type: string; options: string[]; answerFormat?: string };
export type PersonaRequest =
  | { kind: "form"; formName: string; questions: PersonaQuestion[] }
  | { kind: "post"; channelName: string };

const MAX_ANSWER = 1_500;
const MAX_POST = 600;

export function buildPersonaMessages(input: { persona: string; communityName: string; request: PersonaRequest }) {
  const who = `You are role-playing a new member of the online community "${input.communityName}" so its owner can test what members go through. `
    + `Stay in character as this person: ${input.persona}. Write the way they would, first person, plain and specific to their situation. `
    + "Never mention that you are an AI, a test or a role-play. Reply with JSON only, no prose around it.";
  if (input.request.kind === "post") {
    return [
      { role: "system" as const, content: who },
      { role: "user" as const, content: `Write your first post in #${input.request.channelName}: introduce yourself in two to four sentences and say what you hope to get from the community. `
        + 'Reply as {"message": "..."}' },
    ];
  }
  const lines = input.request.questions.map((question, index) => {
    const choices = question.options.length
      ? ` Options: ${question.options.map((option, i) => `${i + 1}) ${option}`).join("; ")}. Answer with ${question.type === "multiple_choice" ? "a list of option numbers" : "one option number"}.`
      : "";
    const format = question.answerFormat === "number" ? " Answer with a number only."
      : question.answerFormat === "date" ? " Answer with a date as YYYY-MM-DD."
      : question.answerFormat === "url" ? " Answer with a full https:// link." : "";
    return `${index + 1}. key "${question.key}": ${question.title}.${choices}${format}`;
  });
  return [
    { role: "system" as const, content: who },
    { role: "user" as const, content: `Fill in the "${input.request.formName}" form you were just sent.\n${lines.join("\n")}\n`
      + 'Reply as {"answers": {"<key>": "<your answer>" or <option number> or [<option numbers>]}}' },
  ];
}

function jsonIn(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** A short answer the form checks (number, date, link), pulled out of what the persona wrote; null if there isn't one. */
function inFormat(text: string, format: string | undefined): string | null {
  if (format === "number") return text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/-?\d+(?:\.\d+)?/)?.[0] ?? null;
  if (format === "date") return text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
  if (format === "url") return text.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;
  return text || null;
}

/** The model's reply as answers/message, keeping only what fits each question. */
export function parsePersonaReply(text: string, request: PersonaRequest): { answers?: Record<string, string | string[]>; message?: string } | null {
  const json = jsonIn(text);
  if (!json || typeof json !== "object") return null;
  if (request.kind === "post") {
    const message = String(json.message ?? "").trim().slice(0, MAX_POST);
    return message ? { message } : null;
  }
  const raw = json.answers && typeof json.answers === "object" ? json.answers : {};
  const answers: Record<string, string | string[]> = {};
  for (const question of request.questions) {
    const value = raw[question.key];
    if (value === undefined || value === null) continue;
    const pick = (n: unknown) => {
      const index = Math.round(Number(n)) - 1;
      return Number.isInteger(index) && index >= 0 && index < question.options.length ? String(index) : null;
    };
    if (question.type === "single_choice") {
      const choice = pick(Array.isArray(value) ? value[0] : value);
      if (choice !== null) answers[question.key] = choice;
    } else if (question.type === "multiple_choice") {
      const choices = [...new Set((Array.isArray(value) ? value : [value]).map(pick).filter((c): c is string => c !== null))];
      if (choices.length) answers[question.key] = choices;
    } else {
      const answer = inFormat(String(value).trim(), question.answerFormat);
      if (answer) answers[question.key] = answer.slice(0, MAX_ANSWER);
    }
  }
  return Object.keys(answers).length ? { answers } : null;
}

/**
 * The persona's answers over the sample ones. A number, date or link the form
 * checks is only taken once it's in that format (parsePersonaReply sees to it);
 * any other sample that isn't sample text is kept, so the form still saves.
 */
export function mergePersonaAnswers(sample: Record<string, string | string[]>, persona: Record<string, string | string[]> | undefined,
  questions: PersonaQuestion[]): Record<string, string | string[]> {
  const merged = { ...sample };
  for (const question of questions) {
    const value = persona?.[question.key];
    if (value === undefined) continue;
    const isChoice = question.type === "single_choice" || question.type === "multiple_choice";
    const sampleIsText = typeof sample[question.key] === "string" && String(sample[question.key]).startsWith("Sample answer");
    if (isChoice || sampleIsText || question.answerFormat) merged[question.key] = value;
  }
  return merged;
}

export const writePersonaDraftInternal = internalAction({
  args: {
    testMemberId: v.id("communityTestMembers"),
    key: v.string(),
    persona: v.string(),
    communityName: v.string(),
    request: v.any(),
  },
  handler: async (ctx, args) => {
    const request = args.request as PersonaRequest;
    const engine = describeCommunityInferenceEngine();
    let result: { answers?: Record<string, string | string[]>; message?: string } | null = null;
    let error: string | undefined;
    // Only the free local engine writes persona text; it never spends credits.
    if (engine.provider !== "claude_code_local" || !engine.ready) {
      error = "persona_needs_local_engine";
    } else {
      const completion: any = await runCommunityFundedCompletion({
        modelId: engine.model,
        messages: buildPersonaMessages({ persona: args.persona, communityName: args.communityName, request }),
        maxTokens: 1_200,
        tools: [],
      });
      if (completion.ok && completion.type === "assistant") result = parsePersonaReply(completion.assistantText, request);
      error = result ? undefined : completion.ok ? "persona_reply_unreadable" : String(completion.code ?? "persona_failed");
    }
    await ctx.runMutation(internal.communityTestMemberPersona.savePersonaDraftInternal, {
      testMemberId: args.testMemberId, key: args.key, ...(result ? { status: "ready" as const, ...result } : { status: "failed" as const, error }),
    });
  },
});

export const savePersonaDraftInternal = internalMutation({
  args: {
    testMemberId: v.id("communityTestMembers"),
    key: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    answers: v.optional(v.any()),
    message: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.testMemberId);
    // A newer step (or the end of the run) already moved on.
    if (!row || row.endedAt !== undefined || row.autoplayDraft?.key !== args.key) return;
    await ctx.db.patch(row._id, { autoplayDraft: { key: args.key, status: args.status, startedAt: row.autoplayDraft.startedAt,
      ...(args.answers ? { answers: args.answers } : {}), ...(args.message ? { message: args.message } : {}),
      ...(args.error ? { error: args.error.slice(0, 200) } : {}) } });
  },
});
