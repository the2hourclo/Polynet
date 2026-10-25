import { BookOpen, ClipboardList, Eye, GripVertical, Image as ImageIcon, Monitor, Plus, RotateCcw, Smartphone, SplitSquareVertical, Trash2, Type, X } from "lucide-react";
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type DragEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type TextareaHTMLAttributes,
} from "react";
import type { CloudCommunityMemberWorkflowBoard, CloudCommunityWelcomePageDraft } from "../../../../shared/cloudCommunityMemberWorkflowsGateway";
import {
  WELCOME_BLOCKS_MAX, WELCOME_FORMS_MAX, WELCOME_LESSONS_MAX, WELCOME_TEXT_MAX,
  legacyWelcomeLayout, normalizeWelcomeLayout, welcomeLayoutSteps, welcomeLayoutWithForms, welcomeScreens,
  type WelcomeBlock, type WelcomeStep,
} from "../../../../shared/communityWelcomeLayout";
import { renderMarkdown } from "../../../../shared/markdownUi";
import type { WelcomeLessonOption } from "../controllers/useWebCommunityWorkflowsController";
import type { CommunityFormsGateway } from "../controllers/useWebCommunityFormsGateway";
import type { CommunityFormDraft } from "../../../../shared/communityForms";
import { MemberFormRunner } from "./WebCommunityNextStep";
import { WelcomeScreenView, welcomeMediaMarkdown } from "./WebCommunityWelcome";
import "./WebCommunityWelcomeSettings.css";

const TITLE_MAX = 120;

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

type EditorBlock = WelcomeBlock & { uid: string };
type Draft = { title: string; layout: EditorBlock[] };
let nextUid = 0;
const withUid = (block: WelcomeBlock): EditorBlock => ({ ...block, uid: `b${++nextUid}` });
const stripUid = ({ uid: _uid, ...block }: EditorBlock): WelcomeBlock => block as WelcomeBlock;
const isStep = (block: WelcomeBlock) => block.type === "form" || block.type === "lesson";
const mediaLine = (url: string) => welcomeMediaMarkdown(url).replace(/^<(.*)>$/, "$1");
const isLink = (value: string) => /^https:\/\/\S+$/i.test(value.trim());

function joinFormKeys(board: CloudCommunityMemberWorkflowBoard | null): string[] {
  return (board?.milestones[0]?.automations ?? [])
    .filter((rule) => rule.trigger.type === "member_joined" && rule.action.type === "request_form")
    .map((rule) => (rule.action.type === "request_form" ? rule.action.formKey : ""));
}

// The saved page, or the words, media and steps saved before the page was blocks.
function savedLayout(board: CloudCommunityMemberWorkflowBoard | null): WelcomeBlock[] {
  const page = board?.welcome_page;
  const forms = joinFormKeys(board);
  const layout = page?.layout ?? legacyWelcomeLayout({
    message: page?.message ?? "", mediaUrl: page?.media_url ? mediaLine(page.media_url) : "",
    formKeys: forms, lessonIds: board?.welcome_lesson_ids ?? [],
  });
  return withBreaks(welcomeLayoutWithForms(layout, forms));
}

/** Shows every screen split: a step that would start a screen of its own gets its "Next" break drawn. */
function withBreaks<T extends WelcomeBlock>(layout: T[], make: (block: WelcomeBlock) => T = (block) => block as T): T[] {
  const out: T[] = [];
  let hasStep = false;
  for (const block of layout) {
    if (block.type === "next") hasStep = false;
    else if (isStep(block)) {
      if (hasStep) out.push(make({ type: "next" }));
      hasStep = true;
    }
    out.push(block);
  }
  return out;
}

const draftKey = (title: string, layout: WelcomeBlock[]) =>
  JSON.stringify({ title: title.replace(/\s+/g, " ").trim(), layout: normalizeWelcomeLayout(layout) });

// "replace" swaps the "/" line typed in a text block (the whole block when that's all it holds) for the new blocks.
type MenuTarget = { uid: string; mode: "after" } | { uid: string; mode: "replace"; start: number; end: number } | { uid: null; mode: "end" };
type MenuView = "root" | "form" | "lesson" | "link";
type MenuItem = { key: string; label: string; hint: string; icon: ReactNode };

