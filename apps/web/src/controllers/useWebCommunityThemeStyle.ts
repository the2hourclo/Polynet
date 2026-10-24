import { useEffect, useState } from "react";
import {
  compileCommunityThemeCss,
  communityThemeFontStylesheetUrl,
  type CommunityThemeV1,
} from "../../../../shared/communityTheme";
import {
  fetchCloudCommunityThemeDraft,
  fetchCloudPublishedCommunityTheme,
} from "../../../../shared/cloudCommunityThemeGateway";

const STYLE_ELEMENT_ID = "polynet-community-theme";
const FONT_ELEMENT_ID = "polynet-community-theme-font";

/** Fired after a manager publishes, so the open community picks up its new look. */
export const COMMUNITY_THEME_PUBLISHED_EVENT = "polynet:community-theme-published";

// `polynet dev` opens the community with ?design=draft and saves each edit to
// the draft; the preview re-reads it this often, so changes show within seconds.
const DRAFT_PREVIEW_POLL_MS = 1500;

function draftPreviewRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("design") === "draft";
  } catch {
    return false;
  }
}

function upsertHeadElement<T extends HTMLElement>(id: string, tag: string): T {
  const existing = document.getElementById(id);
  if (existing) return existing as T;
  const element = document.createElement(tag) as T;
  element.id = id;
  document.head.appendChild(element);
  return element;
}

function removeHeadElement(id: string) {
  document.getElementById(id)?.remove();
}

/**
 * Loads the active community's published theme and installs it as one style
 * element scoped to `[data-community-theme="<community id>"]`. Returns the
 * attribute value for the community's own area, or null for Polynet's look.
 * A failed read leaves Polynet's look in place: themes are never required.
 *
 * With ?design=draft and a manager's session, it shows the draft instead and
 * keeps re-reading it, so edits saved by `polynet dev` or an agent appear live.
 * Only managers can read a draft; anyone else sees the published look.
 */
export function useWebCommunityThemeStyle(
  communityId: string | null,
  options: { draftSession?: unknown } = {},
): { attribute: string | null; previewingDraft: boolean } {
  const [loaded, setLoaded] = useState<{ communityId: string; theme: CommunityThemeV1 | null; draft: boolean } | null>(null);
  const draftSession = options.draftSession ?? null;
  const wantsDraft = Boolean(draftSession) && draftPreviewRequested();

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRevision: number | null = null;
    const loadPublished = () => {
      fetchCloudPublishedCommunityTheme({ communityId })
        .then((theme) => {
          if (!cancelled) setLoaded({ communityId, theme, draft: false });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ communityId, theme: null, draft: false });
        });
    };
    const loadDraft = () => {
      fetchCloudCommunityThemeDraft({ session: draftSession, communityId })
        .then((state) => {
          if (cancelled) return;
          if (state.draftRevision !== lastRevision) {
            lastRevision = state.draftRevision;
            setLoaded({ communityId, theme: state.draft, draft: true });
          }
          timer = setTimeout(loadDraft, DRAFT_PREVIEW_POLL_MS);
        })
        .catch(() => {
          // Not a manager after all, or offline: fall back to what members see.
          if (!cancelled && lastRevision === null) loadPublished();
          else if (!cancelled) timer = setTimeout(loadDraft, DRAFT_PREVIEW_POLL_MS * 4);
        });
    };
    const load = wantsDraft ? loadDraft : loadPublished;
    load();
    const onPublished = (event: Event) => {
      if ((event as CustomEvent<{ communityId?: string }>).detail?.communityId === communityId && !wantsDraft) loadPublished();
    };
    window.addEventListener(COMMUNITY_THEME_PUBLISHED_EVENT, onPublished);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(COMMUNITY_THEME_PUBLISHED_EVENT, onPublished);
    };
  }, [communityId, draftSession, wantsDraft]);

  const current = loaded && loaded.communityId === communityId ? loaded : null;
  const theme = current?.theme ?? null;

  useEffect(() => {
    if (!communityId || !theme) return;
    const style = upsertHeadElement<HTMLStyleElement>(STYLE_ELEMENT_ID, "style");
    style.textContent = compileCommunityThemeCss(theme, `[data-community-theme="${CSS.escape(communityId)}"]`);
    const fontUrl = communityThemeFontStylesheetUrl(theme);
    if (fontUrl) {
      const link = upsertHeadElement<HTMLLinkElement>(FONT_ELEMENT_ID, "link");
      link.rel = "stylesheet";
      link.href = fontUrl;
    }
    return () => {
      removeHeadElement(STYLE_ELEMENT_ID);
      removeHeadElement(FONT_ELEMENT_ID);
    };
  }, [communityId, theme]);

  return {
    attribute: communityId && theme ? communityId : null,
    previewingDraft: Boolean(communityId && current?.draft),
  };
}
