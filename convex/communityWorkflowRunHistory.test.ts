/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { activateCommunityMembershipCore } from "./communityMembershipLifecycle";

const modules = import.meta.glob(["./communityMemberWorkflows.ts", "./communityWorkflowRunHistory.ts", "./communityAgentServeWorker.ts", "./memberOntology.ts", "./_generated/**/*.*s"]);
const epoch = 1_800_000_000_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(epoch); });
afterEach(() => vi.useRealTimers());

test("Run history lists a member's automation runs for managers only", async () => {
  const t = convexTest(schema, modules);
  const f = await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { authSubject: "runs-owner", createdAt: epoch, updatedAt: epoch });
    const userId = await ctx.db.insert("users", { authSubject: "runs-member", displayName: "Ava", createdAt: epoch, updatedAt: epoch });
    await ctx.db.insert("operatorRoles", { userId: ownerId, role: "owner", active: true, createdAt: epoch, updatedAt: epoch });
    const communityId = await ctx.db.insert("communities", { ownerId, name: "Runs", slug: "runs", lifecycleStatus: "active", visibility: "unlisted", inferenceFundingPolicy: "managed_required", entryPolicy: "approval", createdAt: epoch, updatedAt: epoch });
    return { ownerId, userId, communityId };
  });
  const owner = t.withIdentity({ subject: "runs-owner" });
  const first = await owner.mutation(api.communityMemberWorkflows.createBuilderWorkflowMilestone, { communityId: f.communityId, expectedRevision: 0, name: "Getting started" });
  await owner.mutation(api.communityMemberWorkflows.updateBuilderWorkflowMilestone, { communityId: f.communityId, expectedRevision: 1,
    milestoneKey: first.milestone.key, name: "Getting started",
    automations: [{ trigger: { type: "milestone_elapsed" as const, delayMinutes: 1 }, action: { type: "prompt_agent" as const, prompt: "Say hi" } }] });
  await t.run(ctx => activateCommunityMembershipCore({ ctx, communityId: f.communityId, userId: f.userId, accessSource: "manual_grant", activationReason: "test", nowMs: epoch }));

  expect((await owner.query(api.communityWorkflowRunHistory.listBuilderWorkflowRunHistory, { communityId: f.communityId })).runs).toEqual([]);
  vi.setSystemTime(epoch + 60_000);
  await t.mutation(internal.communityMemberWorkflows.processDueMilestoneTimersInternal, {});

  const history = await owner.query(api.communityWorkflowRunHistory.listBuilderWorkflowRunHistory, { communityId: f.communityId });
  expect(history.runs).toHaveLength(1);
  expect(history.runs[0]).toMatchObject({ member_name: "Ava", is_test: false, milestone_name: "Getting started", status: "failed" });
  // No private room is set up for Ava, so the agent step fails and says why.
  expect(history.runs[0].steps.map((step) => step.action_type)).toEqual(["prompt_agent"]);
  expect(history.runs[0].steps[0].error_code).toBeTruthy();
  expect((await owner.query(api.communityWorkflowRunHistory.listBuilderWorkflowRunHistory, { communityId: f.communityId, filter: "failed" })).runs).toHaveLength(1);
  expect((await owner.query(api.communityWorkflowRunHistory.listBuilderWorkflowRunHistory, { communityId: f.communityId, filter: "tests" })).runs).toEqual([]);

  const member = t.withIdentity({ subject: "runs-member" });
  await expect(member.query(api.communityWorkflowRunHistory.listBuilderWorkflowRunHistory, { communityId: f.communityId })).rejects.toThrow();
});
