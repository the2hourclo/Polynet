import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { buildPlatformSwitcherStyle } from "../../../../shared/platformSwitcherUi";
import { WebPlatformTabList, platformTabId, platformTabPanelId } from "./WebPlatformChoiceControls";
import { CommunityResourcesPanel } from "./CommunityResourcesPanel";
import { createServerCommunityEmbedStorage } from "../../../../shared/cloudCommunityEmbedValuesGateway";
import { createBrowserCommunityEmbedStorage } from "../../../../shared/communityEmbedUi";
import { CommunityMemoryGraph } from "./CommunityMemoryGraph";
import { WebCommunityLessonBoard, communityBoardLessons, type RoadmapEditing } from "./WebCommunityLessonBoard";
import { updateCloudCommunityLessonBoard } from "../../../../shared/cloudCommunityAdminGateway";
import { resolveUsableSession } from "../../../../shared/ensureUsableSession";
import { useWebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import { computeCommunityCourseProgress } from "../../../../shared/communityCourseProgress";
import type { WebLessonActivity } from "./WebCommunityResourceViewerContent";
import type { AuthSession } from "../auth";
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
  const canManage = resources.capabilities.canOperateResources;
  // The Roadmap (view id "board") shows when the community has lesson pages with a
  // stage, and always to owners so they can start one.
  const hasBoard = useMemo(() => canManage || communityBoardLessons(resources.state.resources).length > 0, [canManage, resources.state.resources]);
  // "Edit lesson" on the Roadmap opens that lesson in the Resources editor.
  const [editRequest, setEditRequest] = useState<{ resourceId: string; key: number } | null>(null);
  const { session: rawSession, ensureSession, communityId } = context;
  const { retryRead, handleCreateBlankPageDraft } = resources.actions;
  const resourceList = resources.state.resources;
  const firstModuleId = resources.state.modules[0]?.id ?? null;
  const roadmapEditing = useMemo<RoadmapEditing | null>(() => {
    if (!canManage || !rawSession || !communityId) return null;
    return {
      save: async (updates) => {
        const usable = await resolveUsableSession(rawSession as AuthSession, ensureSession);
        if (!usable) return false;
        try {
          await updateCloudCommunityLessonBoard({ session: usable, communityId, updates });
        } catch {
          return false;
        }
        await retryRead("resources");
        return true;
      },
      // A new lesson joins the course of a lesson already in its stage.
      addLesson: async ({ stage, stageOrder, order, nearResourceId }) => {
        const moduleId = resourceList.find((resource) => resource.id === nearResourceId)?.module_id ?? firstModuleId;
        if (!moduleId) return null;
        return handleCreateBlankPageDraft(moduleId, { order, stage, stage_order: stageOrder });
      },
      editLesson: (resource) => {
        setView("resources");
        setEditRequest({ resourceId: resource.id, key: Date.now() });
      },
    };
  }, [canManage, rawSession, ensureSession, communityId, retryRead, handleCreateBlankPageDraft, resourceList, firstModuleId]);
  const graphOpen = view === "graph" && context.canViewGraph;
  const boardOpen = view === "board" && hasBoard;
  const activeView: KnowledgeView = graphOpen ? "graph" : boardOpen ? "board" : "resources";
  // One progress read feeds the Roadmap and the course cards.
  const progress = useWebCommunityLessonProgress({
    communityId: context.communityId,
    session: context.session ?? null,
  });
  const courseProgress = useMemo(
    () =>
      progress.loaded
        ? computeCommunityCourseProgress({ lessons: resources.state.resources, statusByRef: progress.statusByRef })
        : undefined,
    [progress.loaded, progress.statusByRef, resources.state.resources],
  );
  const session = context.session as AuthSession | null;
  const embedStorage = useMemo(
    () => session && context.communityId
      ? createServerCommunityEmbedStorage({
          communityId: context.communityId,
          ensureSession: () => context.ensureSession(session),
          // Per member: another account in this browser never sees these answers.
          fallback: createBrowserCommunityEmbedStorage(`${context.communityId}:user:${session.user.id}`),
        })
      : null,
    [session, context.communityId, context.ensureSession],
  );
  const lessonActivity = useMemo<WebLessonActivity>(() => ({
    progress,
    embedStorage,
    signedIn: Boolean(context.session),
    onRequireSignIn: context.requireSignIn,
    forms: context.session && context.communityId
      ? { communityId: context.communityId, session: context.session as AuthSession, ensureSession: context.ensureSession }
      : null,
  }), [progress, embedStorage, context.session, context.communityId, context.ensureSession, context.requireSignIn]);
  const tabs: { id: KnowledgeView; label: string }[] = [
    { id: "resources", label: "Resources" },
    ...(hasBoard ? [{ id: "board" as const, label: "Roadmap" }] : []),
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
    <section
      className="community-knowledge-page"
      aria-label="Knowledge"
      data-reading={activeView === "resources" && resources.state.selectedModuleId ? "" : undefined}
    >
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
        <CommunityResourcesPanel {...resources} courseProgress={courseProgress} lessonActivity={lessonActivity} editRequest={editRequest} />
      </div>
      {boardOpen ? (
        <div className="lesson-board-panel" role="tabpanel" id={platformTabPanelId("community-knowledge", "board")} aria-labelledby={platformTabId("community-knowledge", "board")}>
          <WebCommunityLessonBoard
            resources={resources.state.resources}
            progress={progress}
            signedIn={Boolean(context.session)}
            onRequireSignIn={context.requireSignIn}
            lessonActivity={lessonActivity}
            editing={roadmapEditing}
          />
        </div>
      ) : null}
      {graphOpen ? <div className="community-knowledge-graph" role="tabpanel" id={platformTabPanelId("community-knowledge", "graph")} aria-labelledby={platformTabId("community-knowledge", "graph")}><CommunityMemoryGraph activeCommunityName={context.communityName} state={graph.state} onRefresh={graph.actions.refresh} /></div> : null}
    </section>
  );
}
