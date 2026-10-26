import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { WebPlatformTabList, platformTabId, platformTabPanelId } from "./WebPlatformChoiceControls";
import { CommunityResourcesPanel } from "./CommunityResourcesPanel";
import { createServerCommunityEmbedStorage } from "../../../../shared/cloudCommunityEmbedValuesGateway";
import { createBrowserCommunityEmbedStorage } from "../../../../shared/communityEmbedUi";
import { CommunityMemoryGraph } from "./CommunityMemoryGraph";
import { WebCommunityLessonBoard, communityBoardLessons, type RoadmapEditing } from "./WebCommunityLessonBoard";
import { updateCloudCommunityLessonBoard } from "../../../../shared/cloudCommunityAdminGateway";
import { resolveUsableSession } from "../../../../shared/ensureUsableSession";
import { useWebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import {
  WebCommunityTrackEditor,
  WebCommunityTrackHeader,
  WebCommunityTrackHome,
  WebCommunityTrackLocked,
  WebCommunityTrackOpens,
  communityTrackResources,
  communityTrackStagesAfterBoardSave,
} from "./WebCommunityTracks";
import { COMMUNITY_MAIN_TRACK_KEY } from "../../../../shared/communityLessonTracks";
import { fetchCloudCommunityLessonTracks, saveCloudCommunityLessonTrack } from "../../../../shared/cloudCommunityLessonTracksGateway";
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
  // One progress read feeds the Roadmap, its skill tracks and the course cards.
  const progress = useWebCommunityLessonProgress({
    communityId: context.communityId,
    session: context.session ?? null,
  });
  const tracks = progress.tracks;
  // The Roadmap (view id "board") shows when the community has lesson pages with a
  // stage or skill tracks, and always to owners so they can start one.
  const hasBoard = useMemo(
    () => canManage || tracks.length > 0 || communityBoardLessons(resources.state.resources).length > 0,
    [canManage, tracks.length, resources.state.resources],
  );
  // With several tracks the Roadmap opens on the tracks home; with one, on its board.
  const [trackKey, setTrackKey] = useState<string | null>(null);
  const [trackEditor, setTrackEditor] = useState<{ key: string | null } | null>(null);
  // A lesson open on the Roadmap lays the page out for reading, like Resources.
  const [roadmapReading, setRoadmapReading] = useState(false);
  const activeTrack = tracks.length === 1 ? tracks[0] : tracks.find((track) => track.key === trackKey) ?? null;
  const boardResources = useMemo(
    () => (activeTrack ? communityTrackResources(resources.state.resources, activeTrack) : resources.state.resources),
    [activeTrack, resources.state.resources],
  );
  // "Edit lesson" on the Roadmap opens that lesson in the Resources editor.
  const [editRequest, setEditRequest] = useState<{ resourceId: string; key: number } | null>(null);
  const { session: rawSession, ensureSession, communityId } = context;
  const { retryRead, handleCreateBlankPageDraft } = resources.actions;
  const resourceList = resources.state.resources;
  const firstModuleId = resources.state.modules[0]?.id ?? null;
  const reloadProgress = progress.reload;
  const roadmapEditing = useMemo<RoadmapEditing | null>(() => {
    if (!canManage || !rawSession || !communityId) return null;
    // Every track but the main roadmap keeps its stages in the track itself, so
    // board edits there save the track (the same save as the track editor).
    if (activeTrack && activeTrack.key !== COMMUNITY_MAIN_TRACK_KEY) {
      const track = activeTrack;
      const saveStages = async (change: (stages: ReturnType<typeof communityTrackStagesAfterBoardSave>) => ReturnType<typeof communityTrackStagesAfterBoardSave>, updates: Parameters<typeof communityTrackStagesAfterBoardSave>[1]) => {
        const usable = await resolveUsableSession(rawSession as AuthSession, ensureSession);
        if (!usable) return false;
        try {
          const current = (await fetchCloudCommunityLessonTracks({ session: usable, communityId })).tracks.find((row) => row.key === track.key);
          if (!current) return false;
          await saveCloudCommunityLessonTrack({
            session: usable, communityId, key: track.key, expectedRevision: current.revision, title: current.title,
            opensWhen: current.opens_when, stages: change(communityTrackStagesAfterBoardSave(current.stages, updates)),
          });
        } catch {
          return false;
        }
        reloadProgress();
        return true;
      };
      return {
        save: (updates) => saveStages((stages) => stages, updates),
        // A new lesson starts in the course of a lesson near it, and joins only this track.
        addLesson: async ({ stage, order, nearResourceId }) => {
          const moduleId = resourceList.find((resource) => resource.id === nearResourceId)?.module_id ?? firstModuleId;
          if (!moduleId) return null;
          const created = await handleCreateBlankPageDraft(moduleId);
          if (!created) return null;
          await saveStages((stages) => stages, [{ resourceId: created.id, stage, order }]);
          return created;
        },
        editLesson: (resource) => {
          setView("resources");
          setEditRequest({ resourceId: resource.id, key: Date.now() });
        },
      };
    }
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
  }, [canManage, rawSession, ensureSession, communityId, retryRead, handleCreateBlankPageDraft, resourceList, firstModuleId, activeTrack, reloadProgress]);
  const graphOpen = view === "graph" && context.canViewGraph;
  const boardOpen = view === "board" && hasBoard;
  const activeView: KnowledgeView = graphOpen ? "graph" : boardOpen ? "board" : "resources";
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
  // The views are chips, like the channel chips in Classroom.
  const chip = "community-category-chip";
  const tabs: { id: KnowledgeView; label: string; buttonClassName: string }[] = [
    { id: "resources", label: "Resources", buttonClassName: chip },
    ...(hasBoard ? [{ id: "board" as const, label: "Roadmap", buttonClassName: chip }] : []),
    ...(context.canViewGraph ? [{ id: "graph" as const, label: "Graph", buttonClassName: chip }] : []),
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
      data-reading={(activeView === "resources" && resources.state.selectedModuleId) || (boardOpen && roadmapReading) ? "" : undefined}
    >
      <div className="community-knowledge-header">
        <h1>Knowledge</h1>
        <WebPlatformTabList
          tabs={tabs}
          activeTab={activeView}
          onSelectTab={setView}
          ariaLabel="Knowledge view"
          idPrefix="community-knowledge"
          className="community-knowledge-views"
        />
      </div>
      <div hidden={activeView !== "resources"} role="tabpanel" id={platformTabPanelId("community-knowledge", "resources")} aria-labelledby={platformTabId("community-knowledge", "resources")}>
        <CommunityResourcesPanel {...resources} courseProgress={courseProgress} lessonActivity={lessonActivity} editRequest={editRequest} />
      </div>
      {boardOpen ? (
        <div className="lesson-board-panel" role="tabpanel" id={platformTabPanelId("community-knowledge", "board")} aria-labelledby={platformTabId("community-knowledge", "board")}>
          {tracks.length > 1 && !activeTrack ? (
            <WebCommunityTrackHome
              tracks={tracks}
              onOpenTrack={setTrackKey}
              canManage={canManage}
              onNewTrack={() => setTrackEditor({ key: null })}
              onEditTrack={(key) => setTrackEditor({ key })}
            />
          ) : activeTrack && !activeTrack.open ? (
            <>
              <WebCommunityTrackHeader
                tracks={tracks}
                track={activeTrack}
                onPick={setTrackKey}
                onHome={() => setTrackKey(null)}
                onEdit={canManage ? () => setTrackEditor({ key: activeTrack.key }) : undefined}
              />
              <WebCommunityTrackLocked track={activeTrack} />
            </>
          ) : (
            <>
              <WebCommunityLessonBoard
                resources={boardResources}
                progress={progress}
                signedIn={Boolean(context.session)}
                onRequireSignIn={context.requireSignIn}
                lessonActivity={lessonActivity}
                editing={roadmapEditing}
                title={activeTrack?.title}
                onReadingChange={setRoadmapReading}
                header={activeTrack && (tracks.length > 1 || canManage) ? (
                  <WebCommunityTrackHeader
                    tracks={tracks}
                    track={activeTrack}
                    onPick={setTrackKey}
                    onHome={() => setTrackKey(null)}
                    onEdit={canManage ? () => setTrackEditor({ key: activeTrack.key }) : undefined}
                    onNewTrack={canManage && tracks.length === 1 ? () => setTrackEditor({ key: null }) : undefined}
                  />
                ) : undefined}
              />
              {activeTrack && !roadmapReading ? <WebCommunityTrackOpens track={activeTrack} tracks={tracks} onOpenTrack={setTrackKey} /> : null}
            </>
          )}
          {trackEditor && context.session && context.communityId ? (
            <WebCommunityTrackEditor
              session={context.session}
              communityId={context.communityId}
              trackKey={trackEditor.key}
              onClose={() => setTrackEditor(null)}
              onSaved={progress.reload}
            />
          ) : null}
        </div>
      ) : null}
      {graphOpen ? <div className="community-knowledge-graph" role="tabpanel" id={platformTabPanelId("community-knowledge", "graph")} aria-labelledby={platformTabId("community-knowledge", "graph")}><CommunityMemoryGraph activeCommunityName={context.communityName} state={graph.state} onRefresh={graph.actions.refresh} /></div> : null}
    </section>
  );
}
