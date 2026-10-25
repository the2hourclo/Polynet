import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";
import type { CommunityMemberAccess } from "./communityAccess";

// Who can use what, and until when: the Clients list with its Access column,
// one client's Access panel, the owner's connected services (such as the
// AIEB MCP) and the member's own license key.

export type CloudCommunityAccessGrant = {
  id: string;
  status: "active" | "ended";
  reason: string;
  ends_at: string | null;
  granted_at: string | null;
  granted_by_user_id: string;
  granted_via: "web" | "agent";
  ended_at: string | null;
  ended_reason: string | null;
};

export type CloudCommunityLicenseKey = { last4: string; created_at: string | null; last_checked_at: string | null };

export type CloudCommunityClientAccess = CommunityMemberAccess & {
  grant: CloudCommunityAccessGrant | null;
  license_key: CloudCommunityLicenseKey | null;
};

export type CloudCommunityClient = {
  membership_id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  status: string;
  role: string;
  access_source: string | null;
  joined_at: string | null;
  left_at: string | null;
  stage: { key: string; name: string; entered_at: string | null; completed_at: string | null } | null;
  lessons_done: number;
  last_active_at: string | null;
  stuck: boolean;
  access: CloudCommunityClientAccess;
};

export type CloudCommunityClientPage = { clients: CloudCommunityClient[]; next_cursor: string | null };

export type CloudCommunityClientAccessDetail = {
  membership_id: string;
  access: CommunityMemberAccess;
  is_test_member: boolean;
  grant: CloudCommunityAccessGrant | null;
  grants: CloudCommunityAccessGrant[];
  license_key: CloudCommunityLicenseKey | null;
  integrations: Array<{
    id: string;
    name: string;
    entitled: boolean;
    last_event: { event_id: string; entitled: boolean | null; status: string; created_at: string | null; delivered_at: string | null; last_error_code: string | null } | null;
  }>;
};

export type CloudCommunityTimelineEntry = { at: string | null; type: string; summary: string };

export type CloudCommunityAccessIntegration = {
  id: string;
  name: string;
  webhook_url: string;
  price_point_ids: string[];
  include_owner_grants: boolean;
  status: string;
  api_key_last4: string;
  signing_secret_last4: string;
  created_at: string | null;
  last_delivered_at: string | null;
  last_failed_at: string | null;
  last_error_code: string | null;
  last_lookup_at: string | null;
};

export type CloudCommunityAccessPricePoint = {
  id: string; name: string; billing_period: string; amount_base_units: number; currency: string; currency_decimals: number; is_current: boolean;
};

export type CloudCommunityAccessIntegrations = {
  integrations: CloudCommunityAccessIntegration[];
  price_points: CloudCommunityAccessPricePoint[];
  loopback_webhooks_allowed: boolean;
  lookup_url: string | null;
};

export type CloudCommunityAccessEvent = {
  event_id: string;
  type: string;
  member_id: string | null;
  member_email: string | null;
  entitled: boolean | null;
  status: "pending" | "delivering" | "delivered" | "needs_attention";
  attempt_count: number;
  response_status: number | null;
  last_error_code: string | null;
  created_at: string | null;
  delivered_at: string | null;
  next_attempt_at: string | null;
};

export type CloudCommunityIntegrationInput = { name: string; webhookUrl: string; pricePointIds: string[]; includeOwnerGrants: boolean };

export type CloudMyCommunityAccess = {
  community: { id: string; slug: string; name: string };
  access: CommunityMemberAccess;
  license_key_available: boolean;
  license_key: CloudCommunityLicenseKey | null;
};

const community = (communityId: string) => communityId as Id<"communities">;

export async function listCloudCommunityClients(session: unknown, communityId: string, cursor?: string | null): Promise<CloudCommunityClientPage> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.query(api.communityClients.listClientsForOwner, {
    authSubject, communityId: community(communityId), ...(cursor ? { cursor } : {}),
  }) as unknown as CloudCommunityClientPage;
}

export async function fetchCloudClientTimeline(session: unknown, communityId: string, membershipId: string): Promise<CloudCommunityTimelineEntry[]> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  const result = await client.query(api.communityClients.getClientTimeline, { authSubject, communityId: community(communityId), membershipId });
  return (result as any).entries ?? [];
}

export async function fetchCloudClientAccess(session: unknown, communityId: string, membershipId: string): Promise<CloudCommunityClientAccessDetail> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.query(api.communityAccess.getClientAccess, { authSubject, communityId: community(communityId), membershipId }) as unknown as CloudCommunityClientAccessDetail;
}

/** Give access by hand (or change its end date): to a client, or by verified email. */
export async function grantCloudCommunityAccess(session: unknown, communityId: string, input: {
  membershipId?: string; email?: string; endsAt: string | null; reason: string;
}): Promise<{ membership_id: string; grant: CloudCommunityAccessGrant }> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.grantCommunityAccess, {
    authSubject, communityId: community(communityId), reason: input.reason, endsAt: input.endsAt,
    ...(input.membershipId ? { membershipId: input.membershipId } : {}), ...(input.email ? { email: input.email } : {}),
  }) as any;
}

