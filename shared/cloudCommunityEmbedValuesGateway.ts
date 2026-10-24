import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";
import type { CommunityEmbedStorage } from "./communityEmbed";

/**
 * Widget answers kept per member on the server, so they follow the member
 * across devices. An answer saved in this browser before is moved up the first
 * time the widget asks for it; if the server can't be reached the browser
 * copy is used and kept.
 */
export function createServerCommunityEmbedStorage<SessionT>(params: {
  communityId: string;
  ensureSession: () => Promise<SessionT | null>;
  fallback: CommunityEmbedStorage;
}): CommunityEmbedStorage {
  const client = async () => {
    const session = await params.ensureSession();
    if (!session) throw new Error("auth_session_required");
    return bootstrapConvexAuthenticatedClient(session);
  };
  const communityId = params.communityId as Id<"communities">;
  return {
    async load(key) {
      try {
        const { client: convex, authSubject } = await client();
        const value = await convex.query(api.communityEmbedValues.getOwnEmbedValue, { authSubject, communityId, key });
        if (value !== null) return value;
        const local = await params.fallback.load(key);
        if (local !== null) await convex.mutation(api.communityEmbedValues.saveOwnEmbedValue, { authSubject, communityId, key, value: local }).catch(() => null);
        return local;
      } catch {
        return params.fallback.load(key);
      }
    },
    async save(key, value) {
      try {
        const { client: convex, authSubject } = await client();
        await convex.mutation(api.communityEmbedValues.saveOwnEmbedValue, { authSubject, communityId, key, value });
        await params.fallback.save(key, value);
        return true;
      } catch {
        return params.fallback.save(key, value);
      }
    },
  };
}
