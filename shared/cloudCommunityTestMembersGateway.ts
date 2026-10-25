import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient, requireConvexUrl } from "./convexAuthenticatedClient";
import { acquireAuthenticatedConvexRealtimeClient, type ConvexRealtimeEnsureSession } from "./convexRealtimeAuth";

export type CloudCommunityTestMember = {
  id: string;
  label: string;
  membership_id: string | null;
  created_at: string;
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

export async function startCloudCommunityTestMember(session: unknown, communityId: string): Promise<CloudCommunityTestMemberStarted> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityTestMembers.startTestMember, { authSubject, communityId: communityId as Id<"communities"> });
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
