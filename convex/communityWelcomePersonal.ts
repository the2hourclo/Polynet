import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUniqueCommunityMembershipByPair, requireCommunityChatAccess, requireCommunityManager, resolveUserIdForAuthenticatedRequest } from "./communityCore";
import { getCommunityMemberWorkflowByCommunity } from "./communityMemberWorkflowReadCore";
import { resolveCommunityInferenceFundingForAction } from "./founderInferenceRuntime";
import { startFundedInferenceRun } from "./fundedInferenceGateway";
import { readCommunityInferenceProvider } from "./communityInferenceProvider";
import { communityFormQuestionValidator } from "./communityFormValidators";
import { formQuestionAnswered } from "../shared/communityFormAnswers";
import type { CommunityFormQuestion } from "../shared/communityForms";
import {
  readWelcomePersonalTurn, welcomeAnswerWords, welcomeGoalPartsOpen, welcomePersonalQuoteFound, welcomePersonalRepeats, welcomePersonalBackup, welcomePersonalLimit, welcomePersonalPrompt,
  WELCOME_PERSONAL_TOOLS, type WelcomePersonalAnswer, type WelcomePersonalTurn,
} from "../shared/communityWelcomePersonal";
import { WELCOME_PERSONAL_BACKUP_MAX, WELCOME_PERSONAL_GOAL_MAX, type WelcomePersonalBlock } from "../shared/communityWelcomeLayout";

// Personal questions on the welcome page, asked one at a time. Each time the
// member answers, the agent is asked again with everything they've said, and
// it either asks one more question (its ask_question tool) or finishes, up to
// the owner's limit. What it asked is kept: coming back shows the same
// question. The page never waits long on the agent; past the time limit, or
// with no AI engine, the first question is the owner's backup and a later one
// ends the page.

const MAX_OUTPUT_TOKENS = 600;
// A local Claude Code turn (the claude_code_local bridge) takes 10 to 16
// seconds, so it gets longer before the backup is asked.
// A retry (a reply with no tool call) can take a second turn, so the limit covers both.
const agentTimeLimitMs = () => (readCommunityInferenceProvider() === "claude_code_local" ? 40_000 : 15_000);
const scope = { communityId: v.id("communities"), authSubject: v.optional(v.string()) };
const answersValidator = v.record(v.string(), v.union(v.string(), v.array(v.string())));
const readEnv = (name: string) => { const value = (globalThis as any)?.process?.env?.[name]; return typeof value === "string" ? value.trim() : ""; };
const project = (row: any) => ({ questions: row.questions as CommunityFormQuestion[], answers: row.answers as Record<string, string | string[]>,
  source: row.source as "agent" | "backup", answered: Boolean(row.answeredAt) });
/** The question waiting for an answer: the last one asked, until it's answered. */
const waiting = (row: { questions: CommunityFormQuestion[]; answers: Record<string, string | string[]> }) => {
  const last = row.questions[row.questions.length - 1];
  return last && !formQuestionAnswered(last, row.answers) ? last : null;
};
/** This page's own questions and answers so far, for the agent to build on. */
const ownAnswers = (row: { questions: CommunityFormQuestion[]; answers: Record<string, string | string[]> } | null): WelcomePersonalAnswer[] =>
  (row?.questions ?? []).map((question) => ({ question: question.title, answer: welcomeAnswerWords(question, row!.answers[question.key]).trim() })).filter((item) => item.answer);

async function ownMembership(ctx: any, args: { communityId: Id<"communities">; authSubject?: string }) {
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
  await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId, allowWelcome: true });
  const membership = await getUniqueCommunityMembershipByPair({ ctx, communityId: args.communityId, userId });
  if (!membership) throw new Error("welcome_personal_unavailable");
  return { userId, membershipId: membership._id as Id<"communityMemberships"> };
}

