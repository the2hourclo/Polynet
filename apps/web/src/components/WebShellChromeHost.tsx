import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { layoutForClassroomChat, visibleCommunityLayoutTabs } from "../../../../shared/communityLayout";
import { WebMobileTopBar } from "./WebMobileTopBar";
import { buildWebShellChromeClassNames } from "../controllers/buildWebShellChromeClassNames";
import { WebDesktopShellHeader } from "./WebDesktopShellHeader";
import { WebCommunityRail } from "./WebCommunityRail";
import { WebMobileCommunityShell } from "./WebMobileCommunityShell";
import { WebMobileGlobalShell } from "./WebMobileGlobalShell";
import { WebCommunityNavSurface } from "./WebCommunityNavSurface";
import { useWebCommunityThemeStyle } from "../controllers/useWebCommunityThemeStyle";
import { useWebCommunityLayout, useWebCommunityLayoutChoice } from "../controllers/useWebCommunityLayout";
import { WebCommunityFrameContext, type WebCommunityFrame } from "../controllers/useWebCommunityFrame";
import { WebCommunityAside } from "./WebCommunityAside";
import { usePodSpaces } from "./WebCommunityPods";
import { WebCommunityTopNav } from "./WebCommunityTopNav";
import { WebCommunityOwnerBar, isCommunityOwnerPage } from "./WebCommunityOwnerBar";
import type { AppTheme } from "../../../../shared/theme";
import { WebCommunityDisplayMenu } from "./WebCommunityDisplayMenu";
import { WebAccountSettingsButton } from "./WebAccountSettingsButton";
import { useDraftLook } from "../controllers/useDraftLook";
import { courseCardLookWords } from "./ResourceCourseCatalog";
import { WebChannelsFeelMasthead } from "./WebChannelsFeelMasthead";
import { setMemberPickEverywhere, useMemberPickEverywhere } from "../controllers/communityLookPreference";
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
  /** The welcome as a pop-up: shown over the community page, which stays open behind it. */
  welcomeOverlay?: ReactNode;
  // A manager's session, for the draft theme preview; null for everyone else.
  themeDraftSession?: unknown;
  memberSession?: unknown;
  // The arrangement this member sees ("top" is Classroom). With it the
  // community agent floats at the bottom right instead of being a tab.
  onCommunityLayoutPositionChange?: (position: "top" | "side") => void;
  onOpenCommunityAgent?: () => void;
  appTheme?: AppTheme;
  onChooseAppTheme?: (theme: AppTheme) => void;
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
  "community_funnels",
  // Your settings take the look of the community you came from, so leaving
  // a community for your own settings doesn't change colours (Rashid).
  "global_settings",
]);

// ?pods=aside|header previews the other pods placement (screenshots).
const PODS_PLACE_OVERRIDE: "aside" | "header" | null = (() => {
  try {
    const value = new URLSearchParams(window.location.search).get("pods");
    return value === "aside" || value === "header" ? value : null;
  } catch {
    return null;
  }
})();

