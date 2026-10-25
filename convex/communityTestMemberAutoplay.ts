import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { communityWelcomeLessonIds } from "./communityCore";
import { requestIsCurrent } from "./communityFormRequestCore";
import { memberFormQuestions, saveOwnAnswers } from "./communityFormRequests";
import { createCommunityInteractionComposerMessageCore } from "./communityInteractions";
import { getCommunityMemberWorkflowByCommunity, getMemberMilestone, resolveCurrentMilestone } from "./communityMemberWorkflowReadCore";
import { runWorkflowTimerNow } from "./communityMemberWorkflows";
import { lessonElements, listMemberVisibleLessonPages, readProgressRows, saveOwnLessonResponse, setOwnResourceProgress } from "./communityResourceProgress";
import { durationText, requireMyTestMember } from "./communityTestMembers";
import type { CommunityFormQuestion } from "../shared/communityForms";

// Autoplay: a test member goes through the Workflow by itself, one step per
// call, doing what a member would do: answer forms, click through lessons,
// post, and wait out timed steps (skipped). The page calls it on a timer, so
// Play, Pause, Step and speed are the page's; the server only does the next
// thing. While it plays, agent steps are previewed, not sent.

/** Agent previews last this long after the last step, so a paused run goes back to normal. */
const AUTOPLAY_WINDOW_MS = 60_000;
const DONE_KEEP = 200;

export type AutoplayBeat = {
  kind: "form" | "lesson_step" | "lesson_done" | "post" | "wait"; text: string; ok: boolean; detail?: string;
  /** Where in the community it happened and the words on what was pressed, for the member tab to show. */
  path?: string; target?: string;
};

/** Answers a form the way a member might, valid for each question's type and format. */
export function sampleFormAnswers(questions: CommunityFormQuestion[], label: string, nowMs: number): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  for (const q of questions) {
    if (q.type === "single_choice") { if (q.options.length) answers[q.key] = "0"; continue; }
    if (q.type === "multiple_choice") { if (q.options.length) answers[q.key] = ["0"]; continue; }
    answers[q.key] = q.answerFormat === "number" ? "3"
      : q.answerFormat === "date" ? new Date(nowMs).toISOString().slice(0, 10)
      : q.answerFormat === "url" ? "https://example.com"
      : q.type === "long_text" ? `Sample answer from ${label} to “${q.title}”. Autoplay wrote this to test the Workflow.`
      : `Sample answer from ${label}`;
  }
  return answers;
}

function quoted(text: string | undefined, fallback: string): string {
  const value = String(text ?? "").trim();
  return value ? `“${value.length > 60 ? `${value.slice(0, 60)}…` : value}”` : fallback;
}

