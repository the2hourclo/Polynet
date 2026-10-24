import { isCommunityChatBackedTab, type AppView, type CommunityTab } from "../../../../shared/appShellNavigation";
import { useActiveCommunityLayout } from "../controllers/useWebCommunityLayout";
import { WebCommunityChatPanel, type WebCommunityChatPanelProps } from "./WebCommunityChatPanel";
import type { CommunityAdmissionControl } from "./CommunityAutoJoinControl";
import { WebCommunitySecondaryPanels, type WebCommunitySecondaryPanelsProps } from "./WebCommunitySecondaryPanels";

type WebCommunityHostProps = {
  admission?: CommunityAdmissionControl;
  activeView: AppView;
  communityTab: CommunityTab;
  chatPanelProps: WebCommunityChatPanelProps;
  secondaryPanelsProps: WebCommunitySecondaryPanelsProps;
};

export function WebCommunityHost(props: WebCommunityHostProps) {
  const { communityTab, chatPanelProps, secondaryPanelsProps } = props;
  const layout = useActiveCommunityLayout();
  return (
    <div className="community-body">
      {isCommunityChatBackedTab(communityTab) ? (
        <WebCommunityChatPanel {...chatPanelProps} interactionProjection={chatPanelProps.interactionProjection
          ? {
              ...chatPanelProps.interactionProjection,
              admission: props.admission,
              presentation: layout.pages.chat.presentation,
              surface: communityTab === "members" ? "members" : "chat",
            }
          : undefined} />
      ) : (
        <WebCommunitySecondaryPanels {...secondaryPanelsProps} />
      )}
    </div>
  );
}
