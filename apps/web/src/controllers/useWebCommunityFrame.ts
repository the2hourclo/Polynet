import { createContext, useContext } from "react";
import type { CommunityTab } from "../../../../shared/appShellNavigation";
import { DEFAULT_COMMUNITY_LAYOUT, type CommunityLayoutV1 } from "../../../../shared/communityLayout";
import type { CommunityShellCommunity } from "../../../../shared/communityTypes";

// What the community's own area knows about the frame around it: the active
// layout plus the community and actions the layout's blocks (community card,
// upcoming events, About page) need. Provided by WebShellChromeHost.
export type WebCommunityFrame = {
  layout: CommunityLayoutV1;
  community: (CommunityShellCommunity & { one_liner?: string | null; about?: string | null }) | null;
  memberCount: number | null;
  session: unknown | null;
  canInvite: boolean;
  onSelectTab: (tab: CommunityTab) => void;
  onCopyJoinLink: ((joinUrl: string) => Promise<void> | void) | null;
};

export const WebCommunityFrameContext = createContext<WebCommunityFrame>({
  layout: DEFAULT_COMMUNITY_LAYOUT,
  community: null,
  memberCount: null,
  session: null,
  canInvite: false,
  onSelectTab: () => {},
  onCopyJoinLink: null,
});

export function useWebCommunityFrame(): WebCommunityFrame {
  return useContext(WebCommunityFrameContext);
}

export function communityJoinUrl(slug: string | null | undefined): string | null {
  const value = String(slug ?? "").trim();
  if (!value) return null;
  const path = `/c/${encodeURIComponent(value)}`;
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}
