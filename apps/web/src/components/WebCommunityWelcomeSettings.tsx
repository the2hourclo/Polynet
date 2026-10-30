import { BookOpen, ChevronDown, Sparkles, ChevronUp, CircleHelp, ClipboardList, Eye, GripVertical, Image as ImageIcon, LayoutGrid, Maximize2, Merge, Monitor, PanelTop, Plus, RotateCcw, Smartphone, SplitSquareVertical, Trash2, Type, X } from "lucide-react";
import {
  Fragment, lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type DragEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type TextareaHTMLAttributes,
} from "react";
import type { CloudCommunityMemberWorkflowBoard, CloudCommunityWelcomePageDraft } from "../../../../shared/cloudCommunityMemberWorkflowsGateway";
import {
  WELCOME_BLOCKS_MAX, WELCOME_CHOICE_HINT_MAX, WELCOME_CHOICE_LABEL_MAX, WELCOME_CHOICE_OPTIONS_MAX, WELCOME_CHOICE_PROMPT_MAX,
  WELCOME_CHOICE_TEXT_MAX, WELCOME_CHOICES_MAX, WELCOME_FORMS_MAX, WELCOME_LESSONS_MAX, WELCOME_PERSONAL_BACKUP_MAX, WELCOME_PERSONAL_GOAL_MAX,
  WELCOME_PERSONAL_MAX, WELCOME_PERSONAL_QUESTIONS_MAX, WELCOME_TEXT_MAX, welcomeLayoutIssue,
  legacyWelcomeLayout, normalizeWelcomeLayout, welcomeFormPartPlace, welcomeFormPartQuestions, welcomeLayoutSteps, welcomeLayoutWithForms, welcomeScreens,
  type WelcomeBlock, type WelcomeChoiceOption, type WelcomeStep,
} from "../../../../shared/communityWelcomeLayout";
import { CONTENT_MARKDOWN_OPTIONS, CONTENT_PROSE_CLASS, renderMarkdown } from "../../../../shared/markdownUi";
import type { WelcomeLessonOption } from "../controllers/useWebCommunityWorkflowsController";
import type { CommunityFormsGateway } from "../controllers/useWebCommunityFormsGateway";
import { blankCommunityFormQuestion, communityFormValidationIssue, COMMUNITY_FORM_MAX_QUESTIONS, type CommunityFormDraft, type CommunityFormQuestion } from "../../../../shared/communityForms";
import { MemberFormRunner } from "./WebCommunityNextStep";
import { WelcomeFormPage } from "./WelcomeFormPage";
import { WelcomePersonalPage } from "./WelcomePersonalPage";
import type { WelcomePersonalQuestions } from "../../../../shared/cloudCommunityWelcomePersonalGateway";
import { welcomeAnswerWords, welcomePersonalBackup, type WelcomePersonalAnswer } from "../../../../shared/communityWelcomePersonal";
import { ChoiceIconMark, WelcomeScreenView, welcomeMediaMarkdown } from "./WebCommunityWelcome";
import "./WebCommunityWelcomeSettings.css";
import type { LessonEditorProps } from "./lessonEditor/LessonEditor";

// The same editor as lessons (Rashid, 2026-10-27: the welcome page's editing
// should be "the same exact idea" as Knowledge), loaded when a block is opened.
const LessonEditor = lazy(() => import("./lessonEditor/LessonEditor"));

const TITLE_MAX = 120;

type Props = {
  board: CloudCommunityMemberWorkflowBoard | null;
  communityName: string | null;
  forms?: CommunityFormsGateway;
  isSaving: boolean;
  actionError: string | null;
  onSetWelcomeGate?: (enabled: boolean) => Promise<boolean>;
  onSetWelcomeDisplay?: (display: "page" | "popup") => Promise<boolean>;
  onSaveWelcomePage?: (page: CloudCommunityWelcomePageDraft) => Promise<boolean>;
  onLoadWelcomeLessonOptions?: () => Promise<WelcomeLessonOption[]>;
  onOpenWorkflows: () => void;
  /** Asked before leaving this tab, so unsaved words aren't lost silently. */
  leaveGuard: MutableRefObject<(() => Promise<boolean>) | null>;
};

type EditorBlock = WelcomeBlock & { uid: string };
/** The questions of each form on the page, written here; Publish saves and publishes the ones that changed. */
type FormContent = { name: string; questions: CommunityFormQuestion[] };
type Draft = { title: string; layout: EditorBlock[]; forms: Record<string, FormContent> };
type FormPart = Extract<WelcomeBlock, { type: "form" }>;
let nextUid = 0;
const withUid = (block: WelcomeBlock): EditorBlock => ({ ...block, uid: `b${++nextUid}` });
const stripUid = ({ uid: _uid, ...block }: EditorBlock): WelcomeBlock => block as WelcomeBlock;
const isStep = (block: WelcomeBlock) => block.type === "form" || block.type === "lesson" || block.type === "personal";
const PERSONAL_BACKUP = "What would make joining worth it for you?";
const newPersonal = (): WelcomeBlock => ({ type: "personal", key: `personal-${crypto.randomUUID().slice(0, 8)}`, goal: "", count: 3, backup: PERSONAL_BACKUP });
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

/** Opens every form on the page as questions written in place: a form placed
 * whole (one question at a time) becomes a page per question, which is how
 * members already go through it, and a split form's last part takes any
 * question added in Forms since. */
function splitForms(layout: WelcomeBlock[], rows: Map<string, CommunityFormDraft> | null): WelcomeBlock[] {
  if (!rows) return layout;
  const out: WelcomeBlock[] = [];
  for (const block of layout) {
    const row = block.type === "form" ? rows.get(block.formKey) : undefined;
    if (block.type === "form" && !block.questions && row?.questions.length) {
      row.questions.forEach((question, index) => {
        if (index) out.push({ type: "next" });
        out.push({ type: "form", formKey: block.formKey, questions: [question.key] });
      });
    } else out.push(block.type === "form" && block.questions ? { ...block, questions: [...block.questions] } : block);
  }
  for (const [formKey, row] of rows) {
    const parts = out.filter((block): block is FormPart => block.type === "form" && block.formKey === formKey && Boolean(block.questions));
    if (!parts.length) continue;
    const keys = new Set(row.questions.map((question) => question.key));
    for (const part of parts) part.questions = part.questions!.filter((key) => keys.has(key));
    const placed = new Set(parts.flatMap((part) => part.questions!));
    parts[parts.length - 1].questions!.push(...row.questions.filter((question) => !placed.has(question.key)).map((question) => question.key));
  }
  return out.filter((block) => block.type !== "form" || !block.questions || block.questions.length);
}

/** Two parts of one form with nothing between them are one part. */
function joinParts<T extends WelcomeBlock>(layout: T[]): T[] {
  const out: T[] = [];
  for (const block of layout) {
    const last = out[out.length - 1];
    if (block.type === "form" && block.questions && last?.type === "form" && last.questions && last.formKey === block.formKey) {
      out[out.length - 1] = { ...last, questions: [...last.questions, ...block.questions] };
    } else out.push(block);
  }
  return out;
}

