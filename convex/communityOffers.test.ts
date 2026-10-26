/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  communityOfferAudienceIncludes,
  communityOfferKeyFromName,
  communityOffersHeld,
  diffCommunityOffersHeld,
  resolveCommunityOfferLadder,
} from "../shared/communityOffers";
import { workflowConditionHolds } from "../shared/communityMemberWorkflow";

const modules = import.meta.glob([
  "./communityOffers.ts",
  "./communityAccess.ts",
  "./communityAccessSync.ts",
  "./communityClients.ts",
  "./communityCommerce.ts",
  "./communityMemberWorkflows.ts",
  "./communityResourceProgress.ts",
  "./communityLessonTracks.ts",
  "./communityChannelParticipants.ts",
  "./_generated/**/*.*s",
]);

const DAY = 24 * 60 * 60 * 1000;
const internalApi = internal as any;

describe("the offer ladder", () => {
  const ladder = [
    { key: "membership", name: "Membership", rank: 0, isBase: true },
    { key: "consulting", name: "Membership + Consulting", rank: 1 },
    { key: "done-for-you", name: "Done for you", rank: 2 },
  ];

  test("a member has their offer and every one below it; nobody has none", () => {
    expect(communityOffersHeld(ladder, "consulting").map((offer) => offer.key)).toEqual(["membership", "consulting"]);
    expect(communityOffersHeld(ladder, "membership").map((offer) => offer.key)).toEqual(["membership"]);
    expect(communityOffersHeld(ladder, null)).toEqual([]);
    // An offer that no longer exists falls back to the base one.
    expect(communityOffersHeld(ladder, "gone").map((offer) => offer.key)).toEqual(["membership"]);
  });

  test("with nothing saved the community sells one offer, Membership", () => {
    expect(resolveCommunityOfferLadder([])).toEqual([{ key: "membership", name: "Membership", rank: 0, isBase: true }]);
  });

  test("an audience lets in the offers it names and the ones above them", () => {
    const consulting = communityOffersHeld(ladder, "consulting");
    const base = communityOffersHeld(ladder, "membership");
    expect(communityOfferAudienceIncludes(["consulting"], consulting)).toBe(true);
    expect(communityOfferAudienceIncludes(["consulting"], base)).toBe(false);
    expect(communityOfferAudienceIncludes(["membership"], consulting)).toBe(true);
    expect(communityOfferAudienceIncludes([], base)).toBe(true);
  });

  test("keys come from names and never repeat; diffs list what started and ended", () => {
    expect(communityOfferKeyFromName("Membership + Consulting", new Set(["membership"]))).toBe("membership-consulting");
    expect(communityOfferKeyFromName("Consulting", new Set(["consulting"]))).toBe("consulting-2");
    expect(diffCommunityOffersHeld(["membership"], ["membership", "consulting"])).toEqual({ started: ["consulting"], ended: [] });
    expect(diffCommunityOffersHeld(["membership", "consulting"], [])).toEqual({ started: [], ended: ["membership", "consulting"] });
  });

  test("the Offer property works with today's Only if: a Consulting member is on both offers", () => {
    const names = ["Membership", "Membership + Consulting"];
    expect(workflowConditionHolds({ propertyKey: "polynet_offer", op: "is", value: "Membership + Consulting" }, names)).toBe(true);
    expect(workflowConditionHolds({ propertyKey: "polynet_offer", op: "is", value: "Membership + Consulting" }, ["Membership"])).toBe(false);
  });
});

