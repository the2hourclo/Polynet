import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient, requireConvexUrl } from "./convexAuthenticatedClient";
import { acquireAuthenticatedConvexRealtimeClient, type ConvexRealtimeEnsureSession } from "./convexRealtimeAuth";

export type CloudCommunityTestMember = {
  id: string;
  label: string;
  membership_id: string | null;
  created_at: string;
  /** The Workflow stage the run started in, when not the first. */
  start_milestone_key: string | null;
  /** Started by the viewer, who alone can open the community as it. */
  mine: boolean;
  auth_subject: string | null;
};
export type CloudCommunityTestMembers = { limit: number; test_members: CloudCommunityTestMember[] };
export type CloudCommunityTestMemberStarted = { id: string; label: string; auth_subject: string; membership_id: string };
export type CloudCommunityClientTimelineEntry = { at: string; type: string; summary: string; ref?: string; actor?: string };
export type CloudMyTestRun = { label: string; community_id: string; community_slug: string | null; community_name: string | null };

export async function listCloudCommunityTestMembers(session: unknown, communityId: string): Promise<CloudCommunityTestMembers> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.query(api.communityTestMembers.listTestMembers, { authSubject, communityId: communityId as Id<"communities"> });
}

/** Starts a test member; with a stage key it starts in that Workflow stage instead of joining at the first. */
export async function startCloudCommunityTestMember(session: unknown, communityId: string, milestoneKey?: string | null): Promise<CloudCommunityTestMemberStarted> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityTestMembers.startTestMember, {
    authSubject, communityId: communityId as Id<"communities">, ...(milestoneKey ? { milestoneKey } : {}),
  });
}

export type CloudTestRunStepStatus = "done" | "failed" | "running" | "scheduled" | "waiting" | "skipped" | "not_reached";
export type CloudTestRunStep = { key: string; when: string; does: string; status: CloudTestRunStepStatus; at: string | null; due_at: string | null; error: string | null };
export type CloudTestRunStage = { key: string; name: string; is_current: boolean; reached: boolean; entered_at: string | null; steps: CloudTestRunStep[] };
export type CloudTestRunSequence = { stages: CloudTestRunStage[]; completed_at: string | null };

/** The test member's way through the Workflow, live: each stage's rules and whether they ran. */
export function subscribeCloudTestRunSequence<S>(params: {
  session: S; ensureSession: ConvexRealtimeEnsureSession<S>; communityId: string; testMemberId: string;
  update: (sequence: CloudTestRunSequence) => void; error: () => void;
}): () => void {
  const lease = acquireAuthenticatedConvexRealtimeClient({ session: params.session, convexUrl: requireConvexUrl(), ensureSession: params.ensureSession });
  const watch = lease.client.watchQuery(api.communityTestMembers.getTestRunSequence, {
    authSubject: lease.authSubject, communityId: params.communityId as Id<"communities">,
    testMemberId: params.testMemberId as Id<"communityTestMembers">,
  });
  let closed = false;
  const publish = () => {
    if (closed) return;
    try {
      const value = watch.localQueryResult() as CloudTestRunSequence | undefined;
      if (value !== undefined) params.update(value);
    } catch { params.error(); }
  };
  const stop = watch.onUpdate(publish);
  publish();
  return () => { closed = true; stop(); lease.close(); };
}

/** Skips the wait on timed steps: one (by rule key) or all in the current stage. */
export async function runCloudTestMemberTimedStepsNow(session: unknown, communityId: string, testMemberId: string, automationKey?: string): Promise<number> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  const result = await client.mutation(api.communityTestMembers.runTestMemberTimedStepsNow, {
    authSubject, communityId: communityId as Id<"communities">, testMemberId: testMemberId as Id<"communityTestMembers">,
    ...(automationKey ? { automationKey } : {}),
  });
  return result.ran;
}

export async function endCloudCommunityTestMember(session: unknown, communityId: string, testMemberId: string): Promise<void> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  await client.mutation(api.communityTestMembers.endTestMember, {
    authSubject, communityId: communityId as Id<"communities">, testMemberId: testMemberId as Id<"communityTestMembers">,
  });
}

/** In a test-run tab: who it acts as, or null once the run has ended. Throws when the server refuses the run. */
export async function getCloudMyTestRun(session: unknown): Promise<CloudMyTestRun | null> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.query(api.communityTestMembers.getMyTestRun, { authSubject });
}

/** The test member's record as it changes: what they did and what Workflows did for them. */
export function subscribeCloudCommunityClientTimeline<S>(params: {
  session: S;
  ensureSession: ConvexRealtimeEnsureSession<S>;
  communityId: string;
  membershipId: string;
  update: (entries: CloudCommunityClientTimelineEntry[]) => void;
  error: () => void;
}): () => void {
  const lease = acquireAuthenticatedConvexRealtimeClient({ session: params.session, convexUrl: requireConvexUrl(), ensureSession: params.ensureSession });
  const watch = lease.client.watchQuery(api.communityClients.getClientTimeline, {
    authSubject: lease.authSubject,
    communityId: params.communityId as Id<"communities">,
    membershipId: params.membershipId,
  });
  let closed = false;
  const publish = () => {
    if (closed) return;
    try {
      const value = watch.localQueryResult() as { entries?: CloudCommunityClientTimelineEntry[] } | undefined;
      if (value === undefined) return;
      params.update(Array.isArray(value.entries) ? value.entries : []);
    } catch { params.error(); }
  };
  const stop = watch.onUpdate(publish);
  publish();
  return () => { closed = true; stop(); lease.close(); };
}
