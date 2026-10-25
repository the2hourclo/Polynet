/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./communityAdmin.ts",
  "./communityPublic.ts",
  "./communityDirectory.ts",
  "./_generated/**/*.*s",
]);

async function fixture() {
  const t = convexTest(schema, modules);
  const nowMs = Date.now();
  const ids = await t.run(async (ctx) => {
    const user = (subject: string, handle: string) => ctx.db.insert("users", {
      authSubject: subject, displayName: handle, handle, normalizedHandle: handle, createdAt: nowMs, updatedAt: nowMs,
    });
    const ownerId = await user("cc-owner", "rashid");
    const janeId = await user("cc-jane", "jane");
    const adminId = await user("cc-admin", "ada");
    const communityId = await ctx.db.insert("communities", {
      ownerId, slug: "aieb", name: "AI Employee Builders", visibility: "published",
      inferenceFundingPolicy: "managed_required", entryPolicy: "open", activeMemberCount: 2, createdAt: nowMs, updatedAt: nowMs,
    });
    const member = (userId: any, role: "admin" | "member") => ctx.db.insert("communityMemberships", {
      communityId, userId, role, accessSource: "free_grant", active: true, activationSequence: 1,
      activatedAt: nowMs, createdAt: nowMs, updatedAt: nowMs,
    });
    const janeMembership = await member(janeId, "member");
    const adminMembership = await member(adminId, "admin");
    return { communityId, janeMembership, adminMembership };
  });
  return { t, ...ids, asOwner: t.withIdentity({ subject: "cc-owner" }), asAdmin: t.withIdentity({ subject: "cc-admin" }) };
}

describe("co-creators", () => {
  test("the owner makes a member a co-creator; they show as a creator and can change the look", async () => {
    const f = await fixture();
    expect((await f.t.query(api.communityPublic.listCommunityCreators, { communityId: f.communityId })).creators.map((c) => [c.display_name, c.role]))
      .toEqual([["rashid", "owner"]]);

    await f.asOwner.mutation(api.communityAdmin.setCommunityMemberRole, { communityId: f.communityId, targetMembershipId: f.janeMembership, role: "co_creator" });
    const row = await f.t.run((ctx) => ctx.db.get(f.janeMembership));
    expect(row).toMatchObject({ role: "admin", coCreator: true });
    expect((await f.t.query(api.communityPublic.listCommunityCreators, { communityId: f.communityId })).creators.map((c) => [c.display_name, c.role]))
      .toEqual([["rashid", "owner"], ["jane", "co_creator"]]);

    // Back to member: no longer a creator, and the flag is gone.
    await f.asOwner.mutation(api.communityAdmin.setCommunityMemberRole, { communityId: f.communityId, targetMembershipId: f.janeMembership, role: "member" });
    expect(await f.t.run((ctx) => ctx.db.get(f.janeMembership))).toMatchObject({ role: "member" });
    expect((await f.t.run((ctx) => ctx.db.get(f.janeMembership)))?.coCreator).toBeUndefined();
    expect((await f.t.query(api.communityPublic.listCommunityCreators, { communityId: f.communityId })).creators).toHaveLength(1);
  });

  test("an admin cannot make anyone a co-creator", async () => {
    const f = await fixture();
    await expect(f.asAdmin.mutation(api.communityAdmin.setCommunityMemberRole, { communityId: f.communityId, targetMembershipId: f.janeMembership, role: "co_creator" }))
      .rejects.toThrow(/community_owner_required_for_admin_role/);
  });
});
