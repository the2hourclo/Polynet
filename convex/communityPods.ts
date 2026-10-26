import { query } from "./_generated/server";
import { v } from "convex/values";
import { communityMembershipRowIsActive, getUniqueCommunityMembershipByPair, normalizeIdValue, resolvePublicUserId,
  resolveUserIdForAuthenticatedRequest } from "./communityCore";
import { resolveAuthorizedCommunityChannel } from "./communityChannelCore";
import { getCommunityChannelCapabilities, resolveCommunityChannelActor } from "./communityChannelAccess";
import { resolveUserProfileDisplayProjection } from "./userProfileProjection";

// Pods (Rashid, 2026-10-26): Classroom shows each invite-only room as a pod,
// with the faces of everyone who can see it. A read model over the existing
// channel policy and grants, never another access list:
// the owner, admins (they can open every room) and members with an exact,
// still-valid grant, plus the community agent when it has its own grant.

const MAX_PODS_PER_CALL = 12;
const MAX_GRANTS_READ = 200;
const MAX_MEMBERSHIPS_READ = 1000;
const MAX_FACES = 12;

type PodPerson = {
  user_id: string;
  role: "owner" | "admin" | "member";
  profile: Awaited<ReturnType<typeof resolveUserProfileDisplayProjection>>;
  last_seen_at: number | null;
  active_until: number | null;
};

export const listPodPeople = query({
  args: {
    communityId: v.id("communities"),
    channelIds: v.array(v.id("communityChannels")),
    userId: v.optional(v.id("users")),
    authSubject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdForAuthenticatedRequest({ ctx, userId: args.userId, authSubject: args.authSubject ?? null });
    const actor = await resolveCommunityChannelActor({ ctx, communityId: args.communityId, userId });
    const community = (await ctx.db.get(args.communityId))!;
    const channelIds = [...new Set(args.channelIds.map(String))].slice(0, MAX_PODS_PER_CALL);

    // Admins can see every pod, so they are read once for all of them.
    let admins: Array<{ userId: any }> | null = null;
    const loadAdmins = async () => {
      if (admins) return admins;
      const rows = await ctx.db.query("communityMemberships")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId)).take(MAX_MEMBERSHIPS_READ);
      admins = rows.filter((row) => row.role === "admin" && communityMembershipRowIsActive(row) && row.userId !== community.ownerId);
      return admins;
    };
    const person = async (personId: any, role: PodPerson["role"]): Promise<PodPerson> => {
      const presence = await ctx.db.query("communityPresence")
        .withIndex("by_community_user", (q) => q.eq("communityId", args.communityId).eq("userId", personId)).first();
      return {
        user_id: (await resolvePublicUserId(ctx, personId)) ?? String(personId),
        role,
        profile: await resolveUserProfileDisplayProjection(ctx, personId),
        last_seen_at: presence?.lastSeenAt ?? null,
        active_until: presence?.activeUntil ?? null,
      };
    };

    const pods = [];
    for (const channelId of channelIds) {
      let channel;
      try {
        channel = await resolveAuthorizedCommunityChannel({ ctx, communityId: args.communityId, channelId, actor, capability: "canRead" });
      } catch {
        // A room the caller can't open is left out without saying why.
        continue;
      }
      if (channel.accessMode !== "restricted") continue;
      const roles = new Map<string, { id: any; role: PodPerson["role"] }>();
      roles.set(normalizeIdValue(community.ownerId), { id: community.ownerId, role: "owner" });
      for (const admin of await loadAdmins()) roles.set(normalizeIdValue(admin.userId), { id: admin.userId, role: "admin" });
      const grants = await ctx.db.query("communityChannelParticipants")
        .withIndex("by_channel_principal", (q) => q.eq("channelId", channel._id as any)).take(MAX_GRANTS_READ);
      let agent = false;
      for (const grant of grants) {
        if (grant.status !== "active" || grant.communityId !== args.communityId) continue;
        if (grant.principalKey === "community_agent") { agent = true; continue; }
        if (!grant.principalKey.startsWith("user:")) continue;
        const grantedUserId = grant.principalKey.slice("user:".length);
        if (roles.has(grantedUserId)) continue;
        const membership = await getUniqueCommunityMembershipByPair({ ctx, communityId: args.communityId, userId: grantedUserId });
        if (!membership || !communityMembershipRowIsActive(membership)
          || normalizeIdValue(grant.membershipId) !== normalizeIdValue(membership._id)
          || grant.membershipActivationSequence !== Math.max(0, Math.floor(Number(membership.activationSequence ?? 0)))) continue;
        roles.set(grantedUserId, { id: membership.userId, role: membership.role === "admin" ? "admin" : "member" });
      }
      if (agent) {
        const agentActor = await resolveCommunityChannelActor({ ctx, communityId: args.communityId, userId, kind: "community_agent" });
        agent = (await getCommunityChannelCapabilities({ ctx, channel, actor: agentActor })).canRead;
      }
      // Invited members first, then admins, then the owner: the faces a member
      // recognises as "their" pod lead the stack.
      const order = { member: 0, admin: 1, owner: 2 } as const;
      const everyone = [...roles.values()].sort((a, b) => order[a.role] - order[b.role]);
      const people = [];
      for (const entry of everyone.slice(0, MAX_FACES)) people.push(await person(entry.id, entry.role));
      pods.push({ channel_id: String(channel._id), people, people_count: everyone.length, agent });
    }
    return { pods };
  },
});