export const autoplayTestMemberStep = mutation({
  args: {
    authSubject: v.optional(v.string()),
    communityId: v.id("communities"),
    testMemberId: v.id("communityTestMembers"),
    /** Pause: agent steps go back to sending as soon as autoplay stops. */
    stop: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ status: "acted" | "idle" | "finished" | "stopped"; beat: AutoplayBeat | null }> => {
    const { row, membership } = await requireMyTestMember(ctx, args);
    const nowMs = Date.now();
    if (args.stop) {
      await ctx.db.patch(row._id, { autoplayUntil: undefined });
      return { status: "stopped", beat: null };
    }
    const done = new Set<string>(row.autoplayDone ?? []);
    const remember = async (...keys: string[]) => {
      for (const key of keys) done.add(key);
      await ctx.db.patch(row._id, { autoplayDone: [...done].slice(-DONE_KEEP) });
    };
    await ctx.db.patch(row._id, { autoplayUntil: nowMs + AUTOPLAY_WINDOW_MS });
    const { communityId } = args;
    const community: any = await ctx.db.get(communityId);
    const base = `/c/${encodeURIComponent(String(community?.slug ?? ""))}`;
    const acted = async (beat: AutoplayBeat) => {
      await ctx.db.patch(row._id, { autoplayLast: { at: Date.now(), text: beat.text,
        ...(beat.path ? { path: beat.path } : {}), ...(beat.target ? { target: beat.target } : {}) } });
      return { status: "acted" as const, beat };
    };
    const userId = row.userId;

    // 1. A form waiting for them: fill it in and send it.
    const pending = await ctx.db.query("communityFormRequests")
      .withIndex("by_member_status", (q: any) => q.eq("membershipId", membership._id).eq("status", "pending")).take(20);
    for (const request of pending) {
      if (done.has(`form:${request._id}`) || !await requestIsCurrent(ctx, request)) continue;
      const version = await ctx.db.get(request.versionId);
      const name = version?.name ?? "a";
      try {
        if (!version) throw new Error("form_version_missing");
        const questions = await memberFormQuestions(ctx, communityId, version.questions);
        await saveOwnAnswers(ctx, { expectedRevision: request.revision, answers: sampleFormAnswers(questions, row.label, nowMs), submit: true }, request);
        await remember(`form:${request._id}`);
        return await acted({ kind: "form", text: `Filled in the ${name} form with sample answers`, ok: true, path: `${base}/chat`, target: name });
      } catch (error) {
        await remember(`form:${request._id}`);
        return await acted({ kind: "form", text: `Couldn't send the ${name} form`, ok: false, detail: String(error instanceof Error ? error.message : error).replace(/_/g, " ") });
      }
    }

    const workflow = await getCommunityMemberWorkflowByCommunity({ ctx, communityId });
    if (!workflow?.milestones.length) return { status: "finished", beat: null };
    const state = await getMemberMilestone({ ctx, workflowId: workflow._id, membershipId: membership._id });
    const current = resolveCurrentMilestone({ workflow, membership, state });
    if (current.completedAt) return { status: "finished", beat: null };
    const visit = `${current.milestone.key}:${current.milestoneEnteredAt}`;
    const runs = await ctx.db.query("communityMemberWorkflowRuns")
      .withIndex("by_workflow_membership_createdAt", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membership._id))
      .order("desc").take(200);
    const ranThisVisit = (ruleKey: string) => runs.some((run: any) => run.automationKey === ruleKey
      && run.milestoneKey === current.milestone.key && run.milestoneEnteredAt === current.milestoneEnteredAt);
    const open = current.milestone.automations.filter((rule: any) => !ranThisVisit(rule.key));

    // 2. Lessons: the welcome lessons, then any lesson or course a rule here waits for.
    const source = await listMemberVisibleLessonPages(ctx, communityId);
    const moduleOrder = new Map(source.modules.map((module: any) => [String(module._id), module.sortOrder ?? 0]));
    const pages = [...source.pages].sort((a: any, b: any) =>
      (moduleOrder.get(String(a.moduleId)) ?? 0) - (moduleOrder.get(String(b.moduleId)) ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const progress = await readProgressRows(ctx, communityId, userId);
    const finished = new Set(progress.filter((p: any) => p.status === "done").map((p: any) => String(p.resourceId)));
    const welcome = await communityWelcomeLessonIds(ctx, communityId);
    const wanted: any[] = pages.filter((page: any) => welcome.has(String(page._id)));
    for (const rule of open) {
      const trigger: any = rule.trigger;
      if (trigger.type === "lesson_completed") {
        const page = trigger.resourceId ? pages.find((p: any) => String(p._id) === trigger.resourceId)
          : pages.find((p: any) => !finished.has(String(p._id)) && !done.has(`lesson:${p._id}`)) ?? pages[0];
        if (page) wanted.push(page);
      } else if (trigger.type === "course_completed") {
        const moduleId = trigger.moduleId ?? pages.find((p: any) => p.moduleId)?.moduleId;
        wanted.push(...pages.filter((p: any) => moduleId && String(p.moduleId) === String(moduleId)));
      }
    }
    for (const page of wanted) {
      const id = String(page._id);
      if (finished.has(id) || done.has(`lesson:${id}`)) continue;
      const title = quoted(page.title, "a lesson");
      const lessonPath = `${base}/resources${page.moduleId ? `/${encodeURIComponent(String(page.moduleId))}` : ""}`;
      const responses = progress.find((p: any) => String(p.resourceId) === id)?.responses ?? [];
      const complete = new Set(responses.filter((r: any) => r.complete).map((r: any) => r.element));
      for (const element of await lessonElements(ctx, page)) {
        if (complete.has(element.id) || element.type === "form" || done.has(`element:${id}:${element.id}`)) continue;
        if (element.type === "button" && element.action !== "confirm" && element.action !== undefined && !element.required) continue;
        const value = element.type === "button" ? true
          : element.type === "checklist" ? (element.choices ?? []).map((choice) => choice.id)
          : element.correct?.length ? element.correct : (element.choices ?? []).slice(0, 1).map((choice) => choice.id);
        const saved: any = await saveOwnLessonResponse(ctx, { userId, communityId, resourceId: id, element: element.id, value });
        await remember(`element:${id}:${element.id}`);
        const text = element.type === "button" ? `Clicked ${quoted(element.label ?? element.prompt, "a button")} in ${title}`
          : element.type === "checklist" ? `Ticked every item of ${quoted(element.prompt, "a checklist")} in ${title}`
          : `Answered the quiz ${quoted(element.prompt, "")} in ${title}`.replace("  ", " ");
        return await acted({ kind: "lesson_step", text, ok: saved.ok !== false, detail: saved.ok === false ? saved.message : undefined,
          path: lessonPath, target: element.type === "button" ? String(element.label ?? element.prompt ?? "") : String(element.prompt ?? "") });
      }
      const marked: any = await setOwnResourceProgress(ctx, { userId, communityId, resourceId: id, status: "done" });
      await remember(`lesson:${id}`);
      return await acted({ kind: "lesson_done", text: `Marked ${title} complete`, ok: marked.ok !== false,
        detail: marked.ok === false ? marked.message : undefined, path: lessonPath, target: String(page.title ?? "") });
    }

    // 3. A rule waiting for them to post: post an intro where it listens.
    for (const rule of open) {
      const trigger: any = rule.trigger;
      if (trigger.type !== "member_contributed" || done.has(`post:${visit}:${rule.key}`)) continue;
      const channelId = trigger.channelId ? ctx.db.normalizeId("communityChannels", trigger.channelId) ?? undefined : undefined;
      try {
        const result: any = await createCommunityInteractionComposerMessageCore(ctx, {
          communityId, ...(channelId ? { channelId } : {}), idempotencyKey: `autoplay:${row._id}:${visit}:${rule.key}`,
          text: `Hi everyone, I'm ${row.label}. (A test post from Autoplay; it's removed when the test run ends.)`,
        }, userId);
        const rootId = result?.interaction?.root_id;
        await remember(`post:${visit}:${rule.key}`, ...(rootId ? [`posted:${rootId}`] : []));
        const channel: any = rootId ? await ctx.db.get((await ctx.db.get(ctx.db.normalizeId("communityInteractionRoots", rootId)!) as any)?.channelId) : null;
        const channelPath = `${base}/chat${channel?.slug && channel.slug !== "general" ? `/${encodeURIComponent(channel.slug)}` : ""}`;
        return await acted({ kind: "post", text: `Posted an intro${channel?.name ? ` in #${channel.name}` : ""}`, ok: true, path: channelPath, target: row.label });
      } catch (error) {
        await remember(`post:${visit}:${rule.key}`);
        return await acted({ kind: "post", text: "Couldn't post", ok: false, detail: String(error instanceof Error ? error.message : error).replace(/_/g, " ") });
      }
    }

    // 4. Timed steps: skip the wait on the next one due.
    const timers = (await ctx.db.query("communityMemberWorkflowTimers")
      .withIndex("by_member_entry", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membership._id)).take(100))
      .filter((timer: any) => timer.status === "pending").sort((a: any, b: any) => a.dueAt - b.dueAt);
    if (timers.length) {
      const timer: any = timers[0];
      const rule: any = current.milestone.automations.find((r: any) => r.key === timer.automationKey);
      const wait = rule?.trigger?.type === "milestone_elapsed" ? durationText(rule.trigger.delayMinutes) : "timed";
      const ran = await runWorkflowTimerNow(ctx, timer);
      return await acted({ kind: "wait", text: `Skipped the ${wait} wait`, ok: !!ran });
    }
    return { status: "idle", beat: null };
  },
});