/** A form's questions in the order the page shows them. */
function pageOrder(layout: WelcomeBlock[], formKey: string, content: FormContent): CommunityFormQuestion[] {
  const keys = layout.flatMap((block) => (block.type === "form" && block.formKey === formKey ? block.questions ?? [] : []));
  const byKey = new Map(content.questions.map((question) => [question.key, question]));
  const ordered = keys.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  return [...ordered, ...content.questions.filter((question) => !keys.includes(question.key))];
}

const formContent = (row: CommunityFormDraft): FormContent => ({ name: row.name, questions: row.questions });

const QUESTION_TYPES: { type: CommunityFormQuestion["type"]; label: string; hint: string }[] = [
  { type: "short_text", label: "Short answer", hint: "A line of text" },
  { type: "long_text", label: "Long answer", hint: "A few sentences" },
  { type: "single_choice", label: "One choice", hint: "They pick one option" },
  { type: "multiple_choice", label: "Several choices", hint: "They tick all that fit" },
];
const blankQuestion = (type: CommunityFormQuestion["type"]): CommunityFormQuestion =>
  ({ ...blankCommunityFormQuestion(), type, options: type.endsWith("choice") ? ["Option 1", "Option 2"] : [] });

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

const draftKey = (title: string, layout: WelcomeBlock[], forms: Record<string, FormContent>) => {
  const normal = normalizeWelcomeLayout(layout);
  const placed = welcomeLayoutSteps(normal).formKeys.flatMap((key) => (forms[key] ? [[key, { ...forms[key], questions: pageOrder(normal, key, forms[key]) }]] : []));
  return JSON.stringify({ title: title.replace(/\s+/g, " ").trim(), layout: normal, forms: Object.fromEntries(placed) });
};

// "replace" swaps the "/" line typed in a text block (the whole block when that's all it holds) for the new blocks.
type MenuTarget = { uid: string; mode: "after" } | { uid: string; mode: "replace"; start: number; end: number } | { uid: null; mode: "end" };
type MenuView = "root" | "form" | "lesson" | "link" | "question";
type MenuItem = { key: string; label: string; hint: string; icon: ReactNode };

