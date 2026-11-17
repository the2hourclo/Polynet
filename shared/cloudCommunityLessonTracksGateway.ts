// Skill tracks on Knowledge (convex/communityLessonTracks.ts). Fork only.
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";
import type { CommunityTrackDefinition } from "./communityLessonTracks";

type Call = { session: unknown; communityId: string };

export type CommunityStoredTrack = CommunityTrackDefinition & { revision: number };

export type CommunityTracksRead = {
  tracks: CommunityStoredTrack[];
  can_edit: boolean;
  lessons: Array<{ id: string; title: string; module_id: string }>;
};

export async function fetchCommunityLessonTracks(params: Call): Promise<CommunityTracksRead> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return await client.query("communityLessonTracks:getCommunityLessonTracks" as any, { authSubject, communityId: params.communityId }) as CommunityTracksRead;
}

export async function saveCommunityLessonTrackCover(params: Call & { track: CommunityStoredTrack; coverUrl: string | null }) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  const { track } = params;
  return await client.mutation("communityLessonTracks:saveCommunityLessonTrack" as any, {
    authSubject, communityId: params.communityId, key: track.key, expectedRevision: track.revision, title: track.title,
    coverUrl: params.coverUrl, opensWhen: track.opens_when, stages: track.stages,
  }) as { key: string; revision: number };
}
