import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  communityMembershipRowIsActive,
  communityWelcomeLessonAllowed,
  communityResourceIsLiveModulePage,
  communityResourceModuleIsLive,
  normalizeIdValue,
  requireCommunityChatAccess,
  requireCommunityManager,
  resolveUserIdForAuthenticatedRequest,
  type CommunityResourceLike,
  type CommunityResourceModuleLike,
} from "./communityCore";
import { resolveSelfCommunityMembershipContext } from "./communityMembershipContextCore";
import { hydrateCommunityResourceBody } from "./communityResourceContent";
import { resolveUserProfileDisplayProjection } from "./userProfileProjection";
import { buildCommunityResourceEvidenceRef } from "../shared/communityEvidenceContract";
import {
  computeCommunityLessonStages,
  gradeCommunityLessonResponse,
  parseCommunityLessonElements,
  type CommunityLessonElementWithAnswers,
  type CommunityLessonProgressStatus,
  type CommunityLessonResponseValue,
} from "../shared/communityLessonContract";

// One member's way through the community's lesson pages: what they have done,
// what they answered, which board stages are open, and where they stand in
// the community's workflow. Completion and answers are the only stored state;
// locks and the journey are read fresh every time from the lesson gates and
// the existing workflow.

const PROGRESS_READ_MAX_PAGES = 500;
const REPORT_PAGE_SIZE = 50;

type ResponseRow = {
  element: string;
  value: CommunityLessonResponseValue;
  correct?: boolean;
  complete: boolean;
  at: number;
};

type ProgressRow = {
  _id: any;
  resourceId: any;
  status: "in_progress" | "done";
  startedAt: number;
  completedAt?: number;
  responses?: ResponseRow[];
  updatedAt: number;
};

type LessonPages = {
  modules: CommunityResourceModuleLike[];
  pages: CommunityResourceLike[];
  truncated: boolean;
};

export async function listMemberVisibleLessonPages(ctx: any, communityId: any): Promise<LessonPages> {
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
    modules,
    pages: rows
      .slice(0, PROGRESS_READ_MAX_PAGES)
      .filter((row) => communityResourceIsLiveModulePage(row, liveModuleIds)),
    truncated: rows.length > PROGRESS_READ_MAX_PAGES,
  };
}

