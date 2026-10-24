import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import type { CommunityTab } from "../../../../shared/appShellNavigation";
import { communityLayoutTabLabel, visibleCommunityLayoutTabs } from "../../../../shared/communityLayout";
import { UserAvatar } from "../../../../shared/UserAvatar";
import { communityJoinUrl, useWebCommunityFrame } from "../controllers/useWebCommunityFrame";
import type { WebCommunityShellProps } from "./webShellChromeShared";

// The community's navigation as a tab bar across the top, for layouts with
// navigation.position "top". Same tabs, channels, indicators and owner tools
// as the side column (shared/CommunityNav.tsx); only the arrangement differs.
// Channels show as category chips under the tabs on the chat tab.

const OWNER_TABS: { tab: CommunityTab; label: string; allowed: (shell: WebCommunityShellProps) => boolean }[] = [
  { tab: "workflows", label: "Workflows", allowed: (shell) => shell.canManageMembersActiveCommunity },
  { tab: "analytics", label: "Analytics", allowed: (shell) => shell.canViewActiveCommunityAnalytics },
  { tab: "settings", label: "Settings", allowed: (shell) => shell.canViewActiveCommunitySettings },
];

export function WebCommunityTopNav({ communityShell }: { communityShell: WebCommunityShellProps }) {
  const { layout } = useWebCommunityFrame();
  const [copied, setCopied] = useState(false);
  const community = communityShell.activeCommunity;
  const activeTab = communityShell.communityTab;
  const tabs = visibleCommunityLayoutTabs(layout).filter(
    (entry) => entry.tab !== "members" || communityShell.canViewMembersActiveCommunity,
  );
  const ownerTabs = communityShell.isLoadingCommunityAccess ? [] : OWNER_TABS.filter((entry) => entry.allowed(communityShell));
  const joinUrl = communityJoinUrl(community?.slug);
  const canInvite = Boolean(communityShell.canViewMembersActiveCommunity && joinUrl);
  const channels = [...communityShell.communityChannels].sort((a, b) => a.position - b.position);
  const showChips = activeTab === "chat" && channels.length > 1;

  const copyInvite = async () => {
    if (!joinUrl) return;
    await communityShell.onCopyCommunityJoinLink(joinUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const renderTab = (tab: CommunityTab, label: string) => {
    const locked = Boolean(communityShell.lockedCommunityNavTabs?.[tab]);
    const isActive = activeTab === tab;
    return (
      <button
        key={tab}
        type="button"
        role="tab"
        aria-selected={isActive}
        className={`community-top-nav-tab${isActive ? " is-active" : ""}${locked ? " is-locked" : ""}`}
        onClick={() => communityShell.onSelectCommunityTab(tab)}
      >
        <span>{label}</span>
        {!isActive && communityShell.communityTabIndicators[tab] ? <span className="nav-item-dot" aria-hidden="true" /> : null}
      </button>
    );
  };

  return (
    <header className="community-top-nav">
      <div className="community-top-nav-identity">
        {community ? (
          <UserAvatar
            className="community-top-nav-avatar"
            readyClassName="has-image"
            imageClassName="community-top-nav-avatar-image"
            fallbackClassName="community-top-nav-avatar-fallback"
            name={community.name}
            imageUrl={community.avatar_url}
            focusX={community.avatar_focus_x ?? 0.5}
            focusY={community.avatar_focus_y ?? 0.5}
            zoom={community.avatar_zoom ?? 1}
            fallback={<span>{communityShell.communityInitials(community.name)}</span>}
            alt=""
            aria-hidden={true}
          />
        ) : null}
        <span className="community-top-nav-name">{community?.name ?? "Community"}</span>
        {canInvite ? (
          <button type="button" className="community-top-nav-invite" onClick={() => void copyInvite()}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
            {copied ? "Copied" : "Invite"}
          </button>
        ) : null}
      </div>
      <nav className="community-top-nav-tabs" role="tablist" aria-label={`${community?.name ?? "Community"} sections`}>
        {tabs.map((entry) => renderTab(entry.tab, communityLayoutTabLabel(layout, entry.tab)))}
        {ownerTabs.length > 0 ? <span className="community-top-nav-divider" aria-hidden="true" /> : null}
        {ownerTabs.map((entry) => renderTab(entry.tab, entry.label))}
      </nav>
      {showChips ? (
        <div className="community-top-nav-chips" role="group" aria-label="Categories">
          {channels.map((channel) => {
            const selected = communityShell.selectedCommunityChannelSlug === channel.slug
              || (!communityShell.selectedCommunityChannelSlug && channel.is_general);
            const unread = communityShell.communityChannelIndicators[channel.slug]?.chat;
            return (
              <button
                key={channel.id}
                type="button"
                aria-pressed={selected}
                className={`community-category-chip${selected ? " is-selected" : ""}${unread && !selected ? " has-unread" : ""}`}
                onClick={() => communityShell.onSelectCommunityChannel(channel)}
              >
                {channel.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </header>
  );
}
