import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { ArrowLeft, Maximize2, Minimize2, Network, Pencil, Plus } from "lucide-react";
import { CommunityResourcesPanel } from "./CommunityResourcesPanel";
import { createServerCommunityEmbedStorage } from "../../../../shared/cloudCommunityEmbedValuesGateway";
import { createBrowserCommunityEmbedStorage } from "../../../../shared/communityEmbedUi";
import { CommunityMemoryGraph } from "./CommunityMemoryGraph";
import { WebCommunityLessonBoard, communityBoardLessons, type RoadmapEditing, type RoadmapTrackAbout } from "./WebCommunityLessonBoard";
import { updateCloudCommunityLessonBoard } from "../../../../shared/cloudCommunityAdminGateway";
import { resolveUsableSession } from "../../../../shared/ensureUsableSession";
import { useWebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import {
  WebCommunityTrackEditor,
  WebCommunityTrackHeader,
  WebCommunityTrackHome,
  WebCommunityTrackLibrary,
  type CommunityTrackLibraryCourse,
  WebCommunityTrackShelf,
  type CommunityTrackShelfModule,
  WebCommunityTrackLocked,
  WebCommunityTrackOpens,
  communityTrackResources,
  communityTrackStagesAfterBoardSave,
  type CommunityTrackOfferAccess,
} from "./WebCommunityTracks";
import {
  communityOfferUpgradeErrorMessage,
  fetchCloudCommunityVisitorOffers,
  formatCommunityOfferPrice,
  startCloudCommunityOfferUpgrade,
  type CommunityVisitorOffers,
} from "../../../../shared/cloudCommunityOffersGateway";
import { COMMUNITY_MAIN_TRACK_KEY } from "../../../../shared/communityLessonTracks";
import { fetchCloudCommunityLessonTracks, saveCloudCommunityLessonTrack } from "../../../../shared/cloudCommunityLessonTracksGateway";
import { computeCommunityCourseProgress } from "../../../../shared/communityCourseProgress";
import type { WebLessonActivity } from "./WebCommunityResourceViewerContent";
import type { AuthSession } from "../auth";
import type { WebCommunityChatPanelProps } from "./WebCommunityChatPanel";
import type { WebCommunitySettingsSection } from "./WebCommunitySettingsSection";
import { useWebCommunityPolynetController } from "../controllers/useWebCommunityPolynetController";
import "./WebCommunityKnowledgePanel.css";

// Bars that keep Messages, Display and Settings: Channels' top bar,
// Classroom's identity row, and the phone's top bar.
const LESSON_FOCUS_KEEP_BARS = ".app-topbar, .community-top-nav-identity, .mobile-topbar";

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
  // Knowledge opens on the Roadmap; Resources is only where a course is read,
  // and Graph is a button on the right (Rashid, 2026-10-30).
  const [view, setView] = useState<KnowledgeView>("board");
  useEffect(() => { if (resources.state.selectedModuleId) setView("resources"); }, [resources.state.selectedModuleId]);
  const canManage = resources.capabilities.canOperateResources;
  // Owner tools stay out of the way until the owner turns Edit on.
  const [editMode, setEditMode] = useState(() => readKnowledgeEditMode());
  const toggleEditMode = () => {
    const next = !editMode;
    setEditMode(next);
    try { window.localStorage.setItem(KNOWLEDGE_EDIT_KEY, next ? "on" : "off"); } catch { /* not remembered */ }
  };
  const ownerTools = canManage && editMode;
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
  const [roadmapLessonOpen, setRoadmapLessonOpen] = useState(false);
  const activeTrack = tracks.length === 1 ? tracks[0] : tracks.find((track) => track.key === trackKey) ?? null;
  // A lesson to open on the board from outside it (the free preview, "Go to the next lesson").
  const [openRequest, setOpenRequest] = useState<{ ref: string; key: number } | null>(null);
  const openLesson = (key: string, resourceId: string) => {
    setTrackKey(key);
    setOpenRequest({ ref: `resource:${resourceId}`, key: Date.now() });
  };
  const trackLocks = useMemo(
    () => new Set(activeTrack?.stages.flatMap((stage) => stage.steps.filter((step) => step.locked).map((step) => step.ref)) ?? []),
    [activeTrack],
  );
  // Sold tracks: the offers' prices, and moving a member up to the one that includes the track.
  const offerAccess = useTrackOfferAccess(context.communityId, (context.session ?? null) as AuthSession | null, tracks.some((track) => track.paid), progress.reload);
  const boardResources = useMemo(
    () => (activeTrack ? communityTrackResources(resources.state.resources, activeTrack) : resources.state.resources),
    [activeTrack, resources.state.resources],
  );
  // An open track shows its modules as course cards, and a module opens in
  // Resources with only its own lessons (Rashid, 2026-10-30: the track page was
  // too busy). The course's back link returns to the track it came from.
  const [courseFromTrack, setCourseFromTrack] = useState<string | null>(null);
  const [lessonRequest, setLessonRequest] = useState<{ resourceId: string; key: number } | null>(null);
  // The owner's "Arrange lessons", or a module with no course of its own, uses the Roadmap board.
  const [trackBoard, setTrackBoard] = useState(false);
  useEffect(() => { setTrackBoard(false); }, [trackKey]);
  const resourceModuleOf = useMemo(
    () => new Map(resources.state.resources.map((resource) => [resource.id, resource.module_id ?? null])),
    [resources.state.resources],
  );
  const readInResources = (key: string, resourceId: string) => {
    if (!resourceModuleOf.get(resourceId)) return false;
    setCourseFromTrack(key);
    setView("resources");
    setLessonRequest({ resourceId, key: Date.now() });
    return true;
  };
  const readTrackLesson = (key: string, resourceId: string) => {
    if (readInResources(key, resourceId)) return;
    setTrackBoard(true);
    openLesson(key, resourceId);
  };
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
  // Graph is an owner's tool: to a member it's unlabelled dots.
  const showGraph = context.canViewGraph && canManage;
  const graphOpen = view === "graph" && showGraph;
  const boardOpen = view === "board" && hasBoard;
  const activeView: KnowledgeView = graphOpen ? "graph" : boardOpen ? "board" : "resources";
  const courseProgress = useMemo(
    () =>
      progress.loaded
        ? computeCommunityCourseProgress({
          lessons: resources.state.resources,
          statusByRef: progress.statusByRef,
          courseTitles: Object.fromEntries(resources.state.modules.map((module) => [module.id, module.name])),
        })
        : undefined,
    [progress.loaded, progress.statusByRef, resources.state.resources, resources.state.modules],
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
  // Each course reads as an Article or a Video course; the owner picks in Edit course.
  const readingLessonStyle = activeView === "resources" && resources.state.selectedModuleId
    ? (resources.state.modules.find((module) => module.id === resources.state.selectedModuleId)?.lesson_style === "video" ? "video" : "article")
    : undefined;
  const reading = Boolean((activeView === "resources" && resources.state.selectedModuleId) || (boardOpen && roadmapReading));
  const trackAbout: RoadmapTrackAbout | undefined = activeTrack && (activeTrack.open || !activeTrack.paid) ? {
    eyebrow: activeTrack.key === COMMUNITY_MAIN_TRACK_KEY ? "Core track" : "Skill track",
    summary: activeTrack.summary,
    outcomes: activeTrack.outcomes,
    audience: activeTrack.audience,
    onAllTracks: tracks.length > 1 ? () => setTrackKey(null) : undefined,
    actions: ownerTools ? (
      <>
        <button type="button" className="lesson-journey-edit" onClick={() => setTrackEditor({ key: activeTrack.key })}><Pencil size={14} aria-hidden="true" /> Edit track</button>
        {tracks.length === 1 ? <button type="button" className="lesson-journey-edit" onClick={() => setTrackEditor({ key: null })}><Plus size={14} aria-hidden="true" /> New track</button> : null}
      </>
    ) : undefined,
    footer: <WebCommunityTrackOpens track={activeTrack} tracks={tracks} onOpenTrack={setTrackKey} />,
  } : undefined;
  const shelfModules = useMemo<CommunityTrackShelfModule[]>(() => {
    if (!activeTrack) return [];
    return activeTrack.stages.map((stage) => {
      // The course that holds most of the module's lessons gives it its cover.
      const counts = new Map<string, number>();
      for (const step of stage.steps) {
        const moduleId = resourceModuleOf.get(step.resource_id);
        if (moduleId) counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
      }
      const moduleId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const course = moduleId ? resources.state.modules.find((module) => module.id === moduleId) ?? null : null;
      const target = stage.steps.find((step) => !step.done && !step.locked) ?? stage.steps[0] ?? null;
      return {
        stage,
        cover: course?.banner_url ?? null,
        onOpen: () => { if (target) readTrackLesson(activeTrack.key, target.resource_id); },
        onChangeImage: ownerTools && course ? () => resources.actions.handleEditModule(course) : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, resourceModuleOf, resources.state.modules, ownerTools, resources.actions]);
  // Build / Watch / Checkpoint, as the Roadmap board labels lessons.
  const lessonTag = useCallback((resourceId: string) => {
    const fields = resourceList.find((resource) => resource.id === resourceId)?.lesson;
    const kind = fields?.gate ? "" : fields?.kind === "build" ? "Build" : fields?.kind === "lesson" ? "Watch" : "";
    return [kind, fields?.minutes ? `${fields.minutes} min` : ""].filter(Boolean).join(" · ");
  }, [resourceList]);
  // The Library: courses with no lesson on any track, so nothing outside a
  // track gets lost now the Resources tab is gone.
  const libraryCourses = useMemo<CommunityTrackLibraryCourse[]>(() => {
    const onTrack = new Set(tracks.flatMap((track) => track.stages.flatMap((stage) => stage.steps.map((step) => step.resource_id))));
    return resources.state.modules.flatMap((module) => {
      const lessons = resourceList.filter((resource) => resource.module_id === module.id);
      if (!lessons.length || lessons.some((resource) => onTrack.has(resource.id))) return [];
      return [{
        id: module.id,
        title: module.name,
        cover: module.banner_url ?? null,
        lessonCount: lessons.length,
        onOpen: () => { setCourseFromTrack(null); setView("resources"); resources.actions.handleSelectModule(module.id); },
      }];
    });
  }, [tracks, resources.state.modules, resourceList, resources.actions]);
  const openCatalog = () => { setCourseFromTrack(null); resources.actions.handleSelectModule(null); setView("resources"); };
  const trackShelf = activeTrack && trackAbout && !trackBoard ? (
    <WebCommunityTrackShelf
      track={activeTrack}
      modules={shelfModules}
      onContinue={() => { if (activeTrack.next) readTrackLesson(activeTrack.key, activeTrack.next.resource_id); }}
      onAllTracks={tracks.length > 1 ? () => setTrackKey(null) : undefined}
      lessonTag={lessonTag}
      onOpenStep={(resourceId) => readTrackLesson(activeTrack.key, resourceId)}
      ownerActions={ownerTools ? (
        <>
          <button type="button" className="track-new" onClick={() => setTrackBoard(true)}><Pencil size={14} aria-hidden="true" /> Arrange lessons</button>
          <button type="button" className="track-new" onClick={() => setTrackEditor({ key: activeTrack.key })}><Pencil size={14} aria-hidden="true" /> Edit track</button>
          {tracks.length === 1 ? <button type="button" className="track-new" onClick={() => setTrackEditor({ key: null })}><Plus size={14} aria-hidden="true" /> New track</button> : null}
        </>
      ) : undefined}
    />
  ) : null;
  const fromTrack = courseFromTrack ? tracks.find((track) => track.key === courseFromTrack) ?? null : null;
  const resourcesBackTo = fromTrack && activeView === "resources" ? {
    label: fromTrack.title,
    onBack: () => { setCourseFromTrack(null); setTrackKey(fromTrack.key); setView("board"); },
  } : activeView === "resources" && hasBoard ? {
    label: "Roadmap",
    onBack: () => setView("board"),
  } : null;
  // The full course list, reached from the Library's "See everything".
  const catalogOpen = activeView === "resources" && !resources.state.selectedModuleId;
  // Focus mode is for reading a lesson, not a track's own page.
  const lessonOpen = Boolean((activeView === "resources" && resources.state.selectedModuleId) || (boardOpen && roadmapLessonOpen));
  // Resources · Roadmap · Graph belong to Knowledge's main view; inside a
  // course, lesson or track they step aside (Rashid, 2026-10-27), and a lesson
  // offers Focus mode in their place.
  // The Edit and Graph buttons stay on a track's page too, and step aside only while reading.
  const insideKnowledge = reading;
  const [focus, setFocus] = useState(false);
  const focusOn = focus && lessonOpen;
  useEffect(() => {
    if (!lessonOpen) setFocus(false);
  }, [lessonOpen]);
  useEffect(() => {
    if (!focusOn) return;
    const root = document.documentElement;
    root.dataset.lessonFocus = "on";
    // The page lifts over the community's rails but stops under the bar that
    // holds Messages, Display and Settings, so those stay in reach
    // (Rashid, 2026-10-28: focus covered the top-right buttons).
    const placeUnderBar = () => {
      let top = 0;
      for (const bar of document.querySelectorAll<HTMLElement>(LESSON_FOCUS_KEEP_BARS)) {
        if (getComputedStyle(bar).visibility === "hidden") continue;
        const rect = bar.getBoundingClientRect();
        if (rect.height > 0) top = Math.max(top, rect.bottom);
      }
      root.style.setProperty("--lesson-focus-top", `${Math.max(0, Math.round(top))}px`);
    };
    placeUnderBar();
    window.addEventListener("resize", placeUnderBar);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete root.dataset.lessonFocus;
      root.style.removeProperty("--lesson-focus-top");
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placeUnderBar);
    };
  }, [focusOn]);
  return (
    <section
      className="community-knowledge-page"
      aria-label="Knowledge"
      data-reading={reading ? "" : undefined}
      data-focus={focusOn ? "" : undefined}
      data-lesson-style={readingLessonStyle}
    >
      <div className="community-knowledge-header">
        <h1>Knowledge</h1>
        {lessonOpen ? (
          <button
            type="button"
            className="community-knowledge-focus-button"
            aria-pressed={focusOn}
            onClick={() => setFocus(!focusOn)}
            title={focusOn ? "Bring back the course outline and menus (Esc)" : "Hide everything but the lesson"}
          >
            {focusOn ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            <span>{focusOn ? "Exit focus" : "Focus mode"}</span>
          </button>
        ) : null}
        {insideKnowledge ? null : (
          <div className="community-knowledge-tools">
            {catalogOpen && hasBoard ? (
              <button type="button" className="community-knowledge-tool" onClick={() => setView("board")}>
                <ArrowLeft size={15} aria-hidden="true" /> <span>Roadmap</span>
              </button>
            ) : null}
            {canManage ? (
              <button type="button" className="community-knowledge-tool" aria-pressed={editMode} onClick={toggleEditMode}
                title={editMode ? "Hide the owner tools" : "Show the owner tools: edit tracks, images and lessons"}>
                <Pencil size={15} aria-hidden="true" /> <span>{editMode ? "Editing" : "Edit"}</span>
              </button>
            ) : null}
            {showGraph ? (
              <button type="button" className="community-knowledge-tool" aria-pressed={graphOpen}
                onClick={() => { setCourseFromTrack(null); setView(graphOpen ? "board" : "graph"); }}
                title={graphOpen ? "Back to the Roadmap" : "See how everything connects"}>
                <Network size={15} aria-hidden="true" /> <span>Graph</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
      <div hidden={activeView !== "resources"}>
        <CommunityResourcesPanel {...resources} courseProgress={courseProgress} lessonActivity={lessonActivity} editRequest={editRequest}
          openRequest={lessonRequest} backTo={resourcesBackTo}
          memberViewOffered={activeView === "resources"} />
      </div>
      {boardOpen ? (
        <div className="lesson-board-panel">
          {tracks.length > 1 && !activeTrack ? (
            <WebCommunityTrackHome
              tracks={tracks}
              offer={offerAccess}
              onOpenTrack={setTrackKey}
              canManage={ownerTools}
              onNewTrack={() => setTrackEditor({ key: null })}
              onEditTrack={(key) => setTrackEditor({ key })}
              onContinue={(track) => { if (track.next) readTrackLesson(track.key, track.next.resource_id); else setTrackKey(track.key); }}
            />
          ) : trackShelf ? trackShelf : activeTrack && !activeTrack.open && !activeTrack.paid ? (
            <>
              <WebCommunityTrackHeader
                tracks={tracks}
                track={activeTrack}
                onPick={setTrackKey}
                onHome={() => setTrackKey(null)}
                onEdit={ownerTools ? () => setTrackEditor({ key: activeTrack.key }) : undefined}
              />
              <WebCommunityTrackLocked
                track={activeTrack}
                onGoTo={(resourceId) => {
                  const home = tracks.find((track) => track.open && track.stages.some((stage) => stage.steps.some((step) => step.resource_id === resourceId)));
                  if (home) openLesson(home.key, resourceId);
                }}
              />
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
                onLessonOpenChange={setRoadmapLessonOpen}
                about={trackAbout}
                extraLocked={trackLocks}
                openRequest={openRequest}
                // A sold track keeps its sales page; every open track opens like a course.
                header={activeTrack && !trackAbout && (tracks.length > 1 || canManage || activeTrack.paid) ? (
                  <WebCommunityTrackHeader
                    tracks={tracks}
                    track={activeTrack}
                    onPick={setTrackKey}
                    onHome={() => setTrackKey(null)}
                    onEdit={ownerTools ? () => setTrackEditor({ key: activeTrack.key }) : undefined}
                    onNewTrack={ownerTools && tracks.length === 1 ? () => setTrackEditor({ key: null }) : undefined}
                    offer={offerAccess}
                    onPreview={activeTrack.paid?.preview ? () => openLesson(activeTrack.key, activeTrack.paid!.preview!.resource_id) : undefined}
                  />
                ) : undefined}
              />
              {activeTrack && !trackAbout && !roadmapReading ? <WebCommunityTrackOpens track={activeTrack} tracks={tracks} onOpenTrack={setTrackKey} /> : null}
            </>
          )}
          {libraryCourses.length && (trackShelf || (tracks.length > 1 && !activeTrack)) ? (
            <WebCommunityTrackLibrary courses={libraryCourses} onBrowseAll={openCatalog} />
          ) : null}
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
      {graphOpen ? <div className="community-knowledge-graph"><CommunityMemoryGraph activeCommunityName={context.communityName} state={graph.state} onRefresh={graph.actions.refresh} /></div> : null}
    </section>
  );
}

function useTrackOfferAccess(
  communityId: string | null,
  session: AuthSession | null,
  needed: boolean,
  onUpgraded: () => void,
): CommunityTrackOfferAccess | null {
  const [offers, setOffers] = useState<CommunityVisitorOffers | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!needed || !communityId) return;
    let live = true;
    void fetchCloudCommunityVisitorOffers({ session, communityId })
      .then((next) => { if (live) setOffers(next); })
      .catch(() => { if (live) setOffers(null); });
    return () => { live = false; };
  }, [needed, communityId, session]);
  const upgrade = useCallback(async (offerKey: string) => {
    if (!session || !communityId) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await startCloudCommunityOfferUpgrade({ session, communityId, offerKey });
      if (result.status === "upgraded") {
        setNote("It's on your plan now. Everything in this track is open.");
        onUpgraded();
      } else if (result.status === "payment_needed") {
        if (result.invoice_url) window.location.assign(result.invoice_url);
        else setNote("Your card needs a quick check. Pay the invoice we just emailed you, and the track opens.");
      } else {
        // Not paying through Polynet yet: the sales page's offer picker checks them out.
        const slug = window.location.pathname.match(/^\/c\/([^/]+)/)?.[1];
        if (slug) window.location.assign(`/c/${slug}/preview#offers`);
      }
    } catch (error) {
      setNote(communityOfferUpgradeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [session, communityId, onUpgraded]);
  if (!needed) return null;
  return {
    priceFor: (offerKey) => {
      const offer = offers?.offers.find((candidate) => candidate.key === offerKey);
      return offer?.prices[0] ? formatCommunityOfferPrice(offer.prices[0]) : null;
    },
    upgrade: (offerKey) => { void upgrade(offerKey); },
    busy,
    note,
  };
}

const KNOWLEDGE_EDIT_KEY = "polynet.knowledge.editMode";
function readKnowledgeEditMode() {
  try { return window.localStorage.getItem(KNOWLEDGE_EDIT_KEY) === "on"; } catch { return false; }
}