export async function readProgressRows(ctx: any, communityId: any, userId: any) {
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

async function lessonElements(ctx: any, page: CommunityResourceLike) {
  if (!page.lesson) return [];
  const hydrated = await hydrateCommunityResourceBody(ctx, page);
  return parseCommunityLessonElements(hydrated?.bodyMd);
}

// A quiz shows its explanation once answered, and its answer once answered right.
function responseView(response: ResponseRow, element: CommunityLessonElementWithAnswers) {
  return {
    element: response.element,
    value: response.value,
    correct: response.correct ?? null,
    complete: response.complete,
    answered_at: new Date(response.at).toISOString(),
    ...(element.type === "quiz"
      ? {
          explanation_md: element.explanation_md ?? null,
          answer: response.correct ? element.correct ?? [] : null,
        }
      : null),
  };
}

function requiredRemaining(elements: CommunityLessonElementWithAnswers[], responses: ResponseRow[] | undefined) {
  const complete = new Set((responses ?? []).filter((row) => row.complete).map((row) => row.element));
  return elements.filter((element) => element.required && !complete.has(element.id)).map((element) => element.id);
}

/** Lesson-by-lesson progress for one member, shared by the member's own read and the owner's. */
async function buildMemberProgress(ctx: any, source: LessonPages, rows: ProgressRow[]) {
  const { stages, lockedRefs } = lessonLocks(source.pages, rows);
  const rowByResource = new Map(rows.map((row) => [normalizeIdValue(row.resourceId), row]));
  const lessons = await Promise.all(source.pages.map(async (page) => {
    const id = normalizeIdValue(page._id);
    const ref = buildCommunityResourceEvidenceRef(id);
    const row = rowByResource.get(id);
    // Bodies are read only for lessons the member has answered something in.
    const elements = row?.responses?.length ? await lessonElements(ctx, page) : [];
    const byId = new Map(elements.map((element) => [element.id, element]));
    return {
      ref,
      title: page.title,
      course_ref: page.moduleId ? `module:${normalizeIdValue(page.moduleId)}` : null,
      status: (row?.status ?? "not_started") as CommunityLessonProgressStatus,
      locked: lockedRefs.has(ref),
      started_at: toIso(row?.startedAt),
      completed_at: toIso(row?.completedAt),
      responses: (row?.responses ?? []).flatMap((response) => {
        const element = byId.get(response.element);
        return element ? [responseView(response, element)] : [];
      }),
    };
  }));
  return { stages, lessons };
}

// Totals come from the course's visible lessons; done counts from the member's rows.
export function courseSummaries(source: LessonPages, rows: ProgressRow[]) {
  const rowByResource = new Map(rows.map((row) => [normalizeIdValue(row.resourceId), row]));
  return source.modules.map((module) => {
    const inCourse = source.pages.filter((page) => normalizeIdValue(page.moduleId) === normalizeIdValue(module._id));
    const done = inCourse
      .map((page) => rowByResource.get(normalizeIdValue(page._id)))
      .filter((row): row is ProgressRow => row?.status === "done");
    const total = inCourse.length;
    const lastDone = Math.max(0, ...done.map((row) => row.completedAt ?? 0));
    return {
      ref: `module:${normalizeIdValue(module._id)}`,
      name: module.name ?? null,
      lesson_count: total,
      done_count: done.length,
      percent: total ? Math.round((done.length / total) * 100) : 0,
      completed_at: total && done.length === total ? toIso(lastDone || undefined) : null,
    };
  }).filter((course) => course.lesson_count > 0);
}

const readOwnResourceProgressArgs = {
    userId: v.id("users"),
    communityId: v.id("communities"),
};

async function readOwnResourceProgress(ctx: any, args: any) {
  // A member in the welcome flow reads their own progress for its lesson steps.
  await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId: args.userId, allowWelcome: true });
  const source = await listMemberVisibleLessonPages(ctx, args.communityId);
  const rows = await readProgressRows(ctx, args.communityId, args.userId);
  const { stages, lessons } = await buildMemberProgress(ctx, source, rows);

  // The member's place in the community workflow, from the same owner as
  // /members/me/context.md. Stage names only: builder instructions and goals
  // stay private.
  const self = await resolveSelfCommunityMembershipContext({
    ctx,
    actorUserId: args.userId,
    communityId: args.communityId,
    allowWelcome: true,
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
    courses: courseSummaries(source, rows),
    stages,
    lessons,
    truncated: source.truncated,
  };
}

export const readOwnResourceProgressInternal = internalQuery({ args: readOwnResourceProgressArgs, handler: (ctx, args) => readOwnResourceProgress(ctx, args) });

async function findVisibleLesson(ctx: any, communityId: any, rawResourceId: string) {
  const resourceId = ctx.db.normalizeId("communityResources", rawResourceId);
  const source = await listMemberVisibleLessonPages(ctx, communityId);
  const page = resourceId
    ? source.pages.find((row) => normalizeIdValue(row._id) === normalizeIdValue(resourceId))
    : null;
  return resourceId && page ? { resourceId, page, source } : null;
}

async function findOwnRow(ctx: any, communityId: any, userId: any, resourceId: any) {
  return (await ctx.db
    .query("communityResourceProgress")
    .withIndex("by_community_user_resource", (q: any) =>
      q.eq("communityId", communityId).eq("userId", userId).eq("resourceId", resourceId),
    )
    .unique()) as ProgressRow | null;
}

const UNAVAILABLE = { ok: false as const, code: "resource_unavailable", message: "That lesson is not available." };
const LOCKED = { ok: false as const, code: "lesson_locked", message: "Finish the gate in an earlier stage first." };

const setOwnResourceProgressArgs = {
    userId: v.id("users"),
    communityId: v.id("communities"),
    resourceId: v.string(),
    status: v.union(v.literal("not_started"), v.literal("in_progress"), v.literal("done")),
};

