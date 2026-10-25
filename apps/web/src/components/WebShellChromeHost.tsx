import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { visibleCommunityLayoutTabs } from "../../../../shared/communityLayout";
import { WebMobileTopBar } from "./WebMobileTopBar";
import { buildWebShellChromeClassNames } from "../controllers/buildWebShellChromeClassNames";
import { WebDesktopShellHeader } from "./WebDesktopShellHeader";
import { WebCommunityRail } from "./WebCommunityRail";
import { WebMobileCommunityShell } from "./WebMobileCommunityShell";
import { WebMobileGlobalShell } from "./WebMobileGlobalShell";
import { WebCommunityNavSurface } from "./WebCommunityNavSurface";
import { WebSettingsSidebar } from "./WebSettingsSidebar";
import { useWebCommunityThemeStyle } from "../controllers/useWebCommunityThemeStyle";
import { useWebCommunityLayout } from "../controllers/useWebCommunityLayout";
import { WebCommunityFrameContext, type WebCommunityFrame } from "../controllers/useWebCommunityFrame";
import { WebCommunityAside } from "./WebCommunityAside";
import { WebCommunityTopNav } from "./WebCommunityTopNav";
import type {
  MobileOverlay,
  WebCommunityShellProps,
  WebDesktopShellHeaderProps,
  WebSettingsSidebarProps,
} from "./webShellChromeShared";

export type WebShellChromeHostProps = {
  showMobileAppShell: boolean;
  showMobileSettingsShell: boolean;
  showMobilePublicFunnel: boolean;
  mobileOverlay: MobileOverlay;
  mobileChromeAutoHideEnabled: boolean;
  mobileChromeReadingMode: boolean;
  mobileTopBarProps: ComponentProps<typeof WebMobileTopBar>;
  desktopHeader: WebDesktopShellHeaderProps;
  communityShell: WebCommunityShellProps;
  settingsSidebar: WebSettingsSidebarProps;
  hasLeftPanel: boolean;
  isGlobalSettings: boolean;
  mainSurface: ReactNode;
  globalOverlays: ReactNode;
  /** Replaces the community nav and page while the member owes welcome forms. */
  welcomeSurface?: ReactNode;
  // A manager's session, for the draft theme preview; null for everyone else.
  themeDraftSession?: unknown;
  memberSession?: unknown;
};

// Every page inside a community takes its theme, its owner pages included, so
// the community's navigation never changes look between tabs. The community
// rail and everything outside a community keep Polynet's look.
const COMMUNITY_THEMED_DESTINATIONS = new Set([
  "community_settings",
  "community_analytics",
  "community_home",
  "community_chat",
  "community_resources",
  "community_events",
  "community_members",
  "community_about",
  "community_agent",
  "community_workflows",
]);

