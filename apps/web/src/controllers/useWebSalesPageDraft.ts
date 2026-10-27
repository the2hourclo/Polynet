import { useEffect, useRef, useState } from "react";

import { uploadCloudCommunityResourceImage } from "../../../../shared/cloudCommunityAdminGateway";
import {
  discardCloudCommunityLayoutDraft,
  fetchCloudCommunityLayoutDraft,
  publishCloudCommunityLayoutDraft,
  saveCloudCommunityLayoutDraft,
  type CommunityLayoutDraftState,
} from "../../../../shared/cloudCommunityLayoutGateway";
import type { CommunityLayoutV1 } from "../../../../shared/communityLayout";
import { COMMUNITY_LAYOUT_PUBLISHED_EVENT } from "./useWebCommunityLayout";

type AboutPage = CommunityLayoutV1["pages"]["about"];

// The sales page's draft for editing it in place on the About tab: the same
// layout draft Funnels › Sales page and an agent's layout.json write, loaded
// only while the owner is editing.
export function useWebSalesPageDraft(params: { communityId: string | null; session: unknown; enabled: boolean }) {
  const { communityId, session, enabled } = params;
  const [state, setState] = useState<CommunityLayoutDraftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || !communityId || !session) {
      setState(null);
      return;
    }
    let active = true;
    setError(null);
    fetchCloudCommunityLayoutDraft({ session, communityId })
      .then((loaded) => { if (active) setState(loaded); })
      .catch(() => { if (active) setError("Could not load the page for editing."); });
    return () => { active = false; };
  }, [enabled, communityId, session, reload]);

  const run = async (operation: (current: CommunityLayoutDraftState) => Promise<CommunityLayoutDraftState>): Promise<boolean> => {
    if (!state || busy || !communityId) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await operation(state);
      if (!alive.current) return false;
      setState(next);
      return true;
    } catch (caught) {
      if (!alive.current) return false;
      const message = String((caught as { data?: { code?: string } })?.data?.code ?? caught ?? "");
      setError(message.includes("conflict")
        ? "The page changed in another window. Reload to continue."
        : "Could not save. Try again.");
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const saveAbout = (patch: Partial<AboutPage>) => run((current) => saveCloudCommunityLayoutDraft({
    session,
    communityId: communityId!,
    expectedDraftRevision: current.draftRevision,
    layout: { ...current.draft, pages: { ...current.draft.pages, about: { ...current.draft.pages.about, ...patch } } },
  }));

  const publish = async () => {
    const ok = await run((current) => publishCloudCommunityLayoutDraft({
      session,
      communityId: communityId!,
      expectedDraftRevision: current.draftRevision,
    }));
    if (ok) window.dispatchEvent(new CustomEvent(COMMUNITY_LAYOUT_PUBLISHED_EVENT, { detail: { communityId } }));
    return ok;
  };

  const discard = () => run((current) => discardCloudCommunityLayoutDraft({
    session,
    communityId: communityId!,
    expectedDraftRevision: current.draftRevision,
  }));

  const uploadImage = (file: File) => {
    if (!communityId || !session) return Promise.reject(new Error("Sign in again to upload."));
    return uploadCloudCommunityResourceImage({ session, communityId, file });
  };

  return {
    state,
    busy,
    error,
    saveAbout,
    publish,
    discard,
    uploadImage,
    reload: () => setReload((n) => n + 1),
  };
}