async function personalBlock(ctx: any, communityId: Id<"communities">, blockKey: string): Promise<WelcomePersonalBlock> {
  const workflow = await getCommunityMemberWorkflowByCommunity({ ctx, communityId });
  const block = (workflow?.welcomePage?.layout ?? []).find((item: any) => item.type === "personal" && item.key === blockKey);
  if (!block) throw new Error("welcome_personal_unavailable");
  return block as WelcomePersonalBlock;
}

/** What one member has answered so far in this community's forms, newest visit first, in words. */
async function memberAnswers(ctx: any, membershipId: Id<"communityMemberships">): Promise<WelcomePersonalAnswer[]> {
  const out: WelcomePersonalAnswer[] = [];
  for (const status of ["pending", "submitted"] as const) {
    const rows = await ctx.db.query("communityFormRequests").withIndex("by_member_status", (q: any) => q.eq("membershipId", membershipId).eq("status", status))
      .order("desc").take(8);
    for (const row of rows) {
      const version = await ctx.db.get(row.versionId);
      for (const question of (version?.questions ?? []) as CommunityFormQuestion[]) {
        const answer = welcomeAnswerWords(question, row.answers[question.key]).trim();
        if (answer) out.push({ question: question.title, answer: answer.slice(0, 1_500) });
      }
    }
  }
  return out.slice(0, 40);
}

async function communityContext(ctx: any, communityId: Id<"communities">) {
  const community: any = await ctx.db.get(communityId);
  return { name: community?.name ?? "", one_liner: community?.oneLiner ?? "", about: String(community?.about ?? "").slice(0, 1_500) };
}

export const personalContextInternal = internalQuery({
  args: { ...scope, blockKey: v.string() },
  handler: async (ctx, args) => {
    const { userId, membershipId } = await ownMembership(ctx, args);
    const row = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", membershipId).eq("blockKey", args.blockKey)).unique();
    // Finished, or a question still waiting: nothing to ask the agent.
    if (row && (row.answeredAt || waiting(row))) return { userId, membershipId, existing: project(row) };
    const block = await personalBlock(ctx, args.communityId, args.blockKey);
    return { userId, membershipId, existing: null, row: row ? project(row) : null, block,
      community: await communityContext(ctx, args.communityId), answers: await memberAnswers(ctx, membershipId), askedHere: ownAnswers(row) };
  },
});

