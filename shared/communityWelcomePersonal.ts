import type { CommunityFormQuestion } from "./communityForms";
import { normalizeCommunityFormAgentDraft } from "./communityFormAgentDraft";
import { WELCOME_PERSONAL_QUESTIONS_MAX } from "./communityWelcomeLayout";

// Personal questions on the welcome page, asked one at a time. The owner gives
// a goal; the community's agent has two tools: ask_question (the next question,
// built on everything the member has said) and finish (it has what the goal
// needs). It is called again after each answer, up to the owner's limit. Its
// reply is untrusted, so a question goes through the same clamping as "Draft
// with The Builder"; when it can't ask the first question, the owner's backup
// question is asked instead.

/** One earlier answer the agent reads: the question as the member saw it, and their answer in words. */
export type WelcomePersonalAnswer = { question: string; answer: string };
/** The agent's turn: the next question, or done. */
/** A part of the goal the agent says is answered, with the member's words it points to. */
export type WelcomePersonalCovered = { part: string; quote: string };
export type WelcomePersonalTurn = { kind: "ask"; question: CommunityFormQuestion } | { kind: "finish"; openParts?: string[]; covered?: WelcomePersonalCovered[] };

const QUESTION_TYPES = ["short_text", "long_text", "single_choice", "multiple_choice"];

/** The two tools the agent is given. Strict schemas list every property as required. */
export const WELCOME_PERSONAL_TOOLS = [
  {
    type: "function" as const, name: "ask_question", strict: true,
    description: "Ask the member one more question. It shows on its own page; their answer comes back before you choose again.",
    parameters: {
      type: "object", additionalProperties: false, required: ["title", "description", "type", "options"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 300, description: "The question, short, plain and warm." },
        description: { type: "string", maxLength: 300, description: "One optional line under it, or empty." },
        type: { type: "string", enum: QUESTION_TYPES },
        options: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 }, description: "2 to 8 short options for a choice question, otherwise empty." },
      },
    },
  },
  {
    type: "function" as const, name: "finish", strict: true,
    description: "Stop asking: every part of the owner's goal is answered, or another question would only repeat what the member said.",
    parameters: { type: "object", additionalProperties: false, required: ["covered_parts", "open_parts"], properties: {
      covered_parts: { type: "array", maxItems: 8, description: "Each part of the goal their answers already cover, with the member's own words that answer it, quoted exactly.",
        items: { type: "object", additionalProperties: false, required: ["part", "answer_quote"], properties: {
          part: { type: "string", maxLength: 200 }, answer_quote: { type: "string", maxLength: 300 } } } },
      open_parts: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 }, description: "Each part of the goal with no answer yet; empty when all are covered." },
    } },
  },
];

export function welcomePersonalPrompt(asked: number, max: number): string {
  const left = Math.max(0, max - asked);
  return [
    "You are the guide of an online community, welcoming one new member through a few questions, one at a time.",
    "The owner tells you what they want to learn (owner_goal). You see what this member answered on earlier pages, and the questions you already asked on this page with their answers.",
    "Choose your next move with a tool: ask_question for the one question that moves furthest toward the goal, built on their own words, or finish once the goal is met.",
    "The goal may have several parts (for example what they want, what stops them, how they'd know it worked). Before you finish, check each part against their answers; while any part has no answer yet and you have questions left, ask about that part.",
    "finish needs proof: for each covered part, quote the member's exact words that answer it. A part you can't quote an answer for is open.",
    asked === 0 ? "This is your first question, so ask one." : `You have asked ${asked}; you may ask ${left} more at most. Finish once every part of the goal is answered, or when another question wouldn't add something new.`,
    "Never ask again something you already asked on this page, even reworded or as a list of options: take their answer as given and go one step further, or finish.",
    "Ask only what their answers don't already tell you. Each question is answered in seconds. No advice, no selling, no compliments.",
    "Always answer with a tool call, never with plain text.",
    'If you can\'t call tools, reply with JSON only: {"ask": {"title": "…", "description": "", "type": "short_text", "options": []}} or {"finish": true, "covered_parts": [{"part": "…", "answer_quote": "their exact words"}], "open_parts": []}.',
  ].join("\n");
}

function parseJson(text: string): any {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** One question from the agent, clamped like a drafted form's, with a fresh key; null when it isn't usable. */
export function normalizeWelcomePersonalQuestion(raw: unknown, newKey: () => string): CommunityFormQuestion | null {
  try {
    const { questions } = normalizeCommunityFormAgentDraft(JSON.stringify({ name: "", questions: [{ ...(raw as object), required: true }] }), [], newKey);
    const question = questions[0];
    if (!question) return null;
    const { clientPropertyKey: _unused, ...rest } = question;
    return { ...rest, required: true };
  } catch { return null; }
}

const openParts = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, 8);

