import { ArrowDown, ArrowUp, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from "react";
import { renderMarkdown } from "../../../../shared/markdownUi";
import type { CloudCommunityMemberWorkflowBoard, CloudCommunityWelcomePageDraft } from "../../../../shared/cloudCommunityMemberWorkflowsGateway";
import type { WelcomeLessonOption } from "../controllers/useWebCommunityWorkflowsController";
import type { CommunityFormsGateway } from "../controllers/useWebCommunityFormsGateway";
import { welcomeMediaMarkdown } from "./WebCommunityWelcome";
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

  const [formNames, setFormNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    props.forms?.load().then((rows) => { if (alive) setFormNames(new Map(rows.map((row) => [row.key, row.name]))); }).catch(() => {});
    return () => { alive = false; };
  }, [props.forms]);
  const joinForms = useMemo(() => (props.board?.milestones[0]?.automations ?? [])
    .filter((rule) => rule.trigger.type === "member_joined" && rule.action.type === "request_form")
    .map((rule) => (rule.action.type === "request_form" ? rule.action.formKey : ""))
    .map((key) => ({ key, name: formNames.get(key) ?? "A form" })), [props.board, formNames]);

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
  const moveLesson = (index: number, by: -1 | 1) => {
    const lessonIds = [...draft.lessonIds];
    const [moved] = lessonIds.splice(index, 1);
    lessonIds.splice(index + by, 0, moved);
    edit({ lessonIds });
    // Keep focus on the moved lesson's same button so keyboard users can keep moving it.
    requestAnimationFrame(() => document.getElementById(`${id}-lesson-${moved}-${by < 0 ? "up" : "down"}`)?.focus());
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
  const preview = useMemo(() => ({
    message: draft.message.trim() ? renderMarkdown(draft.message) : null,
    media: /^https?:\/\/\S+$/i.test(draft.mediaUrl.trim()) ? renderMarkdown(welcomeMediaMarkdown(draft.mediaUrl.trim()), { embedStandaloneMedia: true }) : null,
  }), [draft.message, draft.mediaUrl]);

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
          <h2 id={`${id}-steps`}>Steps</h2>
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
                      <button type="button" className="welcome-settings-icon-button" aria-label={`Remove ${name}`} title="Remove"
                        onClick={() => edit({ lessonIds: draft.lessonIds.filter((other) => other !== lessonId) })}><X size={15} aria-hidden="true" /></button>
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
              {draft.lessonIds.length >= LESSONS_MAX ? `That’s the most: ${LESSONS_MAX} lessons.` : `Up to ${LESSONS_MAX}, from published courses. Good for a welcome video or a setup step.`}
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
        <h2 id={`${id}-preview`}>Preview</h2>
        <div className="welcome-settings-preview-page">
          <small>Welcome</small>
          <p className="welcome-settings-preview-title">{headline}</p>
          {preview.message ? <div className="welcome-settings-preview-message">{preview.message}</div>
            : <p>Finish {stepCount > 1 ? "these steps" : "this step"} to open the community.</p>}
          {preview.media ? <div className="welcome-settings-preview-media">{preview.media}</div> : null}
          {stepCount ? (
            <ol className="welcome-settings-preview-steps">
              {joinForms.map((form) => <li key={`form:${form.key}`}>{form.name}</li>)}
              {draft.lessonIds.map((lessonId) => <li key={`lesson:${lessonId}`}>{lessonLabel(lessonId)}</li>)}
            </ol>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
