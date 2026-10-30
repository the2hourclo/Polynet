import type { CommunityFormQuestion } from "./communityForms";
import { normalizeCommunityFormAgentDraft } from "./communityFormAgentDraft";
import { WELCOME_PERSONAL_QUESTIONS_MAX } from "./communityWelcomeLayout";

// Personal questions on the welcome page: the owner gives a goal, and the
// community's agent writes a few questions for each member from what they have
// already answered. The agent's reply is untrusted text, so it goes through the
// same clamping as "Draft with The Builder", and anything unusable falls back to
// the owner's backup question.

/** One earlier answer the agent reads: the question as the member saw it, and their answer in words. */
export type WelcomePersonalAnswer = { question: string; answer: string };

export function welcomePersonalPrompt(count: number): string {
  return [
    "You are the guide of an online community, welcoming one new member.",
    "The owner tells you what they want to learn. You see what this member has already answered.",
    `Write ${count === 1 ? "one question" : `up to ${count} questions`} for this member that move toward the owner's goal, built on their own words.`,
    "Ask only what their earlier answers don't already tell you. Each question is short, plain and warm, answered in seconds. No advice, no selling, no compliments.",
    "Reply with JSON only, no prose and no code fence, shaped like:",
    '{"questions": [{"title": "Question", "description": "", "type": "short_text", "required": true, "options": []}]}',
    "type is one of short_text, long_text, single_choice, multiple_choice. Choice questions need 2 to 8 short, distinct options.",
  ].join("\n");
}

/** The agent's questions, at most `count`, with fresh keys; null when the reply holds none it can use. */
export function normalizeWelcomePersonalQuestions(reply: string, count: number, newKey: () => string): CommunityFormQuestion[] | null {
  try {
    const { questions } = normalizeCommunityFormAgentDraft(reply, [], newKey);
    return questions.slice(0, Math.max(1, Math.min(WELCOME_PERSONAL_QUESTIONS_MAX, count)))
      .map(({ clientPropertyKey: _unused, ...question }) => question);
  } catch { return null; }
}

/** The owner's backup, asked when the agent can't write the questions in time. */
export function welcomePersonalBackup(backup: string, key: string): CommunityFormQuestion[] {
  return [{ key, title: backup, description: "", type: "long_text", required: true, options: [] }];
}

/** An answer in words, for the agent to read: a choice answer becomes the option the member picked. */
export function welcomeAnswerWords(question: CommunityFormQuestion, answer: string | string[] | undefined): string {
  if (answer === undefined) return "";
  const pick = (value: string) => question.options[Number(value)] ?? value;
  if (Array.isArray(answer)) return answer.map(pick).join(", ");
  return question.type === "single_choice" ? pick(answer) : answer;
}
