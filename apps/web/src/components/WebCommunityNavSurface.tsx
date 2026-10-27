import { CommunityNav } from "../../../../shared/CommunityNav";
import { webDestinationHasCommunityNavSelection } from "../../../../shared/webAppRouteState";
import type { WebCommunityShellProps } from "./webShellChromeShared";

type WebCommunityNavSurfaceProps = {
  communityShell: WebCommunityShellProps;
  presentation: "desktop" | "mobile-home";
  memberSpaceIds?: string[];
};

export function WebCommunityNavSurface({
  communityShell,
  presentation,
  memberSpaceIds,
}: WebCommunityNavSurfaceProps) {
  const isMobileHome = presentation === "mobile-home";
  const hasDestinationSelection =
    !isMobileHome &&
    webDestinationHasCommunityNavSelection(communityShell.destination);

  return (
    <CommunityNav
      memberNextStep={communityShell.memberNextStep}
      activeCommunity={communityShell.activeCommunity}
      // The banner gear moved to Settings at the top right (WebAccountSettingsButton).
      hideIdentitySettings
      communityTab={communityShell.communityTab}
      activeSelectionMode={hasDestinationSelection ? "route" : "none"}
      tabIndicators={communityShell.communityTabIndicators}
      channels={communityShell.communityChannels}
      memberSpaceIds={memberSpaceIds}
      isLoadingChannels={communityShell.isLoadingCommunityChannels}
      selectedChannelSlug={isMobileHome ? null : communityShell.selectedCommunityChannelSlug}
      channelIndicators={communityShell.communityChannelIndicators}
      onSelectChannel={communityShell.onSelectCommunityChannel}
      onCreateChannel={communityShell.onCreateCommunityChannel}
      isCreatingChannel={communityShell.isCreatingCommunityChannel}
      createChannelError={communityShell.communityChannelCreateError}
      clearCreateChannelError={communityShell.clearCommunityChannelCreateError}
      isAtChannelLimit={communityShell.isAtCommunityChannelLimit}
      maxActiveChannels={communityShell.maxActiveCommunityChannels}
      onReorderChannels={isMobileHome ? undefined : communityShell.onReorderCommunityChannels}
      isReorderingChannels={communityShell.isReorderingCommunityChannels}
      reorderChannelsError={communityShell.communityChannelReorderError}
      clearReorderChannelsError={communityShell.clearCommunityChannelReorderError}
      canViewMembersActiveCommunity={communityShell.canViewMembersActiveCommunity}
      canViewActiveCommunitySettings={communityShell.canViewActiveCommunitySettings}
      canManageMembersActiveCommunity={communityShell.canManageMembersActiveCommunity}
      canViewActiveCommunityAnalytics={communityShell.canViewActiveCommunityAnalytics}
      isLoadingAccess={communityShell.isLoadingCommunityAccess}
      lockedTabs={communityShell.lockedCommunityNavTabs ?? undefined}
      onCopyCommunityJoinLink={communityShell.onCopyCommunityJoinLink}
      onSelectTab={
        isMobileHome
          ? communityShell.onSelectCommunityTabFromMobile
          : communityShell.onSelectCommunityTab
      }
    />
  );
}