// The welcome page, written like a page: the headline, then blocks of words,
// videos, forms and lessons, split into screens by "Next" breaks. Members go
// through it one screen at a time; Preview plays it the same way.
export function WebCommunityWelcomeSettings(props: Props) {
  const id = useId();
  const baseline = useMemo<Draft>(() => ({
    title: props.board?.welcome_page?.title ?? "", layout: savedLayout(props.board).map(withUid),
  }), [props.board]);
  const baselineKey = draftKey(baseline.title, baseline.layout.map(stripUid));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [draftBase, setDraftBase] = useState(baselineKey);
  const [saved, setSaved] = useState(false);
  const adoptNext = useRef(false);
  const currentKey = draftKey(draft.title, draft.layout.map(stripUid));
  // Take the server's copy when there are no edits here, or right after a save
  // (the server tidies spacing, so the saved draft may not match it exactly).
  if (draftBase !== baselineKey && (adoptNext.current || currentKey === draftBase)) {
    adoptNext.current = false;
    setDraft(baseline);
    setDraftBase(baselineKey);
  }
  const dirty = currentKey !== baselineKey;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    props.leaveGuard.current = async () => !dirtyRef.current || window.confirm("Leave without saving your welcome page changes?");
    return () => { props.leaveGuard.current = null; };
  }, [props.leaveGuard]);

  const [options, setOptions] = useState<WelcomeLessonOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!props.onLoadWelcomeLessonOptions) { setOptions([]); return; }
    props.onLoadWelcomeLessonOptions().then((rows) => { if (alive) setOptions(rows); }).catch(() => { if (alive) setOptions([]); });
    return () => { alive = false; };
  }, [props.onLoadWelcomeLessonOptions]);
  const [formRows, setFormRows] = useState<Map<string, CommunityFormDraft> | null>(null);
  useEffect(() => {
    let alive = true;
    if (!props.forms) { setFormRows(new Map()); return; }
    props.forms.load().then((rows) => { if (alive) setFormRows(new Map(rows.map((row) => [row.key, row]))); })
      .catch(() => { if (alive) setFormRows(new Map()); });
    return () => { alive = false; };
  }, [props.forms]);
  const lessonById = useMemo(() => new Map((options ?? []).map((option) => [option.id, option])), [options]);

  // Read out after a keyboard move; any other edit clears it.
  const [moveNote, setMoveNote] = useState("");
  const setLayout = (update: (layout: EditorBlock[]) => EditorBlock[]) => {
    setSaved(false);
    setMoveNote("");
    setDraft((current) => ({ ...current, layout: withBreaks(update(current.layout), withUid) }));
  };
  const [editing, setEditing] = useState<string | null>(null);
  const focusBlock = (uid: string) => requestAnimationFrame(() => document.getElementById(`${id}-block-${uid}`)?.focus());
  const editText = (uid: string) => { setEditing(uid); focusBlock(uid); };

  // The block menu: opened by typing "/" on an empty line, by a block's +, or by "Add a block".
  const [menu, setMenu] = useState<{ target: MenuTarget; view: MenuView; filter: string; active: number } | null>(null);
  const [link, setLink] = useState("");
  const placed = useMemo(() => welcomeLayoutSteps(draft.layout), [draft.layout]);
  const publishedForms = useMemo(() => [...(formRows?.values() ?? [])].filter((row) => row.publishedRevision !== null), [formRows]);
  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu || menu.view === "link") return [];
    if (menu.view === "form") return publishedForms.filter((row) => !placed.formKeys.includes(row.key))
      .map((row) => ({ key: `form:${row.key}`, label: row.name || "Untitled form",
        hint: `${row.questions.length} question${row.questions.length === 1 ? "" : "s"}`, icon: <ClipboardList size={16} aria-hidden="true" /> }));
    if (menu.view === "lesson") return (options ?? []).filter((row) => !placed.lessonIds.includes(row.id))
      .map((row) => ({ key: `lesson:${row.id}`, label: row.title, hint: row.course, icon: <BookOpen size={16} aria-hidden="true" /> }));
    const filter = menu.filter.toLowerCase();
    return [
      { key: "text", label: "Text", hint: "Words, lists and links", icon: <Type size={16} aria-hidden="true" /> },
      { key: "link", label: "Video or image", hint: "A YouTube, Loom, Vimeo, Wistia or image link", icon: <ImageIcon size={16} aria-hidden="true" /> },
      ...(placed.formKeys.length < WELCOME_FORMS_MAX ? [{ key: "form", label: "Form", hint: "Questions every new member answers", icon: <ClipboardList size={16} aria-hidden="true" /> }] : []),
      ...(placed.lessonIds.length < WELCOME_LESSONS_MAX ? [{ key: "lesson", label: "Lesson", hint: "A lesson they read and mark done", icon: <BookOpen size={16} aria-hidden="true" /> }] : []),
      { key: "next", label: "Next page", hint: "Start a new screen", icon: <SplitSquareVertical size={16} aria-hidden="true" /> },
    ].filter((item) => item.label.toLowerCase().includes(filter));
  }, [menu, publishedForms, options, placed]);
  const full = draft.layout.length >= WELCOME_BLOCKS_MAX;
  const openMenu = (target: MenuTarget, view: MenuView = "root", filter = "") => { setLink(""); setMenu({ target, view, filter, active: 0 }); };
  const closeMenu = () => {
    const target = menu?.target;
    setMenu(null);
    if (target?.uid) focusBlock(target.uid); else document.getElementById(`${id}-add`)?.focus();
  };
  const insert = (blocks: WelcomeBlock[]) => {
    if (!menu) return;
    const added = blocks.map(withUid);
    const target = menu.target;
    setLayout((layout) => {
      const at = target.uid ? layout.findIndex((block) => block.uid === target.uid) : -1;
      if (at < 0) return [...layout, ...added];
      if (target.mode !== "replace") return [...layout.slice(0, at), layout[at], ...added, ...layout.slice(at + 1)];
      // The words around the "/" line stay where they were, above and below what was added.
      const block = layout[at];
      const markdown = block.type === "text" ? block.markdown : "";
      const around = [markdown.slice(0, target.start), markdown.slice(target.end + 1)]
        .map((part) => part.replace(/^\n+|\n+$/g, "")).map((part) => (part.trim() ? withUid({ type: "text", markdown: part }) : null));
      return [...layout.slice(0, at), ...(around[0] ? [around[0]] : []), ...added, ...(around[1] ? [around[1]] : []), ...layout.slice(at + 1)];
    });
    setMenu(null);
    const last = added[added.length - 1];
    if (last.type === "text" && !last.markdown) editText(last.uid);
    else { setEditing(null); focusBlock(last.uid); }
  };
  const choose = (key: string) => {
    if (!menu) return;
    if (key === "form" || key === "lesson" || key === "link") { setLink(""); setMenu({ ...menu, view: key, filter: "", active: 0 }); return; }
    if (key === "text") return insert([{ type: "text", markdown: "" }]);
    if (key === "next") return insert([{ type: "next" }, { type: "text", markdown: "" }]);
    if (key.startsWith("form:")) return insert([{ type: "form", formKey: key.slice(5) }]);
    if (key.startsWith("lesson:")) return insert([{ type: "lesson", resourceId: key.slice(7) }]);
  };
  const addLink = () => { if (isLink(link)) insert([{ type: "text", markdown: mediaLine(link.trim()) }]); };
  const menuKeys = (event: KeyboardEvent) => {
    if (!menu) return false;
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); return true; }
    if (menu.view === "link") return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = Math.max(menuItems.length, 1);
      setMenu({ ...menu, active: (menu.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count });
      return true;
    }
    if (event.key === "Enter" && menuItems[menu.active]) { event.preventDefault(); choose(menuItems[menu.active].key); return true; }
    return false;
  };
  const menuEmpty = menu?.view === "form" ? (formRows === null ? "Loading forms…" : publishedForms.length ? "Every published form is already on the page." : "Publish a form in Forms first.")
    : menu?.view === "lesson" ? (options === null ? "Loading lessons…" : "No more published lessons to add.") : "No block matches.";
  // The highlighted choice is read out from wherever the keys are typed: the menu's list, or the text line that typed "/".
  const menuListId = `${id}-menu-list`;
  const menuOptionId = (index: number) => `${id}-menu-option-${index}`;
  const renderMenu = (autoFocus: boolean) => menu ? <BlockMenu view={menu.view} items={menuItems} active={menu.active} link={link} onLink={setLink}
    listId={menuListId} optionId={menuOptionId}
    onAddLink={addLink} onChoose={choose} onClose={closeMenu} onBack={() => setMenu({ ...menu, view: "root", active: 0 })}
    autoFocus={autoFocus} onKeys={menuKeys} emptyText={menuEmpty} /> : null;

  const updateText = (uid: string, markdown: string) => {
    setLayout((layout) => layout.map((block) => (block.uid === uid ? { ...block, markdown } : block)));
    // "/" at the start of an empty line opens the block menu, filtered by what follows: the line with the cursor, not the whole block.
    const field = document.getElementById(`${id}-block-${uid}`) as HTMLTextAreaElement | null;
    const caret = field?.selectionStart ?? markdown.length;
    const start = markdown.lastIndexOf("\n", caret - 1) + 1;
    const end = markdown.indexOf("\n", caret) < 0 ? markdown.length : markdown.indexOf("\n", caret);
    const slash = /^\/(\w*)$/.exec(markdown.slice(start, end));
    if (slash && !full) openMenu({ uid, mode: "replace", start, end }, "root", slash[1]);
    else if (menu?.target.uid === uid) setMenu(null);
  };
  const remove = (uid: string) => {
    const at = draft.layout.findIndex((block) => block.uid === uid);
    const neighbour = draft.layout[at - 1] ?? draft.layout[at + 1];
    setLayout((layout) => layout.filter((block) => block.uid !== uid));
    if (neighbour?.type === "text") editText(neighbour.uid);
    else if (neighbour) focusBlock(neighbour.uid);
    else requestAnimationFrame(() => document.getElementById(`${id}-add`)?.focus());
  };
  const move = (uid: string, to: number) => setLayout((layout) => {
    const from = layout.findIndex((block) => block.uid === uid);
    if (from < 0) return layout;
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to > from ? to - 1 : to)), 0, moved);
    return next;
  });

  // Dragging a block by its handle; a line shows where it lands.
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragOver = (event: DragEvent, index: number) => {
    if (!dragging) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    if (dragging && dropAt !== null) move(dragging, dropAt);
    setDragging(null); setDropAt(null);
  };

  const save = async () => {
    if (!props.onSaveWelcomePage) return;
    adoptNext.current = true;
    const layout = normalizeWelcomeLayout(draft.layout.map(stripUid));
    const ok = await props.onSaveWelcomePage({ title: draft.title, message: "", mediaUrl: "", lessonIds: welcomeLayoutSteps(layout).lessonIds, layout });
    if (!ok) adoptNext.current = false;
    setSaved(ok);
  };

  const gateOn = props.board?.welcome_gate === true;
  const hasSteps = joinFormKeys(props.board).length > 0 || (props.board?.welcome_lesson_ids?.length ?? 0) > 0;
  const headline = draft.title.trim() || `Welcome to ${props.communityName ?? "your community"}`;
  const [previewing, setPreviewing] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const plain = draft.layout.map(stripUid);
  const screenCount = welcomeScreens(normalizeWelcomeLayout(plain)).length;
  const lastStepAt = plain.map(isStep).lastIndexOf(true);
  const afterLastStep = lastStepAt >= 0 && plain.slice(lastStepAt + 1).some((block) => block.type === "next");

  if (!props.board) return <div className="workflow-page welcome-settings"><p role="status">Loading the welcome page…</p></div>;

  let screenNumber = 1;
  return (
    <div className="workflow-page welcome-settings">
      <header className="welcome-settings-bar">
        <div className="welcome-settings-bar-title">
          <h1>Welcome page</h1>
          <p>New members see this first, one screen at a time, and finish its steps before the community opens.</p>
        </div>
        <label className="welcome-settings-switch">
          <input type="checkbox" role="switch" checked={gateOn} aria-describedby={`${id}-status-help`}
            disabled={props.isSaving || !props.onSetWelcomeGate || (!gateOn && !hasSteps)}
            onChange={(event) => void props.onSetWelcomeGate?.(event.target.checked)} />
          <span>
            <strong>Show to new members</strong>
            <small id={`${id}-status-help`}>
              {gateOn ? "On. New members start here." : hasSteps ? "Off. New members skip it." : "Add a form or a lesson, and save, to turn it on."}
            </small>
          </span>
        </label>
        <div className="welcome-settings-bar-actions">
          <button type="button" ref={previewButton} className="workflow-secondary-button" disabled={!screenCount} onClick={() => { setMenu(null); setPreviewing(true); }}>
            <Eye size={15} aria-hidden="true" /> Preview
          </button>
          <button type="button" className="workflow-secondary-button" disabled={!dirty || props.isSaving}
            onClick={() => { setSaved(false); setMenu(null); setEditing(null); setDraft(baseline); setDraftBase(baselineKey); }}>Discard</button>
          <button type="button" className={`platform-save-button${dirty ? " is-dirty" : ""}`} disabled={!dirty || props.isSaving || !props.onSaveWelcomePage}
            onClick={() => void save()}>{props.isSaving ? "Saving…" : "Save"}</button>
          <small role="status" className="welcome-settings-saved">{moveNote || (dirty ? "Unsaved changes" : saved ? "Saved" : "")}</small>
        </div>
      </header>
      {props.actionError ? <p className="workflow-error welcome-settings-error" role="alert">{props.actionError}</p> : null}

      <div className="welcome-settings-canvas">
        <article className="community-welcome welcome-settings-page" aria-label="Welcome page editor">
          <div className="community-welcome-intro">
            <small>Welcome</small>
            <AutoSizeTextarea id={`${id}-title`} className="welcome-settings-headline" value={draft.title} maxLength={TITLE_MAX} rows={1} aria-label="Headline"
              placeholder={`Welcome to ${props.communityName ?? "your community"}`}
              onChange={(title) => { setSaved(false); setDraft((current) => ({ ...current, title: title.replace(/\n/g, " ") })); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const first = draft.layout[0];
                if (first?.type === "text") editText(first.uid); else if (first) focusBlock(first.uid);
              }} />
          </div>

          <ol className="welcome-settings-blocks" onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={drop}>
            {draft.layout.map((block, index) => {
              const label = block.type === "text" ? "text" : block.type === "next" ? "page break" : block.type;
              if (block.type === "next") screenNumber += 1;
              const menuHere = Boolean(menu && menu.target.uid === block.uid);
              const classes = ["welcome-settings-block", `is-${block.type}`, dragging === block.uid ? "is-dragging" : "",
                dropAt === index ? "drop-before" : "", dropAt === index + 1 && index === draft.layout.length - 1 ? "drop-after" : ""].filter(Boolean).join(" ");
              return (
                <li key={block.uid} className={classes} draggable={dragging === block.uid} onDragOver={(event) => dragOver(event, index)}
                  onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", label); }}
                  onDragEnd={() => { setDragging(null); setDropAt(null); }}>
                  <div className="welcome-settings-gutter">
                    <button type="button" className="welcome-settings-icon-button" aria-label={`Add a block after this ${label}`} title="Add a block"
                      disabled={full} onClick={() => openMenu({ uid: block.uid, mode: "after" })}><Plus size={16} aria-hidden="true" /></button>
                    <button type="button" className="welcome-settings-icon-button welcome-settings-handle" data-handle={block.uid}
                      aria-label={`Move this ${label}. Use the up and down arrow keys.`} title="Drag to move"
                      onPointerDown={() => setDragging(block.uid)} onPointerUp={() => setDragging(null)}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        event.preventDefault();
                        const to = event.key === "ArrowUp" ? index - 1 : index + 2;
                        move(block.uid, to);
                        const at = Math.max(0, Math.min(draft.layout.length - 1, event.key === "ArrowUp" ? index - 1 : index + 1));
                        setMoveNote(`Moved the ${label} to ${at + 1} of ${draft.layout.length}.`);
                        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-handle="${block.uid}"]`)?.focus());
                      }}><GripVertical size={16} aria-hidden="true" /></button>
                  </div>
                  <div className="welcome-settings-block-body">
                    {block.type === "text" ? (
                      editing === block.uid || !block.markdown.trim() ? (
                        <AutoSizeTextarea id={`${id}-block-${block.uid}`} value={block.markdown} maxLength={WELCOME_TEXT_MAX} rows={1}
                          aria-label="Text. Type / to add a block." className="welcome-settings-text"
                          aria-controls={menuHere && menu?.view === "root" ? menuListId : undefined}
                          aria-activedescendant={menuHere && menu?.view === "root" && menuItems[menu.active] ? menuOptionId(menu.active) : undefined}
                          placeholder={draft.layout.length === 1 ? "Say hello. Type / to add a video, a form, a lesson or a Next page." : "Type / to add a block"}
                          onFocus={() => setEditing(block.uid)}
                          onBlur={() => { if (!menuHere) setEditing((current) => (current === block.uid ? null : current)); }}
                          onChange={(markdown) => updateText(block.uid, markdown)}
                          onPaste={(event) => {
                            // A link pasted on an empty line becomes the video or image it points to.
                            const pasted = event.clipboardData.getData("text").trim();
                            if (block.markdown.trim() || !isLink(pasted)) return;
                            event.preventDefault();
                            updateText(block.uid, mediaLine(pasted));
                            setEditing(null);
                          }}
                          onKeyDown={(event) => {
                            if (menuHere && menuKeys(event)) return;
                            if (event.key === "Backspace" && !block.markdown && draft.layout.length > 1) { event.preventDefault(); remove(block.uid); }
                            else if (event.key === "Escape") (event.target as HTMLElement).blur();
                          }} />
                      ) : <TextView id={`${id}-block-${block.uid}`} markdown={block.markdown} onEdit={() => editText(block.uid)} />
                    ) : block.type === "next" ? (
                      <div id={`${id}-block-${block.uid}`} tabIndex={-1} className="welcome-settings-break">
                        <span>Next page</span><small>Screen {screenNumber}</small>
                      </div>
                    ) : block.type === "form" ? (
                      <StepCard id={`${id}-block-${block.uid}`} kind="Form" icon={<ClipboardList size={18} aria-hidden="true" />}
                        title={formRows?.get(block.formKey)?.name || (formRows ? "This form was removed" : "Loading…")}
                        unavailable={Boolean(formRows) && !formRows?.get(block.formKey)?.publishedRevision}
                        detail={(formRows?.get(block.formKey)?.questions ?? []).slice(0, 3).map((question) => question.title).filter(Boolean)}
                        note="Every new member answers this when they join." />
                    ) : (
                      <StepCard id={`${id}-block-${block.uid}`} kind="Lesson" icon={<BookOpen size={18} aria-hidden="true" />}
                        title={lessonById.get(block.resourceId)?.title ?? (options ? "This lesson is no longer published" : "Loading…")}
                        unavailable={Boolean(options) && !lessonById.has(block.resourceId)}
                        detail={lessonById.get(block.resourceId)?.course ? [lessonById.get(block.resourceId)!.course] : []}
                        note="Members read it here and mark it done to go on." />
                    )}
                    {menuHere ? renderMenu(menu?.target.mode !== "replace") : null}
                  </div>
                  <div className="welcome-settings-block-end">
                    <button type="button" className="welcome-settings-icon-button" aria-label={`Remove this ${label}`} title="Remove"
                      onClick={() => remove(block.uid)}><Trash2 size={15} aria-hidden="true" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="welcome-settings-add">
            <button type="button" id={`${id}-add`} className="welcome-settings-add-button" disabled={full} onClick={() => openMenu({ uid: null, mode: "end" })}>
              <Plus size={16} aria-hidden="true" /> {full ? `That's the most: ${WELCOME_BLOCKS_MAX} blocks` : "Add a block"}
            </button>
            {menu && menu.target.uid === null ? renderMenu(true) : null}
          </div>
          <p className="welcome-settings-help">
            {afterLastStep ? "Members go into the community right after the last step, so screens after it aren't shown. " : ""}
            Forms on this page are the ones new members answer when they join. What happens after a form is set in{" "}
            <button type="button" className="welcome-settings-link" onClick={props.onOpenWorkflows}>Workflows</button>.
          </p>
        </article>
      </div>

      {previewing ? <WelcomePreview title={headline} layout={plain} formRows={formRows} lessonById={lessonById}
        onClose={() => { setPreviewing(false); requestAnimationFrame(() => previewButton.current?.focus()); }} /> : null}
    </div>
  );
}

function AutoSizeTextarea(props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & { value: string; onChange: (value: string) => void }) {
  const { onChange, value, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`; };
    fit();
    // A narrower window (a phone turned, a resized pane) wraps the words onto more lines.
    if (typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; fit(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return <textarea ref={ref} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />;
}

// Words show as the member reads them (videos play inline); a click puts the cursor back in.
function TextView(props: { id: string; markdown: string; onEdit: () => void }) {
  const rendered = useMemo(() => renderMarkdown(props.markdown, { embedStandaloneMedia: true }), [props.markdown]);
  return <div id={props.id} className="community-welcome-message welcome-settings-text-view" tabIndex={0} role="group" aria-label="Text. Press Enter to edit."
    onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button, iframe, video")) props.onEdit(); }}
    onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); props.onEdit(); } }}>{rendered}</div>;
}

function StepCard(props: { id: string; kind: string; icon: ReactNode; title: string; detail: string[]; note: string; unavailable: boolean }) {
  return <div id={props.id} tabIndex={-1} className={`welcome-settings-step${props.unavailable ? " is-unavailable" : ""}`}>
    <span className="welcome-settings-step-icon">{props.icon}</span>
    <span className="welcome-settings-step-copy">
      <small>{props.kind}</small>
      <strong>{props.title}</strong>
      {props.detail.length ? <span className="welcome-settings-step-detail">{props.detail.join(" · ")}</span> : null}
      <span className="welcome-settings-step-note">{props.note}</span>
    </span>
  </div>;
}

function BlockMenu(props: {
  view: MenuView; items: MenuItem[]; active: number; link: string; emptyText: string; autoFocus: boolean;
  listId: string; optionId: (index: number) => string;
  onLink: (value: string) => void; onAddLink: () => void; onChoose: (key: string) => void; onClose: () => void; onBack: () => void;
  onKeys: (event: KeyboardEvent) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.view === "link") ref.current?.querySelector("input")?.focus();
    else if (props.autoFocus || props.view !== "root") (ref.current?.querySelector<HTMLElement>("[role=listbox]") ?? ref.current)?.focus();
  }, [props.view, props.autoFocus]);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest(".welcome-settings-text")) onClose.current();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  const title = props.view === "form" ? "Choose a form" : props.view === "lesson" ? "Choose a lesson" : props.view === "link" ? "Video or image" : "Add a block";
  return <div ref={ref} className="welcome-settings-menu" role="dialog" aria-label={title} tabIndex={-1} onKeyDown={(event) => { props.onKeys(event); }}>
    <div className="welcome-settings-menu-head">
      {props.view !== "root" ? <button type="button" className="welcome-settings-link" onClick={props.onBack}>Back</button> : null}
      <strong>{title}</strong>
      <button type="button" className="welcome-settings-icon-button" aria-label="Close" onClick={props.onClose}><X size={14} aria-hidden="true" /></button>
    </div>
    {props.view === "link" ? (
      <form className="welcome-settings-menu-link" onSubmit={(event) => { event.preventDefault(); props.onAddLink(); }}>
        <input type="url" inputMode="url" value={props.link} placeholder="https://www.youtube.com/watch?v=…" aria-label="Video or image link"
          onChange={(event) => props.onLink(event.target.value)} />
        <button type="submit" className="platform-save-button" disabled={!isLink(props.link)}>Add</button>
      </form>
    ) : props.items.length ? (
      <ul id={props.listId} role="listbox" aria-label={title} tabIndex={-1} aria-activedescendant={props.items[props.active] ? props.optionId(props.active) : undefined}>
        {props.items.map((item, index) => (
          <li key={item.key} id={props.optionId(index)} role="option" aria-selected={index === props.active}>
            <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onChoose(item.key)}>
              <span className="welcome-settings-menu-icon">{item.icon}</span>
              <span><strong>{item.label}</strong>{item.hint ? <small>{item.hint}</small> : null}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : <p className="welcome-settings-menu-empty">{props.emptyText}</p>}
    {props.view !== "link" && props.items.length ? <p className="welcome-settings-menu-hint">↑ ↓ to choose · Enter to add · Esc to close</p> : null}
  </div>;
}

// Plays the page the way a member goes through it: one screen at a time, the
// real form runner (answers aren't saved), at a desktop or phone width.
function WelcomePreview(props: {
  title: string; layout: WelcomeBlock[]; formRows: Map<string, CommunityFormDraft> | null;
  lessonById: Map<string, WelcomeLessonOption>; onClose: () => void;
}) {
  const screens = useMemo(() => welcomeScreens(normalizeWelcomeLayout(props.layout)), [props.layout]);
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  const lastStep = screens.map((screen) => Boolean(screen.step)).lastIndexOf(true);
  const finished = index >= screens.length || (lastStep >= 0 && index > lastStep);
  const advance = () => setIndex((n) => n + 1);
  const renderStep = (step: WelcomeStep) => {
    if (step.type === "lesson") {
      const lesson = props.lessonById.get(step.resourceId);
      return <div className="community-welcome-lesson">
        <p className="welcome-settings-preview-lesson">The lesson “{lesson?.title ?? "Lesson"}” shows here, as it does in Knowledge.</p>
        <footer><button type="button" className="platform-save-button" onClick={advance}>
          {index === lastStep ? "Mark done and open the community" : "Mark done and continue"}</button></footer>
      </div>;
    }
    const form = props.formRows?.get(step.formKey);
    const request = form?.questions.length ? { id: `preview:${form.key}`, name: form.name, questions: form.questions, answers: {}, revision: form.revision } : null;
    return <div className="member-form-dialog community-welcome-form">
      {request ? <MemberFormRunner key={`${request.id}:${run}`} preview={request} requestId={request.id} communityId=""
        session={null as never} ensureSession={async () => null} onClose={advance} />
        : <p className="welcome-settings-preview-lesson" role="status">{props.formRows ? `The form “${form?.name ?? "Form"}” shows here once it has a question.` : "Loading the form…"}</p>}
    </div>;
  };
  return <div className="welcome-settings-preview-overlay" role="dialog" aria-modal="true" aria-label="Welcome page preview"
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
      if (event.key !== "Tab") return;
      // Tab stays inside the preview while it's open.
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], iframe, [tabindex=\"0\"]")];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="welcome-settings-preview-panel">
      <div className="welcome-settings-preview-bar">
        <h2>Preview</h2>
        <span className="welcome-settings-preview-where">{finished ? "Done" : `Screen ${index + 1} of ${screens.length}`}</span>
        <div className="welcome-settings-device" role="group" aria-label="Preview size">
          <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={15} aria-hidden="true" /> Desktop</button>
          <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")}><Smartphone size={15} aria-hidden="true" /> Phone</button>
        </div>
        <button type="button" className="workflow-secondary-button" onClick={() => { setIndex(0); setRun((n) => n + 1); }}><RotateCcw size={14} aria-hidden="true" /> Start over</button>
        <button type="button" ref={close} className="welcome-settings-icon-button" aria-label="Close preview" onClick={props.onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <p className="welcome-settings-help">Click through it as a new member would. Answers aren't saved.</p>
      <div className="welcome-settings-preview-scroll">
        <ScaledPreview width={device === "desktop" ? 960 : 390}>
          <section className="community-welcome community-welcome-preview" aria-label="What a new member sees">
            {finished ? <div className="community-welcome-intro"><small>Welcome</small><h1 tabIndex={-1} aria-level={3}>{props.title}</h1>
              <p className="community-welcome-done">That was the last step. The community opens for the member now.</p></div>
              : <WelcomeScreenView key={`${index}:${run}`} title={props.title} screens={screens} index={index} renderStep={renderStep} onNext={advance} headingLevel={3} />}
          </section>
        </ScaledPreview>
      </div>
    </div>
  </div>;
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
