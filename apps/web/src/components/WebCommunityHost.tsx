import { isCommunityChatBackedTab, type AppView, type CommunityTab } from "../../../../shared/appShellNavigation";
import { useActiveCommunityLayout } from "../controllers/useWebCommunityLayout";
import { useWebCommunityFrame } from "../controllers/useWebCommunityFrame";
import { createPortal } from "react-dom";
import { WebCommunityPodRoomHead } from "./WebCommunityPods";
import { WebCommunityPodPanel } from "./WebCommunityPodPanel";
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
  const { pods } = useWebCommunityFrame();
  // In Classroom an invite-only channel opens as its pod's room: a full-height
  // chat with the people along the top, and the pod panel in the right column.
  const projection = chatPanelProps.interactionProjection;
  const activeChannel = projection?.activeChannel ?? null;
  const podId = communityTab === "chat" && pods?.mode === "classroom" && activeChannel?.access_mode === "restricted"
    && pods.pods.some((pod) => pod.id === activeChannel.id) ? activeChannel.id : null;
  const chatPanel = (
    <WebCommunityChatPanel {...chatPanelProps} interactionProjection={chatPanelProps.interactionProjection
      ? {
          ...chatPanelProps.interactionProjection,
          admission: props.admission,
          presentation: podId ? "messages" : layout.pages.chat.presentation,
          surface: communityTab === "members" ? "members" : "chat",
        }
      : undefined} />
  );
  return (
    <div className="community-body">
      {isCommunityChatBackedTab(communityTab) ? (
        podId && pods ? (
          <div className="community-pod-room">
            <WebCommunityPodRoomHead pods={pods} podId={podId} />
            {chatPanel}
            {projection && pods.panelSlot ? createPortal(
              <WebCommunityPodPanel
                podId={podId}
                pinnedRoot={projection.pinnedRoot}
                roots={projection.roots}
                onOpenPost={projection.onSelectRoot}
                canManage={Boolean(projection.canManageActiveChannel)}
              />,
              pods.panelSlot,
            ) : null}
          </div>
        ) : chatPanel
      ) : (
        <WebCommunitySecondaryPanels {...secondaryPanelsProps} />
      )}
    </div>
  );
}