export function WebShellChromeHost(props: WebShellChromeHostProps) {
  const communityTheme = useWebCommunityThemeStyle(
    COMMUNITY_THEMED_DESTINATIONS.has(props.communityShell.destination.kind)
      ? props.communityShell.activeCommunity?.id ?? null
      : null,
    { draftSession: props.themeDraftSession ?? null },
  );
  const communityThemeAttribute = communityTheme.attribute;
  // The community's layout applies wherever its own navigation shows, owner
  // tools included, so the tab bar doesn't jump between pages.
  const { layout: communityLayout, ready: communityLayoutReady } = useWebCommunityLayout(
    props.communityShell.activeCommunity?.id ?? null,
    { draftSession: props.themeDraftSession ?? null },
  );
  // Members and About are pages only where the community's layout shows them.
  // Elsewhere their links keep landing on chat, as before layouts existed.
  const activeCommunityTab = props.communityShell.communityTab;
  const onSelectCommunityTab = props.communityShell.onSelectCommunityTab;
  const layoutHidesActiveTab =
    communityLayoutReady &&
    (activeCommunityTab === "members" || activeCommunityTab === "about") &&
    !visibleCommunityLayoutTabs(communityLayout).some((entry) => entry.tab === activeCommunityTab);
  useEffect(() => {
    if (layoutHidesActiveTab) onSelectCommunityTab("chat");
  }, [layoutHidesActiveTab, onSelectCommunityTab]);
  const activeCommunityId = props.communityShell.activeCommunity?.id ?? null;
  const [postSearchState, setPostSearchState] = useState<{ communityId: string | null; query: string }>({ communityId: null, query: "" });
  const postSearch = postSearchState.communityId === activeCommunityId ? postSearchState.query : "";
  const setPostSearch = useCallback(
    (query: string) => setPostSearchState({ communityId: activeCommunityId, query }),
    [activeCommunityId],
  );
  const communityFrame: WebCommunityFrame = {
    layout: communityLayout,
    community: props.communityShell.activeCommunity,
    memberCount: props.communityShell.activeCommunityMemberCount,
    session: props.memberSession ?? null,
    canInvite: props.communityShell.canViewMembersActiveCommunity,
    onSelectTab: props.communityShell.onSelectCommunityTab,
    onCopyJoinLink: props.communityShell.onCopyCommunityJoinLink,
    postSearch,
    onPostSearch: setPostSearch,
  };
  const isMobileDedicatedRoot =
    props.showMobileAppShell &&
    (props.communityShell.mobileRootPage === "agent" ||
      props.communityShell.mobileRootPage === "messages");
  const isMobileCommunityHome =
    props.showMobileAppShell &&
    !props.showMobileSettingsShell &&
    props.communityShell.mobileRootPage === "community" &&
    props.communityShell.destination.kind === "community_home";
  const showMobileGlobalShell =
    props.communityShell.showMobileGlobalShell &&
    !props.communityShell.forceMobileCommunityRoot;
  const isMobileDiscoverRoot =
    props.showMobileAppShell &&
    showMobileGlobalShell &&
    props.communityShell.destination.kind === "discover";
  const shellHeader = props.showMobileAppShell ? (
    isMobileDedicatedRoot || isMobileDiscoverRoot ? null : (
      <WebMobileTopBar
        {...props.mobileTopBarProps}
        hasCommunityRail={showMobileGlobalShell}
      />
    )
  ) : (
    <WebDesktopShellHeader {...props.desktopHeader} />
  );

  const welcome = props.welcomeSurface ?? null;
  const isTopCommunityNav =
    !props.showMobileAppShell &&
    props.communityShell.showDesktopCommunityNav &&
    !welcome &&
    communityLayout.navigation.position === "top";
  const desktopCommunityNav = props.communityShell.showDesktopCommunityNav && !welcome ? (
    isTopCommunityNav ? (
      <WebCommunityTopNav communityShell={props.communityShell} />
    ) : (
      <WebCommunityNavSurface
        communityShell={props.communityShell}
        presentation="desktop"
      />
    )
  ) : null;
  const communityAsideBlocks =
    isTopCommunityNav && props.communityShell.communityTab === "chat" ? communityLayout.pages.chat.aside : [];
  const mobileGlobalShellContent = welcome ?? (isMobileCommunityHome ? (
    <WebCommunityNavSurface
      communityShell={props.communityShell}
      presentation="mobile-home"
    />
  ) : isMobileDedicatedRoot ? null : props.mainSurface);
  const mobileGlobalShellLabel = isMobileCommunityHome
    ? "Community home"
    : props.communityShell.mobileRootPage === "agent"
      ? "Polynet AI"
      : props.communityShell.mobileRootPage === "messages"
        ? "Direct messages"
        : props.communityShell.destination.kind === "global_settings"
          ? "Settings"
          : props.communityShell.destination.kind === "community_settings"
            ? "Community settings"
          : props.communityShell.destination.kind === "discover"
            ? "Discover"
            : "Polynet";
  const unthemedMainSurface = showMobileGlobalShell ? (
    <WebMobileGlobalShell
      communityShell={props.communityShell}
      isCommunityHome={isMobileCommunityHome}
      label={mobileGlobalShellLabel}
    >
      {mobileGlobalShellContent}
    </WebMobileGlobalShell>
  ) : welcome ?? props.mainSurface;
  // On desktop the community surface below carries the theme. Elsewhere the
  // page is wrapped without a box of its own, so layout is unchanged.
  const themedMainSurface =
    communityThemeAttribute && !desktopCommunityNav ? (
      <div className="community-theme-scope" data-community-theme={communityThemeAttribute}>
        {unthemedMainSurface}
      </div>
    ) : unthemedMainSurface;
  // With the top tab bar the page sits under it, beside the layout's aside.
  const mainSurface = isTopCommunityNav ? (
    <div className={`community-top-body${communityAsideBlocks.length > 0 ? " has-aside" : ""}`}>
      <div className="community-top-main">{themedMainSurface}</div>
      <WebCommunityAside blocks={communityAsideBlocks} />
    </div>
  ) : themedMainSurface;
  const desktopSettingsSidebar = (
    <WebSettingsSidebar settingsSidebar={props.settingsSidebar} />
  );
  const desktopFrameMode = desktopCommunityNav
    ? isTopCommunityNav ? "community-top" : "community"
    : props.isGlobalSettings
      ? "settings"
      : "single";

  const { rootClassName: chromeRootClassName, shellClassName } = buildWebShellChromeClassNames({
    showMobileAppShell: props.showMobileAppShell,
    showMobileSettingsShell: props.showMobileSettingsShell,
    showMobileGlobalShell,
    showMobilePublicFunnel: props.showMobilePublicFunnel,
    mobileOverlay: Boolean(props.mobileOverlay),
    mobileChromeAutoHideEnabled: props.mobileChromeAutoHideEnabled,
    mobileChromeReadingMode: props.mobileChromeReadingMode,
    showDesktopCommunityRail: props.communityShell.showDesktopCommunityRail,
    showDesktopCommunityNav: props.communityShell.showDesktopCommunityNav,
    isGlobalSettings: props.isGlobalSettings,
    hasLeftPanel: props.hasLeftPanel,
    reserveCommunityNavTopbarSpace:
      !props.showMobileAppShell &&
      props.desktopHeader.isPublicCommunityFunnel &&
      props.desktopHeader.hasBackTargetSnapshot,
  });

  const rootClassName = isTopCommunityNav
    ? `${chromeRootClassName} community-layout-top community-layout-${communityLayout.width}`
    : chromeRootClassName;

  return (
    <WebCommunityFrameContext.Provider value={communityFrame}>
    <div className={rootClassName}>
      {communityTheme.previewingDraft ? (
        <div className="community-theme-draft-banner" role="status">
          Draft preview. Members still see the published look.
        </div>
      ) : null}
      {shellHeader}
      <WebMobileCommunityShell communityShell={props.communityShell} />

      <div className={shellClassName}>
        <WebCommunityRail
          communityShell={props.communityShell}
          presentation="desktop"
        />
        {props.communityShell.showDesktopCommunityRail ? (
          <div
            className={`product-shell-surface product-shell-surface--${desktopFrameMode}`}
            data-community-theme={desktopCommunityNav ? communityThemeAttribute ?? undefined : undefined}
          >
            {desktopFrameMode === "settings" ? desktopSettingsSidebar : null}
            {desktopCommunityNav}
            {mainSurface}
          </div>
        ) : desktopCommunityNav ? (
          <div
            className={`product-shell-surface product-shell-surface--${isTopCommunityNav ? "community-top" : "community"}`}
            data-community-theme={communityThemeAttribute ?? undefined}
          >
            {desktopCommunityNav}
            {mainSurface}
          </div>
        ) : (
          <>
            {desktopSettingsSidebar}
            {mainSurface}
          </>
        )}
      </div>

      {props.globalOverlays}
    </div>
    </WebCommunityFrameContext.Provider>
  );
}
