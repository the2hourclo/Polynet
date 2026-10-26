import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Circle, CircleDot, GripVertical, Lock, PenLine, Plus,
} from "lucide-react";
import { buildPlatformSwitcherStyle } from "../../../../shared/platformSwitcherUi";
import {
  computeCommunityLessonStages,
  projectCommunityLessonBody,
  type CommunityLessonProgressStatus,
  type CommunityLessonStage,
} from "../../../../shared/communityLessonContract";
import { buildCommunityResourceEvidenceRef } from "../../../../shared/communityEvidenceContract";
import { WebCommunityResourceViewerContent, type WebLessonActivity } from "./WebCommunityResourceViewerContent";
import { WebPlatformTabList } from "./WebPlatformChoiceControls";
import type { CommunityResource } from "./communityResourcesContracts";
import type { WebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import "./WebCommunityLessonBoard.css";

// Knowledge -> Roadmap: the same lesson pages as Resources, read top to bottom as
// one journey of stages. A stage stays locked until the gate lesson before it is
// done; opening a lesson shows it as a step of its stage, with the member's
// platform section and Mark done / Next. Progress is the member's own, from the
// store the site SDK's progress()/setProgress() use. Owners edit the journey in
// place: rename and reorder stages and lessons, add either, and open a lesson in
// the Resources editor. Edits are the lessons' own stage fields.

const PLATFORM_KEY = "polynet-lesson-platform";
const STATUS_LABEL: Record<CommunityLessonProgressStatus, string> = { not_started: "To do", in_progress: "In progress", done: "Done" };
const KIND_LABEL: Record<string, string> = { build: "Build", lesson: "Watch", checkpoint: "Checkpoint" };
const NEW_STAGE_NAME = "New stage";
const DRAG_MIME = "application/x-polynet-roadmap-lesson";

type BoardLesson = { ref: string; resource: CommunityResource };

/** One lesson's new place on the roadmap, as the board save sends it. */
export type RoadmapLessonUpdate = { resourceId: string; stage: string; stageOrder?: number; order?: number; title?: string };

/** What an owner can do on the roadmap. Absent for members. */
export type RoadmapEditing = {
  save: (updates: RoadmapLessonUpdate[]) => Promise<boolean>;
  addLesson: (args: { stage: string; stageOrder: number; order: number; nearResourceId: string | null }) => Promise<CommunityResource | null>;
  editLesson: (resource: CommunityResource) => void;
};

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

/** The resources with the owner's unsaved moves laid over them, so the board moves at once. */
function withPending(resources: readonly CommunityResource[], pending: ReadonlyMap<string, RoadmapLessonUpdate>) {
  if (!pending.size) return resources;
  return resources.map((resource) => {
    const update = pending.get(resource.id);
    if (!update || !resource.lesson) return resource;
    return {
      ...resource,
      title: update.title ?? resource.title,
      lesson: { ...resource.lesson, stage: update.stage, stage_order: update.stageOrder ?? resource.lesson.stage_order, order: update.order ?? resource.lesson.order },
    };
  });
}

export function WebCommunityLessonBoard(props: {
  resources: readonly CommunityResource[];
  progress: WebCommunityLessonProgress;
  signedIn: boolean;
  onRequireSignIn: () => void;
  lessonActivity?: WebLessonActivity | null;
  editing?: RoadmapEditing | null;
  // Shown above the progress strip, for a track's title and picker.
  header?: ReactNode;
}) {
  const { progress, editing } = props;
  const [pending, setPending] = useState<Map<string, RoadmapLessonUpdate>>(() => new Map());
  // A fresh list from the server already holds every saved move.
  useEffect(() => { setPending(new Map()); }, [props.resources]);
  const resources = useMemo(() => withPending(props.resources, pending), [props.resources, pending]);
  const lessons = useMemo(() => communityBoardLessons(resources), [resources]);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [platform, setPlatform] = useState(readPlatform);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  // A lesson the owner just added opens with its title ready to type.
  const [renameId, setRenameId] = useState<string | null>(null);
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
  // Owners can open any lesson to check it; the lock is the member's.
  const isLocked = (ref: string) => !editing && lockedRefs.has(ref);
  const setStatus = (lesson: BoardLesson, status: CommunityLessonProgressStatus) => {
    if (!props.signedIn) { props.onRequireSignIn(); return; }
    progress.setStatus(lesson.resource.id, lesson.ref, status);
  };
  const open = (lesson: BoardLesson) => {
    setOpenRef(lesson.ref);
    if (props.signedIn && statusOf(lesson.ref) === "not_started") setStatus(lesson, "in_progress");
  };

  const save = async (updates: RoadmapLessonUpdate[]) => {
    if (!editing || !updates.length) return;
    setSaveError(null);
    setPending((current) => {
      const next = new Map(current);
      for (const update of updates) next.set(update.resourceId, { ...next.get(update.resourceId), ...update });
      return next;
    });
    const ok = await editing.save(updates).catch(() => false);
    if (!ok) {
      setPending((current) => {
        const next = new Map(current);
        for (const update of updates) next.delete(update.resourceId);
        return next;
      });
      setSaveError("That change didn't save. Try again.");
    }
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
        onNext={next && !isLocked(next.ref) ? () => { if (!done && props.signedIn) setStatus(opened, "done"); open(next); } : null}
        onEdit={editing ? () => editing.editLesson(opened.resource) : null}
      />
    );
  }

  // The whole journey at a glance: how much is done, and the one lesson to do next.
  const ordered = stages.flatMap((stage) => inStage(stage.name));
  const nextUp = ordered.find((lesson) => statusOf(lesson.ref) !== "done" && !lockedRefs.has(lesson.ref)) ?? null;
  const percent = lessons.length ? Math.round((doneRefs.size / lessons.length) * 100) : 0;
  const currentStage = nextUp?.resource.lesson?.stage ?? null;
  const minutes = lessons.reduce((sum, lesson) => sum + (lesson.resource.lesson?.minutes ?? 0), 0);

  const ops = editing ? roadmapOps(stages, inStage, save) : null;
  const addLesson = async (stage: CommunityLessonStage | null) => {
    if (!editing) return null;
    const stageIndex = stage ? stages.indexOf(stage) : stages.length;
    const siblings = stage ? inStage(stage.name) : [];
    const created = await editing.addLesson({
      stage: stage?.name ?? uniqueStageName(stages),
      stageOrder: Math.min(stageIndex + 1, 999),
      order: Math.min(siblings.reduce((max, lesson) => Math.max(max, lesson.resource.lesson?.order ?? 0), 0) + 1, 9_999),
      nearResourceId: siblings[0]?.resource.id ?? lessons[0]?.resource.id ?? null,
    });
    if (created) setRenameId(created.id);
    else setSaveError("Couldn't add a lesson. Try again.");
    return created;
  };

  if (!lessons.length) {
    return (
      <div className={`lesson-board lesson-journey${editing ? " is-editing" : ""}`}>
        {saveError ? <p className="lesson-journey-note is-error" role="alert">{saveError}</p> : null}
        <div className="lesson-journey-empty">
          <h3>No roadmap yet</h3>
          <p>{editing ? "Lay out the journey in stages. Each stage holds lessons your members work through in order." : "The roadmap will show here once it's ready."}</p>
          {editing ? <AddButton label="Add the first stage" onAdd={() => addLesson(null)} /> : null}
        </div>
      </div>
    );
  }

  // Only the first locked stage names the checkpoint that opens it; the rest
  // follow on from the stage before.
  const firstLocked = stages.find((stage) => stage.locked)?.name ?? null;
  const currentIndex = stages.findIndex((stage) => stage.name === currentStage);
  return (
    <div className={`lesson-board lesson-journey${editing ? " is-editing" : ""}`}>
      {progress.error ? <p className="lesson-journey-note" role="status">{progress.error}</p> : null}
      {saveError ? <p className="lesson-journey-note is-error" role="alert">{saveError}</p> : null}
      {props.header ?? null}
      <div className="lesson-journey-progress">
        <div className="lesson-journey-bar" role="progressbar" aria-label="Roadmap progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${doneRefs.size} of ${lessons.length} lessons done`}>
          {stages.map((stage) => (
            <span key={stage.name} className={stage.name === currentStage ? "is-current" : undefined} title={`${stage.name}: ${stage.done_count}/${stage.lesson_count}`} style={{ flexGrow: Math.max(stage.lesson_count, 1) }}>
              <i style={{ width: `${stage.lesson_count ? (stage.done_count / stage.lesson_count) * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="lesson-journey-progress-label">
          <span>{doneRefs.size} of {lessons.length} lessons{minutes ? ` · about ${formatMinutes(minutes)}` : ""}</span>
          <span>{currentIndex >= 0 ? `Stage ${currentIndex + 1} of ${stages.length}` : `${stages.length} ${stages.length === 1 ? "stage" : "stages"}`}</span>
        </div>
      </div>
      {nextUp ? (
        <button type="button" className="lesson-journey-next" onClick={() => open(nextUp)}>
          <span className="lesson-journey-next-copy">
            <small>{doneRefs.size ? "Next up" : "Start here"}</small>
            <strong>{nextUp.resource.title}</strong>
            <span>{[nextUp.resource.lesson?.stage, lessonMeta(nextUp.resource)].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="lesson-journey-next-go">{statusOf(nextUp.ref) === "in_progress" ? "Continue" : "Start"} <ArrowRight size={15} aria-hidden="true" /></span>
        </button>
      ) : <p className="lesson-journey-complete"><Check size={16} aria-hidden="true" /> Every lesson is done</p>}

      <ol className="lesson-journey-stages">
        {stages.map((stage, index) => {
          const complete = stage.lesson_count > 0 && stage.done_count === stage.lesson_count;
          const state = complete ? "done" : stage.locked ? "locked" : stage.name === currentStage ? "current" : "todo";
          // Members see the stage they're on; owners see everything they edit.
          const isOpen = expanded[stage.name] ?? (editing ? true : state === "current" || (state === "todo" && !currentStage));
          const stageLessons = inStage(stage.name);
          const subline = complete
            ? "Done"
            : stage.locked
              ? stage.name === firstLocked ? `Opens after “${titleOf(stage.blocked_by)}”` : `Opens after stage ${index}`
              : null;
          const panelId = `lesson-journey-stage-${index}`;
          return (
            <li className="lesson-journey-stage" data-state={state} data-open={isOpen ? "" : undefined} key={stage.name}>
              <div className="lesson-journey-stage-head">
                <span className="lesson-journey-marker" aria-hidden="true">
                  {complete ? <Check size={13} /> : stage.locked ? <Lock size={12} /> : index + 1}
                </span>
                <div className="lesson-journey-stage-title">
                  {ops ? (
                    <InlineName value={stage.name} label="Stage name" className="lesson-journey-stage-name" onSave={(name) => ops.renameStage(stage, name)} />
                  ) : (
                    <h3 className="lesson-journey-stage-name">
                      <button type="button" className="lesson-journey-toggle" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setExpanded((current) => ({ ...current, [stage.name]: !isOpen }))}>
                        {stage.name}
                      </button>
                    </h3>
                  )}
                  {subline ? <span className="lesson-journey-stage-meta">{subline}</span> : null}
                </div>
                <div className="lesson-journey-stage-tools">
                  {ops ? (
                    <>
                      <IconButton label={`Move ${stage.name} up`} disabled={index === 0} onClick={() => ops.moveStage(index, -1)}><ChevronUp size={16} /></IconButton>
                      <IconButton label={`Move ${stage.name} down`} disabled={index === stages.length - 1} onClick={() => ops.moveStage(index, 1)}><ChevronDown size={16} /></IconButton>
                    </>
                  ) : null}
                  <span className="lesson-journey-count">
                    {stage.done_count || state === "current" || complete ? `${stage.done_count}/${stage.lesson_count}` : `${stage.lesson_count} ${stage.lesson_count === 1 ? "lesson" : "lessons"}`}
                  </span>
                  {ops ? (
                    <IconButton label={`${isOpen ? "Fold" : "Open"} ${stage.name}`} onClick={() => setExpanded((current) => ({ ...current, [stage.name]: !isOpen }))}>
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </IconButton>
                  ) : (
                    <ChevronDown size={16} className="lesson-journey-chevron" aria-hidden="true" />
                  )}
                </div>
              </div>
              {isOpen ? (
                <div className="lesson-journey-stage-body" id={panelId}>
                  <ul className="lesson-journey-lessons" onDragOver={ops ? ops.allowDrop : undefined} onDrop={ops ? (event) => ops.dropAt(event, stage, null) : undefined}>
                    {stageLessons.map((lesson, at) => (
                      <JourneyLesson
                        key={lesson.ref}
                        lesson={lesson}
                        status={statusOf(lesson.ref)}
                        locked={lockedRefs.has(lesson.ref)}
                        clickable={!isLocked(lesson.ref)}
                        isNext={lesson.ref === nextUp?.ref}
                        autoRename={lesson.resource.id === renameId}
                        onOpen={() => open(lesson)}
                        editing={ops && editing ? {
                          canMoveUp: index > 0 || at > 0,
                          canMoveDown: index < stages.length - 1 || at < stageLessons.length - 1,
                          move: (direction) => ops.moveLesson(lesson, direction),
                          rename: (title) => ops.renameLesson(lesson, title),
                          edit: () => editing.editLesson(lesson.resource),
                          dragStart: (event) => ops.dragStart(event, lesson),
                          drop: (event) => ops.dropAt(event, stage, lesson),
                        } : null}
                      />
                    ))}
                  </ul>
                  {ops ? <AddButton label="Add a lesson" onAdd={() => addLesson(stage)} /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {ops ? <div className="lesson-journey-add-stage"><AddButton label="Add a stage" onAdd={() => addLesson(null)} /></div> : null}
    </div>
  );
}

function lessonMeta(resource: CommunityResource) {
  const fields = resource.lesson;
  const kind = fields?.gate ? "Checkpoint" : fields?.kind ? KIND_LABEL[fields.kind] ?? fields.kind : null;
  return [kind, fields?.minutes ? `${fields.minutes} min` : null].filter(Boolean).join(" · ");
}

function formatMinutes(total: number) {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function uniqueStageName(stages: readonly CommunityLessonStage[]) {
  const names = new Set(stages.map((stage) => stage.name));
  if (!names.has(NEW_STAGE_NAME)) return NEW_STAGE_NAME;
  let n = 2;
  while (names.has(`${NEW_STAGE_NAME} ${n}`)) n += 1;
  return `${NEW_STAGE_NAME} ${n}`;
}

// Every owner edit as the list of lessons whose stage fields change. Stages are
// numbered 1..n and lessons 1..n within a stage, so the saved order is exactly
// what the owner sees.
function roadmapOps(
  stages: CommunityLessonStage[],
  inStage: (name: string) => BoardLesson[],
  save: (updates: RoadmapLessonUpdate[]) => Promise<void>,
) {
  const layout = () => stages.map((stage) => ({ name: stage.name, lessons: inStage(stage.name) }));
  const commit = (next: Array<{ name: string; lessons: BoardLesson[] }>, titles: Record<string, string> = {}) => {
    const updates: RoadmapLessonUpdate[] = [];
    next.forEach((stage, stageIndex) => stage.lessons.forEach((lesson, lessonIndex) => {
      const fields = lesson.resource.lesson;
      const stageOrder = Math.min(stageIndex + 1, 999);
      const order = Math.min(lessonIndex + 1, 9_999);
      const title = titles[lesson.resource.id];
      if (fields?.stage === stage.name && fields?.stage_order === stageOrder && fields?.order === order && !title) return;
      updates.push({ resourceId: lesson.resource.id, stage: stage.name, stageOrder, order, ...(title ? { title } : {}) });
    }));
    void save(updates);
  };
  const place = (lesson: BoardLesson, stageName: string, before: BoardLesson | null) => {
    const next = layout().map((stage) => ({ ...stage, lessons: stage.lessons.filter((item) => item.ref !== lesson.ref) }));
    const target = next.find((stage) => stage.name === stageName);
    if (!target) return;
    const at = before ? target.lessons.findIndex((item) => item.ref === before.ref) : -1;
    target.lessons.splice(at < 0 ? target.lessons.length : at, 0, lesson);
    commit(next.filter((stage) => stage.lessons.length));
  };
  return {
    renameStage: (stage: CommunityLessonStage, raw: string) => {
      const name = raw.trim().slice(0, 80);
      if (!name || name === stage.name) return;
      commit(layout().map((item) => (item.name === stage.name ? { ...item, name } : item)));
    },
    moveStage: (index: number, direction: -1 | 1) => {
      const next = layout();
      const to = index + direction;
      if (to < 0 || to >= next.length) return;
      [next[index], next[to]] = [next[to], next[index]];
      commit(next);
    },
    renameLesson: (lesson: BoardLesson, raw: string) => {
      const title = raw.trim();
      if (!title || title === lesson.resource.title) return;
      commit(layout(), { [lesson.resource.id]: title });
    },
    // Up from the top of a stage goes to the end of the stage above, and down
    // from the bottom to the start of the one below.
    moveLesson: (lesson: BoardLesson, direction: -1 | 1) => {
      const next = layout();
      const stageIndex = next.findIndex((stage) => stage.lessons.some((item) => item.ref === lesson.ref));
      if (stageIndex < 0) return;
      const list = next[stageIndex].lessons;
      const at = list.findIndex((item) => item.ref === lesson.ref);
      const to = at + direction;
      if (to >= 0 && to < list.length) {
        [list[at], list[to]] = [list[to], list[at]];
      } else {
        const neighbour = next[stageIndex + direction];
        if (!neighbour) return;
        list.splice(at, 1);
        if (direction < 0) neighbour.lessons.push(lesson); else neighbour.lessons.unshift(lesson);
      }
      commit(next.filter((stage) => stage.lessons.length));
    },
    dragStart: (event: DragEvent, lesson: BoardLesson) => {
      event.dataTransfer.setData(DRAG_MIME, lesson.ref);
      event.dataTransfer.effectAllowed = "move";
    },
    allowDrop: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    dropAt: (event: DragEvent, stage: CommunityLessonStage, before: BoardLesson | null) => {
      const ref = event.dataTransfer.getData(DRAG_MIME);
      if (!ref) return;
      event.preventDefault();
      event.stopPropagation();
      const lesson = layout().flatMap((item) => item.lessons).find((item) => item.ref === ref);
      if (lesson && lesson.ref !== before?.ref) place(lesson, stage.name, before);
    },
  };
}

function JourneyLesson(props: {
  lesson: BoardLesson;
  status: CommunityLessonProgressStatus;
  locked: boolean;
  clickable: boolean;
  isNext: boolean;
  autoRename?: boolean;
  onOpen: () => void;
  editing: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    move: (direction: -1 | 1) => void;
    rename: (title: string) => void;
    edit: () => void;
    dragStart: (event: DragEvent) => void;
    drop: (event: DragEvent) => void;
  } | null;
}) {
  const { lesson, status, editing } = props;
  const [renaming, setRenaming] = useState(false);
  // The list can show a new lesson before the board learns it was just added.
  useEffect(() => { if (props.autoRename && editing) setRenaming(true); }, [props.autoRename, Boolean(editing)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dropping, setDropping] = useState(false);
  const fields = lesson.resource.lesson;
  const meta = lessonMeta(lesson.resource);
  const icon = status === "done" ? <Check size={14} /> : props.locked ? <Lock size={13} /> : status === "in_progress" ? <CircleDot size={14} /> : <Circle size={14} />;
  return (
    <li
      className={`lesson-journey-lesson${props.isNext ? " is-next" : ""}${fields?.gate ? " is-gate" : ""}${dropping ? " is-drop-target" : ""}`}
      data-status={status}
      draggable={editing && !renaming ? true : undefined}
      onDragStart={editing ? editing.dragStart : undefined}
      onDragOver={editing ? (event) => { if (event.dataTransfer.types.includes(DRAG_MIME)) { event.preventDefault(); setDropping(true); } } : undefined}
      onDragLeave={editing ? () => setDropping(false) : undefined}
      onDrop={editing ? (event) => { setDropping(false); editing.drop(event); } : undefined}
    >
      {editing ? <span className="lesson-journey-grip" aria-hidden="true"><GripVertical size={14} /></span> : null}
      {renaming && editing ? (
        <div className="lesson-journey-lesson-main">
          <span className="lesson-journey-status" aria-hidden="true">{icon}</span>
          <InlineName
            value={lesson.resource.title}
            label="Lesson title"
            className="lesson-journey-lesson-title"
            startEditing
            onSave={(title) => { setRenaming(false); editing.rename(title); }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button type="button" className="lesson-journey-lesson-main" disabled={!props.clickable} onClick={props.onOpen}>
          <span className="lesson-journey-status" aria-hidden="true">{icon}</span>
          <span className="lesson-journey-lesson-copy">
            <strong className="lesson-journey-lesson-title">{lesson.resource.title}</strong>
            {meta ? <span>{meta}</span> : null}
          </span>
          <span className="lesson-journey-lesson-state">{props.isNext ? "Up next" : STATUS_LABEL[status]}</span>
        </button>
      )}
      {editing ? (
        <div className="lesson-journey-lesson-tools">
          <IconButton label={`Rename ${lesson.resource.title}`} onClick={() => setRenaming(true)}><PenLine size={15} /></IconButton>
          <IconButton label={`Move ${lesson.resource.title} up`} disabled={!editing.canMoveUp} onClick={() => editing.move(-1)}><ChevronUp size={16} /></IconButton>
          <IconButton label={`Move ${lesson.resource.title} down`} disabled={!editing.canMoveDown} onClick={() => editing.move(1)}><ChevronDown size={16} /></IconButton>
          <button type="button" className="lesson-journey-edit" onClick={editing.edit}>Edit lesson</button>
        </div>
      ) : null}
    </li>
  );
}

function IconButton(props: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="lesson-journey-icon" aria-label={props.label} title={props.label} disabled={props.disabled} onClick={props.onClick}>
      <span aria-hidden="true">{props.children}</span>
    </button>
  );
}

function AddButton(props: { label: string; onAdd: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="lesson-journey-add"
      disabled={busy}
      onClick={async () => { setBusy(true); try { await props.onAdd(); } finally { setBusy(false); } }}
    >
      <Plus size={15} aria-hidden="true" />
      <span>{busy ? "Adding…" : props.label}</span>
    </button>
  );
}

// A name that reads as text and becomes a field on click; Enter or leaving saves,
// Escape puts it back.
function InlineName(props: {
  value: string;
  label: string;
  className: string;
  startEditing?: boolean;
  onSave: (value: string) => void;
  onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(Boolean(props.startEditing));
  const [draft, setDraft] = useState(props.value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(props.value); }, [props.value, editing]);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const finish = (keep: boolean) => {
    setEditing(false);
    if (keep && draft.trim() && draft.trim() !== props.value) props.onSave(draft);
    else { setDraft(props.value); props.onCancel?.(); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  };
  if (editing) {
    return (
      <input
        ref={input}
        className={`${props.className} lesson-journey-name-input`}
        aria-label={props.label}
        value={draft}
        maxLength={props.label === "Stage name" ? 80 : 200}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <button type="button" className={`${props.className} lesson-journey-name`} title={`Rename ${props.value}`} onClick={() => setEditing(true)}>
      {props.value}
      <span className="sr-only"> (rename)</span>
    </button>
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
  onEdit: (() => void) | null;
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
        <div className="lesson-board-step-top-right">
          {props.onEdit ? (
            <button type="button" className="lesson-journey-edit" onClick={props.onEdit}>
              <PenLine size={14} aria-hidden="true" /> Edit lesson
            </button>
          ) : null}
          <span className="lesson-board-stage-badge">{fields?.stage}</span>
        </div>
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
