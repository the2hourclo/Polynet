// The AIEB portal rendered with Polynet's own web components: the community
// shell (rail + CommunityNav), the Knowledge page's Resources panel for the
// Library view, and the Workflows board styling for the Board view. Data comes
// from fixtures.json (built from the portal content folder) and lesson
// progress is kept in this browser, standing in for progress() / setProgress().
import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { ArrowLeft, Check, Circle, Lock } from "lucide-react";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "../src/index.css";
import "../src/components/WebCommunityKnowledgePanel.css";
import "../src/components/WebCommunityWorkflowsSection.css";
import "./preview.css";

import { CommunityNav } from "../../../shared/CommunityNav";
import { CommunityAvatar } from "../../../shared/CommunityAvatar";
import { CommunityVisualIdentityRegistryProvider } from "../../../shared/CommunityVisualIdentityRegistry";
import { buildPlatformSwitcherStyle } from "../../../shared/platformSwitcherUi";
import { computeCommunityLessonStages, type CommunityLessonFields } from "../../../shared/communityLessonContract";
import type { CommunityTab } from "../../../shared/appShellNavigation";
import { CommunityResourcesPanel } from "../src/components/CommunityResourcesPanel";
import { WebCommunityResourceViewerContent } from "../src/components/WebCommunityResourceViewerContent";
import { WebPlatformTabList, platformTabId, platformTabPanelId } from "../src/components/WebPlatformChoiceControls";
import type { CommunityResource, CommunityResourceModule } from "../src/components/communityResourcesContracts";
import fixtures from "./fixtures.json";

type Lesson = { ref: string; title: string; module_id: string; lesson: CommunityLessonFields | null };
type Status = "not_started" | "in_progress" | "done";

const COMMUNITY = { id: "aieb", slug: "ai-employee-builders", name: "AI Employee Builders", banner_url: null };
const modules = fixtures.modules as CommunityResourceModule[];
const resources = fixtures.resources as CommunityResource[];
const lessons = fixtures.lessons as Lesson[];
const resourceById = new Map(resources.map((r) => [r.id, r]));
const PROGRESS_KEY = "aieb-preview-progress";

function loadProgress(): Record<string, Status> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); } catch { return {}; }
}
function saveProgress(progress: Record<string, Status>) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* storage can be blocked */ }
}

const noop = () => {};
const resolved = async () => true;

