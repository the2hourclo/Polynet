// Member properties, the host's side (shared/communityMemberProperties.ts).
// A host (or anyone who manages members) defines fields about their members
// and fills them in on each member's record; up to three show as columns in
// the Members table. Members never read these: every function here requires
// a community manager, like the rest of the host's Members page.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUserIdForAuthenticatedRequest } from "./authActor";
import { requireCommunityManager } from "./communityCore";
import {
  MEMBER_PROPERTY_LIMIT,
  MEMBER_PROPERTY_TABLE_LIMIT,
  MemberPropertyError,
  memberPropertyKey,
  normalizeMemberPropertyDraft,
  normalizeMemberPropertyOptions,
  normalizeMemberPropertyValue,
  type MemberPropertyDefinition,
  type MemberPropertyValue,
} from "../shared/communityMemberProperties";

const VALUES_CAP = 5_000;

const actor = {
  userId: v.optional(v.id("users")),
  authSubject: v.optional(v.string()),
  communityId: v.id("communities"),
};

async function context(ctx: any, args: { userId?: any; authSubject?: string; communityId: any }) {
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, userId: args.userId, authSubject: args.authSubject ?? null });
  const { community } = await requireCommunityManager({ ctx, communityId: args.communityId, userId });
  return { userId, community };
}

async function liveProperties(ctx: any, communityId: any) {
  const rows = await ctx.db.query("communityMemberProperties").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).collect();
  return rows.filter((row: any) => !row.archivedAt).sort((a: any, b: any) => a.position - b.position);
}

async function propertyByKey(ctx: any, communityId: any, key: string) {
  const row = await ctx.db.query("communityMemberProperties")
    .withIndex("by_community_key", (q: any) => q.eq("communityId", communityId).eq("key", key)).first();
  if (!row || row.archivedAt) throw new MemberPropertyError("member_property_not_found");
  return row;
}

const project = (row: any) => ({ key: row.key as string, name: row.name as string, type: row.type as MemberPropertyDefinition["type"],
  options: row.options as string[], in_table: Boolean(row.inTable) });

export type CommunityMemberPropertyRow = ReturnType<typeof project>;

export const listCommunityMemberProperties = query({
  args: actor,
  handler: async (ctx, args) => {
    await context(ctx, args);
    return (await liveProperties(ctx, args.communityId)).map(project);
  },
});

export const createCommunityMemberProperty = mutation({
  args: { ...actor, name: v.string(), type: v.string(), options: v.optional(v.array(v.string())), inTable: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { userId } = await context(ctx, args);
    const draft = normalizeMemberPropertyDraft({ name: args.name, type: args.type, options: args.options });
    const live = await liveProperties(ctx, args.communityId);
    if (live.length >= MEMBER_PROPERTY_LIMIT) throw new MemberPropertyError("member_property_limit_reached");
    if (live.some((row: any) => row.name.toLowerCase() === draft.name.toLowerCase())) throw new MemberPropertyError("member_property_name_taken");
    // A key is never reused, even after a property is archived, so old values never come back under a new name.
    const base = memberPropertyKey(draft.name);
    let key = base;
    for (let n = 2; await ctx.db.query("communityMemberProperties").withIndex("by_community_key", (q: any) => q.eq("communityId", args.communityId).eq("key", key)).first(); n += 1) {
      key = `${base}_${n}`;
    }
    const inTable = Boolean(args.inTable) && live.filter((row: any) => row.inTable).length < MEMBER_PROPERTY_TABLE_LIMIT;
    const now = Date.now();
    const position = live.length ? Math.max(...live.map((row: any) => row.position)) + 1 : 0;
    await ctx.db.insert("communityMemberProperties", { communityId: args.communityId, key, name: draft.name, type: draft.type, options: draft.options,
      position, inTable, createdByUserId: userId, createdAt: now, updatedAt: now });
    return { key };
  },
});

