import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireCommunityManager, resolveUserIdForAuthenticatedRequest } from "./communityCore";

// A member's guide channel (their private room with you and the agent) is an
// invite-only channel too, but it isn't a pod: automations never add people to
// it or start when someone is added. Nothing on the channel row says which it
// is; a membership pointing at it as its serviceChannelId does.

const MAX_MEMBERSHIPS_READ = 1000;

export async function workflowGuideChannelIds(ctx: any, communityId: any): Promise<Set<string>> {
  const rows = await ctx.db.query("communityMemberships")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId)).take(MAX_MEMBERSHIPS_READ);
  return new Set(rows.flatMap((row: any) => row.serviceChannelId ? [String(row.serviceChannelId)] : []));
}

export const listWorkflowGuideChannelIds = query({
  args: { communityId: v.id("communities"), authSubject: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string[]> => {
    const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: args.authSubject ?? null });
    await requireCommunityManager({ ctx, communityId: args.communityId, userId });
    return [...await workflowGuideChannelIds(ctx, args.communityId)];
  },
});