export async function endCloudCommunityAccess(session: unknown, communityId: string, membershipId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.endCommunityAccess, { authSubject, communityId: community(communityId), membershipId });
}

export async function revokeCloudClientLicenseKey(session: unknown, communityId: string, membershipId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.revokeClientLicenseKeyForOwner, { authSubject, communityId: community(communityId), membershipId });
}

export async function fetchCloudMyCommunityMemberAccess(session: unknown, communityId: string): Promise<CloudMyCommunityAccess> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.query(api.communityAccess.getMyCommunityAccess, { authSubject, communityId: community(communityId) }) as unknown as CloudMyCommunityAccess;
}

/** A new key, shown once; any older key stops working. */
export async function createCloudMyCommunityLicenseKey(session: unknown, communityId: string): Promise<{ key: string; last4: string; rotated: boolean }> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.createMyCommunityLicenseKey, { authSubject, communityId: community(communityId) }) as any;
}

export async function listCloudAccessIntegrations(session: unknown, communityId: string): Promise<CloudCommunityAccessIntegrations> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.query(api.communityAccess.listAccessIntegrations, { authSubject, communityId: community(communityId) }) as unknown as CloudCommunityAccessIntegrations;
}

/** The API key and signing secret come back once, here. */
export async function createCloudAccessIntegration(session: unknown, communityId: string, input: CloudCommunityIntegrationInput): Promise<{
  integration: CloudCommunityAccessIntegration; api_key: string; signing_secret: string;
}> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.createAccessIntegration, { authSubject, communityId: community(communityId), ...input }) as any;
}

export async function updateCloudAccessIntegration(session: unknown, communityId: string, integrationId: string, input: Partial<CloudCommunityIntegrationInput>) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.updateAccessIntegration, { authSubject, communityId: community(communityId), integrationId, ...input });
}

export async function rotateCloudAccessIntegrationSecret(session: unknown, communityId: string, integrationId: string, which: "api_key" | "signing_secret"): Promise<{ api_key?: string; signing_secret?: string }> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.rotateAccessIntegrationSecret, { authSubject, communityId: community(communityId), integrationId, which }) as any;
}

export async function revokeCloudAccessIntegration(session: unknown, communityId: string, integrationId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.revokeAccessIntegration, { authSubject, communityId: community(communityId), integrationId });
}

export async function sendCloudAccessIntegrationTest(session: unknown, communityId: string, integrationId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.sendAccessIntegrationTest, { authSubject, communityId: community(communityId), integrationId });
}

export async function listCloudAccessIntegrationEvents(session: unknown, communityId: string, integrationId: string): Promise<CloudCommunityAccessEvent[]> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  const result = await client.query(api.communityAccess.listAccessIntegrationEvents, { authSubject, communityId: community(communityId), integrationId });
  return (result as any).events ?? [];
}

export async function retryCloudAccessIntegrationEvent(session: unknown, communityId: string, integrationId: string, eventId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return await client.mutation(api.communityAccess.retryAccessIntegrationEvent, { authSubject, communityId: community(communityId), integrationId, eventId });
}

/** Plain words for the error codes the access functions throw. */
export function communityAccessErrorMessage(error: unknown): string {
  const data = (error as any)?.data;
  const raw = [data?.code, typeof data === "string" ? data : "", (error as any)?.message].filter(Boolean).join(" ");
  const messages: Record<string, string> = {
    access_grant_email_invalid: "That email address doesn't look right.",
    access_grant_user_not_found: "No Polynet account has verified that email yet. Ask them to sign up first.",
    access_grant_email_ambiguous: "More than one account uses that email. Give access from their row in Clients instead.",
    access_grant_owner: "You own this community, so you always have access.",
    access_grant_user_blocked: "This person is banned from the community.",
    access_grant_member_paying: "They're on a paid plan. Change or cancel it in billing first.",
    access_grant_not_found: "There's no access you gave to end.",
    access_grant_reason_required: "Add a short reason, such as \"Trial\" or \"Comp for a podcast guest\".",
    access_grant_reason_too_long: "Keep the reason under 200 characters.",
    access_grant_end_invalid: "Pick a valid end date.",
    access_grant_end_in_past: "The end date has to be in the future.",
    access_grant_end_too_far: "Pick an end date within ten years, or choose no end date.",
    license_key_requires_access: "You need access to this community to make a key.",
    license_key_not_found: "They don't have a license key.",
    access_integration_limit_reached: "A community can connect up to 5 services.",
    access_integration_plans_invalid: "One of the chosen plans no longer exists.",
    access_integration_name_invalid: "Give the service a name of up to 60 characters.",
    access_webhook_url_invalid: "That webhook address isn't a valid URL.",
    access_webhook_url_not_public: "The webhook has to be a public address.",
    access_webhook_url_https_required: "The webhook address has to start with https://.",
    community_client_not_found: "That client isn't in this community.",
  };
  // The code travels inside the server's error text.
  const code = Object.keys(messages).find((key) => raw.includes(key));
  return code ? messages[code] : "That didn't work. Try again.";
}
