// Hard-to-undo Settings changes an agent proposes and the owner applies
// (Rashid, 2026-10-25: "Direct, risky ones need Apply"). The agent's
// polynet_call stages a proposal; nothing changes until a manager taps Apply
// in the app. Apply runs the Settings page's own function as that manager, so
// the change carries the person's authority, not the agent's.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { resolveUserIdForAuthenticatedRequest } from "./authActor";
import { requireCommunityManager } from "./communityCore";
import { builderSettingOperation } from "./polynetBuilderSettings";

export const SETTING_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STAGED_PER_COMMUNITY = 20;
const RECENT_LIMIT = 20;

type ProposalRow = {
  _id: any; communityId: any; createdByUserId: any; operation: string; args: Record<string, unknown>;
  summary: string; details: Array<{ label: string; value: string }>; note?: string; status: string;
  error?: string; createdAt: number; expiresAt: number; decidedAt?: number;
};

const isExpired = (row: ProposalRow, nowMs: number) => row.status === "staged" && row.expiresAt <= nowMs;

function project(row: ProposalRow, nowMs: number) {
  return {
    proposal_id: String(row._id),
    community_id: String(row.communityId),
    operation: row.operation,
    summary: row.summary,
    details: row.details,
    note: row.note ?? null,
    status: isExpired(row, nowMs) ? "expired" : row.status,
    error: row.error ?? null,
    created_at: new Date(row.createdAt).toISOString(),
    expires_at: new Date(row.expiresAt).toISOString(),
    decided_at: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
  };
}

const show = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);

const money = (value: unknown) => typeof value === "number" ? `$${(value / 100).toFixed(2)}` : "None";
// Plain words for each field the proposed operations take. A field not here
// isn't shown (revisions, generations), so the card never shows a raw name.
const FIELD_LABELS: Record<string, { label: string; value?: (value: unknown) => string }> = {
  mode: { label: "Joining", value: value => value === "approval" ? "You approve each request" : value === "open" ? "Anyone can join" : show(value) },
  monthlyAmountBaseUnits: { label: "Monthly price", value: money },
  annualAmountBaseUnits: { label: "Yearly price", value: money },
  integrationId: { label: "Connected service" },
  milestoneKey: { label: "Stage" },
  accessMode: { label: "Who can see it" },
  acknowledgeHistoryExposure: { label: "Past posts", value: value => value ? "Become visible to the new audience" : "Stay hidden" },
  role: { label: "New role", value: value => typeof value === "string" ? value[0].toUpperCase() + value.slice(1) : show(value) },
  reason: { label: "Reason" },
};

// What the owner reads on the card: names, not ids, where Polynet knows them.
async function describe(ctx: any, args: Record<string, unknown>) {
  const details: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === "communityId" || key.startsWith("expected")) continue;
    let shown = show(value);
    if ((key === "membershipId" || key === "targetMembershipId") && typeof value === "string") {
      const membership = await ctx.db.get(value as any).catch(() => null);
      const user = membership?.userId ? await ctx.db.get(membership.userId) : null;
      if (user) shown = user.displayName ?? user.handle ?? shown;
      details.push({ label: "Member", value: shown });
      continue;
    }
    if (key === "channelId" && typeof value === "string") {
      const channel = await ctx.db.get(value as any).catch(() => null);
      details.push({ label: "Channel", value: channel?.name ? `#${channel.name}` : shown });
      continue;
    }
    const field = FIELD_LABELS[key];
    if (!field) continue;
    details.push({ label: field.label, value: (field.value ? field.value(value) : shown).slice(0, 200) });
  }
  return details;
}

export const stageSettingProposalInternal = internalMutation({
  args: {
    userId: v.id("users"), communityId: v.id("communities"), operation: v.string(),
    args: v.any(), note: v.optional(v.string()), idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const spec = builderSettingOperation(args.operation);
    if (spec?.review !== "owner_apply") throw new Error("setting_proposal_operation_invalid");
    await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
    const nowMs = Date.now();
    const existing = (await ctx.db.query("communitySettingProposals")
      .withIndex("by_community_creator_idempotencyKey", q =>
        q.eq("communityId", args.communityId).eq("createdByUserId", args.userId).eq("idempotencyKey", args.idempotencyKey))
      .first()) as ProposalRow | null;
    if (existing) {
      if (existing.operation !== args.operation || JSON.stringify(existing.args) !== JSON.stringify(args.args))
        throw new Error("setting_proposal_idempotency_conflict");
      return project(existing, nowMs);
    }
    const staged = (await ctx.db.query("communitySettingProposals")
      .withIndex("by_community_status_createdAt", q => q.eq("communityId", args.communityId).eq("status", "staged"))
      .take(MAX_STAGED_PER_COMMUNITY + 1) as ProposalRow[]).filter(row => !isExpired(row, nowMs));
    if (staged.length >= MAX_STAGED_PER_COMMUNITY) throw new Error("setting_proposal_limit_reached");
    const id = await ctx.db.insert("communitySettingProposals", {
      communityId: args.communityId, createdByUserId: args.userId, operation: args.operation, args: args.args,
      summary: spec.name, details: await describe(ctx, args.args),
      ...(args.note ? { note: args.note.slice(0, 300) } : {}),
      status: "staged", idempotencyKey: args.idempotencyKey, createdAt: nowMs, updatedAt: nowMs,
      expiresAt: nowMs + SETTING_PROPOSAL_TTL_MS,
    });
    return project((await ctx.db.get(id)) as ProposalRow, nowMs);
  },
});

