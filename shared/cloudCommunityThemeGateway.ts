import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  bootstrapConvexAuthenticatedClient,
  createConvexClient,
} from "./convexAuthenticatedClient";
import type { CommunityThemeV1 } from "./communityTheme";

export type CommunityThemeDraftState = {
  draft: CommunityThemeV1;
  draftRevision: number;
  published: CommunityThemeV1 | null;
  publishedAt: number | null;
  hasUnpublishedChanges: boolean;
};

/** The community's published theme, or null for Polynet's own look. Needs no session. */
export async function fetchCloudPublishedCommunityTheme(params: {
  communityId: string;
}): Promise<CommunityThemeV1 | null> {
  const client = createConvexClient();
  return (await client.query(api.communityThemes.getPublishedCommunityTheme, {
    communityId: params.communityId as Id<"communities">,
  })) as CommunityThemeV1 | null;
}

export async function fetchCloudCommunityThemeDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
}): Promise<CommunityThemeDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.query(api.communityThemes.getCommunityThemeDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
  })) as CommunityThemeDraftState;
}

export async function saveCloudCommunityThemeDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
  expectedDraftRevision: number;
  theme: unknown;
}): Promise<CommunityThemeDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityThemes.saveCommunityThemeDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    expectedDraftRevision: params.expectedDraftRevision,
    theme: params.theme,
  })) as CommunityThemeDraftState;
}

export async function publishCloudCommunityThemeDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
  expectedDraftRevision: number;
}): Promise<CommunityThemeDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityThemes.publishCommunityThemeDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    expectedDraftRevision: params.expectedDraftRevision,
  })) as CommunityThemeDraftState;
}

export async function discardCloudCommunityThemeDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
  expectedDraftRevision: number;
}): Promise<CommunityThemeDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityThemes.discardCommunityThemeDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    expectedDraftRevision: params.expectedDraftRevision,
  })) as CommunityThemeDraftState;
}
