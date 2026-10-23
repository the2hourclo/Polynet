import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  communityResourceIsLiveModulePage,
  communityResourceModuleIsLive,
  normalizeIdValue,
  requireCommunityChatAccess,
  type CommunityResourceLike,
  type CommunityResourceModuleLike,
} from "./communityCore";
import { resolveSelfCommunityMembershipContext } from "./communityMembershipContextCore";
import { buildCommunityResourceEvidenceRef } from "../shared/communityEvidenceContract";
import {
  computeCommunityLessonStages,
  type CommunityLessonProgressStatus,
} from "../shared/communityLessonContract";

// One member's way through the community's lesson pages: what they have done,
// which board stages are open, and where they stand in the community's
// workflow. Completion is the only stored state; locks and the journey are read
// fresh every time from the lesson gates and the existing workflow.

const PROGRESS_READ_MAX_PAGES = 500;

type ProgressRow = {
  _id: any;
  resourceId: any;
  status: "in_progress" | "done";
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
};

async function listMemberVisibleLessonPages(ctx: any, communityId: any) {
  const modules = ((await ctx.db
    .query("communityResourceModules")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .collect()) as CommunityResourceModuleLike[]).filter(communityResourceModuleIsLive);
  const liveModuleIds = new Set(modules.map((module) => normalizeIdValue(module._id)));
  const rows = (await ctx.db
    .query("communityResources")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .take(PROGRESS_READ_MAX_PAGES + 1)) as CommunityResourceLike[];
  return {
    pages: rows
      .slice(0, PROGRESS_READ_MAX_PAGES)
      .filter((row) => communityResourceIsLiveModulePage(row, liveModuleIds)),
    truncated: rows.length > PROGRESS_READ_MAX_PAGES,
  };
}

async function readOwnProgressRows(ctx: any, communityId: any, userId: any) {
  return (await ctx.db
    .query("communityResourceProgress")
    .withIndex("by_community_user", (q: any) => q.eq("communityId", communityId).eq("userId", userId))
    .take(PROGRESS_READ_MAX_PAGES)) as ProgressRow[];
}

function lessonLocks(pages: CommunityResourceLike[], rows: ProgressRow[]) {
  const doneRefs = new Set(
    rows
      .filter((row) => row.status === "done")
      .map((row) => buildCommunityResourceEvidenceRef(normalizeIdValue(row.resourceId))),
  );
  return computeCommunityLessonStages({
    lessons: pages.map((page) => ({
      ref: buildCommunityResourceEvidenceRef(normalizeIdValue(page._id)),
      lesson: page.lesson ?? null,
    })),
    doneRefs,
  });
}

function toIso(value: number | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : null;
}

export const readOwnResourceProgressInternal = internalQuery({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId: args.userId });
    const { pages, truncated } = await listMemberVisibleLessonPages(ctx, args.communityId);
    const rows = await readOwnProgressRows(ctx, args.communityId, args.userId);
    const { stages, lockedRefs } = lessonLocks(pages, rows);
    const rowByResource = new Map(rows.map((row) => [normalizeIdValue(row.resourceId), row]));

    // The member's place in the community workflow, from the same owner as
    // /members/me/context.md. Stage names only: builder instructions and goals
    // stay private.
    const self = await resolveSelfCommunityMembershipContext({
      ctx,
      actorUserId: args.userId,
      communityId: args.communityId,
    });
    const workflow = self.workflow
      ? await ctx.db.get(self.workflow.id as any)
      : null;
    const journey = self.workflow
      ? {
          current_milestone_key: self.workflow.current_milestone_key,
          current_milestone_name: self.workflow.current_milestone_name,
          entered_at: self.workflow.current_milestone_entered_at,
          completed_at: self.workflow.completed_at,
          all_actions_complete: self.workflow.action_progress?.all_actions_complete ?? null,
          awaiting_approval: Boolean(self.workflow.require_human_approval),
          milestones: ((workflow as any)?.milestones ?? []).map(
            (milestone: { key: string; name: string }, index: number) => ({
              key: milestone.key,
              name: milestone.name,
              position: index + 1,
            }),
          ),
        }
      : null;

    return {
      kind: "community_resource_progress",
      read_at: new Date().toISOString(),
      journey,
      stages,
      lessons: pages.map((page) => {
        const id = normalizeIdValue(page._id);
        const ref = buildCommunityResourceEvidenceRef(id);
        const row = rowByResource.get(id);
        return {
          ref,
          title: page.title,
          status: (row?.status ?? "not_started") as CommunityLessonProgressStatus,
          locked: lockedRefs.has(ref),
          started_at: toIso(row?.startedAt),
          completed_at: toIso(row?.completedAt),
        };
      }),
      truncated,
    };
  },
});

export const setOwnResourceProgressInternal = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    resourceId: v.string(),
    status: v.union(v.literal("not_started"), v.literal("in_progress"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId: args.userId });
    const resourceId = ctx.db.normalizeId("communityResources", args.resourceId);
    const { pages } = await listMemberVisibleLessonPages(ctx, args.communityId);
    const page = resourceId ? pages.find((row) => normalizeIdValue(row._id) === normalizeIdValue(resourceId)) : null;
    if (!resourceId || !page) {
      return { ok: false as const, code: "resource_unavailable", message: "That lesson is not available." };
    }
    const ref = buildCommunityResourceEvidenceRef(normalizeIdValue(resourceId));
    const existing = (await ctx.db
      .query("communityResourceProgress")
      .withIndex("by_community_user_resource", (q) =>
        q.eq("communityId", args.communityId).eq("userId", args.userId).eq("resourceId", resourceId),
      )
      .unique()) as ProgressRow | null;
    if (args.status !== "not_started") {
      const rows = await readOwnProgressRows(ctx, args.communityId, args.userId);
      const { lockedRefs } = lessonLocks(pages, rows);
      if (lockedRefs.has(ref)) {
        return {
          ok: false as const,
          code: "lesson_locked",
          message: "Finish the gate in an earlier stage first.",
        };
      }
    }
    const nowMs = Date.now();
    // Setting (not toggling) a status makes retries safe.
    if (args.status === "not_started") {
      if (existing) await ctx.db.delete(existing._id);
    } else if (!existing) {
      await ctx.db.insert("communityResourceProgress", {
        communityId: args.communityId,
        userId: args.userId,
        resourceId,
        status: args.status,
        startedAt: nowMs,
        ...(args.status === "done" ? { completedAt: nowMs } : {}),
        updatedAt: nowMs,
      });
    } else if (existing.status !== args.status) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        completedAt: args.status === "done" ? nowMs : undefined,
        updatedAt: nowMs,
      });
    }
    return { ok: true as const, ref, status: args.status };
  },
});