async function fixture() {
  const t = convexTest(schema, modules);
  const nowMs = Date.now();
  const ids = await t.run(async (ctx) => {
    const user = (subject: string, handle: string, email: string) => ctx.db.insert("users", {
      authSubject: subject, displayName: handle, handle, normalizedHandle: handle, createdAt: nowMs, updatedAt: nowMs,
      email, normalizedEmail: email, emailVerifiedAt: nowMs,
    });
    const ownerId = await user("offers-owner", "rashid", "owner@example.com");
    const thomasId = await user("offers-thomas", "thomas", "thomas@example.com");
    const deanId = await user("offers-dean", "dean", "dean@example.com");
    const annaId = await user("offers-anna", "anna", "anna@example.com");
    await ctx.db.insert("operatorRoles", { userId: ownerId, role: "owner", active: true, createdAt: nowMs, updatedAt: nowMs });
    const communityId = await ctx.db.insert("communities", {
      ownerId, slug: "aieb", name: "AI Employee Builders", lifecycleStatus: "active", visibility: "unlisted",
      inferenceFundingPolicy: "managed_required", entryPolicy: "paid_subscription", activeMemberCount: 2, createdAt: nowMs, updatedAt: nowMs,
    });
    const pricePointId = await ctx.db.insert("communityPricePoints", {
      communityId, billingPeriod: "monthly", name: "Monthly", amountBaseUnits: 13000, currency: "usd", currencyDecimals: 2,
      isCurrent: true, createdAt: nowMs, updatedAt: nowMs,
    });
    const member = (userId: any, accessSource: "paid_subscription" | "manual_grant") => ctx.db.insert("communityMemberships", {
      communityId, userId, role: "member", accessSource, ...(accessSource === "paid_subscription" ? { pricePointId } : {}),
      active: true, activationSequence: 1, activatedAt: nowMs - DAY, createdAt: nowMs - DAY, updatedAt: nowMs - DAY,
    });
    const thomasMembership = await member(thomasId, "paid_subscription");
    const annaMembership = await member(annaId, "manual_grant");
    await ctx.db.insert("communitySubscriptions", {
      communityId, userId: thomasId, membershipId: thomasMembership, pricePointId, source: "stripe", status: "active",
      cancelAtPeriodEnd: false, currentPeriodEndAt: nowMs + 20 * DAY, createdAt: nowMs, updatedAt: nowMs,
    });
    const roomId = await ctx.db.insert("communityChannels", {
      communityId, slug: "consulting-room", name: "Consulting room", accessMode: "restricted", postingPolicy: "members",
      status: "active", position: 1, createdAt: nowMs, updatedAt: nowMs,
    });
    return { ownerId, thomasId, deanId, annaId, communityId, pricePointId, thomasMembership, annaMembership, roomId };
  });
  return { t, ...ids, asOwner: t.withIdentity({ subject: "offers-owner" }), asThomas: t.withIdentity({ subject: "offers-thomas" }) };
}

type F = Awaited<ReturnType<typeof fixture>>;

const roomMembers = (f: F) => f.t.run(async (ctx) => (await ctx.db.query("communityChannelParticipants").collect())
  .filter((row) => String(row.channelId) === String(f.roomId) && row.status === "active")
  .map((row) => row.principalKey).sort());
const offerValue = (f: F, membershipId: any) => f.t.run(async (ctx) => (await ctx.db.query("communityClientValues")
  .withIndex("by_membership_property", (q) => q.eq("membershipId", membershipId).eq("propertyKey", "polynet_offer")).unique())?.value ?? null);

