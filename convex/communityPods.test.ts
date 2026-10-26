/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob(["./communityPods.ts", "./communityChannelParticipants.ts", "./_generated/**/*.*s"]);
const set = "communityChannelParticipants:setParticipant" as any;
const people = "communityPods:listPodPeople" as any;

async function fixture() {
  const t = convexTest(schema, modules);
  const f = await t.run(async ctx => {
    const user = async (name: string) => ctx.db.insert("users", { authSubject: name, displayName: name, createdAt: 1, updatedAt: 1 });
    const ownerId = await user("owner"), memberId = await user("member"), adminId = await user("admin"), outsiderId = await user("outsider");
    const communityId = await ctx.db.insert("communities", { ownerId, name: "Builders", slug: "builders",
      visibility: "unlisted", entryPolicy: "open", inferenceFundingPolicy: "managed_required", createdAt: 1, updatedAt: 1 });
    const membershipId = await ctx.db.insert("communityMemberships", { communityId, userId: memberId, role: "member",
      active: true, activationSequence: 1, accessSource: "manual_grant", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("communityMemberships", { communityId, userId: adminId, role: "admin",
      active: true, activationSequence: 1, accessSource: "manual_grant", createdAt: 2, updatedAt: 2 });
    await ctx.db.insert("communityMemberships", { communityId, userId: outsiderId, role: "member",
      active: true, activationSequence: 1, accessSource: "manual_grant", createdAt: 3, updatedAt: 3 });
    const podId = await ctx.db.insert("communityChannels", { communityId, name: "Agency owners", slug: "agency-owners", position: 1,
      accessMode: "restricted", postingPolicy: "members", status: "active", createdAt: 1, updatedAt: 1 });
    const topicId = await ctx.db.insert("communityChannels", { communityId, name: "Wins", slug: "wins", position: 2,
      accessMode: "all_members", postingPolicy: "members", status: "active", createdAt: 1, updatedAt: 1 });
    return { ownerId, memberId, adminId, outsiderId, communityId, membershipId, podId, topicId };
  });
  const owner = t.withIdentity({ subject: "owner" });
  const member = t.withIdentity({ subject: "member" });
  const outsider = t.withIdentity({ subject: "outsider" });
  return { t, f, owner, member, outsider };
}

test("a pod lists its invited members, admins and owner, and the agent when it has a grant", async () => {
  const { t, f, owner, member } = await fixture();
  await owner.mutation(set, { communityId: f.communityId, channelId: f.podId, target: { kind: "member", userId: f.memberId }, active: true });
  await owner.mutation(set, { communityId: f.communityId, channelId: f.podId, target: { kind: "community_agent" }, active: true });
  const now = Date.now();
  await t.run(ctx => ctx.db.insert("communityPresence", { communityId: f.communityId, userId: f.memberId,
    lastSeenAt: now, activeUntil: now + 90000, createdAt: now, updatedAt: now }));
  const result: any = await member.query(people, { communityId: f.communityId, channelIds: [f.podId] });
  expect(result.pods).toHaveLength(1);
  expect(result.pods[0]).toMatchObject({ channel_id: String(f.podId), people_count: 3, agent: true });
  expect(result.pods[0].people.map((row: any) => [row.profile.display_name, row.role])).toEqual([["member", "member"], ["admin", "admin"], ["owner", "owner"]]);
  expect(result.pods[0].people[0]).toMatchObject({ last_seen_at: now, active_until: now + 90000 });
});

test("pods leave out rooms the caller can't open, shared channels and revoked or stale grants", async () => {
  const { t, f, owner, outsider } = await fixture();
  await owner.mutation(set, { communityId: f.communityId, channelId: f.podId, target: { kind: "member", userId: f.memberId }, active: true });
  expect((await outsider.query(people, { communityId: f.communityId, channelIds: [f.podId, f.topicId] }) as any).pods).toEqual([]);
  // Rejoining doesn't bring an old grant back, so the member drops out of the faces.
  await t.run(ctx => ctx.db.patch(f.membershipId, { activationSequence: 2 }));
  const afterRejoin: any = await owner.query(people, { communityId: f.communityId, channelIds: [f.podId] });
  expect(afterRejoin.pods[0].people.map((row: any) => row.profile.display_name)).toEqual(["admin", "owner"]);
  await owner.mutation(set, { communityId: f.communityId, channelId: f.podId, target: { kind: "member", userId: f.memberId }, active: false });
  const afterRevoke: any = await owner.query(people, { communityId: f.communityId, channelIds: [f.podId] });
  expect(afterRevoke.pods[0]).toMatchObject({ people_count: 2, agent: false });
});
