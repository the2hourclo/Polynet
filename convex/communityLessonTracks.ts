import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { resolveUserIdForAuthenticatedRequest } from "./authActor";
import {
  communityResourceIsLiveModulePage,
  communityResourceModuleIsLive,
  normalizeIdValue,
  requireCommunityChatAccess,
  requireCommunityManager,
} from "./communityCore";
import {
  checkCommunityTrackDefinition,
  COMMUNITY_MAIN_TRACK_KEY,
  COMMUNITY_TRACK_LIMITS,
  type CommunityTrackDefinition,
} from "../shared/communityLessonTracks";

// Skill tracks, ported to design v1 from the fork's old build (Rashid, Nov
// 17): an owner's paths over the lesson library, read on Knowledge as the
// Roadmap. The rules and progress views are in shared/communityLessonTracks.ts
// and are worked out in the browser from the member's own lesson progress.
// Lessons in v1 carry no stage fields, so every track (the main one too) keeps
// its own stages, and a step may carry its minutes. Fork only: not sent to Neil.

export const communityTrackRuleValidator = v.union(
  v.object({ type: v.literal("after_track"), track: v.string() }),
  v.object({ type: v.literal("after_checkpoint"), resource_id: v.string() }),
  // Kept so tracks copied from the old build still load; v1 has no Workflows,
  // client fields or offers, so these never close a track here.
  v.object({ type: v.literal("workflow_stage"), milestone_key: v.string() }),
  v.object({ type: v.literal("client_property"), property: v.string(), equals: v.union(v.string(), v.number(), v.boolean()) }),
  v.object({ type: v.literal("offer"), offer: v.string() }),
);

export const communityTrackCoverStyleValidator = v.union(v.literal("route"), v.literal("diagram"), v.literal("terminal"));

const trackStagesValidator = v.array(v.object({
  name: v.string(),
  steps: v.array(v.object({ resource_id: v.string(), checkpoint: v.optional(v.boolean()), minutes: v.optional(v.number()) })),
}));

const actor = { userId: v.optional(v.id("users")), authSubject: v.optional(v.string()), communityId: v.id("communities") };

async function actorId(ctx: any, args: { userId?: any; authSubject?: string | null }) {
  return await resolveUserIdForAuthenticatedRequest({ ctx, userId: args.userId, authSubject: args.authSubject ?? null });
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
    cover_style: row.coverStyle ?? null,
    outcomes: row.outcomes ?? [],
    audience: row.audience ?? null,
    order: row.order,
    show: row.show,
    // Rules v1 can't check are dropped, so the track stays open.
    opens_when: (row.opensWhen ?? []).filter((rule: any) => rule.type === "after_track" || rule.type === "after_checkpoint"),
    stages: row.stages,
  };
}

// The lesson pages this person can read: every page for a host, live pages in
// live courses for a member.
type LibraryLesson = { id: string; title: string; module_id: string };
async function libraryLessons(ctx: any, communityId: any, manager: boolean): Promise<LibraryLesson[]> {
  const modules = await ctx.db.query("communityResourceModules").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).collect();
  const liveModuleIds = new Set<string>(modules.filter((row: any) => communityResourceModuleIsLive(row)).map((row: any) => normalizeIdValue(row._id)));
  const rows = await ctx.db.query("communityResources").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).take(2000);
  return rows
    .filter((row: any) => (row.role ?? "page") === "page" && row.moduleId)
    .filter((row: any) => manager || communityResourceIsLiveModulePage(row, liveModuleIds))
    .map((row: any) => ({ id: normalizeIdValue(row._id), title: row.title as string, module_id: normalizeIdValue(row.moduleId) }));
}

async function isManager(ctx: any, communityId: any, userId: any) {
  try { await requireCommunityManager({ ctx, communityId, userId }); return true; } catch { return false; }
}

/**
 * The tracks for whoever is reading: their stages trimmed to the lessons they
 * can see. The browser adds their progress (computeCommunityTracks).
 */
export const getCommunityLessonTracks = query({
  args: actor,
  handler: async (ctx, args) => {
    const userId = await actorId(ctx, args);
    await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId });
    const manager = await isManager(ctx, args.communityId, userId);
    const lessons = await libraryLessons(ctx, args.communityId, manager);
    const visible = new Set(lessons.map((lesson) => lesson.id));
    const rows = (await listRows(ctx, args.communityId)).filter((row) => !row.archivedAt);
    const tracks = rows
      .map((row) => ({ ...definitionOf(row), revision: row.revision as number }))
      .map((track) => ({
        ...track,
        stages: track.stages
          .map((stage) => ({ ...stage, steps: stage.steps.filter((step) => visible.has(step.resource_id)) }))
          .filter((stage) => stage.steps.length > 0),
      }))
      .filter((track) => manager || track.stages.length > 0)
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
    return { tracks, can_edit: manager, lessons };
  },
});