function Rail() {
  return (
    <aside className="rail community-rail" aria-label="Communities">
      <div className="rail-main">
        <div className="community-rail-list">
          <button type="button" className="community-rail-button community-rail-community active" title={COMMUNITY.name} aria-current="page">
            <CommunityAvatar communityId={COMMUNITY.id} className="community-rail-avatar" name={COMMUNITY.name} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Placeholder({ tab }: { tab: CommunityTab }) {
  return (
    <div className="community-tab-scroll"><div className="web-community-centered-pane">
      <div className="community-panel-state-shell"><div className="chat-empty-state">
        <div className="chat-empty-title">{tab[0].toUpperCase() + tab.slice(1)}</div>
        <div className="chat-empty-text">This preview only covers the Knowledge page. The rest of the community works as it does on Polynet.</div>
      </div></div>
    </div></div>
  );
}

function Library({ selectedModuleId, onSelectModule }: { selectedModuleId: string | null; onSelectModule: (id: string | null) => void }) {
  const ready = { status: "ready" as const, error: null, hasData: true };
  return (
    <CommunityResourcesPanel
      capabilities={{ hasActiveCommunity: true, activeCommunityId: COMMUNITY.id, activeCommunityName: COMMUNITY.name, canOperateResources: false }}
      state={{ resourceRead: ready, moduleRead: ready, isLoadingResources: false, isLoadingResourceModules: false, modules, resources, selectedModuleId }}
      actions={{
        retryRead: async () => {}, handleSelectModule: onSelectModule, openNewModuleModal: noop, handleEditModule: noop,
        handleSetModuleStatus: resolved, handleDeleteModule: resolved, handleReorderModules: resolved, handleReorderResources: resolved,
        handleMoveResourceToModule: resolved, handleAddCommunitySources: async () => null,
        resourceEditor: {
          editingResourceId: null, titleInput: "", urlInput: "", bodyInput: "", pinnedInput: false, roleInput: "page", error: null, isSaving: false,
          beginInlineEditResource: noop, cancelInlineEditResource: noop, saveInlineEditResource: async () => false,
          onChangeTitle: noop, onChangeUrl: noop, onChangeBody: noop, onChangePinned: noop,
        },
        handleDeleteResource: resolved, handleCreateBlankPageDraft: async () => null,
      }}
    />
  );
}

const STATUS_LABEL: Record<Status, string> = { not_started: "To do", in_progress: "In progress", done: "Done" };

function Board({ progress, setStatus, openRef, setOpenRef }: {
  progress: Record<string, Status>; setStatus: (ref: string, status: Status) => void;
  openRef: string | null; setOpenRef: (ref: string | null) => void;
}) {
  const boardLessons = lessons.filter((l) => l.lesson?.stage);
  const doneRefs = new Set(Object.entries(progress).filter(([, s]) => s === "done").map(([ref]) => ref));
  const { stages, lockedRefs } = computeCommunityLessonStages({ lessons: boardLessons, doneRefs });
  const titleOf = (ref: string | null) => boardLessons.find((l) => l.ref === ref)?.title ?? "an earlier step";
  const statusOf = (ref: string): Status => progress[ref] ?? "not_started";

  if (openRef) {
    const resource = resourceById.get(openRef)!;
    const ordered = stages.flatMap((s) => boardLessons.filter((l) => l.lesson?.stage === s.name).sort((a, b) => (a.lesson?.order ?? 0) - (b.lesson?.order ?? 0)));
    const next = ordered[ordered.findIndex((l) => l.ref === openRef) + 1];
    const done = statusOf(openRef) === "done";
    return (
      <div className="community-panel community-utility-panel resources-panel">
        <div className="feed-header-row">
          <div className="feed-header-copy">
            <button className="resources-back-btn" type="button" onClick={() => setOpenRef(null)}>
              <ArrowLeft aria-hidden="true" /><span>Board</span>
            </button>
          </div>
        </div>
        <div className="knowledge-resource-reader aieb-board-reader">
          <WebCommunityResourceViewerContent resource={resource} />
          <div className="aieb-lesson-actions">
            <button type="button" className={done ? "workflow-secondary-button" : "aieb-primary-button"} onClick={() => setStatus(openRef, done ? "in_progress" : "done")}>
              {done ? "Mark as not done" : "Mark as done"}
            </button>
            {next && !lockedRefs.has(next.ref) ? (
              <button type="button" className="workflow-secondary-button" onClick={() => { setOpenRef(next.ref); if (statusOf(next.ref) === "not_started") setStatus(next.ref, "in_progress"); }}>
                Next: {next.title}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-page workflow-pipeline-page aieb-board">
      <section className="community-panel community-utility-panel workflow-pipeline-shell" aria-label="Build board">
        <div className="workflow-board-stage">
          <div className="workflow-milestone-canvas">
            {stages.map((stage, index) => {
              const stageLessons = boardLessons.filter((l) => l.lesson?.stage === stage.name).sort((a, b) => (a.lesson?.order ?? 0) - (b.lesson?.order ?? 0));
              return (
                <section className={`workflow-milestone-column${stage.locked ? " is-locked" : ""}`} key={stage.name}>
                  <header className="workflow-milestone-column-header">
                    <div>
                      <span className="workflow-milestone-position">{index + 1}</span>
                      <h2>{stage.name}</h2>
                    </div>
                    <div className="workflow-milestone-column-actions">
                      {stage.locked ? <Lock size={14} aria-label="Locked" /> : null}
                      <span aria-label={`${stage.done_count} of ${stage.lesson_count} done`}>{stage.done_count}/{stage.lesson_count}</span>
                    </div>
                  </header>
                  <div className="workflow-milestone-column-body">
                    {stage.locked ? <p className="workflow-milestone-empty">Finish “{titleOf(stage.blocked_by)}” to unlock</p> : null}
                    {stageLessons.map((lesson) => {
                      const status = statusOf(lesson.ref);
                      const locked = lockedRefs.has(lesson.ref);
                      const meta = [lesson.lesson?.gate ? "Checkpoint" : lesson.lesson?.kind ? lesson.lesson.kind[0].toUpperCase() + lesson.lesson.kind.slice(1) : null, lesson.lesson?.minutes ? `${lesson.lesson.minutes} min` : null, STATUS_LABEL[status]].filter(Boolean).join(" · ");
                      return (
                        <button
                          type="button" key={lesson.ref} disabled={locked} data-status={status}
                          className={`workflow-member-stub aieb-lesson-stub${lesson.lesson?.gate ? " is-gate" : ""}`}
                          onClick={() => { setOpenRef(lesson.ref); if (status === "not_started") setStatus(lesson.ref, "in_progress"); }}
                        >
                          <span className="aieb-lesson-status" aria-hidden="true">
                            {status === "done" ? <Check size={14} /> : locked ? <Lock size={13} /> : <Circle size={14} />}
                          </span>
                          <div className="workflow-member-stub-copy">
                            <strong>{lesson.title}</strong>
                            <span>{meta}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function Knowledge() {
  const [view, setView] = useState<"library" | "board">("library");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Status>>(loadProgress);
  const setStatus = (ref: string, status: Status) => setProgress((current) => {
    const next = { ...current, [ref]: status };
    saveProgress(next);
    return next;
  });
  const tabs = [{ id: "library" as const, label: "Resources" }, { id: "board" as const, label: "Board" }];
  const wide = view === "board" && !openRef;
  const pane = wide ? "community-tab-workspace" : "community-tab-scroll";
  return (
    <div className={pane}>
      <div className={`web-community-centered-pane${wide ? " web-community-centered-pane-workspace" : ""}`}>
        <section className="community-knowledge-page" aria-label="Knowledge">
          <div className="community-knowledge-header">
            <h1>Knowledge</h1>
            <WebPlatformTabList
              tabs={tabs} activeTab={view} onSelectTab={setView} ariaLabel="Knowledge view" idPrefix="community-knowledge"
              style={buildPlatformSwitcherStyle(tabs.length, view === "library" ? 0 : 1)}
            />
          </div>
          <div role="tabpanel" className="aieb-knowledge-panel" id={platformTabPanelId("community-knowledge", view)} aria-labelledby={platformTabId("community-knowledge", view)}>
            {view === "board"
              ? <Board progress={progress} setStatus={setStatus} openRef={openRef} setOpenRef={setOpenRef} />
              : <Library selectedModuleId={selectedModuleId} onSelectModule={setSelectedModuleId} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<CommunityTab>("resources");
  const channels = useMemo(() => [
    { id: "general", slug: "general", name: "general", is_general: true, position: 0 },
    { id: "wins", slug: "wins", name: "wins", is_general: false, position: 1 },
  ], []);
  return (
    <div className="app-root">
      <div className="app-shell with-community-rail framed-shell community-layout sessions-compact no-right">
        <Rail />
        <div className="product-shell-surface product-shell-surface--community">
          <CommunityNav
            activeCommunity={COMMUNITY}
            communityTab={tab}
            activeSelectionMode="route"
            channels={channels}
            selectedChannelSlug={null}
            onSelectChannel={() => setTab("chat")}
            canViewMembersActiveCommunity
            canViewActiveCommunitySettings={false}
            canManageMembersActiveCommunity={false}
            canViewActiveCommunityAnalytics={false}
            onSelectTab={setTab}
          />
          <main className="workspace community-mode">
            <div className="community-body">
              {tab === "resources" ? <Knowledge /> : <Placeholder tab={tab} />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CommunityVisualIdentityRegistryProvider>
      <App />
    </CommunityVisualIdentityRegistryProvider>
  </React.StrictMode>,
);