async function setOwnResourceProgress(ctx: any, args: any) {
  await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId: args.userId,
    allowWelcome: await communityWelcomeLessonAllowed(ctx, args.communityId, args.resourceId) });
  const found = await findVisibleLesson(ctx, args.communityId, args.resourceId);
  if (!found) return UNAVAILABLE;
  const { resourceId, page, source } = found;
  const ref = buildCommunityResourceEvidenceRef(normalizeIdValue(resourceId));
  const existing = await findOwnRow(ctx, args.communityId, args.userId, resourceId);
  if (args.status !== "not_started") {
    const rows = await readProgressRows(ctx, args.communityId, args.userId);
    if (lessonLocks(source.pages, rows).lockedRefs.has(ref)) return LOCKED;
  }
  if (args.status === "done") {
    const remaining = requiredRemaining(await lessonElements(ctx, page), existing?.responses);
    if (remaining.length) {
      return {
        ok: false as const,
        code: "lesson_elements_incomplete",
        message: `Finish the required parts of this lesson first: ${remaining.join(", ")}.`,
      };
    }
  }
  const nowMs = Date.now();
  // Setting (not toggling) a status makes retries safe. not_started is a
  // full reset, answers included.
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
  // A newly finished lesson can start the community's Workflow rules (lesson
  // and course completed). Scheduled, so a workflow problem never blocks progress.
  if (args.status === "done" && existing?.status !== "done") {
    await ctx.scheduler.runAfter(0, (internal as any).communityMemberWorkflows.handleLessonCompletedInternal, {
      communityId: args.communityId, userId: args.userId, resourceId,
    });
  }
  return { ok: true as const, ref, status: args.status };
}

export const setOwnResourceProgressInternal = internalMutation({ args: setOwnResourceProgressArgs, handler: (ctx, args) => setOwnResourceProgress(ctx, args) });

const setOwnLessonResponseArgs = {
    userId: v.id("users"),
    communityId: v.id("communities"),
    resourceId: v.string(),
    element: v.string(),
    // null clears the answer.
    value: v.union(v.null(), v.boolean(), v.array(v.string())),
};

async function saveOwnLessonResponse(ctx: any, args: any) {
  await requireCommunityChatAccess({ ctx, communityId: args.communityId, userId: args.userId,
    allowWelcome: await communityWelcomeLessonAllowed(ctx, args.communityId, args.resourceId) });
  const found = await findVisibleLesson(ctx, args.communityId, args.resourceId);
  if (!found) return UNAVAILABLE;
  const { resourceId, page, source } = found;
  const ref = buildCommunityResourceEvidenceRef(normalizeIdValue(resourceId));
  const elements = await lessonElements(ctx, page);
  const element = elements.find((candidate) => candidate.id === args.element);
  if (!element) {
    return { ok: false as const, code: "element_unavailable", message: "That lesson has no element with this id." };
  }
  const rows = await readProgressRows(ctx, args.communityId, args.userId);
  if (lessonLocks(source.pages, rows).lockedRefs.has(ref)) return LOCKED;
  let graded: ReturnType<typeof gradeCommunityLessonResponse> | null = null;
  if (args.value !== null) {
    try {
      graded = gradeCommunityLessonResponse(element, args.value);
    } catch {
      return { ok: false as const, code: "invalid_response", message: "That answer does not fit this element." };
    }
  }
  const nowMs = Date.now();
  const existing = await findOwnRow(ctx, args.communityId, args.userId, resourceId);
  const kept = (existing?.responses ?? []).filter((row) => row.element !== element.id);
  const response: ResponseRow | null = graded
    ? {
        element: element.id,
        value: graded.value,
        ...(graded.correct === null ? {} : { correct: graded.correct }),
        complete: graded.complete,
        at: nowMs,
      }
    : null;
  const responses = response ? [...kept, response] : kept;
  if (!existing) {
    if (response) {
      await ctx.db.insert("communityResourceProgress", {
        communityId: args.communityId,
        userId: args.userId,
        resourceId,
        status: "in_progress",
        startedAt: nowMs,
        responses,
        updatedAt: nowMs,
      });
    }
  } else {
    await ctx.db.patch(existing._id, { responses, updatedAt: nowMs });
  }
  return {
    ok: true as const,
    ref,
    element: element.id,
    response: response ? responseView(response, element) : null,
    // The required elements still open; empty means the lesson can be marked done.
    required_remaining: requiredRemaining(elements, responses),
  };
}

export const setOwnLessonResponseInternal = internalMutation({ args: setOwnLessonResponseArgs, handler: (ctx, args) => saveOwnLessonResponse(ctx, args) });

/**
 * Course completion for every member, for the community's owner and admins.
 * One page of members at a time, each with a per-course summary and their
 * quiz record.
 */
const listCommunityProgressReportArgs = {
    userId: v.id("users"),
    communityId: v.id("communities"),
    cursor: v.optional(v.string()),
};

