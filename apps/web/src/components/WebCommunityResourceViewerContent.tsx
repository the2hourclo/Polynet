import {
  lazy,
  Suspense,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";

import { normalizeExternalUrl, parseEmbedUrl, StableMediaEmbedFrame } from "../../../../shared/linkEmbedUi";
import { renderMarkdown } from "../../../../shared/markdownUi";
import type { CommunityEmbedContext } from "../../../../shared/communityEmbedUi";
import type { CommunityEmbedStorage } from "../../../../shared/communityEmbed";
import { buildCommunityResourceEvidenceRef } from "../../../../shared/communityEvidenceContract";
import {
  parseCommunityLessonElements,
  publicCommunityLessonElement,
  splitCommunityLessonSlides,
  type CommunityLessonElement,
} from "../../../../shared/communityLessonContract";
import { markCommunityLessonElementBlocks } from "../../../../shared/communityLessonElementMarkdown";
import type { WebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import { WebLessonElement, type WebLessonFormAccess } from "./WebLessonElement";
import { DeferredYouTubeEmbed } from "./DeferredYouTubeEmbed";
import { Eye, FileText, ListOrdered, PenLine, PlayCircle } from "lucide-react";
import { buildPlatformSwitcherStyle } from "../../../../shared/platformSwitcherUi";
import {
  isLessonFileLink,
  LESSON_TOC_MIN_ENTRIES,
  lessonBodyForPlatform,
  lessonPlatforms,
  lessonTocSlug,
  type LessonTocEntry,
} from "../../../../shared/lessonReadingView";
import { WebPlatformTabList } from "./WebPlatformChoiceControls";
import { WebLessonSlideDeck } from "./WebLessonSlideDeck";
import type { CommunityResource } from "./communityResourcesContracts";

// Only owners and their team edit, so the editor loads when editing starts.
const LessonEditor = lazy(() => import("./lessonEditor/LessonEditor"));

// The server keeps a page body to this many characters.
const LESSON_BODY_MAX_CHARS = 20_000;

const LESSON_BLOCK_PROBLEMS: Record<string, string> = {
  duplicate_id: "two blocks share the id",
  too_many_elements: "a lesson can hold up to 40 buttons, checklists, quizzes and forms; this one is past it at",
};

/** Why the server would refuse this body, in words, or null. */
function lessonBodyProblem(body: string): string | null {
  if (body.length > LESSON_BODY_MAX_CHARS) {
    return `This lesson is ${body.length.toLocaleString()} characters; a page holds ${LESSON_BODY_MAX_CHARS.toLocaleString()}. Split it into two lessons to save it.`;
  }
  try {
    parseCommunityLessonElements(body, { strict: true });
    return null;
  } catch (error) {
    const [, id = "", problem = ""] = (error instanceof Error ? error.message : "").split(":");
    const known = LESSON_BLOCK_PROBLEMS[problem];
    return known ? `Not saved yet: ${known} "${id}".` : `Not saved yet: the block "${id}" needs fixing (see the note on it).`;
  }
}

// A lesson's buttons, checklists, quizzes and forms read their answers and
// handlers from here, so answering one updates it in place. Rendering the body
// again would replace the control the member is using and drop their focus
// (and, between a key's press and release, the answer itself).
type LessonElementScope = {
  byId: ReadonlyMap<string, CommunityLessonElement>;
  activity: WebLessonActivity;
  responses: WebCommunityLessonProgress["responsesByRef"][string] | undefined;
  resourceId: string;
  lessonRef: string;
};
const LessonElementScopeContext = createContext<LessonElementScope | null>(null);

function LessonElementSlot(props: { id: string }) {
  const scope = useContext(LessonElementScopeContext);
  const element = scope?.byId.get(props.id);
  if (!scope || !element) return null;
  const { activity, resourceId, lessonRef } = scope;
  return (
    <WebLessonElement
      element={element}
      response={scope.responses?.[props.id] ?? null}
      signedIn={activity.signedIn}
      onRequireSignIn={activity.onRequireSignIn}
      onAnswer={(value) => activity.progress.answer(resourceId, lessonRef, props.id, value)}
      onMarkDone={() => activity.progress.setStatus(resourceId, lessonRef, "done")}
      onAskAgent={activity.onAskAgent ?? null}
      forms={activity.forms}
    />
  );
}

// A draft can be mid-edit; Preview shows whatever elements already read cleanly.
function previewLessonElements(body: string) {
  try {
    return parseCommunityLessonElements(body).map(publicCommunityLessonElement);
  } catch {
    return [];
  }
}

type WebCommunityResourceViewerContentProps = {
  resource: CommunityResource;
  editor?: WebCommunityResourceInlineEditor | null;
  communityEmbeds?: CommunityEmbedContext | null;
  lessonActivity?: WebLessonActivity | null;
};

/** What a lesson's buttons, checklists, quizzes and forms need from the page. */
export type WebLessonActivity = {
  progress: WebCommunityLessonProgress;
  signedIn: boolean;
  onRequireSignIn: () => void;
  forms: WebLessonFormAccess | null;
  onAskAgent?: ((text: string) => void) | null;
  /** Where widget answers are kept for this member; the browser when absent. */
  embedStorage?: CommunityEmbedStorage | null;
};

export type WebCommunityResourceInlineEditorField = "title" | "body" | "pin";

export type WebCommunityResourceInlineEditor = {
  canEdit: boolean;
  isEditing: boolean;
  activeField: WebCommunityResourceInlineEditorField | null;
  titleInput: string;
  bodyInput: string;
  pinnedInput: boolean;
  error: string | null;
  isSaving: boolean;
  isDirty: boolean;
  canSave: boolean;
  onBeginEdit: (field: WebCommunityResourceInlineEditorField) => void;
  onSetActiveField: (field: WebCommunityResourceInlineEditorField) => void;
  onChangeTitle: (value: string) => void;
  onChangeBody: (value: string) => void;
  onChangePinned: (value: boolean) => void;
  onSave: () => Promise<boolean> | boolean;
  /** Saves and keeps editing (autosave). */
  onSaveInPlace?: (() => Promise<boolean>) | null;
  onUploadImage?: ((file: File) => Promise<string>) | null;
  onCancel: () => void;
};

// The member's platform (Cowork, Claude Code, Codex…), shared with the Roadmap.
const LESSON_PLATFORM_KEY = "polynet-lesson-platform";
function readLessonPlatform(): string {
  try { return localStorage.getItem(LESSON_PLATFORM_KEY) || ""; } catch { return ""; }
}

type LessonFileLink = { href: string; label: string };

// Reads the rendered lesson for its contents (sections, then videos under the
// section they sit in) and the files it links to, and gives each stop an id
// to jump to. Runs after the body renders.
function useLessonContents(root: { current: HTMLElement | null }, enabled: boolean, renderKey: unknown) {
  const [toc, setToc] = useState<LessonTocEntry[]>([]);
  const [files, setFiles] = useState<LessonFileLink[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) {
      setToc([]);
      setFiles([]);
      return;
    }
    const taken = new Set<string>();
    const entries: LessonTocEntry[] = [];
    // The body's "##" and "###" render one level down (h3, h4).
    element.querySelectorAll<HTMLElement>("h3.md-header, h4.md-header, .md-media-embed, .md-video").forEach((node) => {
      if (node.closest(".lesson-slide-deck")) return;
      const isVideo = !node.matches(".md-header");
      const label = isVideo
        ? (node.querySelector("iframe")?.getAttribute("title") || node.getAttribute("aria-label") || "Video").replace(/\s+embed$/i, "")
        : node.textContent?.trim() ?? "";
      if (!label) return;
      node.id = node.id || lessonTocSlug(label, taken);
      node.style.scrollMarginTop = "1.5rem";
      entries.push({ id: node.id, label, level: isVideo || node.tagName === "H4" ? 3 : 2, kind: isVideo ? "video" : "section" });
    });
    setToc(entries.length >= LESSON_TOC_MIN_ENTRIES ? entries : []);
    const seen = new Set<string>();
    setFiles(Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .filter((link) => isLessonFileLink(link.href) && !seen.has(link.href) && Boolean(seen.add(link.href)))
      .map((link) => ({ href: link.href, label: link.textContent?.trim() || decodeURIComponent(link.pathname.split("/").pop() ?? "File") })));
  }, [root, enabled, renderKey]);
  // The section being read is the last heading that has scrolled past the top third.
  useEffect(() => {
    if (!toc.length) return;
    const targets = toc.map((entry) => document.getElementById(entry.id)).filter((node): node is HTMLElement => Boolean(node));
    const observer = new IntersectionObserver(() => {
      const line = window.innerHeight / 3;
      let current: string | null = targets[0]?.id ?? null;
      for (const target of targets) if (target.getBoundingClientRect().top <= line) current = target.id;
      setActiveId(current);
    }, { rootMargin: "0px 0px -66% 0px", threshold: [0, 1] });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [toc]);
  return { toc, files, activeId };
}

function LessonContents(props: { toc: LessonTocEntry[]; activeId: string | null; onJump?: () => void }) {
  return (
    <ol className="lesson-toc-list">
      {props.toc.map((entry) => (
        <li key={entry.id} className={`lesson-toc-item is-level-${entry.level}${entry.kind === "video" ? " is-video" : ""}${props.activeId === entry.id ? " is-active" : ""}`}>
          <a
            href={`#${entry.id}`}
            aria-current={props.activeId === entry.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              props.onJump?.();
            }}
          >
            {entry.kind === "video" ? <PlayCircle aria-hidden="true" /> : null}
            <span>{entry.label}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function getHostLabel(rawUrl: string | null): string {
  const url = normalizeExternalUrl(rawUrl);
  if (!url) return "External";
  return url.hostname.replace(/^www\./i, "");
}

function getEmbedProviderLabel(provider: string | null | undefined): string {
  if (provider === "youtube") return "YouTube";
  if (provider === "wistia") return "Wistia";
  if (provider === "descript") return "Descript";
  return "Video";
}

const RESOURCE_BODY_INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "iframe",
  "video",
  "audio",
  "embed",
  "object",
  "figure",
  "[role='button']",
  "[contenteditable='true']",
  "[data-resource-media='true']",
  ".md-media-embed",
  ".md-media-embed-frame",
  ".resource-viewer-embed",
].join(", ");

function PinIcon() {
  return (
    <svg className="resource-viewer-pin-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6" />
      <path d="M10 3v6l-3 3v1h10v-1l-3-3V3" />
      <path d="M12 13v8" />
    </svg>
  );
}

function ExternalArrowIcon() {
  return (
    <svg className="resource-viewer-external-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

export function WebCommunityResourceViewerContent(props: WebCommunityResourceViewerContentProps) {
  const { resource, editor = null } = props;
  // A lesson's video (lesson.video_url) plays at the top, like a video page's link.
  const currentUrl = resource.url || resource.lesson?.video_url || null;
  const embed = currentUrl ? parseEmbedUrl(currentUrl) : null;
  const sourceUrl = normalizeExternalUrl(currentUrl);
  const hostLabel = getHostLabel(currentUrl);
  const persistedBody = resource.body_md?.trim() ?? "";
  const trimmedBody = editor?.isEditing ? editor.bodyInput.trim() : persistedBody;
  const titleText = editor?.isEditing ? editor.titleInput : resource.title;
  const hasBody = trimmedBody.length > 0;
  const verificationLink: { label: string; href: string } | null = sourceUrl
    ? {
        label: embed
          ? `Watch on ${getEmbedProviderLabel(embed.provider)}`
          : `Read on ${hostLabel}`,
        href: sourceUrl.toString(),
      }
    : null;
  const isEmpty = !embed && !hasBody && !verificationLink;
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const bodyFocusAtRef = useRef<{ x: number; y: number } | null>(null);
  const canEdit = Boolean(editor?.canEdit);
  const isEditing = Boolean(editor?.isEditing);
  const activeField = editor?.activeField ?? null;
  const isTitleEditing = isEditing && activeField === "title";
  const isBodyEditing = isEditing && activeField === "body";
  const isPinned = editor?.isEditing ? editor.pinnedInput : resource.pinned;
  // Preview shows the lesson as members will read it, from the draft being edited.
  const [previewing, setPreviewing] = useState(false);
  const isPreviewing = isEditing && previewing;
  useEffect(() => {
    if (!isEditing) setPreviewing(false);
  }, [isEditing, resource.id]);
  const fullShownBody = isPreviewing && editor ? editor.bodyInput.trim() : persistedBody;
  // Members pick their platform once; the lesson shows that platform's steps.
  const [platform, setPlatform] = useState(readLessonPlatform);
  const choosePlatform = (key: string) => {
    setPlatform(key);
    try { localStorage.setItem(LESSON_PLATFORM_KEY, key); } catch { /* storage can be blocked */ }
  };
  const platforms = useMemo(() => (isEditing && !isPreviewing ? [] : lessonPlatforms(fullShownBody)), [isEditing, isPreviewing, fullShownBody]);
  const activePlatform = platforms.find((entry) => entry.key === platform)?.key ?? platforms[0]?.key ?? null;
  const shownBody = activePlatform ? lessonBodyForPlatform(fullShownBody, activePlatform) : fullShownBody;
  // Follow-along elements work only in lessons (pages with lesson fields),
  // the same rule the server uses when it saves an answer.
  const lessonActivity = props.lessonActivity && resource.lesson ? props.lessonActivity : null;
  const lessonElements = useMemo(
    () =>
      !lessonActivity
        ? []
        : isPreviewing
          ? previewLessonElements(shownBody)
          : resource.lesson_elements ?? parseCommunityLessonElements(persistedBody).map(publicCommunityLessonElement),
    [lessonActivity, isPreviewing, shownBody, resource.lesson_elements, persistedBody],
  );
  const lessonRef = buildCommunityResourceEvidenceRef(resource.id);
  const lessonResponses = lessonActivity?.progress.responsesByRef[lessonRef];
  // Opening a lesson starts it, in whichever view the member opened it from,
  // so "started" means the same thing on the client record everywhere.
  const lessonStatus = lessonActivity?.progress.loaded ? lessonActivity.progress.statusByRef[lessonRef] ?? "not_started" : null;
  const startLesson = lessonActivity?.signedIn ? lessonActivity.progress.setStatus : null;
  useEffect(() => {
    if (startLesson && lessonStatus === "not_started") startLesson(resource.id, lessonRef, "in_progress");
  }, [startLesson, lessonStatus, resource.id, lessonRef]);
  const lessonScope = useMemo<LessonElementScope | null>(
    () => lessonActivity ? { byId: new Map(lessonElements.map((element) => [element.id, element])), activity: lessonActivity,
      responses: lessonResponses, resourceId: resource.id, lessonRef } : null,
    [lessonActivity, lessonElements, lessonResponses, resource.id, lessonRef],
  );
  // The body renders again only when its text or its set of elements changes.
  const hasLessonActivity = Boolean(lessonActivity);
  const lessonElementIds = lessonElements.map((element) => element.id).join(" ");
  const renderedBodyMarkdown = useMemo(() => {
    if (!shownBody) return null;
    const ids = new Set(lessonElementIds ? lessonElementIds.split(" ") : []);
    const render = (markdown: string) => renderMarkdown(ids.size ? markCommunityLessonElementBlocks(markdown, ids) : markdown, {
      embedStandaloneMedia: true,
      headingLevelOffset: 1,
      communityEmbeds: props.communityEmbeds ?? null,
      renderLessonElement: hasLessonActivity ? (id) => ids.has(id) ? <LessonElementSlot key={id} id={id} /> : null : null,
    });
    // A "## Slides" section reads as a deck, one slide at a time, in place.
    const deck = splitCommunityLessonSlides(shownBody);
    if (!deck) return render(shownBody);
    return (
      <>
        {deck.before ? render(deck.before) : null}
        <WebLessonSlideDeck key={resource.id} slides={deck.slides} renderNote={render} />
        {deck.after ? render(deck.after) : null}
      </>
    );
  }, [shownBody, props.communityEmbeds, hasLessonActivity, lessonElementIds, resource.id]);

  const readingRef = useRef<HTMLDivElement | null>(null);
  const contents = useLessonContents(readingRef, !isEditing || isPreviewing, renderedBodyMarkdown);
  const [compactTocOpen, setCompactTocOpen] = useState(false);
  const hasRail = contents.toc.length > 0 || contents.files.length > 0;

  useEffect(() => {
    if (!isTitleEditing) return;
    const timeoutId = window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isTitleEditing, resource.id]);

  // A click on the read view places the caret once; other ways in start at the end.
  useEffect(() => {
    if (!isEditing) bodyFocusAtRef.current = null;
  }, [isEditing]);

  // Autosave: a moment after the owner stops typing, the page saves and
  // editing carries on. A body the server would refuse waits, with the reason shown.
  const bodyProblem = isEditing && editor ? lessonBodyProblem(editor.bodyInput) : null;
  const hasSavableChanges = Boolean(editor?.isEditing && editor.isDirty && editor.titleInput.trim() && !bodyProblem);
  const canAutosave = Boolean(hasSavableChanges && editor?.canSave && editor.onSaveInPlace);
  // The panel hands a new save function each render; the timer keys on the content.
  const saveInPlaceRef = useRef(editor?.onSaveInPlace ?? null);
  saveInPlaceRef.current = editor?.onSaveInPlace ?? null;
  useEffect(() => {
    if (!canAutosave) return;
    const timeoutId = window.setTimeout(() => void saveInPlaceRef.current?.(), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [canAutosave, editor?.titleInput, editor?.bodyInput, editor?.pinnedInput]);

  // Leaving the lesson saves what the timer hadn't yet. These refs are set
  // after each commit, so the cleanup below still sees the lesson being left.
  const leavingRef = useRef<{ pending: boolean; save: (() => Promise<boolean>) | null }>({ pending: false, save: null });
  useEffect(() => {
    leavingRef.current = { pending: hasSavableChanges, save: editor?.onSaveInPlace ?? null };
  });
  useEffect(() => () => {
    if (leavingRef.current.pending) void leavingRef.current.save?.();
  }, [resource.id]);
  const hasUnsaved = Boolean(editor?.isEditing && editor.isDirty);
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  // Done waits for a save in flight, then saves anything left and closes.
  const [closeWhenSaved, setCloseWhenSaved] = useState(false);
  useEffect(() => {
    if (!closeWhenSaved || !editor || editor.isSaving) return;
    setCloseWhenSaved(false);
    if (!editor.isEditing) return;
    if (!editor.isDirty) editor.onCancel();
    else if (editor.canSave && !bodyProblem) void editor.onSave();
  }, [closeWhenSaved, editor, bodyProblem]);
  const finishEditing = () => setCloseWhenSaved(true);

  const beginEdit = (field: WebCommunityResourceInlineEditorField) => {
    if (!editor?.canEdit || editor.isSaving) return;
    if (editor.isEditing) {
      editor.onSetActiveField(field);
      return;
    }
    editor.onBeginEdit(field);
  };

  const handleEditableKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (!editor) return;
    if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
      event.preventDefault();
      event.stopPropagation();
      finishEditing();
    }
  };

  const handleBodyTriggerClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const interactiveTarget =
      target && target !== event.currentTarget
        ? target.closest(RESOURCE_BODY_INTERACTIVE_SELECTOR)
        : null;
    if (interactiveTarget && interactiveTarget !== event.currentTarget) {
      return;
    }
    // Measured from the body's corner: the editor's toolbar pushes the text down.
    const body = event.currentTarget.getBoundingClientRect();
    bodyFocusAtRef.current = { x: event.clientX - body.left, y: event.clientY - body.top };
    beginEdit("body");
  };

  // Only keys pressed on the body itself start editing. Enter or Space on a
  // checklist, quiz, button or form inside it (or a dialog one opens) is theirs.
  const handleBodyTriggerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    beginEdit("body");
  };

  const renderTitleContent = () => {
    if (isTitleEditing && editor) {
      return (
        <input
          ref={titleInputRef}
          className="resource-viewer-title-input"
          value={editor.titleInput}
          placeholder="Lesson title"
          onChange={(event) => editor.onChangeTitle(event.target.value)}
          onFocus={() => editor.onSetActiveField("title")}
          onKeyDown={handleEditableKeyDown}
        />
      );
    }

    if (canEdit) {
      return (
        <button
          className={`resource-viewer-title-edit-trigger${titleText.trim() ? "" : " is-empty"}`}
          type="button"
          disabled={editor?.isSaving}
          onClick={() => beginEdit("title")}
        >
          <span>{titleText.trim() || "Untitled lesson"}</span>
        </button>
      );
    }

    return <span>{resource.title}</span>;
  };

  const togglePinned = () => {
    if (!editor?.canEdit || editor.isSaving) return;
    if (!editor.isEditing) {
      editor.onBeginEdit("pin");
    } else {
      editor.onSetActiveField("pin");
    }
    editor.onChangePinned(!isPinned);
  };

  const renderPinControl = () => {
    if (canEdit && editor) {
      return (
        <button
          className={`resource-viewer-pin-toggle${isPinned ? " is-active" : ""}`}
          type="button"
          disabled={editor.isSaving}
          aria-pressed={isPinned}
          title={isPinned ? "Unpin lesson" : "Pin lesson"}
          onClick={togglePinned}
        >
          <PinIcon />
        </button>
      );
    }

    return isPinned ? <PinIcon /> : null;
  };

  const renderBodyContent = () => {
    // While the page is being edited the body is always the editor, so moving
    // between the title and the body never reloads it.
    if (isPreviewing) {
      return (
        <>
          <div className="lesson-editor-preview-note" role="status">
            <Eye aria-hidden="true" />
            <span>This is how members see the lesson. Your changes keep saving.</span>
          </div>
          {renderedBodyMarkdown ? <div className="resource-viewer-prose">{renderedBodyMarkdown}</div> : null}
        </>
      );
    }
    if (isEditing && editor) {
      const readView = renderedBodyMarkdown ? <div className="resource-viewer-prose">{renderedBodyMarkdown}</div> : null;
      return (
        <Suspense fallback={readView}>
          <LessonEditor
            key={resource.id}
            initialMarkdown={editor.bodyInput}
            followAlong={Boolean(resource.lesson)}
            onChange={editor.onChangeBody}
            onUploadImage={editor.onUploadImage ?? null}
            autoFocus={isBodyEditing}
            focusAt={bodyFocusAtRef.current}
            onFocus={() => {
              if (editor.activeField !== "body") editor.onSetActiveField("body");
            }}
            onDone={finishEditing}
            onSaveNow={() => {
              if (canAutosave) void editor.onSaveInPlace?.();
            }}
          />
        </Suspense>
      );
    }

    if (hasBody) {
      const prose = renderedBodyMarkdown;
      if (canEdit) {
        return (
          <div
            className="resource-viewer-prose resource-viewer-prose-edit-trigger"
            role="button"
            tabIndex={0}
            onClick={handleBodyTriggerClick}
            onKeyDown={handleBodyTriggerKeyDown}
          >
            {prose}
          </div>
        );
      }
      return <div className="resource-viewer-prose">{prose}</div>;
    }

    if (canEdit) {
      return (
        <button
          className="resource-viewer-empty resource-viewer-empty-edit-trigger"
          type="button"
          disabled={editor?.isSaving}
          onClick={() => beginEdit("body")}
        >
          This lesson has no body text. Click to write it.
        </button>
      );
    }

    return isEmpty ? <div className="resource-viewer-empty">This lesson hasn't been written yet.</div> : null;
  };

  return (
    <div className={`resource-viewer-content${embed ? " is-video-lesson" : ""}`}>
      {/* A video lesson leads with its video, wide, above the title. */}
      {embed ? (
        <div className="resource-viewer-hero">
          <div className="resource-viewer-embed" data-resource-media="true">
            {embed.provider === "youtube" ? (
              <DeferredYouTubeEmbed
                key={embed.id}
                embed={embed}
                title={`${resource.title} video`}
              />
            ) : (
              <StableMediaEmbedFrame
                src={embed.src}
                title={`${resource.title} video`}
              />
            )}
          </div>
        </div>
      ) : null}
      <div className="resource-viewer-header">
        <div className="resource-viewer-title-row">
          <h1 className="resource-viewer-title">
            {renderTitleContent()}
            {renderPinControl()}
          </h1>
          <div className="resource-viewer-header-aside">
            {isEditing && editor ? (
              <div className="resource-viewer-edit-actions">
                <span
                  className={`lesson-editor-save-pill${bodyProblem ? " is-blocked" : editor.isSaving || closeWhenSaved || editor.isDirty ? " is-pending" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  {editor.isSaving || closeWhenSaved
                    ? "Saving…"
                    : bodyProblem
                      ? "Not saved"
                      : editor.isDirty
                        ? "Editing"
                        : "Saved"}
                </span>
                <button
                  className="lesson-editor-header-button"
                  type="button"
                  aria-pressed={isPreviewing}
                  onClick={() => {
                    bodyFocusAtRef.current = null;
                    setPreviewing(!previewing);
                  }}
                  title={isPreviewing ? "Back to editing" : "See the lesson as members will"}
                >
                  {isPreviewing ? <PenLine aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  <span className="lesson-editor-header-label">{isPreviewing ? "Edit" : "Preview"}</span>
                </button>
                <button
                  className="lesson-editor-header-button is-primary"
                  type="button"
                  onClick={finishEditing}
                  disabled={closeWhenSaved || Boolean(bodyProblem && editor.isDirty)}
                  title="Save and stop editing (Ctrl+Enter)"
                >
                  Done
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {isEditing && bodyProblem ? <div className="auth-error resource-viewer-edit-error" role="alert">{bodyProblem}</div> : null}
        {isEditing && editor?.error ? <div className="auth-error resource-viewer-edit-error">{editor.error}</div> : null}
      </div>

      <div className={`resource-viewer-body${hasRail ? " has-lesson-rail" : ""}`}>
        <div className="resource-viewer-column">
          {platforms.length > 1 && activePlatform ? (
            <div className="lesson-platform-row">
              <span>I build in</span>
              <WebPlatformTabList
                tabs={platforms.map((entry) => ({ id: entry.key, label: entry.label }))}
                activeTab={activePlatform}
                onSelectTab={choosePlatform}
                ariaLabel="I build in"
                idPrefix="lesson-platform"
                style={buildPlatformSwitcherStyle(platforms.length, platforms.findIndex((entry) => entry.key === activePlatform))}
              />
            </div>
          ) : null}

          {contents.toc.length ? (
            <details className="lesson-toc-compact" open={compactTocOpen} onToggle={(event) => setCompactTocOpen(event.currentTarget.open)}>
              <summary><ListOrdered aria-hidden="true" /><span>Contents</span></summary>
              <LessonContents toc={contents.toc} activeId={contents.activeId} onJump={() => setCompactTocOpen(false)} />
            </details>
          ) : null}

          {/* Around every place the body shows, read view or editor fallback alike. */}
          <div className="lesson-reading" ref={readingRef}>
            <LessonElementScopeContext.Provider value={lessonScope}>{renderBodyContent()}</LessonElementScopeContext.Provider>
          </div>

          {verificationLink ? (
            <a
              className="resource-viewer-verification-link"
              href={verificationLink.href}
              target="_blank"
              rel="noreferrer"
            >
              <span>{verificationLink.label}</span>
              <ExternalArrowIcon />
            </a>
          ) : null}
        </div>
        {hasRail ? (
          <aside className="lesson-rail" aria-label="In this lesson">
            {contents.toc.length ? (
              <nav className="lesson-rail-section" aria-label="Contents">
                <p className="lesson-rail-label">Contents</p>
                <LessonContents toc={contents.toc} activeId={contents.activeId} />
              </nav>
            ) : null}
            {contents.files.length ? (
              <div className="lesson-rail-section">
                <p className="lesson-rail-label">Files</p>
                <ul className="lesson-rail-files">
                  {contents.files.map((file) => (
                    <li key={file.href}>
                      <a href={file.href} target="_blank" rel="noreferrer"><FileText aria-hidden="true" /><span>{file.label}</span></a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
