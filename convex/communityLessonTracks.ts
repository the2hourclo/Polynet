import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  communityMembershipRowIsActive,
  normalizeIdValue,
  requireCommunityManager,
  resolveUserIdForAuthenticatedRequest,
} from "./communityCore";
import {
  checkCommunityTrackDefinition,
  COMMUNITY_MAIN_TRACK_KEY,
  COMMUNITY_TRACK_LIMITS,
  resolveCommunityTrackDefinitions,
  type CommunityTrackDefinition,
  type CommunityTrackMemberContext,
} from "../shared/communityLessonTracks";

// Skill tracks: the owner's roadmaps over the lesson library (Knowledge →
// Roadmap). The rules and progress views are in shared/communityLessonTracks.ts;
// this file stores the tracks and reads what a member's rules are checked
// against. The Roadmap screen and the owner's agent (community.track.*) save
// through the same mutations.

export const communityTrackRuleValidator = v.union(
  v.object({ type: v.literal("after_track"), track: v.string() }),
  v.object({ type: v.literal("after_checkpoint"), resource_id: v.string() }),
  v.object({ type: v.literal("workflow_stage"), milestone_key: v.string() }),
  v.object({ type: v.literal("client_property"), property: v.string(), equals: v.union(v.string(), v.number(), v.boolean()) }),
);

const trackStagesValidator = v.array(v.object({
  name: v.string(),
  steps: v.array(v.object({ resource_id: v.string(), checkpoint: v.optional(v.boolean()) })),
}));

async function requireManager(ctx: any, args: { userId?: any; authSubject?: string | null; communityId: any }) {
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, userId: args.userId, authSubject: args.authSubject ?? null });
  await requireCommunityManager({ ctx, communityId: args.communityId, userId });
  return userId;
}

async function listRows(ctx: any, communityId: any): Promise<any[]> {
  return await ctx.db.query("communityLessonTracks").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).collect();
}

function definitionOf(row: any): CommunityTrackDefinition {
  return {
    key: row.key,
    title: row.title,
    summary: row.summary ?? null,
    cover_url: row.coverUrl ?? null,
    order: row.order,
    show: row.show,
    opens_when: row.opensWhen,
    stages: row.stages,
  };
}

/** The community's live tracks as stored; resolveCommunityTrackDefinitions fills in the main one. */
export async function readStoredCommunityTracks(ctx: any, communityId: any): Promise<CommunityTrackDefinition[]> {
  return (await listRows(ctx, communityId)).filter((row) => !row.archivedAt).map(definitionOf);
}

/** What one member's track rules are checked against: their Workflow stage and client properties. */
export async function readCommunityTrackMemberContext(ctx: any, communityId: any, userId: any): Promise<{
  context: CommunityTrackMemberContext;
  milestoneName: (key: string) => string | null;
}> {
  const workflow = await ctx.db.query("communityMemberWorkflows").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).first();
  const milestones: Array<{ key: string; name: string }> = workflow?.milestones ?? [];
  const milestoneName = (key: string) => milestones.find((milestone) => milestone.key === key)?.name ?? null;
  const memberships = await ctx.db.query("communityMemberships")
    .withIndex("by_community_user", (q: any) => q.eq("communityId", communityId).eq("userId", userId)).collect();
  const membership = memberships.find(communityMembershipRowIsActive) ?? memberships[0] ?? null;
  if (!membership) return { context: { workflowMilestoneOrder: milestones.map((m) => m.key) }, milestoneName };
  const [position, values] = await Promise.all([
    workflow
      ? ctx.db.query("communityMemberWorkflowMemberMilestones")
        .withIndex("by_workflow_membership", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membership._id)).first()
      : null,
    ctx.db.query("communityClientValues").withIndex("by_membership", (q: any) => q.eq("membershipId", membership._id)).collect(),
  ]);
  return {
    context: {
      workflowMilestoneKey: position?.currentMilestoneKey ?? null,
      workflowMilestoneOrder: milestones.map((milestone) => milestone.key),
      clientValues: Object.fromEntries(values.map((row: any) => [row.propertyKey, row.value])),
    },
    milestoneName,
  };
}

async function libraryLessons(ctx: any, communityId: any) {
  const rows = await ctx.db.query("communityResources").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).take(1000);
  return rows
    .filter((row: any) => (row.role ?? "page") === "page")
    .map((row: any) => ({ id: normalizeIdValue(row._id), title: row.title as string, lesson: row.lesson ?? null }));
}

function projection(row: any) {
  return { ...definitionOf(row), revision: row.revision as number, archived: Boolean(row.archivedAt), updated_at: row.updatedAt as number };
}

/**
 * The owner's view of every track, the main one included (derived: true when
 * its stages still come from the lesson fields), with archived ones listed apart.
 */