async function listProgressReport(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const source = await listMemberVisibleLessonPages(ctx, args.communityId);
  const visibleIds = new Set(source.pages.map((page) => normalizeIdValue(page._id)));
  const page = await ctx.db
    .query("communityMemberships")
    .withIndex("by_community", (q: any) => q.eq("communityId", args.communityId))
    .paginate({ numItems: REPORT_PAGE_SIZE, cursor: args.cursor ?? null });
  const members = await Promise.all(page.page.filter(communityMembershipRowIsActive).map(async (membership: any) => {
    const [profile, rows] = await Promise.all([
      resolveUserProfileDisplayProjection(ctx, membership.userId),
      readProgressRows(ctx, args.communityId, membership.userId),
    ]);
    const visibleRows = rows.filter((row) => visibleIds.has(normalizeIdValue(row.resourceId)));
    const quizzes = visibleRows.flatMap((row) => (row.responses ?? []).filter((response) => response.correct !== undefined));
    return {
      membership_id: String(membership._id),
      user_id: String(membership.userId),
      name: profile.display_name,
      last_activity_at: toIso(visibleRows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0) || undefined),
      lessons_done: visibleRows.filter((row) => row.status === "done").length,
      courses: courseSummaries(source, visibleRows).map(({ name: _name, ...course }) => course),
      quizzes: {
        answered: quizzes.length,
        correct: quizzes.filter((response) => response.correct).length,
      },
    };
  }));
  return {
    courses: courseSummaries(source, []).map(({ ref, name, lesson_count }) => ({ ref, name, lesson_count })),
    members,
    next_cursor: page.isDone ? null : page.continueCursor,
    truncated: source.truncated,
  };
}

export const listCommunityProgressReportInternal = internalQuery({ args: listCommunityProgressReportArgs, handler: (ctx, args) => listProgressReport(ctx, args) });

/** One member's lesson-by-lesson progress and answers, for the owner and admins. */
const readMemberProgressReportArgs = {
    userId: v.id("users"),
    communityId: v.id("communities"),
    membershipId: v.string(),
};

async function readMemberProgressReport(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const membershipId = ctx.db.normalizeId("communityMemberships", args.membershipId);
  const membership = membershipId ? await ctx.db.get(membershipId) : null;
  if (!membership || normalizeIdValue(membership.communityId) !== normalizeIdValue(args.communityId)) {
    throw new Error("community_member_not_found");
  }
  const source = await listMemberVisibleLessonPages(ctx, args.communityId);
  const rows = await readProgressRows(ctx, args.communityId, membership.userId);
  const { stages, lessons } = await buildMemberProgress(ctx, source, rows);
  const profile = await resolveUserProfileDisplayProjection(ctx, membership.userId);
  return {
    kind: "community_member_progress_report",
    read_at: new Date().toISOString(),
    membership_id: String(membership._id),
    user_id: String(membership.userId),
    name: profile.display_name,
    active: communityMembershipRowIsActive(membership),
    courses: courseSummaries(source, rows),
    stages,
    lessons,
    truncated: source.truncated,
  };
}

export const readMemberProgressReportInternal = internalQuery({ args: readMemberProgressReportArgs, handler: (ctx, args) => readMemberProgressReport(ctx, args) });

// The same reads and writes for the signed-in member, or owner, in the web app.
function signedIn<A extends { userId: unknown }>(validators: A) {
  const { userId: _userId, ...rest } = validators;
  return { authSubject: v.optional(v.string()), ...rest };
}

async function signedInArgs(ctx: any, args: { authSubject?: string } & Record<string, unknown>) {
  const { authSubject, ...rest } = args;
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: authSubject ?? null });
  return { ...rest, userId };
}

export const getOwnResourceProgress = query({
  args: signedIn(readOwnResourceProgressArgs),
  handler: async (ctx, args) => readOwnResourceProgress(ctx, await signedInArgs(ctx, args)),
});

export const setOwnResourceProgressStatus = mutation({
  args: signedIn(setOwnResourceProgressArgs),
  handler: async (ctx, args) => setOwnResourceProgress(ctx, await signedInArgs(ctx, args)),
});

export const setOwnLessonResponse = mutation({
  args: signedIn(setOwnLessonResponseArgs),
  handler: async (ctx, args) => saveOwnLessonResponse(ctx, await signedInArgs(ctx, args)),
});

export const listCommunityProgressReport = query({
  args: signedIn(listCommunityProgressReportArgs),
  handler: async (ctx, args) => listProgressReport(ctx, await signedInArgs(ctx, args)),
});

export const getMemberProgressReport = query({
  args: signedIn(readMemberProgressReportArgs),
  handler: async (ctx, args) => readMemberProgressReport(ctx, await signedInArgs(ctx, args)),
});