const saveTrackArgs = {
  ...actor,
  key: v.string(),
  expectedRevision: v.number(),
  title: v.string(),
  summary: v.optional(v.union(v.string(), v.null())),
  coverUrl: v.optional(v.union(v.string(), v.null())),
  coverStyle: v.optional(v.union(communityTrackCoverStyleValidator, v.null())),
  outcomes: v.optional(v.array(v.string())),
  audience: v.optional(v.union(v.string(), v.null())),
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
  const lessons = await libraryLessons(ctx, args.communityId, true);
  const stages = args.stages.map((stage: any) => ({ name: stage.name.trim(), steps: stage.steps }));
  const definition: CommunityTrackDefinition = {
    key: args.key,
    title: args.title.trim(),
    summary: args.summary?.trim() || null,
    cover_url: args.coverUrl === undefined ? existing?.coverUrl ?? null : args.coverUrl?.trim() || null,
    cover_style: args.coverStyle === undefined ? existing?.coverStyle ?? null : args.coverStyle,
    outcomes: (args.outcomes ?? existing?.outcomes ?? []).map((line: string) => line.trim()).filter(Boolean),
    audience: args.audience === undefined ? existing?.audience ?? null : args.audience?.trim() || null,
    order: args.order ?? existing?.order ?? (args.key === COMMUNITY_MAIN_TRACK_KEY ? 0 : rows.length + 1),
    show: args.show ?? existing?.show ?? "always",
    opens_when: args.opensWhen,
    stages,
  };
  const trackKeys = new Set([COMMUNITY_MAIN_TRACK_KEY, ...rows.filter((row) => !row.archivedAt).map((row) => row.key), args.key]);
  const offerKeys = new Set<string>(args.opensWhen.filter((rule: any) => rule.type === "offer").map((rule: any) => rule.offer));
  const problems = checkCommunityTrackDefinition(definition, { lessonIds: new Set(lessons.map((lesson) => lesson.id)), trackKeys, offerKeys });
  if (stages.length === 0) problems.push("Add at least one stage with a lesson.");
  if (problems.length) throw new ConvexError({ code: "track_invalid", problems });
  const now = Date.now();
  const fields = {
    title: definition.title,
    summary: definition.summary ?? undefined,
    coverUrl: definition.cover_url ?? undefined,
    coverStyle: definition.cover_style ?? undefined,
    outcomes: definition.outcomes?.length ? definition.outcomes : undefined,
    audience: definition.audience ?? undefined,
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
  handler: async (ctx, args) => {
    const userId = await actorId(ctx, args);
    await requireCommunityManager({ ctx, communityId: args.communityId, userId });
    return await saveTrack(ctx, userId, args);
  },
});

/**
 * Copies tracks from the old build (scripts/local-dev/import_old_tracks.mjs,
 * run with the deployment's admin key). Old lesson ids are matched to this
 * build's lessons by id, or by course name and lesson title; steps that match
 * nothing are left out and reported.
 */
