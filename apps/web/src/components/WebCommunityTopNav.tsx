import { useState, type ReactNode } from "react";
import { Check, Link2, Search, X } from "lucide-react";
import type { CommunityTab } from "../../../../shared/appShellNavigation";
import { communityLayoutTabLabel, visibleCommunityLayoutTabs } from "../../../../shared/communityLayout";
import { UserAvatar } from "../../../../shared/UserAvatar";
import { communityJoinUrl, useWebCommunityFrame } from "../controllers/useWebCommunityFrame";
import type { WebCommunityShellProps } from "./webShellChromeShared";
import { WebCommunityNotificationsMenu } from "./WebCommunityNotificationsMenu";

// The community's navigation as a tab bar across the top, for layouts with
// navigation.position "top". Same tabs, channels, indicators and owner tools
// as the side column (shared/CommunityNav.tsx); only the arrangement differs.
// Channels show as category chips under the tabs on the chat tab.
// The first row is the header: the community, a search across its posts, and
// the member's tools (invite, messages, notifications).

const OWNER_TABS: { tab: CommunityTab; label: string; allowed: (shell: WebCommunityShellProps) => boolean }[] = [
  { tab: "workflows", label: "Workflows", allowed: (shell) => shell.canManageMembersActiveCommunity },
  { tab: "analytics", label: "Analytics", allowed: (shell) => shell.canViewActiveCommunityAnalytics },
  { tab: "settings", label: "Settings", allowed: (shell) => shell.canViewActiveCommunitySettings },
];

export function WebCommunityTopNav({
  communityShell,
  trailing,
}: {
  communityShell: WebCommunityShellProps;
  // Extra header tools, placed after notifications (e.g. the Display menu).
  trailing?: ReactNode;
}) {
  const { layout, postSearch, onPostSearch } = useWebCommunityFrame();
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
  const mentionChannels = channels.filter((channel) => communityShell.communityChannelIndicators[channel.slug]?.mentions);
  const search = (query: string) => {
    onPostSearch(query);
    if (query.trim() && activeTab !== "chat") communityShell.onSelectCommunityTab("chat");
  };

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
      <div className={`community-top-nav-identity${searchOpen ? " is-search-open" : ""}`}>
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
        <label className="community-top-nav-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search posts"
            aria-label={`Search posts in ${community?.name ?? "this community"}`}
            value={postSearch}
            maxLength={120}
            onChange={(event) => search(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                search("");
                setSearchOpen(false);
              }
            }}
            autoFocus={searchOpen}
          />
          {postSearch || searchOpen ? (
            <button
              type="button"
              className="community-top-nav-search-clear"
              aria-label="Clear search"
              onClick={() => {
                search("");
                setSearchOpen(false);
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          className="community-top-nav-icon community-top-nav-search-toggle"
          aria-label="Search posts"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={20} aria-hidden="true" />
        </button>
        <div className="community-top-nav-actions">
          {canInvite ? (
            <button type="button" className="community-top-nav-invite" onClick={() => void copyInvite()}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
              <span>{copied ? "Copied" : "Invite"}</span>
            </button>
          ) : null}
          {communityShell.directMessagesButton ?? null}
          <WebCommunityNotificationsMenu
            communityId={community?.id ?? null}
            events={communityShell.communityActivityEvents ?? []}
            mentionChannels={mentionChannels}
            onSelectTab={communityShell.onSelectCommunityTab}
            onSelectChannel={(slug) => {
              const channel = channels.find((candidate) => candidate.slug === slug);
              if (!channel) return;
              communityShell.onSelectCommunityTab("chat");
              communityShell.onSelectCommunityChannel(channel);
            }}
          />
          {trailing}
        </div>
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
