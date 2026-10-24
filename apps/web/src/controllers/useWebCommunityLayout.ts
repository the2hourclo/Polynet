import { useEffect, useState } from "react";
import { useWebCommunityFrame } from "./useWebCommunityFrame";
import { DEFAULT_COMMUNITY_LAYOUT, type CommunityLayoutV1 } from "../../../../shared/communityLayout";
import {
  fetchCloudCommunityLayoutDraft,
  fetchCloudPublishedCommunityLayout,
} from "../../../../shared/cloudCommunityLayoutGateway";

/** Fired after a manager publishes, so the open community picks up its new layout. */
export const COMMUNITY_LAYOUT_PUBLISHED_EVENT = "polynet:community-layout-published";

// Same preview rule as the theme (useWebCommunityThemeStyle): `polynet dev`
// opens the community with ?design=draft and the preview re-reads the draft.
const DRAFT_PREVIEW_POLL_MS = 1500;

function draftPreviewRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("design") === "draft";
  } catch {
    return false;
  }
}

/**
 * Loads the active community's published layout. Until it loads, and when a
 * community has none or the read fails, Polynet's own layout is used: layouts
 * are never required. With ?design=draft and a manager's session it shows the
 * draft instead and keeps re-reading it; anyone else sees the published layout.
 */
export function useWebCommunityLayout(
  communityId: string | null,
  options: { draftSession?: unknown } = {},
): { layout: CommunityLayoutV1; ready: boolean } {
  const [loaded, setLoaded] = useState<{ communityId: string; layout: CommunityLayoutV1 | null } | null>(null);
  const draftSession = options.draftSession ?? null;
  const wantsDraft = Boolean(draftSession) && draftPreviewRequested();

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRevision: number | null = null;
    const loadPublished = () => {
      fetchCloudPublishedCommunityLayout({ communityId })
        .then((layout) => {
          if (!cancelled) setLoaded({ communityId, layout });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ communityId, layout: null });
        });
    };
    const loadDraft = () => {
      fetchCloudCommunityLayoutDraft({ session: draftSession, communityId })
        .then((state) => {
          if (cancelled) return;
          if (state.draftRevision !== lastRevision) {
            lastRevision = state.draftRevision;
            setLoaded({ communityId, layout: state.draft });
          }
          timer = setTimeout(loadDraft, DRAFT_PREVIEW_POLL_MS);
        })
        .catch(() => {
          // Not a manager after all, or offline: fall back to what members see.
          if (!cancelled && lastRevision === null) loadPublished();
          else if (!cancelled) timer = setTimeout(loadDraft, DRAFT_PREVIEW_POLL_MS * 4);
        });
    };
    (wantsDraft ? loadDraft : loadPublished)();
    const onPublished = (event: Event) => {
      if ((event as CustomEvent<{ communityId?: string }>).detail?.communityId === communityId && !wantsDraft) loadPublished();
    };
    window.addEventListener(COMMUNITY_LAYOUT_PUBLISHED_EVENT, onPublished);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(COMMUNITY_LAYOUT_PUBLISHED_EVENT, onPublished);
    };
  }, [communityId, draftSession, wantsDraft]);

  // `ready` once this community's layout (or its absence) is known, so a page
  // can tell "hidden by the layout" apart from "not loaded yet".
  const ready = Boolean(loaded && loaded.communityId === communityId);
  return { layout: (ready ? loaded!.layout : null) ?? DEFAULT_COMMUNITY_LAYOUT, ready };
}

// The active community's layout for components below the shell.
export function useActiveCommunityLayout(): CommunityLayoutV1 {
  return useWebCommunityFrame().layout;
}