const coveredParts = (value: unknown): WelcomePersonalCovered[] => (Array.isArray(value) ? value : []).slice(0, 8).flatMap((item: any) =>
  typeof item === "string" ? [{ part: item.slice(0, 200), quote: "" }]
    : item && typeof item.part === "string" ? [{ part: item.part.slice(0, 200), quote: typeof item.answer_quote === "string" ? item.answer_quote.slice(0, 300) : "" }] : []);

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** True when the quote is really the member's: found in one of their answers, or most of its words are. */
export function welcomePersonalQuoteFound(quote: string, answers: string[]): boolean {
  const said = plain(quote);
  if (said.length < 2) return false;
  return answers.some((answer) => {
    const theirs = plain(answer);
    if (theirs.includes(said)) return true;
    const mine = said.split(" ").filter((word) => word.length > 2);
    const pool = new Set(theirs.split(" "));
    return mine.length > 0 && mine.filter((word) => pool.has(word)).length / mine.length >= 0.75;
  });
}

const partWords = (text: string) => new Set(plain(text).split(" ").filter((word) => word.length > 3 && !["find", "what", "them", "their", "they", "which", "with", "from", "that", "this", "would", "could"].includes(word)));
/** The owner's goal in parts, split on commas, semicolons and "and": "which tool, what stops them, and how they'd know it worked" is three. */
export function welcomeGoalParts(goal: string): string[] {
  return goal.split(/[,;.]|\band\b/i).map((part) => part.replace(/^\s*(find out|learn|ask|understand)\s+/i, "").trim())
    .filter((part) => part.split(/\s+/).length >= 2 && partWords(part).size > 0).slice(0, 8);
}
/** Goal parts with no proven covered part sharing a word with them: the agent hasn't shown an answer for these yet. */
export function welcomeGoalPartsOpen(goal: string, provenParts: string[]): string[] {
  const parts = welcomeGoalParts(goal);
  if (parts.length < 2) return [];
  const claimed = provenParts.map(partWords);
  return parts.filter((part) => { const mine = partWords(part); return !claimed.some((theirs) => [...mine].some((word) => theirs.has(word))); });
}

/** Reads the agent's turn from a tool call, or from a JSON reply when the engine has no tools; null when it says nothing usable. */
export function readWelcomePersonalTurn(completion: any, newKey: () => string): WelcomePersonalTurn | null {
  const calls = completion?.type === "tool_call" ? [completion] : completion?.type === "tool_calls" ? completion.toolCalls ?? [] : [];
  for (const call of calls) {
    if (call?.toolName === "finish") return { kind: "finish", openParts: openParts(call.arguments?.open_parts), covered: coveredParts(call.arguments?.covered_parts) };
    if (call?.toolName === "ask_question") {
      const question = normalizeWelcomePersonalQuestion(call.arguments, newKey);
      if (question) return { kind: "ask", question };
    }
  }
  if (completion?.type !== "assistant") return null;
  const reply = parseJson(String(completion.assistantText ?? ""));
  if (!reply) return null;
  if (reply.finish) return { kind: "finish", openParts: openParts(reply.open_parts), covered: coveredParts(reply.covered_parts) };
  const raw = reply.ask ?? (Array.isArray(reply.questions) ? reply.questions[0] : null);
  const question = raw ? normalizeWelcomePersonalQuestion(raw, newKey) : null;
  return question ? { kind: "ask", question } : null;
}

const COMMON = new Set(["what", "which", "would", "could", "your", "you're", "that", "this", "those", "these", "with", "from", "have", "about", "today", "right", "know", "they", "them", "when", "does", "into", "most", "more", "much", "many"]);
const words = (text: string, skip: Set<string>) => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
  .filter((word) => word.length > 3 && !COMMON.has(word) && !skip.has(word)));
/** True when a new question repeats one already asked on the page. Words from `known` (the goal and the member's
 * answers) don't count, since every question naturally echoes the topic and what the member said. */
export function welcomePersonalRepeats(title: string, earlier: string[], known = ""): boolean {
  const same = (a: string, b: string) => a.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ") === b.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (earlier.some((item) => same(item, title))) return true;
  const topic = words(known, new Set());
  const mine = words(title, topic);
  return earlier.some((item) => {
    const theirs = words(item, topic);
    const shared = [...mine].filter((word) => theirs.has(word)).length;
    return shared >= 3 && shared / Math.max(mine.size, theirs.size) >= 0.8;
  });
}

/** How many questions a block may ask, from what the owner set. */
export const welcomePersonalLimit = (count: number) => Math.max(1, Math.min(WELCOME_PERSONAL_QUESTIONS_MAX, Math.round(count) || 1));

/** The owner's backup, asked when the agent can't write the first question in time. */
export function welcomePersonalBackup(backup: string, key: string): CommunityFormQuestion {
  return { key, title: backup, description: "", type: "long_text", required: true, options: [] };
}

/** An answer in words, for the agent to read: a choice answer becomes the option the member picked. */
export function welcomeAnswerWords(question: CommunityFormQuestion, answer: string | string[] | undefined): string {
  if (answer === undefined) return "";
  const pick = (value: string) => question.options[Number(value)] ?? value;
  if (Array.isArray(answer)) return answer.map(pick).join(", ");
  return question.type === "single_choice" ? pick(answer) : answer;
}
