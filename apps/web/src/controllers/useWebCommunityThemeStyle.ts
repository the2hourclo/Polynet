import { useEffect, useState } from "react";
import {
  compileCommunityThemeCss,
  communityThemeFontStylesheetUrl,
  type CommunityThemeV1,
} from "../../../../shared/communityTheme";
import { fetchCloudPublishedCommunityTheme } from "../../../../shared/cloudCommunityThemeGateway";

const STYLE_ELEMENT_ID = "polynet-community-theme";
const FONT_ELEMENT_ID = "polynet-community-theme-font";

/** Fired after a manager publishes, so the open community picks up its new look. */
export const COMMUNITY_THEME_PUBLISHED_EVENT = "polynet:community-theme-published";

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
 */
export function useWebCommunityThemeStyle(communityId: string | null): string | null {
  const [loaded, setLoaded] = useState<{ communityId: string; theme: CommunityThemeV1 | null } | null>(null);

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    const load = () => {
      fetchCloudPublishedCommunityTheme({ communityId })
        .then((theme) => {
          if (!cancelled) setLoaded({ communityId, theme });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ communityId, theme: null });
        });
    };
    load();
    const onPublished = (event: Event) => {
      if ((event as CustomEvent<{ communityId?: string }>).detail?.communityId === communityId) load();
    };
    window.addEventListener(COMMUNITY_THEME_PUBLISHED_EVENT, onPublished);
    return () => {
      cancelled = true;
      window.removeEventListener(COMMUNITY_THEME_PUBLISHED_EVENT, onPublished);
    };
  }, [communityId]);

  const theme = loaded && loaded.communityId === communityId ? loaded.theme : null;

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

  return communityId && theme ? communityId : null;
}