export const storePersonalTurnInternal = internalMutation({
  args: { communityId: v.id("communities"), membershipId: v.id("communityMemberships"), blockKey: v.string(), goal: v.string(),
    source: v.union(v.literal("agent"), v.literal("backup")), asked: v.number(), question: v.union(communityFormQuestionValidator, v.null()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", args.membershipId).eq("blockKey", args.blockKey)).unique();
    const now = Date.now();
    if (!row) {
      const fresh = { communityId: args.communityId, membershipId: args.membershipId, blockKey: args.blockKey, goal: args.goal, source: args.source,
        questions: args.question ? [args.question] : [], answers: {}, createdAt: now, updatedAt: now, ...(args.question ? {} : { answeredAt: now }) };
      await ctx.db.insert("communityWelcomePersonalQuestions", fresh);
      return project(fresh);
    }
    // Two tabs asking at once: the first turn written wins, and the other tab gets it.
    if (row.answeredAt || waiting(row) || row.questions.length !== args.asked) return project(row);
    const patch = args.question ? { questions: [...row.questions, args.question], updatedAt: now } : { answeredAt: now, updatedAt: now };
    await ctx.db.patch(row._id, patch);
    return project({ ...row, ...patch });
  },
});

/** The agent's next move from the goal and everything answered so far; null when it can't say in time. */
async function nextTurn(ctx: any, args: { communityId: Id<"communities">; actorUserId: Id<"users">; goal: string; asked: number; max: number;
  community: unknown; answers: WelcomePersonalAnswer[]; askedHere: WelcomePersonalAnswer[]; persona?: string;
  /** What happened on this turn, in words, for the owner's Preview (and the server log). */
  notes?: string[] }): Promise<WelcomePersonalTurn | null> {
  const note = (text: string) => { args.notes?.push(text); console.log(`welcome_personal: ${text}`); };
  if (args.asked >= args.max) return { kind: "finish" };
  const requestId = crypto.randomUUID();
  let fundedRun: Awaited<ReturnType<typeof startFundedInferenceRun>>;
  try {
    fundedRun = await startFundedInferenceRun({
      ctx, communityId: args.communityId, actorUserId: args.actorUserId,
      surface: "community_workflow_action",
      receiptKey: `community_workflow_action:welcome_personal:${requestId}`,
      sourceRunId: `community-welcome-personal:${requestId}`,
      admission: await resolveCommunityInferenceFundingForAction(ctx, args.communityId),
    });
  } catch { return null; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), agentTimeLimitMs());
  const base = [
    { role: "system", content: welcomePersonalPrompt(args.asked, args.max) },
    { role: "user", content: JSON.stringify({ community: args.community, owner_goal: args.goal,
      member_answers_on_earlier_pages: args.answers, your_questions_on_this_page_and_their_answers: args.askedHere, ...(args.persona ? { member_described_as: args.persona } : {}) }, null, 2) },
  ];
  const ask = (nudge: string | null, force: boolean) => fundedRun.request({
    messages: nudge ? [...base, { role: "user", content: nudge }] : base,
    maxTokens: MAX_OUTPUT_TOKENS, tools: (force ? WELCOME_PERSONAL_TOOLS.filter((tool) => tool.name === "ask_question") : WELCOME_PERSONAL_TOOLS) as any,
    ...(force ? { toolChoice: { type: "function", name: "ask_question" } } : {}),
    parallelToolCalls: false, signal: controller.signal,
    apiKeyOverride: readEnv("OPENAI_API_KEY") || readEnv("ARX_OPENAI_API_KEY") || undefined,
  } as any);
  const read = (completion: any) => readWelcomePersonalTurn(completion, () => crypto.randomUUID());
  const earlier = args.askedHere.map((item) => item.question);
  const known = [args.goal, ...args.answers.map((item) => item.answer), ...args.askedHere.map((item) => item.answer)].join(" ");
  const describe = (completion: any) => completion?.type === "assistant" ? `a reply with no tool call: ${JSON.stringify(String(completion.assistantText ?? "").slice(0, 200))}` : `an unusable ${completion?.type ?? "reply"}`;
  try {
    let completion: any = await ask(null, false);
    if (!completion.ok) { note(`the engine failed (${completion.code ?? "unknown"})`); await fundedRun.fail(completion.code ?? "welcome_personal_unreadable"); return null; }
    let turn = read(completion);
    // A covered part needs the member's own words; one it can't quote is still open.
    const said = [...args.answers, ...args.askedHere].map((item) => item.answer);
    const check = (next: WelcomePersonalTurn | null): WelcomePersonalTurn | null => {
      if (next?.kind !== "finish") return next;
      const covered = next.covered ?? [];
      const proven = covered.filter((item) => welcomePersonalQuoteFound(item.quote, said));
      const unproven = covered.filter((item) => !proven.includes(item)).map((item) => item.part);
      // The server reads the goal's parts too, so a part the agent skipped silently still counts as open.
      const skipped = welcomeGoalPartsOpen(args.goal, proven.map((item) => item.part))
        .filter((part) => !(next.openParts ?? []).includes(part));
      note(`finish claimed covered ${JSON.stringify(covered.map((item) => `${item.part} ← "${item.quote}"`))}, open ${JSON.stringify(next.openParts ?? [])}`
        + `${unproven.length ? `; no matching answer for ${JSON.stringify(unproven)}` : ""}${skipped.length ? `; goal parts not covered ${JSON.stringify(skipped)}` : ""}`);
      return { ...next, openParts: [...new Set([...(next.openParts ?? []), ...unproven, ...skipped])] };
    };
    turn = check(turn);
    // One retry, for: a reply with no tool call; a finish naming parts of the goal still unanswered; a repeat of an earlier question.
    const open = turn?.kind === "finish" ? turn.openParts ?? [] : [];
    const repeat = turn?.kind === "ask" && welcomePersonalRepeats(turn.question.title, earlier, known) ? turn.question.title : null;
    const left = args.asked < args.max;
    if (!turn || (left && (open.length || repeat))) {
      note(!turn ? `retrying after ${describe(completion)}`
        : repeat ? `retrying: ${JSON.stringify(repeat)} repeats an earlier question`
          : `retrying: finished with open parts ${JSON.stringify(open)}`);
      const nudge = !turn ? "Your last reply had no tool call. Answer only by calling ask_question or finish."
        : repeat ? `Don't repeat yourself: you already asked something like "${repeat}". ${open.length ? `Ask about one of these instead: ${open.join("; ")}.` : "Ask about a part of the goal their answers don't cover yet, or finish."}`
          : `You finished, but you listed these parts of the goal as unanswered: ${open.join("; ")}. Ask the member about one of them now.`;
      const retry: any = await ask(nudge, Boolean(turn) && !repeat);
      const again = retry.ok ? read(retry) : null;
      if (!retry.ok) note(`the retry failed (${retry.code ?? "unknown"})`);
      else if (!again) note(`the retry gave ${describe(retry)}`);
      if (again) { completion = retry; turn = check(again); }
    }
    if (!(await fundedRun.settle("provider_completed"))) { note("the run could not be settled"); return null; }
    // A question it already asked here (reworded or as a checklist) ends the page instead of repeating.
    if (turn?.kind === "ask" && welcomePersonalRepeats(turn.question.title, earlier, known)) {
      note(`dropped ${JSON.stringify(turn.question.title)}: it repeats an earlier question`);
      turn = { kind: "finish" };
    }
    if (turn?.kind === "finish") note(`finished${turn.openParts?.length ? `, open parts ${JSON.stringify(turn.openParts)}` : ""}`);
    else if (!turn) note("no usable question, so the page ends (the backup on the first turn)");
    // The first move must be a question; a finish before asking anything means the backup is asked.
    return turn?.kind === "finish" && args.asked === 0 ? null : turn;
  } catch {
    await fundedRun.fail("welcome_personal_provider_error").catch(() => undefined);
    return null;
  } finally { clearTimeout(timer); }
}