export const importCommunityLessonTracksInternal = internalMutation({
  args: {
    slug: v.string(),
    tracks: v.array(v.object({
      key: v.string(),
      title: v.string(),
      summary: v.optional(v.union(v.string(), v.null())),
      coverUrl: v.optional(v.union(v.string(), v.null())),
      coverStyle: v.optional(v.union(communityTrackCoverStyleValidator, v.null())),
      outcomes: v.optional(v.array(v.string())),
      audience: v.optional(v.union(v.string(), v.null())),
      order: v.number(),
      show: v.union(v.literal("always"), v.literal("when_open")),
      opensWhen: v.array(communityTrackRuleValidator),
      stages: v.array(v.object({
        name: v.string(),
        steps: v.array(v.object({ resource_id: v.string(), course: v.optional(v.string()), title: v.optional(v.string()), checkpoint: v.optional(v.boolean()), minutes: v.optional(v.number()) })),
      })),
    })),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const community: any = await ctx.db.query("communities").withIndex("by_slug", (q: any) => q.eq("slug", args.slug)).first();
    if (!community) throw new ConvexError({ code: "community_not_found" });
    const communityId = community._id;
    const modules = await ctx.db.query("communityResourceModules").withIndex("by_community", (q: any) => q.eq("communityId", communityId)).collect();
    const moduleName = new Map<string, string>(modules.map((row: any) => [normalizeIdValue(row._id), String(row.name ?? "").trim().toLowerCase()]));
    const lessons = await libraryLessons(ctx, communityId, true);
    const byId = new Set(lessons.map((lesson) => lesson.id));
    const byCourseTitle = new Map<string, string>(lessons.map((lesson) => [`${moduleName.get(lesson.module_id)}\u0000${lesson.title.trim().toLowerCase()}`, lesson.id]));
    const byTitle = new Map<string, string[]>();
    for (const lesson of lessons) byTitle.set(lesson.title.trim().toLowerCase(), [...(byTitle.get(lesson.title.trim().toLowerCase()) ?? []), lesson.id]);
    const missing: string[] = [];
    const idMap = new Map<string, string>();
    const match = (step: { resource_id: string; course?: string; title?: string }): string | null => {
      if (byId.has(step.resource_id)) return step.resource_id;
      const title = String(step.title ?? "").trim().toLowerCase();
      const viaCourse = byCourseTitle.get(`${String(step.course ?? "").trim().toLowerCase()}\u0000${title}`);
      if (viaCourse) return viaCourse;
      const viaTitle = byTitle.get(title);
      return viaTitle?.length === 1 ? viaTitle[0] : null;
    };
    const tracks = args.tracks.map((track) => ({
      ...track,
      stages: track.stages.map((stage) => ({
        name: stage.name,
        steps: stage.steps.flatMap((step) => {
          const id = match(step);
          if (!id) { missing.push(`${track.title} › ${stage.name} › ${step.title ?? step.resource_id}`); return []; }
          idMap.set(step.resource_id, id);
          return [{ resource_id: id, ...(step.checkpoint ? { checkpoint: true } : {}), ...(step.minutes ? { minutes: step.minutes } : {}) }];
        }),
      })).filter((stage) => stage.steps.length > 0),
    }));
    // Checkpoint rules point at old ids too.
    for (const track of tracks) {
      track.opensWhen = track.opensWhen.map((rule: any) => rule.type === "after_checkpoint" && idMap.has(rule.resource_id) ? { ...rule, resource_id: idMap.get(rule.resource_id)! } : rule);
    }
    const summary = tracks.map((track) => ({ key: track.key, title: track.title, stages: track.stages.length, steps: track.stages.reduce((sum, stage) => sum + stage.steps.length, 0) }));
    if (args.dryRun) return { dryRun: true, summary, missing };
    const existing = await listRows(ctx, communityId);
    const now = Date.now();
    for (const track of tracks) {
      if (!track.stages.length) continue;
      const row = existing.find((candidate) => candidate.key === track.key);
      const fields = {
        title: track.title,
        summary: track.summary ?? undefined,
        coverUrl: track.coverUrl ?? undefined,
        coverStyle: track.coverStyle ?? undefined,
        outcomes: track.outcomes?.length ? track.outcomes : undefined,
        audience: track.audience ?? undefined,
        order: track.order,
        show: track.show,
        opensWhen: track.opensWhen,
        stages: track.stages,
        archivedAt: undefined,
        updatedByUserId: community.ownerId,
        updatedAt: now,
      };
      if (row) await ctx.db.patch(row._id, { ...fields, revision: row.revision + 1 });
      else await ctx.db.insert("communityLessonTracks", { communityId, key: track.key, ...fields, revision: 1, createdByUserId: community.ownerId, createdAt: now });
    }
    return { dryRun: false, summary, missing };
  },
});

/** Puts the tracks in this order; keys not listed keep their place after them. */
export const reorderCommunityLessonTracks = mutation({
  args: { ...actor, keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await actorId(ctx, args);
    await requireCommunityManager({ ctx, communityId: args.communityId, userId });
    const rows = await listRows(ctx, args.communityId);
    const now = Date.now();
    const ordered = [...args.keys, ...rows.map((row) => row.key).filter((key) => !args.keys.includes(key))];
    for (const [index, key] of ordered.entries()) {
      const row = rows.find((candidate) => candidate.key === key);
      if (row && row.order !== index) await ctx.db.patch(row._id, { order: index, updatedByUserId: userId, updatedAt: now });
    }
    return { keys: ordered };
  },
});

/** Archives a track (members stop seeing it; progress is kept) or brings it back. */
export const setCommunityLessonTrackArchived = mutation({
  args: { ...actor, key: v.string(), archived: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await actorId(ctx, args);
    await requireCommunityManager({ ctx, communityId: args.communityId, userId });
    const row = (await listRows(ctx, args.communityId)).find((candidate) => candidate.key === args.key);
    if (!row) throw new ConvexError({ code: "track_not_found" });
    await ctx.db.patch(row._id, { archivedAt: args.archived ? Date.now() : undefined, updatedByUserId: userId, updatedAt: Date.now(), revision: row.revision + 1 });
    return { key: args.key, archived: args.archived };
  },
});