// The welcome page, written like a page: the headline, then blocks of words,
// videos, forms and lessons, split into screens by "Next" breaks. Members go
// through it one screen at a time; Preview plays it the same way.
export function WebCommunityWelcomeSettings(props: Props) {
  const id = useId();
  const [formRows, setFormRows] = useState<Map<string, CommunityFormDraft> | null>(null);
  useEffect(() => {
    let alive = true;
    if (!props.forms) { setFormRows(new Map()); return; }
    props.forms.load().then((rows) => { if (alive) setFormRows(new Map(rows.map((row) => [row.key, row]))); })
      .catch(() => { if (alive) setFormRows(new Map()); });
    return () => { alive = false; };
  }, [props.forms]);
  // Questions are written on the page only where the forms can be saved from here.
  const canWriteQuestions = Boolean(props.forms);
  const baseline = useMemo<Draft>(() => {
    const layout = canWriteQuestions ? splitForms(savedLayout(props.board), formRows) : savedLayout(props.board);
    return {
      title: props.board?.welcome_page?.title ?? "", layout: withBreaks(layout).map(withUid),
      forms: Object.fromEntries([...(formRows?.values() ?? [])].map((row) => [row.key, formContent(row)])),
    };
  }, [props.board, formRows, canWriteQuestions]);
  const baselineKey = draftKey(baseline.title, baseline.layout.map(stripUid), baseline.forms);
  const [draft, setDraft] = useState<Draft>(baseline);
  const [draftBase, setDraftBase] = useState(baselineKey);
  const [saved, setSaved] = useState(false);
  const adoptNext = useRef(false);
  const currentKey = draftKey(draft.title, draft.layout.map(stripUid), draft.forms);
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
  const lessonById = useMemo(() => new Map((options ?? []).map((option) => [option.id, option])), [options]);

  // Read out after a keyboard move; any other edit clears it.
  const [moveNote, setMoveNote] = useState("");
  const setLayout = (update: (layout: EditorBlock[]) => EditorBlock[]) => {
    setSaved(false);
    setMoveNote("");
    setDraft((current) => ({ ...current, layout: withBreaks(joinParts(update(current.layout)), withUid) }));
  };
  const [editing, setEditing] = useState<string | null>(null);
  const focusBlock = (uid: string) => requestAnimationFrame(() => document.getElementById(`${id}-block-${uid}`)?.focus());
  const editText = (uid: string) => { setEditing(uid); focusBlock(uid); };

  // The block menu: opened by typing "/" on an empty line, by a block's +, or by "Add a block".
  const [menu, setMenu] = useState<{ target: MenuTarget; view: MenuView; filter: string; active: number } | null>(null);
  const [link, setLink] = useState("");
  const placed = useMemo(() => welcomeLayoutSteps(draft.layout), [draft.layout]);
  const publishedForms = useMemo(() => [...(formRows?.values() ?? [])].filter((row) => row.publishedRevision !== null), [formRows]);
  const personalCount = draft.layout.filter((block) => block.type === "personal").length;
  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu || menu.view === "link") return [];
    if (menu.view === "form") return publishedForms.filter((row) => !placed.formKeys.includes(row.key))
      .map((row) => ({ key: `form:${row.key}`, label: row.name || "Untitled form",
        hint: `${row.questions.length} question${row.questions.length === 1 ? "" : "s"}`, icon: <ClipboardList size={16} aria-hidden="true" /> }));
    if (menu.view === "question") return QUESTION_TYPES.map((item) => ({ key: `question:${item.type}`, label: item.label, hint: item.hint,
      icon: <CircleHelp size={16} aria-hidden="true" /> }));
    if (menu.view === "lesson") return (options ?? []).filter((row) => !placed.lessonIds.includes(row.id))
      .map((row) => ({ key: `lesson:${row.id}`, label: row.title, hint: row.course, icon: <BookOpen size={16} aria-hidden="true" /> }));
    const filter = menu.filter.toLowerCase();
    return [
      { key: "text", label: "Text", hint: "Words, lists and links", icon: <Type size={16} aria-hidden="true" /> },
      ...(canWriteQuestions ? [{ key: "question", label: "Question", hint: "Ask it right here. Questions on one page show together", icon: <CircleHelp size={16} aria-hidden="true" /> }] : []),
      ...(draft.layout.filter((block) => block.type === "choice").length < WELCOME_CHOICES_MAX
        ? [{ key: "choice", label: "Choice", hint: "Cards to pick from, like the app they use. Each shows its own steps", icon: <LayoutGrid size={16} aria-hidden="true" /> }] : []),
      { key: "link", label: "Video or image", hint: "A YouTube, Loom, Vimeo, Wistia or image link", icon: <ImageIcon size={16} aria-hidden="true" /> },
      ...(placed.formKeys.length < WELCOME_FORMS_MAX ? [{ key: "form", label: "Form", hint: "Questions every new member answers", icon: <ClipboardList size={16} aria-hidden="true" /> }] : []),
      ...(placed.lessonIds.length < WELCOME_LESSONS_MAX ? [{ key: "lesson", label: "Lesson", hint: "A lesson they read and mark done", icon: <BookOpen size={16} aria-hidden="true" /> }] : []),
      ...(personalCount < WELCOME_PERSONAL_MAX ? [{ key: "personal", label: "Personalized questions", hint: "Give a goal; your agent asks each member, one question at a time", icon: <Sparkles size={16} aria-hidden="true" /> }] : []),
      { key: "next", label: "Page break", hint: "Start a new page here", icon: <SplitSquareVertical size={16} aria-hidden="true" /> },
    ].filter((item) => item.label.toLowerCase().includes(filter));
  }, [menu, publishedForms, options, placed, draft.layout, canWriteQuestions, personalCount]);
  const full = draft.layout.length >= WELCOME_BLOCKS_MAX;
  const openMenu = (target: MenuTarget, view: MenuView = "root", filter = "") => { setLink(""); setMenu({ target, view, filter, active: 0 }); };
  const closeMenu = () => {
    const target = menu?.target;
    setMenu(null);
    if (target?.uid) focusBlock(target.uid); else document.getElementById(`${id}-add`)?.focus();
  };
  const insert = (blocks: WelcomeBlock[]) => { if (menu) insertAt(menu.target, blocks); };
  const insertAt = (target: MenuTarget, blocks: WelcomeBlock[]) => {
    const added = blocks.map(withUid);
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
  // Questions written on the page. A new one joins the nearest form above it
  // (its answers land in the same form); with none above, the page gets a form of its own.
  const [focusQuestion, setFocusQuestion] = useState<string | null>(null);
  const setForm = (formKey: string, update: (content: FormContent) => FormContent) => {
    setSaved(false);
    setDraft((current) => current.forms[formKey] ? { ...current, forms: { ...current.forms, [formKey]: update(current.forms[formKey]) } } : current);
  };
  const addQuestion = (target: MenuTarget, type: CommunityFormQuestion["type"]) => {
    const question = blankQuestion(type);
    const at = target.uid ? draft.layout.findIndex((block) => block.uid === target.uid) : draft.layout.length - 1;
    const here = draft.layout[at];
    const above = [...draft.layout.slice(0, at + 1)].reverse().find((block): block is EditorBlock & FormPart => block.type === "form" && Boolean(block.questions));
    let formKey = above?.formKey;
    if (formKey && (draft.forms[formKey]?.questions.length ?? 0) >= COMMUNITY_FORM_MAX_QUESTIONS) formKey = undefined;
    if (!formKey && placed.formKeys.length >= WELCOME_FORMS_MAX) { setMenu(null); return; }
    const newForm = !formKey;
    const key = formKey ?? `welcome-${crypto.randomUUID().slice(0, 8)}`;
    setSaved(false);
    setDraft((current) => ({ ...current, forms: { ...current.forms,
      [key]: newForm ? { name: "Welcome questions", questions: [question] } : { ...current.forms[key], questions: [...current.forms[key].questions, question] } } }));
    if (here?.type === "form" && here.formKey === key && here.questions) {
      setLayout((layout) => layout.map((block) => (block.uid === here.uid && block.type === "form" ? { ...block, questions: [...(block.questions ?? []), question.key] } : block)));
      setMenu(null);
    } else insertAt(target, [{ type: "form", formKey: key, questions: [question.key] }]);
    setFocusQuestion(question.key);
  };
  const updateQuestion = (formKey: string, questionKey: string, patch: Partial<CommunityFormQuestion>) =>
    setForm(formKey, (content) => ({ ...content, questions: content.questions.map((question) => (question.key === questionKey ? { ...question, ...patch } : question)) }));
  const removeQuestion = (uid: string, formKey: string, questionKey: string) => {
    setForm(formKey, (content) => ({ ...content, questions: content.questions.filter((question) => question.key !== questionKey) }));
    setLayout((layout) => layout.flatMap((block) => {
      if (block.uid !== uid || block.type !== "form") return [block];
      const questions = (block.questions ?? []).filter((key) => key !== questionKey);
      return questions.length ? [{ ...block, questions }] : [];
    }));
  };
  const moveQuestion = (uid: string, from: number, to: number) => setLayout((layout) => layout.map((block) => {
    if (block.uid !== uid || block.type !== "form" || !block.questions || to < 0 || to >= block.questions.length) return block;
    const questions = [...block.questions];
    const [moved] = questions.splice(from, 1);
    questions.splice(to, 0, moved);
    return { ...block, questions };
  }));
  // A page break anywhere: between two blocks, or between two questions of a form.
  const splitPart = (uid: string, at: number) => setLayout((layout) => layout.flatMap((block) => {
    if (block.uid !== uid || block.type !== "form" || !block.questions) return [block];
    return [{ ...block, questions: block.questions.slice(0, at) }, withUid({ type: "next" }), withUid({ type: "form", formKey: block.formKey, questions: block.questions.slice(at) })];
  }));
  // Joining takes the break out; two parts of one form that meet become one page of questions.
  const joinPages = (uid: string) => {
    const at = draft.layout.findIndex((block) => block.uid === uid);
    const before = draft.layout[at - 1];
    setLayout((layout) => layout.filter((block) => block.uid !== uid));
    if (before) focusBlock(before.uid);
  };
  const splitAfter = (uid: string) => setLayout((layout) => layout.flatMap((block) => (block.uid === uid ? [block, withUid({ type: "next" })] : [block])));

  const choose = (key: string) => {
    if (!menu) return;
    if (key === "form" || key === "lesson" || key === "link" || key === "question") { setLink(""); setMenu({ ...menu, view: key, filter: "", active: 0 }); return; }
    if (key.startsWith("question:")) { addQuestion(menu.target, key.slice(9) as CommunityFormQuestion["type"]); return; }
    if (key === "text") return insert([{ type: "text", markdown: "" }]);
    if (key === "choice") return insert([{ type: "choice", prompt: "Which one are you using?", options: [
      { label: "Option 1", hint: "", markdown: "" }, { label: "Option 2", hint: "", markdown: "" },
    ] }]);
    if (key === "next") return insert([{ type: "next" }, { type: "text", markdown: "" }]);
    if (key === "personal") return insert([newPersonal()]);
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

  const setText = (uid: string, markdown: string) =>
    setLayout((layout) => layout.map((block) => (block.uid === uid ? { ...block, markdown } : block)));

  // The page's own blocks, offered in the text editor's "/" menu: they go in
  // after the block being written.
  const pageBlocks = (uid: string): LessonEditorProps["pageBlocks"] => full ? undefined : {
    label: "Welcome page",
    items: [
      ...(draft.layout.filter((block) => block.type === "choice").length < WELCOME_CHOICES_MAX
        ? [{ key: "choice", title: "Choice", hint: "Cards to pick from, each with its own steps", keywords: "choice cards app pick", icon: <LayoutGrid />,
          onPick: () => insertAt({ uid, mode: "after" }, [{ type: "choice", prompt: "Which one are you using?", options: [
            { label: "Option 1", hint: "", markdown: "" }, { label: "Option 2", hint: "", markdown: "" }] }]) }] : []),
      ...(placed.formKeys.length < WELCOME_FORMS_MAX ? [{ key: "form", title: "Form", hint: "Questions every new member answers", keywords: "form questions",
        icon: <ClipboardList />, onPick: () => { setEditing(null); openMenu({ uid, mode: "after" }, "form"); } }] : []),
      ...(placed.lessonIds.length < WELCOME_LESSONS_MAX ? [{ key: "lesson", title: "Lesson", hint: "A lesson they read and mark done", keywords: "lesson course",
        icon: <BookOpen />, onPick: () => { setEditing(null); openMenu({ uid, mode: "after" }, "lesson"); } }] : []),
      ...(canWriteQuestions ? [{ key: "question", title: "Question", hint: "Ask it right here, on this page", keywords: "question ask form answer",
        icon: <CircleHelp />, onPick: () => { setEditing(null); openMenu({ uid, mode: "after" }, "question"); } }] : []),
      ...(personalCount < WELCOME_PERSONAL_MAX ? [{ key: "personal", title: "Personalized questions", hint: "Your agent asks each member from a goal", keywords: "personal personalized agent ai goal adaptive questions",
        icon: <Sparkles />, onPick: () => insertAt({ uid, mode: "after" }, [newPersonal()]) }] : []),
      { key: "next", title: "Page break", hint: "Start a new page here", keywords: "next page break screen split", icon: <SplitSquareVertical />,
        onPick: () => insertAt({ uid, mode: "after" }, [{ type: "next" }, { type: "text", markdown: "" }]) },
    ],
  };
  const updateChoice = (uid: string, update: (block: Extract<WelcomeBlock, { type: "choice" }>) => Extract<WelcomeBlock, { type: "choice" }>) =>
    setLayout((layout) => layout.map((block) => (block.uid === uid && block.type === "choice" ? { ...update(block), uid } : block)));
  const remove = (uid: string) => {
    const at = draft.layout.findIndex((block) => block.uid === uid);
    const neighbour = draft.layout[at - 1] ?? draft.layout[at + 1];
    setLayout((layout) => layout.filter((block) => block.uid !== uid));
    if (neighbour?.type === "text") editText(neighbour.uid);
    else if (neighbour) focusBlock(neighbour.uid);
    else requestAnimationFrame(() => document.getElementById(`${id}-add`)?.focus());
  };
  // A group of questions leaves the page with its questions, which come out of the form too.
  const removePart = (uid: string, formKey: string, questionKeys: string[]) => {
    setForm(formKey, (content) => ({ ...content, questions: content.questions.filter((question) => !questionKeys.includes(question.key)) }));
    remove(uid);
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

  // Publish: first the forms whose questions changed here (saved, then
  // published, so members get them), then the page that places them.
  const [formError, setFormError] = useState<string | null>(null);
  const [publishingForms, setPublishingForms] = useState(false);
  const publishForms = async (layout: WelcomeBlock[]): Promise<boolean> => {
    if (!props.forms) return true;
    const rows = new Map(formRows ?? []);
    for (const formKey of welcomeLayoutSteps(layout).formKeys) {
      const edited = draft.forms[formKey];
      if (!edited || !layout.some((block) => block.type === "form" && block.formKey === formKey && block.questions)) continue;
      const content = { name: edited.name.trim() || "Welcome questions", questions: pageOrder(layout, formKey, edited) };
      const row = rows.get(formKey);
      if (row && row.publishedRevision === row.revision && JSON.stringify(formContent(row)) === JSON.stringify(content)) continue;
      const issue = communityFormValidationIssue(content, true);
      if (issue) {
        const question = issue.questionIndex !== undefined ? content.questions[issue.questionIndex] : null;
        setFormError(question ? `${question.title.trim() ? `“${question.title.trim()}”` : "A question"}: ${issue.message}` : issue.message);
        if (question) setFocusQuestion(question.key);
        return false;
      }
      try {
        const savedRow = await props.forms.save({ ...(row ?? { key: formKey, revision: 0, publishedRevision: null }), ...content });
        rows.set(formKey, await props.forms.publish(savedRow));
      } catch (error) {
        setFormError(String(error).includes("conflict")
          ? `“${content.name}” was changed somewhere else (in Forms or by an agent). Discard to load the latest, then make your change again.`
          : `“${content.name}” could not be published. Nothing on the page changed. Try again.`);
        setFormRows(rows);
        return false;
      }
    }
    setFormRows(rows);
    return true;
  };
  const save = async () => {
    if (!props.onSaveWelcomePage) return;
    setFormError(null);
    const layout = normalizeWelcomeLayout(draft.layout.map(stripUid));
    const personalIssue = personalProblem(layout);
    if (personalIssue) { setFormError(personalIssue); return; }
    setPublishingForms(true);
    const formsOk = await publishForms(layout).finally(() => setPublishingForms(false));
    if (!formsOk) return;
    adoptNext.current = true;
    const ok = await props.onSaveWelcomePage({ title: draft.title, message: "", mediaUrl: "", lessonIds: welcomeLayoutSteps(layout).lessonIds, layout });
    if (!ok) adoptNext.current = false;
    setSaved(ok);
  };

  const gateOn = props.board?.welcome_gate === true;
  const display = props.board?.welcome_display === "popup" ? "popup" : "page";
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
        <div className="welcome-settings-column welcome-settings-bar-inner">
          <div className="welcome-settings-bar-title">
            <h1>Welcome page</h1>
            <p>What new members see first, one page at a time. Split a page anywhere.</p>
          </div>
          {/* Saving goes straight to members, so it reads as Publish, like Forms
              and the sales page (2026-10-28 review #13). */}
          <div className="welcome-settings-bar-actions">
            <small role="status" className="welcome-settings-saved">{moveNote || (dirty ? "Draft changes" : saved ? "Published" : "")}</small>
            <button type="button" ref={previewButton} className="workflow-secondary-button" disabled={!screenCount} onClick={() => { setMenu(null); setPreviewing(true); }}>
              <Eye size={15} aria-hidden="true" /> Preview
            </button>
            <button type="button" className="workflow-secondary-button" disabled={!dirty || props.isSaving}
              onClick={() => { setSaved(false); setMenu(null); setEditing(null); setDraft(baseline); setDraftBase(baselineKey); }}>Discard</button>
            <button type="button" className={`platform-save-button${dirty ? " is-dirty" : ""}`} disabled={!dirty || props.isSaving || publishingForms || !props.onSaveWelcomePage}
              onClick={() => void save()}>{props.isSaving || publishingForms ? "Publishing…" : "Publish"}</button>
          </div>
        </div>
      </header>

      <section className="welcome-settings-column welcome-settings-options" aria-label="Who sees it, and how">
        <label className="welcome-settings-switch welcome-settings-option">
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
        <div className="welcome-settings-option">
          <span>
            <strong id={`${id}-display-label`}>Show it as</strong>
            <small id={`${id}-display-help`}>{display === "popup"
              ? "A pop-up over the community. Members can finish later."
              : "A full page. Members see only this until its steps are done."}</small>
          </span>
          <div className="welcome-settings-display" role="radiogroup" aria-labelledby={`${id}-display-label`} aria-describedby={`${id}-display-help`}>
            {([["page", "Full page", <Maximize2 key="i" size={14} aria-hidden="true" />], ["popup", "Pop-up", <PanelTop key="i" size={14} aria-hidden="true" />]] as const).map(([value, label, icon]) => (
              <button key={value} type="button" role="radio" aria-checked={display === value} disabled={props.isSaving || !props.onSetWelcomeDisplay}
                onClick={() => { if (display !== value) void props.onSetWelcomeDisplay?.(value); }}>{icon} {label}</button>
            ))}
          </div>
        </div>
      </section>
      {formError ?? props.actionError ? <p className="workflow-error welcome-settings-error" role="alert">{formError ?? props.actionError}</p> : null}

      <div className="welcome-settings-canvas">
        <article className="community-welcome welcome-settings-page" aria-label="Welcome page editor">
          {draft.layout.some((block) => block.type === "next")
            ? <div className="welcome-settings-break welcome-settings-break-first" aria-hidden="true"><span>Page 1</span></div> : null}
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
              const label = block.type === "text" ? "text" : block.type === "next" ? "page break" : block.type === "form" && block.questions ? "group of questions" : block.type;
              const following = draft.layout[index + 1];
              // A break can go after any block that isn't already followed by one.
              const canSplit = block.type !== "next" && following !== undefined && following.type !== "next";
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
                      editing === block.uid ? (
                        <div id={`${id}-block-${block.uid}`} className="welcome-settings-text-editor" tabIndex={-1}>
                          <Suspense fallback={<TextView id={`${id}-block-${block.uid}-loading`} markdown={block.markdown} onEdit={() => undefined} />}>
                          <LessonEditor key={block.uid} initialMarkdown={block.markdown} autoFocus followAlong={false}
                            onChange={(markdown: string) => setText(block.uid, markdown.slice(0, WELCOME_TEXT_MAX))}
                            onUploadImage={null}
                            onDone={() => { setEditing(null); focusBlock(block.uid); }} onSaveNow={() => undefined}
                            pageBlocks={pageBlocks(block.uid)} />
                          </Suspense>
                          <button type="button" className="welcome-settings-text-done" onClick={() => { setEditing(null); focusBlock(block.uid); }}>Done</button>
                        </div>
                      ) : block.markdown.trim()
                        ? <TextView id={`${id}-block-${block.uid}`} markdown={block.markdown} onEdit={() => editText(block.uid)} />
                        : <button type="button" id={`${id}-block-${block.uid}`} className="welcome-settings-text-empty" onClick={() => editText(block.uid)}
                          onKeyDown={(event) => { if (event.key === "Backspace" && draft.layout.length > 1) { event.preventDefault(); remove(block.uid); } }}>
                          {draft.layout.length === 1 ? "Say hello. Type / for headings, callouts, code, a question, a choice, a lesson or a page break." : "Type / to add a block"}
                        </button>
                    ) : block.type === "choice" ? (
                      <ChoiceEditor id={`${id}-block-${block.uid}`} prompt={block.prompt} options={block.options} agent={Boolean(block.agent)}
                        onAgent={(agent) => updateChoice(block.uid, (current) => ({ ...current, agent: agent || undefined }))}
                        onChange={(prompt, choiceOptions) => updateChoice(block.uid, (current) => ({ ...current, prompt, options: choiceOptions }))} />
                    ) : block.type === "next" ? (
                      <div id={`${id}-block-${block.uid}`} tabIndex={-1} className="welcome-settings-break" aria-label={`Page break: page ${screenNumber} starts here`}>
                        <span>Page {screenNumber}</span>
                        <button type="button" className="welcome-settings-join" onClick={() => joinPages(block.uid)}>
                          <Merge size={13} aria-hidden="true" /> Join with page {screenNumber - 1}
                        </button>
                      </div>
                    ) : block.type === "form" && block.questions && draft.forms[block.formKey] ? (
                      <FormPartEditor id={`${id}-block-${block.uid}`} formKey={block.formKey} questionKeys={block.questions}
                        content={draft.forms[block.formKey]} part={welcomeFormPartPlace(plain, block)}
                        usedElsewhere={Boolean(formRows?.get(block.formKey)?.usedIn?.some((use) => use.kind === "automation"))}
                        isNew={!formRows?.has(block.formKey)} focusQuestion={focusQuestion} onFocused={() => setFocusQuestion(null)}
                        onRename={(name) => setForm(block.formKey, (content) => ({ ...content, name }))}
                        onChange={(questionKey, patch) => updateQuestion(block.formKey, questionKey, patch)}
                        onRemove={(questionKey) => removeQuestion(block.uid, block.formKey, questionKey)}
                        onMove={(from, to) => moveQuestion(block.uid, from, to)}
                        onSplit={(at) => splitPart(block.uid, at)}
                        onAdd={(type) => addQuestion({ uid: block.uid, mode: "after" }, type)} />
                    ) : block.type === "form" ? (
                      <StepCard id={`${id}-block-${block.uid}`} kind="Form" icon={<ClipboardList size={18} aria-hidden="true" />}
                        title={formRows?.get(block.formKey)?.name || (formRows ? "This form was removed" : "Loading…")}
                        unavailable={Boolean(formRows) && !formRows?.get(block.formKey)?.publishedRevision}
                        detail={(formRows?.get(block.formKey)?.questions ?? []).slice(0, 3).map((question) => question.title).filter(Boolean)}
                        note="Every new member answers this when they join." />
                    ) : block.type === "personal" ? (
                      <PersonalEditor id={`${id}-block-${block.uid}`} goal={block.goal} count={block.count} backup={block.backup}
                        onChange={(patch) => setLayout((layout) => layout.map((item) => (item.uid === block.uid && item.type === "personal" ? { ...item, ...patch } : item)))}
                        onTry={props.forms?.previewPersonal} />
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
                    {block.type === "next" ? null : <button type="button" className="welcome-settings-icon-button" aria-label={`Remove this ${label}`} title="Remove"
                      onClick={() => (block.type === "form" && block.questions ? removePart(block.uid, block.formKey, block.questions) : remove(block.uid))}><Trash2 size={15} aria-hidden="true" /></button>}
                  </div>
                  {canSplit ? <button type="button" className="welcome-settings-split" onClick={() => splitAfter(block.uid)}
                    aria-label={`Split the page after this ${label}`}><SplitSquareVertical size={13} aria-hidden="true" /> Split page here</button> : null}
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
            Questions on one page show together; split a page wherever you want a new one. Their answers go to the form named above them, which is
            sent to every new member when they join. What happens after a form is set in{" "}
            <button type="button" className="welcome-settings-link" onClick={props.onOpenWorkflows}>Workflows</button>.
          </p>
        </article>
      </div>

      {previewing ? <WelcomePreview previewPersonal={props.forms?.previewPersonal} title={headline} layout={plain} formRows={previewForms(formRows, draft.forms, plain)} lessonById={lessonById}
        onClose={() => { setPreviewing(false); requestAnimationFrame(() => previewButton.current?.focus()); }} /> : null}
    </div>
  );
}

/** What stops personalized questions from going out, in the owner's words; null when they're ready. */
function personalProblem(layout: WelcomeBlock[]): string | null {
  const blocks = layout.filter((block) => block.type === "personal");
  if (blocks.some((block) => !block.goal.trim())) return "Personalized questions: give them a goal, so your agent knows what to find out.";
  if (blocks.some((block) => !block.backup.trim())) return "Personalized questions: add a backup question, asked when your agent can't answer in time.";
  const issue = welcomeLayoutIssue(layout);
  if (issue === "welcome_personal_too_many") return `A welcome page holds at most ${WELCOME_PERSONAL_MAX} personalized question blocks.`;
  if (issue === "welcome_personal_after_last_step") return "Personalized questions need a form or lesson after them; members go into the community right after the last one.";
  if (issue === "welcome_personal_invalid") return "Personalized questions: shorten the goal or the backup question.";
  return null;
}

// The owner gives a goal; the community's agent writes the questions for each
// member from what they've already answered. "Try it" shows what it would ask
// a member the owner describes.
function PersonalEditor(props: {
  id: string; goal: string; count: number; backup: string;
  onChange: (patch: { goal?: string; count?: number; backup?: string }) => void;
  onTry?: CommunityFormsGateway["previewPersonal"];
}) {
  const [persona, setPersona] = useState("");
  const [tried, setTried] = useState<{ titles: string[]; backup: boolean } | null>(null);
  const [trying, setTrying] = useState(false);
  const tryIt = async () => {
    if (!props.onTry || !props.goal.trim()) return;
    setTrying(true); setTried(null);
    try {
      const turn = await props.onTry({ goal: props.goal, count: props.count, persona: persona.trim(), asked: 0, answers: [] });
      setTried(turn.question ? { titles: [turn.question.title], backup: false } : { titles: [props.backup], backup: true });
    } catch { setTried({ titles: [props.backup], backup: true }); }
    finally { setTrying(false); }
  };
  return <div id={props.id} tabIndex={-1} className="welcome-settings-choice welcome-settings-personal">
    <div className="welcome-settings-choice-head">
      <span className="welcome-settings-step-icon"><Sparkles size={18} aria-hidden="true" /></span>
      <span className="welcome-settings-step-copy"><small>Personalized questions</small>
        <span className="welcome-settings-step-note">Your agent asks each member one question at a time, from the goal below and everything they've answered, and stops once it has what the goal needs.</span></span>
    </div>
    <label className="welcome-settings-choice-field">
      <span>Goal</span>
      <AutoSizeTextarea value={props.goal} maxLength={WELCOME_PERSONAL_GOAL_MAX} rows={2}
        placeholder="Find out what they want to automate first and what's stopping them"
        onChange={(goal) => props.onChange({ goal })} />
    </label>
    <div className="welcome-settings-personal-row">
      <div className="welcome-settings-choice-field" role="group" aria-label="At most this many questions">
        <span>Questions, at most</span>
        <div className="welcome-settings-device welcome-settings-personal-count">
          {Array.from({ length: WELCOME_PERSONAL_QUESTIONS_MAX }, (_, n) => n + 1).map((n) => (
            <button key={n} type="button" aria-pressed={props.count === n} onClick={() => props.onChange({ count: n })}>{n}</button>
          ))}
        </div>
      </div>
      <label className="welcome-settings-choice-field">
        <span>Backup question</span>
        <input value={props.backup} maxLength={WELCOME_PERSONAL_BACKUP_MAX} placeholder={PERSONAL_BACKUP} onChange={(event) => props.onChange({ backup: event.target.value })} />
        <small className="welcome-settings-step-note">Asked instead if your agent can't answer in time.</small>
      </label>
    </div>
    {props.onTry ? <div className="welcome-settings-personal-try">
      <label className="welcome-settings-choice-field">
        <span>Try it on a member</span>
        <input value={persona} maxLength={300} placeholder="A coach with 12 clients who does everything in email" onChange={(event) => setPersona(event.target.value)} />
      </label>
      <button type="button" className="workflow-secondary-button" disabled={trying || !props.goal.trim()} onClick={() => void tryIt()}>
        <Sparkles size={14} aria-hidden="true" /> {trying ? "Writing…" : "Try it"}</button>
      {tried ? <div className="welcome-settings-personal-tried" role="status">
        <small>{tried.backup ? "Your agent didn't answer in time, so this member would get the backup:" : "Your agent would start with this, then ask more from their answer:"}</small>
        <ol>{tried.titles.map((title, n) => <li key={n}>{title}</li>)}</ol>
      </div> : null}
    </div> : null}
  </div>;
}

function AutoSizeTextarea(props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string; onChange: (value: string) => void; inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const { onChange, value, inputRef, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
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
  return <textarea ref={(element) => { ref.current = element; if (inputRef) inputRef.current = element; }} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />;
}

// Words show as the member reads them (videos play inline); a click puts the cursor back in.
function TextView(props: { id: string; markdown: string; onEdit: () => void }) {
  const rendered = useMemo(() => renderMarkdown(props.markdown, CONTENT_MARKDOWN_OPTIONS), [props.markdown]);
  return <div id={props.id} className={`community-welcome-message welcome-settings-text-view ${CONTENT_PROSE_CLASS}`} tabIndex={0} role="group" aria-label="Text. Press Enter to edit."
    onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button, iframe, video")) props.onEdit(); }}
    onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); props.onEdit(); } }}>{rendered}</div>;
}

