import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";
import type { CommunityLessonProgressStatus, CommunityLessonStage } from "./communityLessonContract";

export type CommunityResourceProgressLesson = {
  ref: string;
  title: string;
  status: CommunityLessonProgressStatus;
  locked: boolean;
  started_at: string | null;
  completed_at: string | null;
};

export type CommunityResourceProgressState = {
  stages: CommunityLessonStage[];
  lessons: CommunityResourceProgressLesson[];
  truncated: boolean;
};

/** The signed-in member's own lesson progress in one community, with stage locks. */
export async function fetchCloudOwnResourceProgress<SessionT>(params: {
  session: SessionT;
  communityId: string;
}): Promise<CommunityResourceProgressState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.query(api.communityResourceProgress.getOwnResourceProgress, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
  })) as CommunityResourceProgressState;
}

export type SetCommunityResourceProgressResult =
  | { ok: true; ref: string; status: CommunityLessonProgressStatus }
  | { ok: false; code: string; message: string };

/** Sets (never toggles) one lesson's status, so a retry is safe. */
export async function setCloudOwnResourceProgress<SessionT>(params: {
  session: SessionT;
  communityId: string;
  resourceId: string;
  status: CommunityLessonProgressStatus;
}): Promise<SetCommunityResourceProgressResult> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityResourceProgress.setOwnResourceProgressStatus, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    resourceId: params.resourceId,
    status: params.status,
  })) as SetCommunityResourceProgressResult;
}