export async function readCommunityTracksForBuilder(ctx: any, communityId: any) {
  const rows = await listRows(ctx, communityId);
  const lessons = await libraryLessons(ctx, communityId);
  const tracks = resolveCommunityTrackDefinitions({ stored: rows.filter((row) => !row.archivedAt).map(definitionOf), lessons });
  const revisionByKey = new Map(rows.map((row) => [row.key, row.revision as number]));
  // What "Opens when" rules can point at besides lessons and tracks.
  const workflow = await ctx.db.query("communityMemberWorkflows").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).first();
  const properties = await ctx.db.query("communityClientProperties").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).collect();
  return {
    contract: "polynet.builder_tracks.v1",
    guidance: "Save a whole track with community.track.save (expected_revision from here; 0 for a new track). "
      + "Steps point at lesson resource ids from the library; a checkpoint keeps the rest of its track closed until it is done. "
      + "The main track is the community's first roadmap: leave its stages empty to keep reading them from the lessons.",
    tracks: tracks.map((track) => ({ ...track, revision: revisionByKey.get(track.key) ?? 0, derived: Boolean(track.derived) })),
    archived: rows.filter((row) => row.archivedAt).map(projection),
    rule_types: {
      after_track: '{"type":"after_track","track":"<key>"}: opens once that track is finished',
      after_checkpoint: '{"type":"after_checkpoint","resource_id":"<lesson id>"}: opens once that lesson is done',
      workflow_stage: '{"type":"workflow_stage","milestone_key":"<key>"}: opens once the member reaches that Workflow stage',
      client_property: '{"type":"client_property","property":"<key>","equals":<value>}: opens while that client property has the value',
    },
    lessons: lessons.map(({ id, title, lesson }: any) => ({ id, title, kind: lesson?.kind ?? null })),
    workflow_stages: (workflow?.milestones ?? []).map((milestone: any) => ({ key: milestone.key, name: milestone.name })),
    client_properties: properties
      .filter((property: any) => !property.archivedAt)
      .sort((left: any, right: any) => left.position - right.position)
      .map((property: any) => ({ key: property.key, name: property.name, type: property.type, options: property.options })),
    limits: COMMUNITY_TRACK_LIMITS,
  };
}

export const listCommunityLessonTracks = query({
  args: { userId: v.optional(v.id("users")), authSubject: v.optional(v.string()), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args);
    return await readCommunityTracksForBuilder(ctx, args.communityId);
  },
});

const saveTrackArgs = {
  userId: v.optional(v.id("users")),
  authSubject: v.optional(v.string()),
  communityId: v.id("communities"),
  key: v.string(),
  expectedRevision: v.number(),
  title: v.string(),
  summary: v.optional(v.union(v.string(), v.null())),
  coverUrl: v.optional(v.union(v.string(), v.null())),
  order: v.optional(v.number()),
  show: v.optional(v.union(v.literal("always"), v.literal("when_open"))),
  opensWhen: v.array(communityTrackRuleValidator),
  stages: trackStagesValidator,
};

async function saveTrack(ctx: any, userId: any, args: any) {
  const rows = await listRows(ctx, args.communityId);
  const existing = rows.find((row) => row.key === args.key) ?? null;
  if ((existing?.revision ?? 0) !== args.expectedRevision) {
    throw new ConvexError({ code: "track_revision_conflict", current: existing?.revision ?? 0 });
  }
  if (!existing && rows.filter((row) => !row.archivedAt).length >= COMMUNITY_TRACK_LIMITS.tracks) {
    throw new ConvexError({ code: "track_limit", max: COMMUNITY_TRACK_LIMITS.tracks });
  }
  const lessons = await libraryLessons(ctx, args.communityId);
  const stages = args.stages.map((stage: { name: string; steps: Array<{ resource_id: string; checkpoint?: boolean }> }) => ({ name: stage.name.trim(), steps: stage.steps }));
  const definition: CommunityTrackDefinition = {
    key: args.key,
    title: args.title.trim(),
    summary: args.summary?.trim() || null,
    cover_url: args.coverUrl?.trim() || null,
    order: args.order ?? existing?.order ?? (args.key === COMMUNITY_MAIN_TRACK_KEY ? 0 : rows.length + 1),
    show: args.show ?? existing?.show ?? "always",
    opens_when: args.opensWhen,
    stages,
  };
  const trackKeys = new Set([COMMUNITY_MAIN_TRACK_KEY, ...rows.filter((row) => !row.archivedAt).map((row) => row.key), args.key]);
  const problems = checkCommunityTrackDefinition(definition, { lessonIds: new Set(lessons.map((lesson: any) => lesson.id)), trackKeys });
  if (args.key !== COMMUNITY_MAIN_TRACK_KEY && stages.length === 0) problems.push("Add at least one stage with a lesson.");
  if (problems.length) throw new ConvexError({ code: "track_invalid", problems });
  const now = Date.now();
  const fields = {
    title: definition.title,
    summary: definition.summary ?? undefined,
    coverUrl: definition.cover_url ?? undefined,
    order: definition.order,
    show: definition.show,
    opensWhen: definition.opens_when,
    stages,
    archivedAt: undefined,
    updatedByUserId: userId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, { ...fields, revision: existing.revision + 1 });
    return { key: args.key, revision: existing.revision + 1 };
  }
  await ctx.db.insert("communityLessonTracks", {
    communityId: args.communityId, key: args.key, ...fields, revision: 1, createdByUserId: userId, createdAt: now,
  });
  return { key: args.key, revision: 1 };
}

