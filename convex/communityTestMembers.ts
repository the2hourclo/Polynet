import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUserIdForAuthenticatedRequest } from "./authActor";
import {
  adjustCommunityActiveMemberCountForMembershipTransition,
  getUniqueCommunityMembershipByPair,
  requireCommunityManager,
  type CommunityMembershipLike,
} from "./communityCore";
import { activateCommunityMembershipCore } from "./communityMembershipLifecycle";
import { deleteMemberWorkflowPosition, getCommunityMemberWorkflowByCommunity } from "./communityMemberWorkflowReadCore";
import { deleteCommunityPresenceForUser } from "./communityPresenceCore";
import { deleteCommunityReadCursorsForUserCommunity } from "./communityReadCursorCore";
import { deleteCommunityJoinRequestByPair } from "./communityJoinRequestCore";
import {
  TEST_MEMBER_SUBJECT_PREFIX,
  findTestMemberByUserId,
  type TestMemberRow,
} from "./communityTestMemberCore";

/** Running test members per community; each one is a full member record. */
export const COMMUNITY_TEST_MEMBER_LIMIT = 5;
// Test data is a few dozen rows; this bounds one end call per table.
const CLEANUP_BATCH = 500;

function randomToken(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function listRunning(ctx: any, communityId: any): Promise<TestMemberRow[]> {
  const rows = (await ctx.db.query("communityTestMembers")
    .withIndex("by_community_createdAt", (q: any) => q.eq("communityId", communityId))
    .order("desc").take(50)) as TestMemberRow[];
  return rows.filter((row) => row.endedAt === undefined);
}

async function requireManagerNotTestMember(ctx: any, args: { authSubject?: string; communityId: any }) {
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
  if (await findTestMemberByUserId(ctx, userId)) throw new Error("test_member_cannot_manage");
  const { community } = await requireCommunityManager({ ctx, communityId: args.communityId, userId });
  const owner = await ctx.db.get(userId);
  if (!owner) throw new Error("user_not_found");
  return { userId, community, ownerAuthSubject: String(owner.authSubject) };
}

async function deleteAll(ctx: any, rows: Array<{ _id: any }>) {
  for (const row of rows) await ctx.db.delete(row._id);
}

/** Removes everything the test member did in the community, then the membership. */
async function deleteTestMemberData(ctx: any, row: TestMemberRow, nowMs: number) {
  const { communityId, userId } = row;
  const membership = await getUniqueCommunityMembershipByPair({ ctx, communityId, userId });
  if (membership) {
    const membershipId = membership._id;
    const workflow = await getCommunityMemberWorkflowByCommunity({ ctx, communityId });
    await deleteAll(ctx, await ctx.db.query("communityFormRequests")
      .withIndex("by_member_status", (q: any) => q.eq("membershipId", membershipId)).take(CLEANUP_BATCH));
    await deleteAll(ctx, await ctx.db.query("communityClientEvents")
      .withIndex("by_membership_createdAt", (q: any) => q.eq("membershipId", membershipId)).take(CLEANUP_BATCH));
    await deleteAll(ctx, await ctx.db.query("communityClientValues")
      .withIndex("by_membership", (q: any) => q.eq("membershipId", membershipId)).take(CLEANUP_BATCH));
    if (workflow) {
      await deleteAll(ctx, await ctx.db.query("communityMemberWorkflowRuns")
        .withIndex("by_workflow_membership_createdAt", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membershipId))
        .take(CLEANUP_BATCH));
      await deleteAll(ctx, await ctx.db.query("communityMemberWorkflowTransitions")
        .withIndex("by_workflow_membership_seq", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membershipId))
        .take(CLEANUP_BATCH));
      await deleteAll(ctx, await ctx.db.query("communityMemberWorkflowTimers")
        .withIndex("by_member_entry", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membershipId))
        .take(CLEANUP_BATCH));
      await deleteMemberWorkflowPosition({ ctx, communityId, membershipId });
    }
    await ctx.db.delete(membershipId);
    await adjustCommunityActiveMemberCountForMembershipTransition({
      ctx, communityId, before: membership as CommunityMembershipLike, after: null,
    });
  }
  await deleteAll(ctx, await ctx.db.query("communityResourceProgress")
    .withIndex("by_community_user", (q: any) => q.eq("communityId", communityId).eq("userId", userId)).take(CLEANUP_BATCH));
  await deleteAll(ctx, await ctx.db.query("communityEmbedValues")
    .withIndex("by_community_user_key", (q: any) => q.eq("communityId", communityId).eq("userId", userId)).take(CLEANUP_BATCH));
  await deleteAll(ctx, await ctx.db.query("communityReferrals")
    .withIndex("by_community_user", (q: any) => q.eq("communityId", communityId).eq("userId", userId)).take(CLEANUP_BATCH));
  await deleteAll(ctx, await ctx.db.query("communityMemberSettings")
    .withIndex("by_community_user", (q: any) => q.eq("communityId", communityId).eq("userId", userId)).take(CLEANUP_BATCH));
  await deleteAll(ctx, await ctx.db.query("memberFacts")
    .withIndex("by_user_community", (q: any) => q.eq("userId", userId).eq("communityId", communityId)).take(CLEANUP_BATCH));
  await deleteCommunityReadCursorsForUserCommunity(ctx, communityId, userId);
  await deleteCommunityPresenceForUser({ ctx, communityId, userId });
  await deleteCommunityJoinRequestByPair({ ctx, communityId, userId });
  // The user row stays (chat posts point at it) but can no longer sign in as anything.
  await ctx.db.patch(row._id, { endedAt: nowMs });
}