/** The member's personal page: the question waiting for them, asking the agent for the next one when the last is answered. */
export const askMyWelcomePersonalQuestions = action({
  args: { ...scope, blockKey: v.string() },
  handler: async (ctx, args): Promise<ReturnType<typeof project>> => {
    const context: any = await ctx.runQuery((internal as any).communityWelcomePersonal.personalContextInternal, args);
    if (context.existing) return context.existing;
    const block: WelcomePersonalBlock = context.block;
    const asked = context.row?.questions.length ?? 0;
    const backupAsked = context.row?.source === "backup";
    const turn = backupAsked ? { kind: "finish" as const } : await nextTurn(ctx, { communityId: args.communityId, actorUserId: context.userId, goal: block.goal,
      asked, max: welcomePersonalLimit(block.count), community: context.community, answers: context.answers, askedHere: context.askedHere });
    // No answer from the agent: the backup opens the page, and a later question ends it.
    const question = turn?.kind === "ask" ? turn.question : !turn && asked === 0 ? welcomePersonalBackup(block.backup, `backup-${args.blockKey}`) : null;
    return await ctx.runMutation((internal as any).communityWelcomePersonal.storePersonalTurnInternal, {
      communityId: args.communityId, membershipId: context.membershipId, blockKey: args.blockKey, goal: block.goal,
      source: context.row?.source ?? (turn ? "agent" : "backup"), asked, question,
    });
  },
});