const scope = { authSubject: v.optional(v.string()), communityId: v.id("communities") };

async function managerUserId(ctx: any, args: { authSubject?: string; communityId: any }) {
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
  await requireCommunityManager({ ctx, communityId: args.communityId, userId });
  return userId;
}

// Waiting proposals first, then the latest outcomes, for the Apply cards and
// for the agent to see what happened.
export const listCommunitySettingProposals = query({
  args: scope,
  handler: async (ctx, args) => {
    await managerUserId(ctx, args);
    const nowMs = Date.now();
    const rows = await ctx.db.query("communitySettingProposals")
      .withIndex("by_community_createdAt", q => q.eq("communityId", args.communityId))
      .order("desc").take(RECENT_LIMIT + MAX_STAGED_PER_COMMUNITY) as ProposalRow[];
    const projected = rows.map(row => project(row, nowMs));
    return {
      pending: projected.filter(row => row.status === "staged").reverse(),
      recent: projected.filter(row => row.status !== "staged").slice(0, RECENT_LIMIT),
    };
  },
});

export const rejectCommunitySettingProposal = mutation({
  args: { ...scope, proposalId: v.id("communitySettingProposals") },
  handler: async (ctx, args) => {
    const userId = await managerUserId(ctx, args);
    const row = await ctx.db.get(args.proposalId) as ProposalRow | null;
    if (!row || String(row.communityId) !== String(args.communityId)) throw new Error("setting_proposal_not_found");
    const nowMs = Date.now();
    if (row.status !== "staged" || isExpired(row, nowMs)) return project(row, nowMs);
    await ctx.db.patch(args.proposalId, { status: "rejected", decidedAt: nowMs, decidedByUserId: userId, updatedAt: nowMs });
    return project((await ctx.db.get(args.proposalId)) as ProposalRow, nowMs);
  },
});

export const claimSettingProposalInternal = internalMutation({
  args: { ...scope, proposalId: v.id("communitySettingProposals") },
  handler: async (ctx, args) => {
    const userId = await managerUserId(ctx, args);
    const row = await ctx.db.get(args.proposalId) as ProposalRow | null;
    if (!row || String(row.communityId) !== String(args.communityId)) throw new Error("setting_proposal_not_found");
    const nowMs = Date.now();
    if (isExpired(row, nowMs)) throw new Error("setting_proposal_expired");
    if (row.status !== "staged") throw new Error(`setting_proposal_${row.status}`);
    await ctx.db.patch(args.proposalId, { status: "applying", decidedAt: nowMs, decidedByUserId: userId, updatedAt: nowMs });
    return { operation: row.operation, args: row.args };
  },
});

export const finishSettingProposalInternal = internalMutation({
  args: { proposalId: v.id("communitySettingProposals"), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    await ctx.db.patch(args.proposalId, { status: args.ok ? "applied" : "failed",
      ...(args.error ? { error: args.error.slice(0, 300) } : {}), updatedAt: nowMs });
    return project((await ctx.db.get(args.proposalId)) as ProposalRow, nowMs);
  },
});

const refusal = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^.*Uncaught Error: /s, "").split("\n")[0].slice(0, 300);

// The owner's Apply. It claims the proposal (so two taps can't run it twice),
// runs the Settings function as the person applying, and records the outcome.
export const applyCommunitySettingProposal = action({
  args: { ...scope, proposalId: v.id("communitySettingProposals") },
  handler: async (ctx, args): Promise<any> => {
    const claimed = await ctx.runMutation(internal.communitySettingProposals.claimSettingProposalInternal, args);
    const spec = builderSettingOperation(claimed.operation);
    if (!spec) {
      return await ctx.runMutation(internal.communitySettingProposals.finishSettingProposalInternal,
        { proposalId: args.proposalId, ok: false, error: "setting_proposal_operation_invalid" });
    }
    const callArgs = { ...claimed.args, authSubject: args.authSubject, ...(spec.community === false ? {} : { communityId: args.communityId }) };
    try {
      if (spec.kind === "action") await ctx.runAction(spec.ref, callArgs);
      else await ctx.runMutation(spec.ref, callArgs);
    } catch (error) {
      return await ctx.runMutation(internal.communitySettingProposals.finishSettingProposalInternal,
        { proposalId: args.proposalId, ok: false, error: refusal(error) });
    }
    return await ctx.runMutation(internal.communitySettingProposals.finishSettingProposalInternal,
      { proposalId: args.proposalId, ok: true });
  },
});
