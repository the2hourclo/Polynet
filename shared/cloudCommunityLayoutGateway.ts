import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  bootstrapConvexAuthenticatedClient,
  createConvexClient,
} from "./convexAuthenticatedClient";
import type { CommunityLayoutV1 } from "./communityLayout";

export type CommunityLayoutDraftState = {
  draft: CommunityLayoutV1;
  draftRevision: number;
  published: CommunityLayoutV1 | null;
  publishedAt: number | null;
  hasUnpublishedChanges: boolean;
};

/** The community's published layout, or null for Polynet's own layout. Needs no session. */
export async function fetchCloudPublishedCommunityLayout(params: {
  communityId: string;
}): Promise<CommunityLayoutV1 | null> {
  const client = createConvexClient();
  return (await client.query(api.communityLayouts.getPublishedCommunityLayout, {
    communityId: params.communityId as Id<"communities">,
  })) as CommunityLayoutV1 | null;
}

export async function fetchCloudCommunityLayoutDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
}): Promise<CommunityLayoutDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.query(api.communityLayouts.getCommunityLayoutDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
  })) as CommunityLayoutDraftState;
}

export async function saveCloudCommunityLayoutDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
  expectedDraftRevision: number;
  layout: unknown;
}): Promise<CommunityLayoutDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityLayouts.saveCommunityLayoutDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    expectedDraftRevision: params.expectedDraftRevision,
    layout: params.layout,
  })) as CommunityLayoutDraftState;
}

export async function publishCloudCommunityLayoutDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
  expectedDraftRevision: number;
}): Promise<CommunityLayoutDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityLayouts.publishCommunityLayoutDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    expectedDraftRevision: params.expectedDraftRevision,
  })) as CommunityLayoutDraftState;
}

export async function discardCloudCommunityLayoutDraft<SessionT>(params: {
  session: SessionT;
  communityId: string;
  expectedDraftRevision: number;
}): Promise<CommunityLayoutDraftState> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityLayouts.discardCommunityLayoutDraft, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    expectedDraftRevision: params.expectedDraftRevision,
  })) as CommunityLayoutDraftState;
}