/** Saves the answer to the waiting question as they type; `done` sends it in, so the next ask moves on. */
export const saveMyWelcomePersonalAnswers = mutation({
  args: { ...scope, blockKey: v.string(), answers: answersValidator, done: v.boolean() },
  handler: async (ctx, args) => {
    const { membershipId } = await ownMembership(ctx, args);
    const row = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", membershipId).eq("blockKey", args.blockKey)).unique();
    if (!row) throw new Error("welcome_personal_unavailable");
    const current = waiting(row);
    if (!current) return { answered: Boolean(row.answeredAt) };
    // Only the waiting question's answer changes; earlier answers stay as sent.
    const value = args.answers[current.key];
    const answers = { ...row.answers, ...(value === undefined ? {} : { [current.key]: Array.isArray(value) ? value.slice(0, 12).map((item) => item.slice(0, 200)) : value.slice(0, 5_000) }) };
    if (args.done && !formQuestionAnswered(current, answers)) throw new Error("welcome_personal_answer_missing");
    await ctx.db.patch(row._id, { answers, updatedAt: Date.now() });
    return { answered: Boolean(row.answeredAt) };
  },
});

/** What the agent asked a member and what they said, for the owner's view of that member. */
export const listBuilderMemberPersonalAnswers = query({
  args: { ...scope, membershipId: v.id("communityMemberships") },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
    await requireCommunityManager({ ctx, communityId: args.communityId, userId });
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.communityId !== args.communityId) throw new Error("welcome_personal_unavailable");
    const rows = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", args.membershipId)).take(10);
    return rows.map((row) => ({ goal: row.goal, ...project(row), asked_at: row.createdAt }));
  },
});

export const previewContextInternal = internalQuery({
  args: scope,
  handler: async (ctx, args) => {
    const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
    await requireCommunityManager({ ctx, communityId: args.communityId, userId });
    return { userId, community: await communityContext(ctx, args.communityId) };
  },
});

/** The owner's preview: the agent's next move for a pretend member. Nothing is saved; replied with no question means it would finish; no reply means the backup (first) or the end. */
export const previewWelcomePersonalQuestions = action({
  args: { ...scope, goal: v.string(), count: v.number(), persona: v.string(), asked: v.optional(v.number()),
    answers: v.array(v.object({ question: v.string(), answer: v.string() })),
    askedHere: v.optional(v.array(v.object({ question: v.string(), answer: v.string() }))) },
  handler: async (ctx, args): Promise<{ question: CommunityFormQuestion | null; replied: boolean; notes: string[] }> => {
    const goal = args.goal.trim().slice(0, WELCOME_PERSONAL_GOAL_MAX);
    if (!goal) throw new Error("welcome_personal_invalid");
    const context: any = await ctx.runQuery((internal as any).communityWelcomePersonal.previewContextInternal, { communityId: args.communityId, authSubject: args.authSubject });
    const notes: string[] = [];
    const turn = await nextTurn(ctx, { notes, communityId: args.communityId, actorUserId: context.userId, goal,
      asked: Math.max(0, Math.round(args.asked ?? 0), args.askedHere?.length ?? 0), max: welcomePersonalLimit(args.count), community: context.community,
      answers: args.answers.slice(0, 40).map((item) => ({ question: item.question.slice(0, 500), answer: item.answer.slice(0, 1_500) })),
      askedHere: (args.askedHere ?? []).slice(0, 10).map((item) => ({ question: item.question.slice(0, 500), answer: item.answer.slice(0, 1_500) })),
      persona: args.persona.trim().slice(0, WELCOME_PERSONAL_BACKUP_MAX) || undefined });
    return { question: turn?.kind === "ask" ? turn.question : null, replied: Boolean(turn), notes };
  },
});
