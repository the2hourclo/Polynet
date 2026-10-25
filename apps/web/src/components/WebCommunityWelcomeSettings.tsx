import { ArrowDown, ArrowUp, Monitor, RefreshCw, Smartphone, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { CloudCommunityMemberWorkflowBoard, CloudCommunityWelcomePageDraft } from "../../../../shared/cloudCommunityMemberWorkflowsGateway";
import type { WelcomeLessonOption } from "../controllers/useWebCommunityWorkflowsController";
import type { CommunityFormsGateway } from "../controllers/useWebCommunityFormsGateway";
import type { CommunityFormDraft } from "../../../../shared/communityForms";
import { MemberFormRunner } from "./WebCommunityNextStep";
import { WelcomeIntro } from "./WebCommunityWelcome";
import "./WebCommunityWelcomeSettings.css";

const TITLE_MAX = 120;
const MESSAGE_MAX = 4_000;
const LESSONS_MAX = 5;

type Props = {
  board: CloudCommunityMemberWorkflowBoard | null;
  communityName: string | null;
  forms?: CommunityFormsGateway;
  isSaving: boolean;
  actionError: string | null;
  onSetWelcomeGate?: (enabled: boolean) => Promise<boolean>;
  onSaveWelcomePage?: (page: CloudCommunityWelcomePageDraft) => Promise<boolean>;
  onLoadWelcomeLessonOptions?: () => Promise<WelcomeLessonOption[]>;
  onOpenWorkflows: () => void;
  /** Asked before leaving this tab, so unsaved words aren't lost silently. */
  leaveGuard: MutableRefObject<(() => Promise<boolean>) | null>;
};

function draftFrom(board: CloudCommunityMemberWorkflowBoard | null): CloudCommunityWelcomePageDraft {
  return {
    title: board?.welcome_page?.title ?? "",
    message: board?.welcome_page?.message ?? "",
    mediaUrl: board?.welcome_page?.media_url ?? "",
    lessonIds: board?.welcome_lesson_ids ?? [],
  };
}

// What new members see first, and the steps they finish before the community
// opens: the builder's words, the first milestone's join forms, then lessons.
export function WebCommunityWelcomeSettings(props: Props) {
  const id = useId();
  const baseline = useMemo(() => draftFrom(props.board), [props.board]);
  const baselineKey = JSON.stringify(baseline);
  const [draft, setDraft] = useState(baseline);
  const [draftBase, setDraftBase] = useState(baselineKey);
  const [saved, setSaved] = useState(false);
  const adoptNext = useRef(false);
  // Take the server's copy when there are no edits here, or right after a save
  // (the server tidies spacing, so the saved draft may not match it exactly).
  if (draftBase !== baselineKey && (adoptNext.current || JSON.stringify(draft) === draftBase)) {
    adoptNext.current = false;
    setDraft(baseline);
    setDraftBase(baselineKey);
  }
  const dirty = JSON.stringify(draft) !== baselineKey;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    props.leaveGuard.current = async () => !dirtyRef.current || window.confirm("Leave without saving your welcome page changes?");
    return () => { props.leaveGuard.current = null; };
  }, [props.leaveGuard]);

  const [options, setOptions] = useState<WelcomeLessonOption[] | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsRetry, setOptionsRetry] = useState(0);
  useEffect(() => {
    let alive = true; setOptionsError(false);
    if (!props.onLoadWelcomeLessonOptions) { setOptions([]); return; }
    props.onLoadWelcomeLessonOptions().then((rows) => { if (alive) setOptions(rows); }).catch(() => { if (alive) setOptionsError(true); });
    return () => { alive = false; };
  }, [props.onLoadWelcomeLessonOptions, optionsRetry]);

  const [formRows, setFormRows] = useState<Map<string, CommunityFormDraft>>(new Map());
  const [formsLoaded, setFormsLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    props.forms?.load().then((rows) => { if (alive) setFormRows(new Map(rows.map((row) => [row.key, row]))); }).catch(() => {})
      .finally(() => { if (alive) setFormsLoaded(true); });
    return () => { alive = false; };
  }, [props.forms]);
  const joinForms = useMemo(() => (props.board?.milestones[0]?.automations ?? [])
    .filter((rule) => rule.trigger.type === "member_joined" && rule.action.type === "request_form")
    .map((rule) => (rule.action.type === "request_form" ? rule.action.formKey : ""))
    .map((key) => ({ key, name: formRows.get(key)?.name ?? "A form" })), [props.board, formRows]);

  const optionById = useMemo(() => new Map((options ?? []).map((option) => [option.id, option])), [options]);
  const courses = useMemo(() => {
    const grouped = new Map<string, WelcomeLessonOption[]>();
    for (const option of options ?? []) {
      if (draft.lessonIds.includes(option.id)) continue;
      grouped.set(option.course, [...(grouped.get(option.course) ?? []), option]);
    }
    return [...grouped.entries()];
  }, [options, draft.lessonIds]);
  const lessonLabel = (lessonId: string) => optionById.get(lessonId)?.title ?? (options ? "Lesson no longer published" : "Loading…");

  const edit = (patch: Partial<CloudCommunityWelcomePageDraft>) => { setSaved(false); setDraft((current) => ({ ...current, ...patch })); };
  // Reordering moves the focused button in the DOM, and removing deletes it, so
  // the browser drops focus to the page. Put it on the first of these that can take it.
  const focusFirst = (ids: string[]) => requestAnimationFrame(() => {
    for (const target of ids) {
      const element = document.getElementById(target) as HTMLButtonElement | HTMLSelectElement | null;
      if (element && !element.disabled) { element.focus(); return; }
    }
  });
  const moveLesson = (index: number, by: -1 | 1) => {
    const lessonIds = [...draft.lessonIds];
    const [moved] = lessonIds.splice(index, 1);
    lessonIds.splice(index + by, 0, moved);
    edit({ lessonIds });
    // The same button lets keyboard users keep moving it; at either end that one is disabled.
    const [same, other] = by < 0 ? ["up", "down"] : ["down", "up"];
    focusFirst([`${id}-lesson-${moved}-${same}`, `${id}-lesson-${moved}-${other}`, `${id}-lesson-${moved}-remove`]);
  };
  const removeLesson = (index: number) => {
    const next = draft.lessonIds[index + 1] ?? draft.lessonIds[index - 1];
    edit({ lessonIds: draft.lessonIds.filter((_, other) => other !== index) });
    focusFirst([...(next ? [`${id}-lesson-${next}-remove`] : []), `${id}-add-lesson`, `${id}-steps`]);
  };
  const save = async () => {
    if (!props.onSaveWelcomePage) return;
    adoptNext.current = true;
    const ok = await props.onSaveWelcomePage(draft);
    if (!ok) adoptNext.current = false;
    setSaved(ok);
  };

  const gateOn = props.board?.welcome_gate === true;
  const hasSteps = joinForms.length > 0 || (props.board?.welcome_lesson_ids?.length ?? 0) > 0;
  const stepCount = joinForms.length + draft.lessonIds.length;
  const headline = draft.title.trim() || `Welcome to ${props.communityName ?? "your community"}`;
  const previewMedia = /^https?:\/\/\S+$/i.test(draft.mediaUrl.trim()) ? draft.mediaUrl.trim() : null;
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  // The preview is the member's page itself (the same intro and the same form
  // runner), opened on the first step, so what the owner sees is what members get.
  const firstForm = joinForms[0] ? formRows.get(joinForms[0].key) ?? null : null;
  const firstLessonId = joinForms.length ? null : draft.lessonIds[0] ?? null;
  const previewForm = useMemo(() => firstForm?.questions?.length
    ? { id: `preview:${firstForm.key}`, name: firstForm.name, questions: firstForm.questions, answers: {}, revision: firstForm.revision }
    : null, [firstForm]);
  const [previewRun, setPreviewRun] = useState(0);

  if (!props.board) return <div className="workflow-page welcome-settings"><p role="status">Loading the welcome page…</p></div>;

  return (
    <div className="workflow-page welcome-settings">
      <div className="welcome-settings-editor">
        <header className="welcome-settings-header">
          <h1>Welcome page</h1>
          <p>New members see this page first and finish its steps before the rest of the community opens. They can still use the left rail.</p>
        </header>

        <section className="welcome-settings-section" aria-labelledby={`${id}-status`}>
          <h2 id={`${id}-status`}>Status</h2>
          <label className="welcome-settings-switch">
            <input type="checkbox" role="switch" checked={gateOn} aria-describedby={`${id}-status-help`}
              disabled={props.isSaving || !props.onSetWelcomeGate || (!gateOn && !hasSteps)}
              onChange={(event) => void props.onSetWelcomeGate?.(event.target.checked)} />
            <span>
              <strong>Show the welcome page to new members</strong>
              <small id={`${id}-status-help`}>
                {gateOn ? "On. Members who join from now on start here."
                  : hasSteps ? "Off. New members go straight into the community."
                  : "Add a form or a lesson below, and save, before you turn this on."}
              </small>
            </span>
          </label>
        </section>

        <section className="welcome-settings-section" aria-labelledby={`${id}-words`}>
          <h2 id={`${id}-words`}>What it says</h2>
          <div className="welcome-settings-field">
            <label htmlFor={`${id}-title`}>Headline</label>
            <input id={`${id}-title`} value={draft.title} maxLength={TITLE_MAX} placeholder={`Welcome to ${props.communityName ?? "your community"}`}
              aria-describedby={`${id}-title-help`} onChange={(event) => edit({ title: event.target.value })} />
            <small id={`${id}-title-help`}>Leave empty to use “Welcome to {props.communityName ?? "your community"}”. {draft.title.length}/{TITLE_MAX}</small>
          </div>
          <div className="welcome-settings-field">
            <label htmlFor={`${id}-message`}>Message</label>
            <textarea id={`${id}-message`} value={draft.message} maxLength={MESSAGE_MAX} rows={6}
              placeholder="Say hello, and tell them what to expect in their first week."
              aria-describedby={`${id}-message-help`} onChange={(event) => edit({ message: event.target.value })} />
            <small id={`${id}-message-help`}>You can use **bold**, lists and links. {draft.message.length}/{MESSAGE_MAX}</small>
          </div>
          <div className="welcome-settings-field">
            <label htmlFor={`${id}-media`}>Video or image link</label>
            <input id={`${id}-media`} type="url" inputMode="url" value={draft.mediaUrl} placeholder="https://www.youtube.com/watch?v=…"
              aria-describedby={`${id}-media-help`} onChange={(event) => edit({ mediaUrl: event.target.value })} />
            <small id={`${id}-media-help`}>A YouTube, Loom, Vimeo or Wistia link, or a link to an image. Optional.</small>
          </div>
        </section>

        <section className="welcome-settings-section" aria-labelledby={`${id}-steps`}>
          <h2 id={`${id}-steps`} tabIndex={-1}>Steps</h2>
          <p className="welcome-settings-help">Members do these in order: forms first, then lessons they mark done.</p>
          {stepCount ? (
            <ol className="welcome-settings-steps">
              {joinForms.map((form) => (
                <li key={`form:${form.key}`}>
                  <span className="welcome-settings-step-kind">Form</span>
                  <span className="welcome-settings-step-name">{form.name}</span>
                </li>
              ))}
              {draft.lessonIds.map((lessonId, index) => {
                const name = lessonLabel(lessonId);
                const unavailable = Boolean(options) && !optionById.has(lessonId);
                return (
                  <li key={`lesson:${lessonId}`} className={unavailable ? "is-unavailable" : undefined}>
                    <span className="welcome-settings-step-kind">Lesson</span>
                    <span className="welcome-settings-step-name">
                      {name}
                      {optionById.get(lessonId)?.course ? <small>{optionById.get(lessonId)!.course}</small> : null}
                    </span>
                    <span className="welcome-settings-step-actions">
                      <button type="button" id={`${id}-lesson-${lessonId}-up`} className="welcome-settings-icon-button" disabled={index === 0}
                        aria-label={`Move ${name} earlier`} title="Move earlier" onClick={() => moveLesson(index, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
                      <button type="button" id={`${id}-lesson-${lessonId}-down`} className="welcome-settings-icon-button" disabled={index === draft.lessonIds.length - 1}
                        aria-label={`Move ${name} later`} title="Move later" onClick={() => moveLesson(index, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
                      <button type="button" id={`${id}-lesson-${lessonId}-remove`} className="welcome-settings-icon-button" aria-label={`Remove ${name}`} title="Remove"
                        onClick={() => removeLesson(index)}><X size={15} aria-hidden="true" /></button>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : <p className="welcome-settings-empty">No steps yet.</p>}
          <p className="welcome-settings-help">
            {joinForms.length ? "Forms come from the first milestone’s “Member joins” rules." : "To ask new members questions, add a “Member joins → Request a form” rule to the first milestone."}
            {" "}<button type="button" className="welcome-settings-link" onClick={props.onOpenWorkflows}>{joinForms.length ? "Change forms in Workflows" : "Open Workflows"}</button>
          </p>
          <div className="welcome-settings-field">
            <label htmlFor={`${id}-add-lesson`}>Add a lesson</label>
            {optionsError ? (
              <p role="alert" className="workflow-error">Lessons could not be loaded.{" "}
                <button type="button" className="workflow-secondary-button" onClick={() => setOptionsRetry((n) => n + 1)}><RefreshCw size={14} aria-hidden="true" /> Try again</button></p>
            ) : (
              <select id={`${id}-add-lesson`} value="" aria-describedby={`${id}-add-lesson-help`}
                disabled={!options || draft.lessonIds.length >= LESSONS_MAX || courses.length === 0}
                onChange={(event) => { if (event.target.value) edit({ lessonIds: [...draft.lessonIds, event.target.value] }); }}>
                <option value="">{!options ? "Loading lessons…" : courses.length ? "Choose a lesson…" : "No published lessons to add"}</option>
                {courses.map(([course, rows]) => (
                  <optgroup key={course} label={course || "Lessons"}>
                    {rows.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            <small id={`${id}-add-lesson-help`}>
              {draft.lessonIds.length >= LESSONS_MAX ? `That’s the most: ${LESSONS_MAX} lessons.` : `Up to ${LESSONS_MAX}, from published courses. Good for a welcome video or a setup step. They open even while an earlier board stage is locked.`}
            </small>
          </div>
        </section>

        <footer className="welcome-settings-actions">
          <button type="button" className={`platform-save-button${dirty ? " is-dirty" : ""}`} disabled={!dirty || props.isSaving || !props.onSaveWelcomePage}
            onClick={() => void save()}>{props.isSaving ? "Saving…" : "Save"}</button>
          <button type="button" className="workflow-secondary-button" disabled={!dirty || props.isSaving}
            onClick={() => { setSaved(false); setDraft(baseline); setDraftBase(baselineKey); }}>Discard changes</button>
          <small role="status">{dirty ? "Unsaved changes" : saved ? "Saved" : ""}</small>
        </footer>
        {props.actionError ? <p className="workflow-error" role="alert">{props.actionError}</p> : null}
      </div>

      <aside className="welcome-settings-preview" aria-labelledby={`${id}-preview`}>
        <div className="welcome-settings-preview-bar">
          <h2 id={`${id}-preview`}>Preview</h2>
          <div className="welcome-settings-device" role="group" aria-label="Preview size">
            <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={15} aria-hidden="true" /> Desktop</button>
            <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")}><Smartphone size={15} aria-hidden="true" /> Phone</button>
          </div>
        </div>
        <p className="welcome-settings-help">Exactly what a new member sees first. You can click through the form; answers aren't saved.</p>
        <ScaledPreview width={device === "desktop" ? 960 : 390}>
          <section className="community-welcome community-welcome-preview" aria-label="Welcome page preview">
            <WelcomeIntro title={headline} headingLevel={3} message={draft.message.trim() || null} mediaUrl={previewMedia} total={stepCount}
              stepLine={stepCount > 1 ? `Step 1 of ${stepCount}${firstLessonId ? `: ${lessonLabel(firstLessonId)}` : ""}` : null} />
            {previewForm ? <div className="member-form-dialog community-welcome-form">
              <MemberFormRunner key={`${previewForm.id}:${previewRun}`} preview={previewForm} requestId={previewForm.id} communityId=""
                session={null as never} ensureSession={async () => null} onClose={() => setPreviewRun((n) => n + 1)} />
            </div> : firstLessonId ? <div className="community-welcome-lesson">
              <p className="welcome-settings-preview-lesson">The lesson “{lessonLabel(firstLessonId)}” shows here, as it does in Knowledge.</p>
              <footer aria-hidden="true"><button type="button" className="platform-save-button" tabIndex={-1}>{draft.lessonIds.length > 1 ? "Mark done and continue" : "Mark done and open the community"}</button></footer>
            </div> : joinForms.length ? <p className="welcome-settings-preview-lesson" role="status">{formsLoaded || !props.forms
              ? `The form “${joinForms[0].name}” shows here once it has a question.` : "Loading the form…"}</p> : null}
          </section>
        </ScaledPreview>
      </aside>
    </div>
  );
}

// Lays the member page out at a real screen width, then scales it to fit the pane.
function ScaledPreview(props: { width: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const scale = Math.min(1, outer.current.clientWidth / props.width);
      const height = inner.current.offsetHeight * scale;
      setBox((box) => (box.scale === scale && box.height === height ? box : { scale, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [props.width]);
  // A screen narrower than the pane (a phone) keeps its own width, centred, instead of a wide frame around it.
  return <div ref={outer} className="welcome-settings-preview-frame" style={{ height: box.height || undefined, maxWidth: props.width + 2 }}>
    <div ref={inner} className="welcome-settings-preview-screen" style={{ width: props.width, transform: `scale(${box.scale})` }}>{props.children}</div>
  </div>;
}