// A choice as the owner writes it: the question, a tab per card, and the
// picked card's name, one-line hint and steps (markdown, like a text block).
function ChoiceEditor(props: {
  id: string; prompt: string; options: WelcomeChoiceOption[]; agent: boolean;
  onChange: (prompt: string, options: WelcomeChoiceOption[]) => void; onAgent: (agent: boolean) => void;
}) {
  const [active, setActive] = useState(0);
  const [editingSteps, setEditingSteps] = useState<number | null>(null);
  const at = Math.min(active, props.options.length - 1);
  const option = props.options[at];
  const setOption = (patch: Partial<WelcomeChoiceOption>) =>
    props.onChange(props.prompt, props.options.map((item, index) => (index === at ? { ...item, ...patch } : item)));
  const add = () => {
    props.onChange(props.prompt, [...props.options, { label: `Option ${props.options.length + 1}`, hint: "", markdown: "" }]);
    setActive(props.options.length);
  };
  const removeOption = () => {
    if (props.options.length <= 1) return;
    props.onChange(props.prompt, props.options.filter((_, index) => index !== at));
    setActive(Math.max(0, at - 1));
  };
  return <div id={props.id} tabIndex={-1} className="welcome-settings-choice">
    <div className="welcome-settings-choice-head">
      <span className="welcome-settings-step-icon"><LayoutGrid size={18} aria-hidden="true" /></span>
      <span className="welcome-settings-step-copy"><small>Choice</small><span className="welcome-settings-step-note">Members pick one card and see only its steps. The first card shows until they pick another.</span></span>
    </div>
    <label className="welcome-settings-choice-field">
      <span>Question</span>
      <input value={props.prompt} maxLength={WELCOME_CHOICE_PROMPT_MAX} placeholder="Which app do you use?" onChange={(event) => props.onChange(event.target.value, props.options)} />
    </label>
    <label className="welcome-settings-choice-agent">
      <input type="checkbox" checked={props.agent} onChange={(event) => props.onAgent(event.target.checked)} />
      <span><strong>Show your agent as the plugin</strong><small>Its photo and name sit above the cards, connected to the app the member picks.</small></span>
    </label>
    <div className="welcome-settings-choice-tabs" role="tablist" aria-label="Cards">
      {props.options.map((item, index) => (
        <button key={index} type="button" role="tab" aria-selected={index === at} className={index === at ? "is-active" : ""} onClick={() => setActive(index)}>
          {item.label.trim() || `Card ${index + 1}`}
        </button>
      ))}
      {props.options.length < WELCOME_CHOICE_OPTIONS_MAX
        ? <button type="button" className="welcome-settings-choice-add" onClick={add}><Plus size={14} aria-hidden="true" /> Card</button> : null}
    </div>
    {option ? <div className="welcome-settings-choice-card" role="tabpanel">
      <div className="welcome-settings-choice-row">
        <label className="welcome-settings-choice-field">
          <span>Card name</span>
          <input value={option.label} maxLength={WELCOME_CHOICE_LABEL_MAX} placeholder="Claude Code" onChange={(event) => setOption({ label: event.target.value })} />
        </label>
        <label className="welcome-settings-choice-field">
          <span>One line under it</span>
          <input value={option.hint} maxLength={WELCOME_CHOICE_HINT_MAX} placeholder="Runs in VS Code or your terminal" onChange={(event) => setOption({ hint: event.target.value })} />
        </label>
      </div>
      <div className="welcome-settings-choice-field">
        <span>Icon</span>
        <div className="welcome-settings-choice-icon-row">
          <span className="welcome-settings-choice-icon" aria-hidden="true">{option.icon ? <ChoiceIconMark icon={option.icon} /> : <ImageIcon size={16} />}</span>
          {option.icon?.startsWith("data:")
            ? <span className="welcome-settings-choice-icon-note">Built-in logo</span>
            : <input value={option.icon ?? ""} aria-label="Icon image link" placeholder="https://… image link (optional)"
              onChange={(event) => setOption({ icon: event.target.value || undefined })} />}
          {option.icon ? <button type="button" className="welcome-settings-link" onClick={() => setOption({ icon: undefined })}>Remove icon</button> : null}
        </div>
      </div>
      <div className="welcome-settings-choice-field">
        <span>Steps for this card</span>
        {editingSteps === at ? (
          <div className="welcome-settings-text-editor">
            <Suspense fallback={<TextView id={`${props.id}-steps-loading`} markdown={option.markdown} onEdit={() => undefined} />}>
              <LessonEditor key={at} initialMarkdown={option.markdown} autoFocus followAlong={false} onUploadImage={null}
                onChange={(markdown: string) => setOption({ markdown: markdown.slice(0, WELCOME_CHOICE_TEXT_MAX) })}
                onDone={() => setEditingSteps(null)} onSaveNow={() => undefined} />
            </Suspense>
            <button type="button" className="welcome-settings-text-done" onClick={() => setEditingSteps(null)}>Done</button>
          </div>
        ) : option.markdown.trim()
          ? <TextView id={`${props.id}-steps`} markdown={option.markdown} onEdit={() => setEditingSteps(at)} />
          : <button type="button" className="welcome-settings-text-empty" onClick={() => setEditingSteps(at)}>
            Write the steps for this card. Type / for numbered steps, callouts and code they copy.
          </button>}
      </div>
      <div className="welcome-settings-choice-foot">
        <small>{option.markdown.length.toLocaleString()} / {WELCOME_CHOICE_TEXT_MAX.toLocaleString()} · Type / for steps, callouts and code with a Copy button</small>
        {props.options.length > 1 ? <button type="button" className="welcome-settings-link" onClick={removeOption}>Remove this card</button> : null}
      </div>
    </div> : null}
  </div>;
}

