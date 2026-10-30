import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUniqueCommunityMembershipByPair, requireCommunityChatAccess, requireCommunityManager, resolveUserIdForAuthenticatedRequest } from "./communityCore";
import { getCommunityMemberWorkflowByCommunity } from "./communityMemberWorkflowReadCore";
import { resolveCommunityInferenceFundingForAction } from "./founderInferenceRuntime";
import { startFundedInferenceRun } from "./fundedInferenceGateway";
import { communityFormQuestionValidator } from "./communityFormValidators";
import { formAnswersIssue } from "../shared/communityFormAnswers";
import type { CommunityFormQuestion } from "../shared/communityForms";
import {
  normalizeWelcomePersonalQuestions, welcomeAnswerWords, welcomePersonalBackup, welcomePersonalPrompt, type WelcomePersonalAnswer,
} from "../shared/communityWelcomePersonal";
import { WELCOME_PERSONAL_BACKUP_MAX, WELCOME_PERSONAL_GOAL_MAX, WELCOME_PERSONAL_QUESTIONS_MAX, type WelcomePersonalBlock } from "../shared/communityWelcomeLayout";

// Personal questions on the welcome page. The questions are written once per
// member, when they reach the page, and kept: coming back shows the same
// questions with their answers. The page never waits long on the agent; past
// the time limit, or with no AI engine, the owner's backup question is asked.

const MAX_OUTPUT_TOKENS = 900;
const AGENT_TIME_LIMIT_MS = 12_000;
const scope = { communityId: v.id("communities"), authSubject: v.optional(v.string()) };
const answersValidator = v.record(v.string(), v.union(v.string(), v.array(v.string())));
const readEnv = (name: string) => { const value = (globalThis as any)?.process?.env?.[name]; return typeof value === "string" ? value.trim() : ""; };
const project = (row: any) => ({ questions: row.questions as CommunityFormQuestion[], answers: row.answers as Record<string, string | string[]>,
  source: row.source as "agent" | "backup", answered: Boolean(row.answeredAt) });

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
    const existing = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", membershipId).eq("blockKey", args.blockKey)).unique();
    if (existing) return { userId, membershipId, existing: project(existing) };
    const block = await personalBlock(ctx, args.communityId, args.blockKey);
    return { userId, membershipId, existing: null, block, community: await communityContext(ctx, args.communityId), answers: await memberAnswers(ctx, membershipId) };
  },
});

export const storePersonalQuestionsInternal = internalMutation({
  args: { communityId: v.id("communities"), membershipId: v.id("communityMemberships"), blockKey: v.string(), goal: v.string(),
    source: v.union(v.literal("agent"), v.literal("backup")), questions: v.array(communityFormQuestionValidator) },
  handler: async (ctx, args) => {
    // Two tabs asking at once keep the first set written.
    const existing = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", args.membershipId).eq("blockKey", args.blockKey)).unique();
    if (existing) return project(existing);
    const now = Date.now();
    const row = { ...args, answers: {}, createdAt: now, updatedAt: now };
    await ctx.db.insert("communityWelcomePersonalQuestions", row);
    return project(row);
  },
});

/** The agent's questions from a goal and earlier answers, or null when it can't write them in time. */
async function writeQuestions(ctx: any, args: { communityId: Id<"communities">; actorUserId: Id<"users">; goal: string; count: number;
  community: unknown; answers: WelcomePersonalAnswer[]; persona?: string }): Promise<CommunityFormQuestion[] | null> {
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
        { role: "system", content: welcomePersonalPrompt(args.count) },
        { role: "user", content: JSON.stringify({ community: args.community, owner_goal: args.goal,
          member_answers: args.answers, ...(args.persona ? { member_described_as: args.persona } : {}) }, null, 2) },
      ],
      maxTokens: MAX_OUTPUT_TOKENS, tools: [], signal: controller.signal,
      apiKeyOverride: readEnv("OPENAI_API_KEY") || readEnv("ARX_OPENAI_API_KEY") || undefined,
    });
    if (!completion.ok || completion.type !== "assistant") { await fundedRun.fail(completion.code ?? "welcome_personal_unreadable"); return null; }
    if (!(await fundedRun.settle("provider_completed"))) return null;
    return normalizeWelcomePersonalQuestions(completion.assistantText, args.count, () => crypto.randomUUID());
  } catch {
    await fundedRun.fail("welcome_personal_provider_error").catch(() => undefined);
    return null;
  } finally { clearTimeout(timer); }
}

/** The member's personal questions for one block: written now on the first visit, the same ones after. */
export const askMyWelcomePersonalQuestions = action({
  args: { ...scope, blockKey: v.string() },
  handler: async (ctx, args): Promise<ReturnType<typeof project>> => {
    const context: any = await ctx.runQuery((internal as any).communityWelcomePersonal.personalContextInternal, args);
    if (context.existing) return context.existing;
    const block: WelcomePersonalBlock = context.block;
    const questions = await writeQuestions(ctx, { communityId: args.communityId, actorUserId: context.userId, goal: block.goal,
      count: block.count, community: context.community, answers: context.answers });
    return await ctx.runMutation((internal as any).communityWelcomePersonal.storePersonalQuestionsInternal, {
      communityId: args.communityId, membershipId: context.membershipId, blockKey: args.blockKey, goal: block.goal,
      source: questions ? "agent" : "backup", questions: questions ?? welcomePersonalBackup(block.backup, `backup-${args.blockKey}`),
    });
  },
});

export const saveMyWelcomePersonalAnswers = mutation({
  args: { ...scope, blockKey: v.string(), answers: answersValidator, done: v.boolean() },
  handler: async (ctx, args) => {
    const { membershipId } = await ownMembership(ctx, args);
    const row = await ctx.db.query("communityWelcomePersonalQuestions").withIndex("by_membership_block", (q) => q.eq("membershipId", membershipId).eq("blockKey", args.blockKey)).unique();
    if (!row) throw new Error("welcome_personal_unavailable");
    const issue = formAnswersIssue(row.questions, args.answers, args.done);
    if (issue) throw new Error(issue);
    await ctx.db.patch(row._id, { answers: args.answers, updatedAt: Date.now(), ...(args.done && !row.answeredAt ? { answeredAt: Date.now() } : {}) });
    return { answered: args.done || Boolean(row.answeredAt) };
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

/** The owner's preview: the questions the agent would write for a pretend member. Nothing is saved. */
export const previewWelcomePersonalQuestions = action({
  args: { ...scope, goal: v.string(), count: v.number(), persona: v.string(),
    answers: v.array(v.object({ question: v.string(), answer: v.string() })) },
  handler: async (ctx, args): Promise<{ questions: CommunityFormQuestion[] | null }> => {
    const goal = args.goal.trim().slice(0, WELCOME_PERSONAL_GOAL_MAX);
    if (!goal) throw new Error("welcome_personal_invalid");
    const context: any = await ctx.runQuery((internal as any).communityWelcomePersonal.previewContextInternal, { communityId: args.communityId, authSubject: args.authSubject });
    const questions = await writeQuestions(ctx, { communityId: args.communityId, actorUserId: context.userId, goal,
      count: Math.max(1, Math.min(WELCOME_PERSONAL_QUESTIONS_MAX, Math.round(args.count) || 1)), community: context.community,
      answers: args.answers.slice(0, 40).map((item) => ({ question: item.question.slice(0, 500), answer: item.answer.slice(0, 1_500) })),
      persona: args.persona.trim().slice(0, WELCOME_PERSONAL_BACKUP_MAX) || undefined });
    return { questions };
  },
});
