import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUniqueCommunityMembershipByPair, requireCommunityChatAccess, requireCommunityManager, resolveUserIdForAuthenticatedRequest } from "./communityCore";
import { getCommunityMemberWorkflowByCommunity } from "./communityMemberWorkflowReadCore";
import { resolveCommunityInferenceFundingForAction } from "./founderInferenceRuntime";
import { startFundedInferenceRun } from "./fundedInferenceGateway";
import { communityFormQuestionValidator } from "./communityFormValidators";
import { formQuestionAnswered } from "../shared/communityFormAnswers";
import type { CommunityFormQuestion } from "../shared/communityForms";
import {
  readWelcomePersonalTurn, welcomeAnswerWords, welcomePersonalBackup, welcomePersonalLimit, welcomePersonalPrompt,
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
const AGENT_TIME_LIMIT_MS = 12_000;
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
      community: await communityContext(ctx, args.communityId), answers: [...await memberAnswers(ctx, membershipId), ...ownAnswers(row)] };
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
  community: unknown; answers: WelcomePersonalAnswer[]; persona?: string }): Promise<WelcomePersonalTurn | null> {
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
  const timer = setTimeout(() => controller.abort(), AGENT_TIME_LIMIT_MS);
  try {
    const completion: any = await fundedRun.request({
      messages: [
        { role: "system", content: welcomePersonalPrompt(args.asked, args.max) },
        { role: "user", content: JSON.stringify({ community: args.community, owner_goal: args.goal,
          member_answers: args.answers, ...(args.persona ? { member_described_as: args.persona } : {}) }, null, 2) },
      ],
      maxTokens: MAX_OUTPUT_TOKENS, tools: WELCOME_PERSONAL_TOOLS as any, parallelToolCalls: false, signal: controller.signal,
      apiKeyOverride: readEnv("OPENAI_API_KEY") || readEnv("ARX_OPENAI_API_KEY") || undefined,
    });
    if (!completion.ok) { await fundedRun.fail(completion.code ?? "welcome_personal_unreadable"); return null; }
    if (!(await fundedRun.settle("provider_completed"))) return null;
    const turn = readWelcomePersonalTurn(completion, () => crypto.randomUUID());
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
      asked, max: welcomePersonalLimit(block.count), community: context.community, answers: context.answers });
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
    answers: v.array(v.object({ question: v.string(), answer: v.string() })) },
  handler: async (ctx, args): Promise<{ question: CommunityFormQuestion | null; replied: boolean }> => {
    const goal = args.goal.trim().slice(0, WELCOME_PERSONAL_GOAL_MAX);
    if (!goal) throw new Error("welcome_personal_invalid");
    const context: any = await ctx.runQuery((internal as any).communityWelcomePersonal.previewContextInternal, { communityId: args.communityId, authSubject: args.authSubject });
    const turn = await nextTurn(ctx, { communityId: args.communityId, actorUserId: context.userId, goal,
      asked: Math.max(0, Math.round(args.asked ?? 0)), max: welcomePersonalLimit(args.count), community: context.community,
      answers: args.answers.slice(0, 40).map((item) => ({ question: item.question.slice(0, 500), answer: item.answer.slice(0, 1_500) })),
      persona: args.persona.trim().slice(0, WELCOME_PERSONAL_BACKUP_MAX) || undefined });
    return { question: turn?.kind === "ask" ? turn.question : null, replied: Boolean(turn) };
  },
});