function projectRow(row: TestMemberRow, membershipId: string | null, viewerUserId: any) {
  return {
    id: String(row._id),
    label: row.label,
    membership_id: membershipId,
    created_at: new Date(row.createdAt).toISOString(),
    // Only the manager who started a test run can open the community as it.
    mine: String(row.ownerUserId) === String(viewerUserId),
    auth_subject: String(row.ownerUserId) === String(viewerUserId) ? row.authSubject : null,
  };
}

export const listTestMembers = query({
  args: { authSubject: v.optional(v.string()), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerNotTestMember(ctx, args);
    const rows = await listRunning(ctx, args.communityId);
    const projected = await Promise.all(rows.map(async (row) => {
      const membership = await getUniqueCommunityMembershipByPair({ ctx, communityId: args.communityId, userId: row.userId });
      return projectRow(row, membership ? String(membership._id) : null, userId);
    }));
    return { kind: "community_test_members", limit: COMMUNITY_TEST_MEMBER_LIMIT, test_members: projected };
  },
});

/** Creates a test member that joins like a new member: join rules, welcome flow and all. */
export const startTestMember = mutation({
  args: { authSubject: v.optional(v.string()), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const { userId, ownerAuthSubject } = await requireManagerNotTestMember(ctx, args);
    const running = await listRunning(ctx, args.communityId);
    if (running.length >= COMMUNITY_TEST_MEMBER_LIMIT) throw new Error("test_member_limit_reached");
    const nowMs = Date.now();
    const latest = (await ctx.db.query("communityTestMembers")
      .withIndex("by_community_createdAt", (q: any) => q.eq("communityId", args.communityId))
      .order("desc").first()) as TestMemberRow | null;
    const number = (latest?.number ?? 0) + 1;
    const label = `Test member ${number}`;
    const token = randomToken(12);
    const authSubject = `${TEST_MEMBER_SUBJECT_PREFIX}${token}`;
    const handle = `test-${token.slice(0, 8)}`;
    const testUserId = await ctx.db.insert("users", {
      authSubject, displayName: label, handle, normalizedHandle: handle, createdAt: nowMs, updatedAt: nowMs,
    });
    const testMemberId = await ctx.db.insert("communityTestMembers", {
      communityId: args.communityId, userId: testUserId, authSubject, ownerUserId: userId, ownerAuthSubject,
      label, number, createdAt: nowMs,
    });
    const activation = await activateCommunityMembershipCore({
      ctx, communityId: args.communityId, userId: testUserId, role: "member",
      accessSource: "manual_grant", activationReason: "test_member", nowMs,
    });
    return {
      id: String(testMemberId),
      label,
      auth_subject: authSubject,
      membership_id: String(activation.membership._id),
    };
  },
});

/** Ends a test run: the test member and everything it did in the community are deleted. */
export const endTestMember = mutation({
  args: { authSubject: v.optional(v.string()), communityId: v.id("communities"), testMemberId: v.id("communityTestMembers") },
  handler: async (ctx, args) => {
    await requireManagerNotTestMember(ctx, args);
    const row = (await ctx.db.get(args.testMemberId)) as TestMemberRow | null;
    if (!row || String(row.communityId) !== String(args.communityId)) throw new Error("test_member_not_found");
    if (row.endedAt !== undefined) return { ok: true };
    await deleteTestMemberData(ctx, row, Date.now());
    return { ok: true };
  },
});

/** In a test-run tab: who the tab is acting as, so the page can say so. */
export const getMyTestRun = query({
  args: { authSubject: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
    const row = await findTestMemberByUserId(ctx, userId);
    if (!row || row.endedAt !== undefined) return null;
    const community = (await ctx.db.get(row.communityId)) as { slug?: string; name?: string } | null;
    return {
      label: row.label,
      community_id: String(row.communityId),
      community_slug: community?.slug ?? null,
      community_name: community?.name ?? null,
    };
  },
});
