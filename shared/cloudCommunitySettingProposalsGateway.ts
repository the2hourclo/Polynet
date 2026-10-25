import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";

// Hard-to-undo Settings changes an agent proposed (convex/communitySettingProposals.ts).
export type CommunitySettingProposal = {
  proposal_id: string;
  operation: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  note: string | null;
  // staged, applying, applied, rejected, failed or expired.
  status: string;
  error: string | null;
  created_at: string;
  expires_at: string;
};
export type CommunitySettingProposals = { pending: CommunitySettingProposal[]; recent: CommunitySettingProposal[] };

export async function listCloudCommunitySettingProposals(session: unknown, communityId: string): Promise<CommunitySettingProposals> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.query(api.communitySettingProposals.listCommunitySettingProposals, { authSubject, communityId: communityId as Id<"communities"> });
}
export async function applyCloudCommunitySettingProposal(session: unknown, communityId: string, proposalId: string): Promise<CommunitySettingProposal> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.action(api.communitySettingProposals.applyCommunitySettingProposal, { authSubject,
    communityId: communityId as Id<"communities">, proposalId: proposalId as Id<"communitySettingProposals"> });
}
export async function rejectCloudCommunitySettingProposal(session: unknown, communityId: string, proposalId: string): Promise<CommunitySettingProposal> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.mutation(api.communitySettingProposals.rejectCommunitySettingProposal, { authSubject,
    communityId: communityId as Id<"communities">, proposalId: proposalId as Id<"communitySettingProposals"> });
}