describe("offers in a community", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("adding a second offer keeps everyone on Membership, quietly", async () => {
    const f = await fixture();
    const saved = await f.asOwner.mutation(api.communityOffers.saveCommunityOffer, {
      communityId: f.communityId, name: "Membership + Consulting", blurb: "Everything, plus a private room with me.",
      price: { billingPeriod: "monthly", amountBaseUnits: 50000 },
    });
    expect(saved.key).toBe("membership-consulting");
    const view = await f.asOwner.query(api.communityOffers.listCommunityOffers, { communityId: f.communityId });
    expect(view.offers.map((offer: any) => [offer.key, offer.is_base, offer.price?.amount_base_units ?? null, offer.members])).toEqual([
      ["membership", true, 13000, 2],
      ["membership-consulting", false, 50000, 0],
    ]);
    expect(await offerValue(f, f.thomasMembership)).toEqual(["Membership"]);
    // The base price stays the community's only current price.
    const prices = await f.t.run((ctx) => ctx.db.query("communityPricePoints").collect());
    expect(prices.filter((row) => row.isCurrent).map((row) => row.amountBaseUnits)).toEqual([13000]);
    // Owner-side changes never start Workflow steps for everyone.
    expect(await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
    // Polynet keeps the Offer property; the owner can't overwrite it.
    await expect(f.asOwner.mutation(api.communityClients.setClientPropertyValue, {
      communityId: f.communityId, membershipId: String(f.thomasMembership), key: "polynet_offer", value: ["Membership + Consulting"],
    })).rejects.toThrow("client_property_system");
    await expect(f.asOwner.mutation(api.communityOffers.saveCommunityOffer, { communityId: f.communityId, name: "membership + consulting" }))
      .rejects.toThrow("offer_name_taken");
  });

  test("a private channel for Consulting adds the people on it and removes them when they leave", async () => {
    const f = await fixture();
    const { key } = await f.asOwner.mutation(api.communityOffers.saveCommunityOffer, {
      communityId: f.communityId, name: "Membership + Consulting", price: { billingPeriod: "monthly", amountBaseUnits: 50000 },
    });
    // Someone the owner put in by hand stays, whatever their offer.
    await f.asOwner.mutation(api.communityChannelParticipants.setParticipant, {
      communityId: f.communityId, channelId: f.roomId, target: { kind: "member", userId: f.annaId }, active: true,
    });
    await f.asOwner.mutation(api.communityOffers.setCommunityChannelOfferAudience, { communityId: f.communityId, channelId: f.roomId, offerKeys: [key] });
    expect(await roomMembers(f)).toEqual([`user:${f.annaId}`]);

    // Dean gets Consulting from the owner: he is in the room and on both offers.
    await f.asOwner.mutation(api.communityAccess.grantCommunityAccess, {
      communityId: f.communityId, email: "dean@example.com", endsAt: null, reason: "Consulting client", offerKey: key,
    });
    expect(await roomMembers(f)).toEqual([`user:${f.annaId}`, `user:${f.deanId}`].sort());
    const dean = await f.t.run((ctx) => ctx.db.query("communityMemberships").withIndex("by_community_user", (q) => q.eq("communityId", f.communityId).eq("userId", f.deanId)).unique());
    expect(await offerValue(f, dean!._id)).toEqual(["Membership", "Membership + Consulting"]);
    expect(dean!.heldOfferKeys).toEqual(["membership", key]);
    // His change (not the owner's setup) is what starts "starts an offer" steps.
    const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((job: any) => job.name.includes("handleOfferChangedInternal")
      && job.args[0].started.join() === `membership,${key}`)).toBe(true);

    // Moving him down to Membership takes him out of the room; Anna stays.
    await f.asOwner.mutation(api.communityAccess.grantCommunityAccess, {
      communityId: f.communityId, membershipId: String(dean!._id), endsAt: null, reason: "Consulting finished",
    });
    expect(await roomMembers(f)).toEqual([`user:${f.annaId}`]);
    expect(await offerValue(f, dean!._id)).toEqual(["Membership"]);

    // Thomas pays for Consulting: his subscription's price decides it.
    const consultingPrice = await f.t.run(async (ctx) => (await ctx.db.query("communityPricePoints").collect()).find((row) => row.offerId)!);
    await f.t.run(async (ctx) => {
      const sub = await ctx.db.query("communitySubscriptions").first();
      await ctx.db.patch(sub!._id, { pricePointId: consultingPrice._id, updatedAt: Date.now() });
    });
    await f.t.run(async (ctx) => {
      const { syncCommunityAccessForUser } = await import("./communityAccessSync");
      await syncCommunityAccessForUser(ctx, { communityId: f.communityId, userId: f.thomasId, nowMs: Date.now(), reason: "test" });
    });
    expect(await roomMembers(f)).toContain(`user:${f.thomasId}`);

    // Taking the audience away removes only the people it added.
    await f.asOwner.mutation(api.communityOffers.setCommunityChannelOfferAudience, { communityId: f.communityId, channelId: f.roomId, offerKeys: [] });
    expect(await roomMembers(f)).toEqual([`user:${f.annaId}`]);
  });

  test("a Workflow step runs when someone starts the Consulting offer, and never holds anyone else's stage", async () => {
    const f = await fixture();
    const { key } = await f.asOwner.mutation(api.communityOffers.saveCommunityOffer, {
      communityId: f.communityId, name: "Membership + Consulting", price: { billingPeriod: "monthly", amountBaseUnits: 50000 },
    });
    await f.asOwner.mutation(api.communityClients.createClientProperty, { communityId: f.communityId, name: "Track", type: "select", options: ["Consulting"] });
    const first = await f.asOwner.mutation(api.communityMemberWorkflows.createBuilderWorkflowMilestone, { communityId: f.communityId, expectedRevision: 0, name: "New" });
    await expect(f.asOwner.mutation(api.communityMemberWorkflows.updateBuilderWorkflowMilestone, {
      communityId: f.communityId, expectedRevision: 1, milestoneKey: first.milestone.key, name: "New",
      automations: [{ key: "", trigger: { type: "offer_started" as const, offerKey: "nope" },
        action: { key: "", type: "set_client_property" as const, propertyKey: "track", value: "Consulting" } }],
    })).rejects.toThrow("workflow_offer_unavailable");
    await f.asOwner.mutation(api.communityMemberWorkflows.updateBuilderWorkflowMilestone, {
      communityId: f.communityId, expectedRevision: 1, milestoneKey: first.milestone.key, name: "New",
      automations: [{ key: "", trigger: { type: "offer_started" as const, offerKey: key },
        action: { key: "", type: "set_client_property" as const, propertyKey: "track", value: "Consulting" } }],
    });
    const run = (started: string[]) => f.t.mutation(internalApi.communityMemberWorkflows.handleOfferChangedInternal, {
      communityId: f.communityId, userId: f.thomasId, membershipId: f.thomasMembership, activationSequence: 1, started, ended: [], at: 1,
    });
    expect(await run(["membership"])).toMatchObject({ status: "trigger_unconfigured" });
    expect(await run([key])).toMatchObject({ status: "handled" });
    expect(await run([key])).toMatchObject({ results: [{ status: "already_executed" }] });
    const value = await f.t.run(async (ctx) => (await ctx.db.query("communityClientValues").collect()).find((row) => row.propertyKey === "track"));
    expect(value?.value).toBe("Consulting");
  });
});
