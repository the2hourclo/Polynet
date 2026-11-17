/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./*.ts", "!./*.test.ts", "./_generated/**/*.*s"]);
const NOW = 1_790_000_000_000;

async function seed(t: any) {
  return await t.run(async (ctx: any) => {
    const user = (subject: string, name: string) => ctx.db.insert("users", { authSubject: subject, displayName: name, createdAt: NOW, updatedAt: NOW });
    const ownerId = await user("owner", "Neil");
    const communityId = await ctx.db.insert("communities", { ownerId, slug: "props", name: "Props", visibility: "published",
      inferenceFundingPolicy: "managed_required", entryPolicy: "open", activeMemberCount: 2, createdAt: NOW, updatedAt: NOW });
    const memberId = await user("jon", "Jon");
    const membershipId = await ctx.db.insert("communityMemberships", { communityId, userId: memberId, role: "member", state: "active", accessSource: "free_grant", createdAt: NOW, updatedAt: NOW });
    const otherId = await user("ana", "Ana");
    await ctx.db.insert("communityMemberships", { communityId, userId: otherId, role: "member", state: "active", accessSource: "free_grant", createdAt: NOW, updatedAt: NOW });
    return { communityId, membershipId };
  });
}

test("a host defines properties, fills them in, and sees up to three in the table", async () => {
  const t = convexTest(schema, modules);
  const { communityId, membershipId } = await seed(t);
  const host = t.withIdentity({ subject: "owner" });
  const p = (api as any).communityMemberProperties;
  await host.mutation(p.createCommunityMemberProperty, { authSubject: "owner", communityId, name: "Business type", type: "select", options: ["Coach", "Agency"], inTable: true });
  await host.mutation(p.createCommunityMemberProperty, { authSubject: "owner", communityId, name: "Revenue", type: "number", inTable: true });
  await host.mutation(p.createCommunityMemberProperty, { authSubject: "owner", communityId, name: "Started", type: "date", inTable: true });
  const fourth = await host.mutation(p.createCommunityMemberProperty, { authSubject: "owner", communityId, name: "Website", type: "url", inTable: true });
  const list = await host.query(p.listCommunityMemberProperties, { authSubject: "owner", communityId });
  expect(list.map((row: any) => [row.key, row.in_table])).toEqual([["business_type", true], ["revenue", true], ["started", true], ["website", false]]);
  await expect(host.mutation(p.updateCommunityMemberProperty, { authSubject: "owner", communityId, key: fourth.key, inTable: true })).rejects.toThrow(/member_property_table_full/);

  await host.mutation(p.setCommunityMemberPropertyValue, { authSubject: "owner", communityId, membershipId, key: "business_type", value: "coach" });
  await host.mutation(p.setCommunityMemberPropertyValue, { authSubject: "owner", communityId, membershipId, key: "revenue", value: 12000 });
  await host.mutation(p.setCommunityMemberPropertyValue, { authSubject: "owner", communityId, membershipId, key: "website", value: "example.com" });
  await expect(host.mutation(p.setCommunityMemberPropertyValue, { authSubject: "owner", communityId, membershipId, key: "revenue", value: "lots" })).rejects.toThrow(/member_property_value_invalid/);
  await expect(host.mutation(p.setCommunityMemberPropertyValue, { authSubject: "owner", communityId, membershipId, key: "business_type", value: "SaaS" })).rejects.toThrow(/member_property_value_invalid/);

  expect(await host.query(p.getCommunityMemberPropertyValues, { authSubject: "owner", communityId, membershipId }))
    .toEqual({ business_type: "Coach", revenue: 12000, website: "https://example.com/" });
  expect(await host.query(p.listCommunityMemberTableValues, { authSubject: "owner", communityId }))
    .toEqual({ [String(membershipId)]: { business_type: "Coach", revenue: 12000 } });

  // Taking a choice away clears it from the members who had it.
  await host.mutation(p.updateCommunityMemberProperty, { authSubject: "owner", communityId, key: "business_type", options: ["Agency", "SaaS"] });
  expect(await host.query(p.getCommunityMemberPropertyValues, { authSubject: "owner", communityId, membershipId })).not.toHaveProperty("business_type");

  // Clearing a value removes it; archiving hides the property and never reuses its key.
  await host.mutation(p.setCommunityMemberPropertyValue, { authSubject: "owner", communityId, membershipId, key: "revenue", value: null });
  await host.mutation(p.archiveCommunityMemberProperty, { authSubject: "owner", communityId, key: "website" });
  expect(await host.query(p.getCommunityMemberPropertyValues, { authSubject: "owner", communityId, membershipId })).toEqual({});
  const again = await host.mutation(p.createCommunityMemberProperty, { authSubject: "owner", communityId, name: "Website", type: "url" });
  expect(again.key).toBe("website_2");
});

test("members can't read or write properties", async () => {
  const t = convexTest(schema, modules);
  const { communityId, membershipId } = await seed(t);
  const p = (api as any).communityMemberProperties;
  await t.withIdentity({ subject: "owner" }).mutation(p.createCommunityMemberProperty, { authSubject: "owner", communityId, name: "Stage", type: "text" });
  const member = t.withIdentity({ subject: "jon" });
  await expect(member.query(p.listCommunityMemberProperties, { authSubject: "jon", communityId })).rejects.toThrow();
  await expect(member.query(p.getCommunityMemberPropertyValues, { authSubject: "jon", communityId, membershipId })).rejects.toThrow();
  await expect(member.mutation(p.setCommunityMemberPropertyValue, { authSubject: "jon", communityId, membershipId, key: "stage", value: "Launch" })).rejects.toThrow();
});