/** Creates or replaces one track. expectedRevision 0 creates it; a stale revision is refused. */
export const saveCommunityLessonTrack = mutation({
  args: saveTrackArgs,
  handler: async (ctx, args) => saveTrack(ctx, await requireManager(ctx, args), args),
});

/** The same save for setup scripts run with the deployment's admin key (npx convex run). */
export const saveCommunityLessonTrackInternal = internalMutation({
  args: saveTrackArgs,
  handler: async (ctx, args) => {
    if (!args.userId) throw new ConvexError({ code: "track_user_required" });
    await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
    return await saveTrack(ctx, args.userId, args);
  },
});

/** Courses and their lessons in order, with ids, for setup scripts that build tracks. */
export const listCommunityLessonLibraryInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const community: any = await ctx.db.query("communities").withIndex("by_slug", (q: any) => q.eq("slug", args.slug)).first();
    if (!community) throw new ConvexError({ code: "community_not_found" });
    const communityId = community._id;
    const modules = await ctx.db.query("communityResourceModules").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).collect();
    const pages = (await ctx.db.query("communityResources").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).take(1000))
      .filter((row: any) => (row.role ?? "page") === "page");
    const tracks = await readStoredCommunityTracks(ctx, communityId);
    const revisions = Object.fromEntries((await listRows(ctx, communityId)).map((row) => [row.key, row.revision]));
    return {
      community_id: String(communityId),
      owner_id: String(community.ownerId),
      tracks: tracks.map((track) => ({ key: track.key, title: track.title, revision: revisions[track.key] ?? 0 })),
      courses: modules.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((module: any) => ({
        id: String(module._id),
        name: module.name ?? null,
        lessons: pages.filter((page: any) => String(page.moduleId) === String(module._id))
          .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((page: any) => ({ id: String(page._id), title: page.title, stage: page.lesson?.stage ?? null })),
      })),
    };
  },
});

/** Puts the tracks in this order; keys not listed keep their place after them. */
export const reorderCommunityLessonTracks = mutation({
  args: { userId: v.optional(v.id("users")), authSubject: v.optional(v.string()), communityId: v.id("communities"), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireManager(ctx, args);
    const rows = await listRows(ctx, args.communityId);
    const now = Date.now();
    const ordered = [...args.keys, ...rows.map((row) => row.key).filter((key) => !args.keys.includes(key))];
    for (const [index, key] of ordered.entries()) {
      const row = rows.find((candidate) => candidate.key === key);
      if (row && row.order !== index) await ctx.db.patch(row._id, { order: index, updatedByUserId: userId, updatedAt: now });
      // The main track has no row until it is first changed.
      if (!row && key === COMMUNITY_MAIN_TRACK_KEY && index !== 0) {
        await ctx.db.insert("communityLessonTracks", {
          communityId: args.communityId, key, title: "Roadmap", order: index, show: "always", opensWhen: [], stages: [],
          revision: 1, createdByUserId: userId, updatedByUserId: userId, createdAt: now, updatedAt: now,
        });
      }
    }
    return { keys: ordered };
  },
});

/** Archives a track (members stop seeing it; progress is kept) or brings it back. */
export const setCommunityLessonTrackArchived = mutation({
  args: { userId: v.optional(v.id("users")), authSubject: v.optional(v.string()), communityId: v.id("communities"), key: v.string(), archived: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireManager(ctx, args);
    if (args.key === COMMUNITY_MAIN_TRACK_KEY) throw new ConvexError({ code: "track_main_cannot_archive" });
    const row = (await listRows(ctx, args.communityId)).find((candidate) => candidate.key === args.key);
    if (!row) throw new ConvexError({ code: "track_not_found" });
    await ctx.db.patch(row._id, { archivedAt: args.archived ? Date.now() : undefined, updatedByUserId: userId, updatedAt: Date.now(), revision: row.revision + 1 });
    return { key: args.key, archived: args.archived };
  },
});

/**
 * The tracks a member has just finished by completing this lesson: tracks that
 * have the lesson as a step and now have every step done. For the Workflow
 * trigger "When they finish a track" (handleLessonCompletedInternal).
 */
export async function communityTracksFinishedByLesson(ctx: any, communityId: any, userId: any, resourceId: any): Promise<Array<{ key: string; title: string }>> {
  const lessons = await libraryLessons(ctx, communityId);
  const tracks = resolveCommunityTrackDefinitions({ stored: await readStoredCommunityTracks(ctx, communityId), lessons });
  const id = normalizeIdValue(resourceId);
  const rows = await ctx.db.query("communityResourceProgress")
    .withIndex("by_community_user", (q: any) => q.eq("communityId", communityId).eq("userId", userId)).take(1000);
  const done = new Set(rows.filter((row: any) => row.status === "done").map((row: any) => normalizeIdValue(row.resourceId)));
  return tracks
    .filter((track) => {
      const steps = track.stages.flatMap((stage) => stage.steps);
      return steps.some((step) => step.resource_id === id) && steps.every((step) => done.has(step.resource_id));
    })
    .map((track) => ({ key: track.key, title: track.title }));
}
