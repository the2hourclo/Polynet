import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { buildPlatformSwitcherStyle } from "../../../../shared/platformSwitcherUi";
import { WebPlatformTabList, platformTabId, platformTabPanelId } from "./WebPlatformChoiceControls";
import { CommunityResourcesPanel } from "./CommunityResourcesPanel";
import { CommunityMemoryGraph } from "./CommunityMemoryGraph";
import { WebCommunityLessonBoard, communityBoardLessons } from "./WebCommunityLessonBoard";
import { useWebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import type { WebCommunityChatPanelProps } from "./WebCommunityChatPanel";
import type { WebCommunitySettingsSection } from "./WebCommunitySettingsSection";
import { useWebCommunityPolynetController } from "../controllers/useWebCommunityPolynetController";
import "./WebCommunityKnowledgePanel.css";

type Props = {
  resources: ComponentProps<typeof CommunityResourcesPanel>;
  context: {
    communityId: string | null;
    communityName: string | null;
    session: WebCommunityChatPanelProps["session"];
    ensureSession: ComponentProps<typeof WebCommunitySettingsSection>["ensureSession"];
    requireSignIn: () => void;
    canViewGraph: boolean;
  };
};

type KnowledgeView = "resources" | "board" | "graph";

export function WebCommunityKnowledgePanel({ resources, context }: Props) {
  const [view, setView] = useState<KnowledgeView>("resources");
  useEffect(() => { setView((current) => (current === "graph" ? "resources" : current)); }, [resources.state.selectedModuleId]);
  // The Board shows when the community has lesson pages with a stage.
  const hasBoard = useMemo(() => communityBoardLessons(resources.state.resources).length > 0, [resources.state.resources]);
  const graphOpen = view === "graph" && context.canViewGraph;
  const boardOpen = view === "board" && hasBoard;
  const activeView: KnowledgeView = graphOpen ? "graph" : boardOpen ? "board" : "resources";
  const progress = useWebCommunityLessonProgress({
    communityId: hasBoard ? context.communityId : null,
    session: context.session ?? null,
  });
  const tabs: { id: KnowledgeView; label: string }[] = [
    { id: "resources", label: "Resources" },
    ...(hasBoard ? [{ id: "board" as const, label: "Board" }] : []),
    ...(context.canViewGraph ? [{ id: "graph" as const, label: "Graph" }] : []),
  ];
  const graph = useWebCommunityPolynetController({
    activePage: "community",
    communityTab: "resources",
    isGraphOpen: graphOpen,
    activeCommunityId: context.communityId,
    session: context.session,
    ensureSession: context.ensureSession,
    requireSignIn: context.requireSignIn,
    canViewPolynet: context.canViewGraph,
  });
  return (
    <section className="community-knowledge-page" aria-label="Knowledge">
      <div className="community-knowledge-header">
        <h1>Knowledge</h1>
        <WebPlatformTabList
          tabs={tabs}
          activeTab={activeView}
          onSelectTab={setView}
          ariaLabel="Knowledge view"
          idPrefix="community-knowledge"
          style={buildPlatformSwitcherStyle(tabs.length, tabs.findIndex((tab) => tab.id === activeView))}
        />
      </div>
      <div hidden={activeView !== "resources"} role="tabpanel" id={platformTabPanelId("community-knowledge", "resources")} aria-labelledby={platformTabId("community-knowledge", "resources")}>
        <CommunityResourcesPanel {...resources} />
      </div>
      {boardOpen ? (
        <div className="lesson-board-panel" role="tabpanel" id={platformTabPanelId("community-knowledge", "board")} aria-labelledby={platformTabId("community-knowledge", "board")}>
          <WebCommunityLessonBoard
            resources={resources.state.resources}
            progress={progress}
            signedIn={Boolean(context.session)}
            onRequireSignIn={context.requireSignIn}
          />
        </div>
      ) : null}
      {graphOpen ? <div className="community-knowledge-graph" role="tabpanel" id={platformTabPanelId("community-knowledge", "graph")} aria-labelledby={platformTabId("community-knowledge", "graph")}><CommunityMemoryGraph activeCommunityName={context.communityName} state={graph.state} onRefresh={graph.actions.refresh} /></div> : null}
    </section>
  );
}