// A group of questions on one page, written where members read them (Tally
// style): each question's words, its answer, and a page break between any two.
function FormPartEditor(props: {
  id: string; formKey: string; questionKeys: string[]; content: FormContent; part: { index: number; count: number; last: boolean };
  usedElsewhere: boolean; isNew: boolean; focusQuestion: string | null; onFocused: () => void;
  onRename: (name: string) => void; onChange: (questionKey: string, patch: Partial<CommunityFormQuestion>) => void;
  onRemove: (questionKey: string) => void; onMove: (from: number, to: number) => void; onSplit: (at: number) => void;
  onAdd: (type: CommunityFormQuestion["type"]) => void;
}) {
  const byKey = new Map(props.content.questions.map((question) => [question.key, question]));
  const questions = props.questionKeys.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  const [adding, setAdding] = useState(false);
  return <div id={props.id} tabIndex={-1} className="welcome-settings-form">
    <div className="welcome-settings-form-head">
      <ClipboardList size={14} aria-hidden="true" />
      {props.part.index === 0
        ? <input className="welcome-settings-form-name" value={props.content.name} maxLength={120} aria-label="Form name (members don't see it)"
          placeholder="Welcome questions" onChange={(event) => props.onRename(event.target.value)} />
        : <span>{props.content.name || "Welcome questions"}</span>}
      <small>{props.part.count > 1 ? `Part ${props.part.index + 1} of ${props.part.count}` : props.isNew ? "New form" : "Form"}
        {props.part.last ? " · sent in on this page" : ""}</small>
    </div>
    {props.usedElsewhere && props.part.index === 0
      ? <p className="welcome-settings-form-note">A Workflow sends this form too, so edits here show there as well.</p> : null}
    {questions.map((question, index) => <Fragment key={question.key}>
      {index > 0 ? <button type="button" className="welcome-settings-split is-between" onClick={() => props.onSplit(index)}
        aria-label={`Split the page before question ${index + 1}`}><SplitSquareVertical size={13} aria-hidden="true" /> Split page here</button> : null}
      <QuestionEditor question={question} index={index} count={questions.length} autoFocus={props.focusQuestion === question.key} onFocused={props.onFocused}
        onChange={(patch) => props.onChange(question.key, patch)} onRemove={() => props.onRemove(question.key)}
        onMove={(to) => props.onMove(index, to)} />
    </Fragment>)}
    <div className="welcome-settings-form-add">
      {adding ? <div className="welcome-settings-question-types" role="group" aria-label="Add a question">
        {QUESTION_TYPES.map((item) => <button key={item.type} type="button" onClick={() => { setAdding(false); props.onAdd(item.type); }}>{item.label}</button>)}
        <button type="button" className="welcome-settings-link" onClick={() => setAdding(false)}>Cancel</button>
      </div> : <button type="button" className="welcome-settings-link" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" /> Add a question to this page</button>}
    </div>
  </div>;
}

function QuestionEditor(props: {
  question: CommunityFormQuestion; index: number; count: number; autoFocus: boolean; onFocused: () => void;
  onChange: (patch: Partial<CommunityFormQuestion>) => void; onRemove: () => void; onMove: (to: number) => void;
}) {
  const q = props.question;
  const title = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!props.autoFocus) return;
    requestAnimationFrame(() => title.current?.focus());
    props.onFocused();
  }, [props.autoFocus]);
  const choice = q.type.endsWith("choice");
  const setOption = (at: number, value: string) => props.onChange({ options: q.options.map((option, index) => (index === at ? value : option)) });
  return <div className="welcome-settings-question" role="group" aria-label={`Question ${props.index + 1}`}>
    <AutoSizeTextarea inputRef={title} className="welcome-settings-question-title" value={q.title} rows={1} maxLength={500} aria-label="Question"
      placeholder="Type your question" onChange={(value) => props.onChange({ title: value.replace(/\n/g, " ") })} />
    <AutoSizeTextarea className="welcome-settings-question-help" value={q.description} rows={1} maxLength={2000} aria-label="Help text (optional)"
      placeholder="Add a note under it (optional)" onChange={(value) => props.onChange({ description: value })} />
    {choice ? <ul className="welcome-settings-question-options">
      {q.options.map((option, index) => <li key={index}>
        <span className={`welcome-settings-question-mark${q.type === "multiple_choice" ? " is-box" : ""}`} aria-hidden="true" />
        <input value={option} maxLength={200} aria-label={`Option ${index + 1}`} placeholder={`Option ${index + 1}`} onChange={(event) => setOption(index, event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && q.options.length < 12) { event.preventDefault(); props.onChange({ options: [...q.options, ""] }); } }} />
        {q.options.length > 2 ? <button type="button" className="welcome-settings-icon-button" aria-label={`Remove option ${index + 1}`}
          onClick={() => props.onChange({ options: q.options.filter((_, at) => at !== index) })}><X size={13} aria-hidden="true" /></button> : null}
      </li>)}
      {q.options.length < 12 ? <li><button type="button" className="welcome-settings-link" onClick={() => props.onChange({ options: [...q.options, ""] })}>Add an option</button></li> : null}
    </ul> : <div className={`welcome-settings-question-answer${q.type === "long_text" ? " is-long" : ""}`} aria-hidden="true">
      {q.type === "long_text" ? "Their answer, a few sentences" : "Their answer"}</div>}
    <div className="welcome-settings-question-tools">
      <select value={q.type} aria-label="Answer type" onChange={(event) => {
        const type = event.target.value as CommunityFormQuestion["type"];
        props.onChange({ type, options: type.endsWith("choice") ? (q.options.length >= 2 ? q.options : ["Option 1", "Option 2"]) : [] });
      }}>
        {QUESTION_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
      </select>
      <label className="welcome-settings-question-required">
        <input type="checkbox" checked={q.required} onChange={(event) => props.onChange({ required: event.target.checked })} /> Required
      </label>
      <span className="welcome-settings-question-move">
        <button type="button" className="welcome-settings-icon-button" aria-label="Move question up" disabled={props.index === 0} onClick={() => props.onMove(props.index - 1)}><ChevronUp size={15} aria-hidden="true" /></button>
        <button type="button" className="welcome-settings-icon-button" aria-label="Move question down" disabled={props.index === props.count - 1} onClick={() => props.onMove(props.index + 1)}><ChevronDown size={15} aria-hidden="true" /></button>
        <button type="button" className="welcome-settings-icon-button" aria-label="Delete question" onClick={props.onRemove}><Trash2 size={14} aria-hidden="true" /></button>
      </span>
    </div>
  </div>;
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
  const title = props.view === "form" ? "Choose a form" : props.view === "question" ? "Ask a question" : props.view === "lesson" ? "Choose a lesson" : props.view === "link" ? "Video or image" : "Add a block";
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

/** The forms as they stand in the editor, so the preview plays the questions as written, before Publish. */
function previewForms(rows: Map<string, CommunityFormDraft> | null, forms: Record<string, FormContent>, layout: WelcomeBlock[]) {
  if (!rows) return null;
  const out = new Map(rows);
  for (const [key, content] of Object.entries(forms)) {
    const row = rows.get(key) ?? { key, revision: 0, publishedRevision: 0, ...content };
    out.set(key, { ...row, name: content.name, questions: pageOrder(layout, key, content) });
  }
  return out;
}

// Plays the page the way a member goes through it: one screen at a time, the
// real form runner (answers aren't saved), at a desktop or phone width.
function WelcomePreview(props: {
  previewPersonal?: CommunityFormsGateway["previewPersonal"];
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
  // What the pretend member answered so far, so personal questions build on it as they would for a member.
  const answered = useRef<WelcomePersonalAnswer[]>([]);
  const personalRuns = useRef<Record<string, WelcomePersonalQuestions>>({});
  const heard = (questions: CommunityFormQuestion[], answers: Record<string, string | string[]>) => {
    const keys = new Set(questions.map((question) => question.title));
    answered.current = [...answered.current.filter((item) => !keys.has(item.question)),
      ...questions.map((question) => ({ question: question.title, answer: welcomeAnswerWords(question, answers[question.key]) })).filter((item) => item.answer)];
  };
  const renderStep = (step: WelcomeStep) => {
    if (step.type === "personal") {
      // The same loop the server runs for a member: ask the agent after each answer until it finishes or reaches the limit.
      const page = personalRuns.current[`${step.key}:${run}`] ??= { questions: [], answers: {}, source: "agent", answered: false };
      const own = () => page.questions.map((question) => ({ question: question.title, answer: welcomeAnswerWords(question, page.answers[question.key]) }));
      return <WelcomePersonalPage key={`${step.key}:${run}`} preview onDone={advance}
        load={async () => {
          const last = page.questions[page.questions.length - 1];
          if (page.answered || (last && !page.answers[last.key])) return { ...page };
          const asked = page.questions.length;
          const turn = page.source === "backup" || asked >= step.count ? { question: null, replied: true }
            : props.previewPersonal && step.goal.trim()
              ? await props.previewPersonal({ goal: step.goal, count: step.count, persona: "", asked, answers: [...answered.current, ...own()] }).catch(() => ({ question: null, replied: false }))
              : { question: null, replied: false };
          if (turn.question) page.questions = [...page.questions, turn.question];
          else if (!turn.replied && asked === 0) { page.questions = [welcomePersonalBackup(step.backup, "backup")]; page.source = "backup"; }
          else page.answered = true;
          return { ...page };
        }}
        save={async (answers) => { page.answers = { ...answers }; }} />;
    }
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
    if (step.questions && request) {
      const normal = normalizeWelcomeLayout(props.layout);
      const place = welcomeFormPartPlace(normal, step);
      return <WelcomeFormPage key={`${request.id}:${step.questions[0]}:${run}`} preview={request} requestId={request.id} communityId=""
        pick={(questions) => welcomeFormPartQuestions(normal, step, questions)} last={place.last} onPageDone={advance} onAnswers={heard}
        submitLabel={index === lastStep ? "Finish and open the community" : "Next"} />;
    }
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
        <span className="welcome-settings-preview-where">{finished ? "Done" : `Page ${index + 1} of ${screens.length}`}</span>
        <div className="welcome-settings-device" role="group" aria-label="Preview size">
          <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={15} aria-hidden="true" /> Desktop</button>
          <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")}><Smartphone size={15} aria-hidden="true" /> Phone</button>
        </div>
        <button type="button" className="workflow-secondary-button" onClick={() => { setIndex(0); setRun((n) => n + 1); answered.current = []; }}><RotateCcw size={14} aria-hidden="true" /> Start over</button>
        <button type="button" ref={close} className="welcome-settings-icon-button" aria-label="Close preview" onClick={props.onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <p className="welcome-settings-help">Click through it as a new member would. Answers aren't saved.</p>
      <div className="welcome-settings-preview-scroll">
        <ScaledPreview width={device === "desktop" ? 960 : 390}>
          <section className="community-welcome community-welcome-preview" aria-label="What a new member sees">
            {finished ? <div className="community-welcome-intro"><small>Welcome</small><h1 tabIndex={-1} aria-level={3}>{props.title}</h1>
              <p className="community-welcome-done">That was the last step. The community opens for the member now.</p></div>
              : <WelcomeScreenView key={`${index}:${run}`} title={props.title} screens={screens} index={index} renderStep={renderStep} onNext={advance} onSkip={advance} headingLevel={3} />}
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