export function WebShellChromeHost(props: WebShellChromeHostProps) {
  const pickEverywhere = useMemberPickEverywhere();
  const communityTheme = useWebCommunityThemeStyle(
    COMMUNITY_THEMED_DESTINATIONS.has(props.communityShell.destination.kind)
      ? props.communityShell.activeCommunity?.id ?? null
      : null,
    {
      draftSession: props.themeDraftSession ?? null,
      identity: props.communityShell.activeCommunity?.slug
        ? {
            slug: props.communityShell.activeCommunity.slug,
            name: props.communityShell.activeCommunity.name,
            logoUrl: props.communityShell.activeCommunity.avatar_url ?? null,
          }
        : null,
    },
  );
  const communityThemeAttribute = communityTheme.attribute;
  // The owner's default from Customize, or this browser's Display menu pick.
  const canTryLooks = Boolean(props.communityShell.canManageMembersActiveCommunity);
  const draftLookState = useDraftLook(communityTheme.theme, { canPick: canTryLooks });
  const draftLook = draftLookState.look;
  // The community's layout applies wherever its own navigation shows, owner
  // tools included, so the tab bar doesn't jump between pages.
  const { layout: publishedCommunityLayout, ready: communityLayoutReady } = useWebCommunityLayout(
    props.communityShell.activeCommunity?.id ?? null,
    { draftSession: props.themeDraftSession ?? null },
  );
  // What this member sees: their Classroom/Channels pick where the owner
  // offers one, else the owner's layout.
  const { layout: chosenCommunityLayout, choice: communityLayoutChoice } = useWebCommunityLayoutChoice(
    props.communityShell.activeCommunity?.id ?? null,
    props.memberSession ?? null,
    publishedCommunityLayout,
  );
  // Classroom's Community tab: post cards unless the owner picked a chat.
  const communityLayout = useMemo(
    () => layoutForClassroomChat(chosenCommunityLayout, communityTheme.theme?.classroom_chat ?? "posts"),
    [chosenCommunityLayout, communityTheme.theme?.classroom_chat],
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
    layoutChoice: communityLayoutChoice,
    displayMode: communityTheme.followsMemberMode && props.appTheme && props.onChooseAppTheme
      ? {
          current: communityTheme.theme && !pickEverywhere && !(communityTheme.theme.schemes.light && communityTheme.theme.schemes.dark)
            ? (communityTheme.theme.schemes.dark ? "dark" : "light")
            : props.appTheme,
          onChoose: (theme: AppTheme) => {
            setMemberPickEverywhere(true);
            props.onChooseAppTheme!(theme);
          },
        }
      : null,
    pods: null,
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
  const welcome = props.welcomeSurface ?? null;
  const pageSurface = props.welcomeOverlay ? <>{props.mainSurface}{props.welcomeOverlay}</> : props.mainSurface;
  const isTopCommunityNav =
    !props.showMobileAppShell &&
    props.communityShell.showDesktopCommunityNav &&
    !welcome &&
    communityLayout.navigation.position === "top";
  // Channels keeps Polynet's bar above the page; the Display menu sits at its
  // right, where Classroom's tab bar has it. It draws nothing when there is
  // nothing to choose.
  const sideBarDisplayMenu =
    !props.showMobileAppShell &&
    props.communityShell.showDesktopCommunityNav &&
    !welcome &&
    !isTopCommunityNav ? <WebCommunityDisplayMenu placement="bar" look={draftLookState} canTryLooks={canTryLooks} /> : null;
  const shellHeader = props.showMobileAppShell ? (
    isMobileDedicatedRoot || isMobileDiscoverRoot ? null : (
      <WebMobileTopBar
        {...props.mobileTopBarProps}
        hasCommunityRail={showMobileGlobalShell}
      />
    )
  ) : (
    <WebDesktopShellHeader
      {...props.desktopHeader}
      trailing={<>{sideBarDisplayMenu}<WebAccountSettingsButton communityShell={props.communityShell} placement="bar" /></>}
      communityTheme={isTopCommunityNav ? null : communityThemeAttribute}
    />
  );
  const onLayoutPositionChange = props.onCommunityLayoutPositionChange;
  useEffect(() => {
    onLayoutPositionChange?.(isTopCommunityNav ? "top" : "side");
  }, [isTopCommunityNav, onLayoutPositionChange]);
  // Classroom has no agent page: an agent link opens the floating agent over
  // the community's home tab.
  const onOpenCommunityAgent = props.onOpenCommunityAgent;
  const agentTabInTopLayout = isTopCommunityNav && activeCommunityTab === "agent";
  useEffect(() => {
    if (!agentTabInTopLayout) return;
    onSelectCommunityTab(communityLayout.navigation.home === "agent" ? "chat" : communityLayout.navigation.home);
    onOpenCommunityAgent?.();
  }, [agentTabInTopLayout, onSelectCommunityTab, onOpenCommunityAgent, communityLayout.navigation.home]);
  // Classroom: Settings and Workflows open full screen under a slim bar.
  const isTopOwnerPage = isTopCommunityNav && isCommunityOwnerPage(props.communityShell.communityTab);
  const desktopCommunityNav = props.communityShell.showDesktopCommunityNav && !welcome ? (
    isTopOwnerPage ? (
      <WebCommunityOwnerBar
        communityShell={props.communityShell}
        homeTab={communityLayout.navigation.home === "agent" ? "chat" : communityLayout.navigation.home}
        trailing={<><WebCommunityDisplayMenu placement="top" look={draftLookState} canTryLooks={canTryLooks} /><WebAccountSettingsButton communityShell={props.communityShell} placement="top" /></>}
      />
    ) : isTopCommunityNav ? (
      <WebCommunityTopNav communityShell={props.communityShell} trailing={<><WebCommunityDisplayMenu placement="top" look={draftLookState} canTryLooks={canTryLooks} /><WebAccountSettingsButton communityShell={props.communityShell} placement="top" /></>} />
    ) : (
      <WebCommunityNavSurface
        communityShell={props.communityShell}
        presentation="desktop"
      />
    )
  ) : null;
  // Draft Substack-feel looks for Channels (see useDraftLook); off in Classroom.
  const channelsFeelAttribute = desktopCommunityNav && !isTopCommunityNav && draftLook.feel !== "current" ? draftLook.feel : undefined;
  // Channels chat is always Wide: messages full width from the left edge
  // (Rashid, 2026-10-27, retiring the centred column). Classroom keeps its own.
  const chatViewAttribute = desktopCommunityNav && !isTopCommunityNav ? "wide" : undefined;
  // Draft rail looks, set on <html> so the rail and the frame around the
  // community both see them. The rail reads the community's colours, copied
  // from the themed surface, so it never wears the theme's fonts.
  const railColorAttribute = draftLook.railColor !== "polynet" && communityThemeAttribute ? draftLook.railColor : null;
  const railSizeAttribute = draftLook.railSize === "large" ? "large" : null;
  useEffect(() => {
    const root = document.documentElement;
    if (railSizeAttribute) root.dataset.railSize = railSizeAttribute;
    else delete root.dataset.railSize;
  }, [railSizeAttribute]);
  useEffect(() => {
    const root = document.documentElement;
    const names = ["--bg-workspace", "--pn-accent", "--pn-on-accent", "--text-primary"];
    const clear = () => {
      delete root.dataset.railColor;
      names.forEach((name) => root.style.removeProperty(`--rail-feel-${name.slice(2)}`));
    };
    if (!railColorAttribute || !communityThemeAttribute) {
      clear();
      return;
    }
    let frame = 0;
    let tries = 0;
    const copy = () => {
      const surface = document.querySelector<HTMLElement>(`[data-community-theme="${CSS.escape(communityThemeAttribute)}"]`);
      const style = surface ? getComputedStyle(surface) : null;
      if (!style || !style.getPropertyValue("--pn-accent").trim()) {
        if (tries++ < 60) frame = window.requestAnimationFrame(copy);
        return;
      }
      names.forEach((name) => root.style.setProperty(`--rail-feel-${name.slice(2)}`, style.getPropertyValue(name).trim()));
      root.dataset.railColor = railColorAttribute;
    };
    copy();
    return () => {
      window.cancelAnimationFrame(frame);
      clear();
    };
  }, [railColorAttribute, communityThemeAttribute, communityTheme.theme]);
  // Course card style, pills, description and progress from the theme (set in
  // Customize), on <html> for styles/course-cards.css.
  const courseCardsAttribute = communityThemeAttribute ? courseCardLookWords(communityTheme.theme) : null;
  useEffect(() => {
    const root = document.documentElement;
    if (courseCardsAttribute) root.dataset.courseCards = courseCardsAttribute;
    else delete root.dataset.courseCards;
  }, [courseCardsAttribute]);
  // Classroom shows invite-only channels as pods instead of topic chips.
  // Other members' guide channels aren't the viewer's pods; their own comes first.
  const podSpaces = usePodSpaces(isTopCommunityNav ? props.communityShell.activeCommunity?.id ?? null : null, props.memberSession ?? null);
  const memberSpaces = new Set(podSpaces?.member_spaces ?? []);
  const podChannels = isTopCommunityNav
    ? props.communityShell.communityChannels
      .filter((channel) => channel.access_mode === "restricted" && !memberSpaces.has(channel.id))
      .sort((a, b) => Number(b.id === podSpaces?.mine) - Number(a.id === podSpaces?.mine) || a.position - b.position)
    : [];
  communityFrame.pods = isTopCommunityNav ? {
    place: PODS_PLACE_OVERRIDE ?? communityTheme.theme?.pods_place ?? "aside",
    pods: podChannels,
    unread: Object.fromEntries(podChannels.map((channel) => [channel.slug, Boolean(props.communityShell.communityChannelIndicators[channel.slug]?.chat)])),
    selectedSlug: props.communityShell.communityTab === "chat" ? props.communityShell.selectedCommunityChannelSlug || null : null,
    onOpen: (channel) => {
      props.communityShell.onSelectCommunityTab("chat");
      props.communityShell.onSelectCommunityChannel(channel);
    },
    onLeave: () => {
      const home = props.communityShell.communityChannels.find((channel) => channel.is_general)
        ?? props.communityShell.communityChannels.find((channel) => channel.access_mode !== "restricted");
      if (home) props.communityShell.onSelectCommunityChannel(home);
    },
  } : null;
  const showPodsCard = Boolean(communityFrame.pods && communityFrame.pods.place === "aside" && podChannels.length > 0);
  const communityAsideBlocks =
    isTopCommunityNav && props.communityShell.communityTab === "chat" ? communityLayout.pages.chat.aside : [];
  const hasCommunityAside = communityAsideBlocks.length > 0 || (showPodsCard && props.communityShell.communityTab === "chat");
  const mobileGlobalShellContent = welcome ?? (isMobileCommunityHome ? (
    <WebCommunityNavSurface
      communityShell={props.communityShell}
      presentation="mobile-home"
    />
  ) : isMobileDedicatedRoot ? null : pageSurface);
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
  ) : welcome ?? pageSurface;
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
    <div className={`community-top-body${hasCommunityAside ? " has-aside" : ""}${isTopOwnerPage ? " is-owner-page" : ""}`}>
      <div className="community-top-main">{themedMainSurface}</div>
      {hasCommunityAside ? <WebCommunityAside blocks={communityAsideBlocks} pods={communityFrame.pods} /> : null}
    </div>
  ) : channelsFeelAttribute === "publication" ? (
    <div className="channels-feel-body">
      <WebChannelsFeelMasthead tab={activeCommunityTab} home={communityLayout.navigation.home} />
      {themedMainSurface}
    </div>
  ) : themedMainSurface;
  // Your settings bring their own menu (WebYourSettingsNav), so the frame
  // has one column there too.
  // Channels: Settings swaps the community's menu for its own (with a way
  // back), like Substack, instead of showing two menus side by side.
  const settingsReplacesNav = Boolean(desktopCommunityNav) && !isTopCommunityNav && props.communityShell.communityTab === "settings";
  const desktopFrameMode = desktopCommunityNav && !settingsReplacesNav
    ? isTopCommunityNav ? "community-top" : "community"
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
            data-community-theme={desktopCommunityNav || props.isGlobalSettings ? communityThemeAttribute ?? undefined : undefined}
            data-channels-feel={channelsFeelAttribute}
            data-chat-view={chatViewAttribute}
          >
            {settingsReplacesNav ? null : desktopCommunityNav}
            {mainSurface}
          </div>
        ) : desktopCommunityNav ? (
          <div
            className={`product-shell-surface product-shell-surface--${settingsReplacesNav ? "single" : isTopCommunityNav ? "community-top" : "community"}`}
            data-community-theme={communityThemeAttribute ?? undefined}
            data-channels-feel={channelsFeelAttribute}
            data-chat-view={chatViewAttribute}
          >
            {settingsReplacesNav ? null : desktopCommunityNav}
            {mainSurface}
          </div>
        ) : (
          mainSurface
        )}
      </div>

      {communityThemeAttribute ? (
        // Inside a community, Messages, the floating agent and other overlays
        // take its look too, in either layout.
        <div className="community-theme-scope-overlays" data-community-theme={communityThemeAttribute} style={{ display: "contents" }}>
          {props.globalOverlays}
        </div>
      ) : (
        props.globalOverlays
      )}
    </div>
    </WebCommunityFrameContext.Provider>
  );
}
