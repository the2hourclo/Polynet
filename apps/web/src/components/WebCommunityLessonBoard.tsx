import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Circle, CircleDot, Lock } from "lucide-react";
import { buildPlatformSwitcherStyle } from "../../../../shared/platformSwitcherUi";
import {
  computeCommunityLessonStages,
  projectCommunityLessonBody,
  type CommunityLessonProgressStatus,
} from "../../../../shared/communityLessonContract";
import { buildCommunityResourceEvidenceRef } from "../../../../shared/communityEvidenceContract";
import { WebCommunityResourceViewerContent, type WebLessonActivity } from "./WebCommunityResourceViewerContent";
import { WebPlatformTabList } from "./WebPlatformChoiceControls";
import type { CommunityResource } from "./communityResourcesContracts";
import type { WebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import "./WebCommunityLessonBoard.css";

// Knowledge -> Roadmap: the same lesson pages as Resources, laid out by stage on
// the Workflows board. A stage stays locked until the gate lesson before it is
// done; opening a lesson shows it as a step of its stage, with the member's
// platform section and Mark done / Next. Progress is the member's own, from the
// store the site SDK's progress()/setProgress() use.

const PLATFORM_KEY = "polynet-lesson-platform";
const STATUS_LABEL: Record<CommunityLessonProgressStatus, string> = { not_started: "To do", in_progress: "In progress", done: "Done" };
const KIND_LABEL: Record<string, string> = { build: "Build", lesson: "Watch", checkpoint: "Checkpoint" };

type BoardLesson = { ref: string; resource: CommunityResource };

/** Lesson pages that belong on the board: pages with a stage. */
export function communityBoardLessons(resources: readonly CommunityResource[]): BoardLesson[] {
  return resources
    .filter((resource) => resource.resource_role === "page" && resource.lesson?.stage)
    .map((resource) => ({ ref: buildCommunityResourceEvidenceRef(resource.id), resource }));
}

function byOrder(a: BoardLesson, b: BoardLesson) {
  return (a.resource.lesson?.order ?? 0) - (b.resource.lesson?.order ?? 0) || a.resource.title.localeCompare(b.resource.title);
}

function readPlatform() {
  try { return localStorage.getItem(PLATFORM_KEY) || ""; } catch { return ""; }
}

export function WebCommunityLessonBoard(props: {
  resources: readonly CommunityResource[];
  progress: WebCommunityLessonProgress;
  signedIn: boolean;
  onRequireSignIn: () => void;
  lessonActivity?: WebLessonActivity | null;
}) {
  const { progress } = props;
  const lessons = useMemo(() => communityBoardLessons(props.resources), [props.resources]);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [platform, setPlatform] = useState(readPlatform);
  const choosePlatform = (key: string) => {
    setPlatform(key);
    try { localStorage.setItem(PLATFORM_KEY, key); } catch { /* storage can be blocked */ }
  };

  const statusOf = (ref: string): CommunityLessonProgressStatus => progress.statusByRef[ref] ?? "not_started";
  const doneRefs = new Set(lessons.filter((lesson) => statusOf(lesson.ref) === "done").map((lesson) => lesson.ref));
  const { stages, lockedRefs } = computeCommunityLessonStages({
    lessons: lessons.map((lesson) => ({ ref: lesson.ref, lesson: lesson.resource.lesson ?? null })),
    doneRefs,
  });
  const inStage = (name: string) => lessons.filter((lesson) => lesson.resource.lesson?.stage === name).sort(byOrder);
  const titleOf = (ref: string | null) => lessons.find((lesson) => lesson.ref === ref)?.resource.title ?? "an earlier step";
  const setStatus = (lesson: BoardLesson, status: CommunityLessonProgressStatus) => {
    if (!props.signedIn) { props.onRequireSignIn(); return; }
    progress.setStatus(lesson.resource.id, lesson.ref, status);
  };
  const open = (lesson: BoardLesson) => {
    setOpenRef(lesson.ref);
    if (props.signedIn && statusOf(lesson.ref) === "not_started") setStatus(lesson, "in_progress");
  };

  const opened = openRef ? lessons.find((lesson) => lesson.ref === openRef) ?? null : null;
  if (opened) {
    const stageLessons = inStage(opened.resource.lesson?.stage ?? "");
    const ordered = stages.flatMap((stage) => inStage(stage.name));
    const at = ordered.findIndex((lesson) => lesson.ref === opened.ref);
    const prev = ordered[at - 1] ?? null;
    const next = ordered[at + 1] ?? null;
    const done = statusOf(opened.ref) === "done";
    return (
      <WebCommunityLessonStep
        key={opened.ref}
        lesson={opened}
        lessonActivity={props.lessonActivity ?? null}
        step={stageLessons.findIndex((lesson) => lesson.ref === opened.ref) + 1}
        steps={stageLessons.length}
        stageDone={stageLessons.filter((lesson) => statusOf(lesson.ref) === "done").length}
        done={done}
        platform={platform}
        onPlatform={choosePlatform}
        onBack={() => setOpenRef(null)}
        onToggleDone={() => setStatus(opened, done ? "in_progress" : "done")}
        onPrev={prev ? () => open(prev) : null}
        onNext={next && !lockedRefs.has(next.ref) ? () => { if (!done && props.signedIn) setStatus(opened, "done"); open(next); } : null}
      />
    );
  }

  // The whole journey at a glance: how much is done, and the one lesson to do next.
  const ordered = stages.flatMap((stage) => inStage(stage.name));
  const nextUp = ordered.find((lesson) => statusOf(lesson.ref) !== "done" && !lockedRefs.has(lesson.ref)) ?? null;
  const percent = lessons.length ? Math.round((doneRefs.size / lessons.length) * 100) : 0;
  const currentStage = nextUp?.resource.lesson?.stage ?? null;
  return (
    <div className="workflow-page workflow-pipeline-page lesson-board">
      <section className="community-panel community-utility-panel workflow-pipeline-shell" aria-label="Roadmap">
        {progress.error ? <p className="workflow-milestone-empty" role="status">{progress.error}</p> : null}
        <header className="lesson-board-progress">
          <div className="lesson-board-progress-copy">
            <strong>{percent}%</strong>
            <span>{doneRefs.size} of {lessons.length} lessons done</span>
          </div>
          <div className="lesson-board-progress-bar" role="progressbar" aria-label="Roadmap progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${doneRefs.size} of ${lessons.length} lessons done`}>
            {stages.map((stage) => (
              <span key={stage.name} title={`${stage.name}: ${stage.done_count}/${stage.lesson_count}`}>
                <i style={{ width: `${stage.lesson_count ? (stage.done_count / stage.lesson_count) * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          {nextUp ? (
            <button type="button" className="lesson-board-next" onClick={() => open(nextUp)}>
              <span><small>Next up</small>{nextUp.resource.title}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : lessons.length ? <p className="lesson-board-complete"><Check size={16} aria-hidden="true" /> Every lesson is done</p> : null}
        </header>
        <div className="workflow-board-stage">
          <div className="workflow-milestone-canvas">
            {stages.map((stage, index) => {
              const complete = stage.lesson_count > 0 && stage.done_count === stage.lesson_count;
              return (
              <section className={`workflow-milestone-column${stage.locked ? " is-locked" : ""}${complete ? " is-done" : ""}${stage.name === currentStage ? " is-current" : ""}`} key={stage.name}>
                <header className="workflow-milestone-column-header">
                  <div>
                    <span className="workflow-milestone-position">{complete ? <Check size={13} role="img" aria-label="Done" /> : index + 1}</span>
                    <h2>{stage.name}</h2>
                  </div>
                  <div className="workflow-milestone-column-actions">
                    {stage.locked ? <Lock size={14} aria-label="Locked" /> : null}
                    <span aria-label={`${stage.done_count} of ${stage.lesson_count} done`}>{stage.done_count}/{stage.lesson_count}</span>
                  </div>
                </header>
                <div className="workflow-milestone-column-body">
                  {stage.locked ? <p className="workflow-milestone-empty">Finish “{titleOf(stage.blocked_by)}” to unlock</p> : null}
                  {inStage(stage.name).map((lesson) => {
                    const status = statusOf(lesson.ref);
                    const locked = lockedRefs.has(lesson.ref);
                    const fields = lesson.resource.lesson;
                    const kind = fields?.gate ? "Checkpoint" : fields?.kind ? KIND_LABEL[fields.kind] ?? fields.kind : null;
                    const meta = [kind, fields?.minutes ? `${fields.minutes} min` : null, STATUS_LABEL[status]].filter(Boolean).join(" · ");
                    return (
                      <button
                        type="button"
                        key={lesson.ref}
                        disabled={locked}
                        data-status={status}
                        className={`workflow-member-stub lesson-board-lesson-stub${fields?.gate ? " is-gate" : ""}${lesson.ref === nextUp?.ref ? " is-next" : ""}`}
                        onClick={() => open(lesson)}
                      >
                        <span className="lesson-board-lesson-status" aria-hidden="true">
                          {status === "done" ? <Check size={14} /> : locked ? <Lock size={13} /> : status === "in_progress" ? <CircleDot size={14} /> : <Circle size={14} />}
                        </span>
                        <div className="workflow-member-stub-copy">
                          <strong>{lesson.resource.title}</strong>
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

// One lesson as a step of its stage: the member picks their platform once, sees
// "Step n of N", and the body is the lesson contract's projection (intro, the
// chosen platform's section, slides) in Polynet's own resource reader.
function WebCommunityLessonStep(props: {
  lesson: BoardLesson;
  step: number;
  steps: number;
  stageDone: number;
  done: boolean;
  platform: string;
  onPlatform: (key: string) => void;
  onBack: () => void;
  onToggleDone: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  lessonActivity?: WebLessonActivity | null;
}) {
  const { resource } = props.lesson;
  const fields = resource.lesson;
  const projection = useMemo(() => projectCommunityLessonBody(resource.body_md ?? ""), [resource.body_md]);
  const variant = projection.variants.find((item) => item.key === props.platform) ?? projection.variants[0] ?? null;
  const slides = projection.slides.map((slide) => `![${slide.alt}](${slide.image})\n\n${slide.note_md}`).join("\n\n");
  const body = [projection.intro_md, variant?.body_md, slides ? `## Slides\n\n${slides}` : ""].filter(Boolean).join("\n\n");
  const kind = fields?.gate ? "Checkpoint" : KIND_LABEL[fields?.kind ?? ""] ?? "Step";
  const tabs = projection.variants.map((item) => ({ id: item.key, label: item.label }));
  return (
    <div className="community-panel community-utility-panel resources-panel lesson-board-step-page">
      <div className="lesson-board-step-top">
        <button className="resources-back-btn" type="button" onClick={props.onBack}>
          <ArrowLeft aria-hidden="true" />
          <span>Back to roadmap</span>
        </button>
        <span className="lesson-board-stage-badge">{fields?.stage}</span>
      </div>
      {tabs.length > 1 && variant ? (
        <div className="lesson-board-platform-row">
          <span>I build in:</span>
          <WebPlatformTabList
            tabs={tabs}
            activeTab={variant.key}
            onSelectTab={props.onPlatform}
            ariaLabel="I build in"
            idPrefix="lesson-board-platform"
            style={buildPlatformSwitcherStyle(tabs.length, tabs.findIndex((tab) => tab.id === variant.key))}
          />
        </div>
      ) : null}
      <div className="lesson-board-step-progress">
        <strong>Step <em>{props.step}</em> of {props.steps}</strong>
        <div className="lesson-board-step-bar" aria-hidden="true">
          <span style={{ width: `${props.steps ? (props.stageDone / props.steps) * 100 : 0}%` }} />
        </div>
      </div>
      <article className="lesson-board-step-card">
        <span className="lesson-board-kind-badge">{kind}</span>
        <div className="knowledge-resource-reader">
          <WebCommunityResourceViewerContent resource={{ ...resource, body_md: body }} lessonActivity={props.lessonActivity ?? null} />
        </div>
        <div className="lesson-board-step-nav">
          {props.onPrev ? <button type="button" className="lesson-board-text-button" onClick={props.onPrev}>← Back</button> : <span />}
          <div className="lesson-board-step-nav-right">
            <button type="button" className="lesson-board-text-button" onClick={props.onToggleDone}>
              {props.done ? "Mark as not done" : "Mark as done"}
            </button>
            {props.onNext ? <button type="button" className="lesson-board-primary-button" onClick={props.onNext}>Next →</button> : null}
          </div>
        </div>
      </article>
    </div>
  );
}