export const updateCommunityMemberProperty = mutation({
  args: { ...actor, key: v.string(), name: v.optional(v.string()), options: v.optional(v.array(v.string())), inTable: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await context(ctx, args);
    const row = await propertyByKey(ctx, args.communityId, args.key);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const draft = normalizeMemberPropertyDraft({ name: args.name, type: row.type, options: row.options.length ? row.options : undefined });
      const live = await liveProperties(ctx, args.communityId);
      if (live.some((other: any) => other.key !== row.key && other.name.toLowerCase() === draft.name.toLowerCase())) throw new MemberPropertyError("member_property_name_taken");
      patch.name = draft.name;
    }
    if (args.options !== undefined) {
      const options = normalizeMemberPropertyOptions(row.type, args.options);
      patch.options = options;
      // A choice that was taken away leaves the members who had it.
      const definition = { key: row.key, name: row.name, type: row.type, options } as MemberPropertyDefinition;
      const values = await ctx.db.query("communityMemberPropertyValues")
        .withIndex("by_community_property", (q: any) => q.eq("communityId", args.communityId).eq("propertyKey", row.key)).take(VALUES_CAP);
      for (const value of values) {
        const kept = Array.isArray(value.value) ? value.value.filter((item: string) => options.includes(item)) : options.includes(String(value.value)) ? value.value : null;
        const next = Array.isArray(kept) ? normalizeMemberPropertyValue(definition, kept) : kept;
        if (next === null) await ctx.db.delete(value._id);
        else if (JSON.stringify(next) !== JSON.stringify(value.value)) await ctx.db.patch(value._id, { value: next, updatedAt: Date.now() });
      }
    }
    if (args.inTable !== undefined && args.inTable !== Boolean(row.inTable)) {
      if (args.inTable) {
        const shown = (await liveProperties(ctx, args.communityId)).filter((other: any) => other.inTable).length;
        if (shown >= MEMBER_PROPERTY_TABLE_LIMIT) throw new MemberPropertyError("member_property_table_full");
      }
      patch.inTable = args.inTable;
    }
    await ctx.db.patch(row._id, patch);
    return null;
  },
});

// Archived, not deleted: the property and its values leave every screen, and
// its key is never handed out again.
export const archiveCommunityMemberProperty = mutation({
  args: { ...actor, key: v.string() },
  handler: async (ctx, args) => {
    await context(ctx, args);
    const row = await propertyByKey(ctx, args.communityId, args.key);
    const now = Date.now();
    await ctx.db.patch(row._id, { archivedAt: now, inTable: false, updatedAt: now });
    return null;
  },
});

export const setCommunityMemberPropertyValue = mutation({
  args: { ...actor, membershipId: v.id("communityMemberships"), key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await context(ctx, args);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || String(membership.communityId) !== String(args.communityId)) throw new MemberPropertyError("community_membership_not_found");
    const row = await propertyByKey(ctx, args.communityId, args.key);
    const value = normalizeMemberPropertyValue({ key: row.key, name: row.name, type: row.type, options: row.options }, args.value);
    const existing = await ctx.db.query("communityMemberPropertyValues")
      .withIndex("by_membership_property", (q: any) => q.eq("membershipId", args.membershipId).eq("propertyKey", row.key)).first();
    const now = Date.now();
    if (value === null) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { value, updatedByUserId: userId, updatedAt: now });
    } else {
      await ctx.db.insert("communityMemberPropertyValues", { communityId: args.communityId, membershipId: args.membershipId, propertyKey: row.key,
        value, updatedByUserId: userId, updatedAt: now });
    }
    return { value };
  },
});

// One member's values, keyed by property.
export const getCommunityMemberPropertyValues = query({
  args: { ...actor, membershipId: v.id("communityMemberships") },
  handler: async (ctx, args) => {
    await context(ctx, args);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || String(membership.communityId) !== String(args.communityId)) return {};
    const live = new Set((await liveProperties(ctx, args.communityId)).map((row: any) => row.key));
    const rows = await ctx.db.query("communityMemberPropertyValues").withIndex("by_membership", (q: any) => q.eq("membershipId", args.membershipId)).collect();
    const values: Record<string, MemberPropertyValue> = {};
    for (const row of rows) if (live.has(row.propertyKey)) values[row.propertyKey] = row.value;
    return values;
  },
});

// The table's columns: every member's value for each property shown in the
// table (or, for the export, every property).
export const listCommunityMemberTableValues = query({
  args: { ...actor, all: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await context(ctx, args);
    const shown = (await liveProperties(ctx, args.communityId)).filter((row: any) => args.all || row.inTable);
    const byMembership: Record<string, Record<string, MemberPropertyValue>> = {};
    for (const property of shown) {
      const rows = await ctx.db.query("communityMemberPropertyValues")
        .withIndex("by_community_property", (q: any) => q.eq("communityId", args.communityId).eq("propertyKey", property.key)).take(VALUES_CAP);
      for (const row of rows) (byMembership[String(row.membershipId)] ??= {})[property.key] = row.value;
    }
    return byMembership;
  },
});
