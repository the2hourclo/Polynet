import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Bold,
  CheckSquare,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Code,
  Code2,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Pilcrow,
  Play,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";

import { parseEmbedUrl } from "../../../../../shared/linkEmbedUi";
import { COMMUNITY_EMBED_LANGUAGE } from "../../../../../shared/communityEmbed";
import {
  LessonFencedBlock,
  LessonImage,
  LessonRawMarkdown,
  LessonVideo,
  lessonEditorBaseExtensions,
} from "./lessonEditorSchema";
import { parseLessonMarkdown, parseMarkdownFragment, type LessonDocument } from "./lessonMarkdown";
import { lessonBlockId, starterLessonBlock } from "./lessonBlockModel";
import {
  LessonEditorServicesContext,
  LessonFencedBlockView,
  LessonImageView,
  LessonRawMarkdownView,
  LessonVideoView,
  focusNextBlock,
  type LessonEditorServices,
} from "./LessonEditorNodeViews";
import "./lessonEditor.css";

export type LessonEditorProps = {
  /** The lesson body when editing started. Later changes to it are ignored. */
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** Stores a picture and returns its address; null hides uploading. */
  onUploadImage: ((file: File) => Promise<string>) | null;
  onDone: () => void;
  onSaveNow: () => void;
  /** Take the caret on open: where the owner clicked the read view, or the end. */
  autoFocus?: boolean;
  focusAt?: { x: number; y: number } | null;
  onFocus?: () => void;
  /** Buttons, checklists, quizzes and forms work only in lessons; other pages don't offer them. */
  followAlong?: boolean;
};

const isVideoUrl = (url: string) => Boolean(parseEmbedUrl(url));

function describeVideo(url: string) {
  const embed = parseEmbedUrl(url);
  if (!embed) return null;
  const provider = { youtube: "YouTube", wistia: "Wistia", vimeo: "Vimeo", loom: "Loom" }[embed.provider as string] ?? "Video";
  return { provider, thumbnail: embed.provider === "youtube" ? `https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg` : null };
}

/* The "/" menu ------------------------------------------------------------- */

type SlashItem = {
  key: string;
  title: string;
  hint: string;
  group: "Text" | "Media" | "Lesson";
  keywords: string;
  icon: ReactNode;
  run: (editor: Editor, range: Range) => void;
};

function takenBlockIds(editor: Editor): Set<string> {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "lessonBlock") {
      const id = lessonBlockId(node.attrs as never);
      if (id) ids.add(id);
    }
  });
  return ids;
}

function insertBlock(editor: Editor, range: Range, content: Record<string, unknown>) {
  editor.chain().focus().deleteRange(range).insertContentAt(range.from, content).run();
}

function insertLessonBlock(language: string) {
  return (editor: Editor, range: Range) => {
    const attrs = starterLessonBlock(language, takenBlockIds(editor));
    focusNextBlock(language === COMMUNITY_EMBED_LANGUAGE ? "embed" : lessonBlockId(attrs) ?? "");
    insertBlock(editor, range, { type: "lessonBlock", attrs });
  };
}

const SLASH_ITEMS: SlashItem[] = [
  { key: "text", group: "Text", title: "Text", hint: "Plain writing", keywords: "paragraph p", icon: <Pilcrow />,
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { key: "h1", group: "Text", title: "Heading 1", hint: "Starts a new section", keywords: "h1 title section ##", icon: <Heading1 />,
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { key: "h2", group: "Text", title: "Heading 2", hint: "A heading inside a section", keywords: "h2 subtitle ###", icon: <Heading2 />,
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { key: "h3", group: "Text", title: "Heading 3", hint: "A small heading", keywords: "h3 ####", icon: <Heading3 />,
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 4 }).run() },
  { key: "bullets", group: "Text", title: "Bulleted list", hint: "A simple list", keywords: "ul unordered - points", icon: <List />,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { key: "numbers", group: "Text", title: "Numbered list", hint: "Steps in order", keywords: "ol ordered 1. steps", icon: <ListOrdered />,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { key: "quote", group: "Text", title: "Callout", hint: "A quote or a tip that stands out", keywords: "quote blockquote tip note >", icon: <Quote />,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { key: "code", group: "Text", title: "Code or prompt", hint: "Text members copy as is", keywords: "code prompt command ``` copy", icon: <Code2 />,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { key: "divider", group: "Text", title: "Divider", hint: "A line between parts", keywords: "hr rule line --- separator", icon: <Minus />,
    run: (e, r) => insertBlock(e, r, { type: "horizontalRule" }) },
  { key: "table", group: "Text", title: "Table", hint: "Rows and columns, written as text", keywords: "table grid |", icon: <Table2 />,
    run: (e, r) => {
      focusNextBlock("raw");
      insertBlock(e, r, { type: "rawMarkdown", attrs: { source: "| Column | Column |\n| --- | --- |\n| Text | Text |" } });
    } },
  { key: "image", group: "Media", title: "Image", hint: "Upload or link a picture", keywords: "image picture photo screenshot img upload", icon: <ImagePlus />,
    run: (e, r) => {
      focusNextBlock("image");
      insertBlock(e, r, { type: "image", attrs: { src: "", alt: "" } });
    } },
  { key: "video", group: "Media", title: "Video", hint: "YouTube, Loom, Vimeo or Wistia", keywords: "video youtube loom vimeo wistia embed", icon: <Play />,
    run: (e, r) => {
      focusNextBlock("video");
      insertBlock(e, r, { type: "video", attrs: { url: "" } });
    } },
  { key: "button", group: "Lesson", title: "Button", hint: "Mark done, ask the agent, open a form", keywords: "button cta action done", icon: <MousePointerClick />,
    run: insertLessonBlock("button") },
  { key: "checklist", group: "Lesson", title: "Checklist", hint: "Steps members tick off", keywords: "checklist todo tasks tick", icon: <CheckSquare />,
    run: insertLessonBlock("checklist") },
  { key: "quiz", group: "Lesson", title: "Quiz", hint: "A question with a right answer", keywords: "quiz question test check answer", icon: <CircleHelp />,
    run: insertLessonBlock("quiz") },
  { key: "form", group: "Lesson", title: "Form", hint: "A Polynet Form members fill in here", keywords: "form survey intake submit", icon: <ClipboardList />,
    run: insertLessonBlock("form") },
  { key: "embed", group: "Lesson", title: "Interactive widget", hint: "A page from your community site", keywords: "embed widget interactive html polynet-embed", icon: <AppWindow />,
    run: insertLessonBlock(COMMUNITY_EMBED_LANGUAGE) },
];

const FOLLOW_ALONG_KEYS = new Set(["button", "checklist", "quiz", "form"]);

function filterSlashItems(query: string, followAlong: boolean): SlashItem[] {
  const q = query.trim().toLowerCase();
  const offered = followAlong ? SLASH_ITEMS : SLASH_ITEMS.filter((item) => !FOLLOW_ALONG_KEYS.has(item.key));
  if (!q) return offered;
  return offered.filter((item) => `${item.title} ${item.keywords}`.toLowerCase().includes(q));
}

type SlashState = { items: SlashItem[]; index: number; rect: DOMRect | null };
type SlashBridge = {
  props: SuggestionProps<SlashItem, SlashItem> | null;
  index: number;
  set: (state: SlashState | null) => void;
  followAlong: boolean;
};

const slashKey = new PluginKey("lessonSlash");

function slashExtension(bridge: SlashBridge) {
  return Extension.create({
    name: "lessonSlash",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: slashKey,
          char: "/",
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return $from.parent.type.name === "paragraph" || $from.parent.type.name === "heading";
          },
          items: ({ query }) => filterSlashItems(query, bridge.followAlong),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => {
              bridge.props = props;
              bridge.index = 0;
              bridge.set({ items: props.items, index: 0, rect: props.clientRect?.() ?? null });
            },
            onUpdate: (props) => {
              bridge.props = props;
              bridge.index = 0;
              bridge.set({ items: props.items, index: 0, rect: props.clientRect?.() ?? null });
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const props = bridge.props;
              if (!props) return false;
              const count = props.items.length;
              if (event.key === "Escape") {
                bridge.props = null;
                bridge.set(null);
                return true;
              }
              if (!count) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                bridge.index = (bridge.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
                bridge.set({ items: props.items, index: bridge.index, rect: props.clientRect?.() ?? null });
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                props.command(props.items[bridge.index]);
                return true;
              }
              return false;
            },
            onExit: () => {
              bridge.props = null;
              bridge.set(null);
            },
          }),
        }),
      ];
    },
  });
}

function SlashMenu({ state, onPick, host }: { state: SlashState; onPick: (index: number) => void; host: HTMLElement | null }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [state.index]);
  if (!state.rect) return null;
  const below = state.rect.bottom + 340 < window.innerHeight;
  const style = {
    left: Math.max(8, Math.min(state.rect.left, window.innerWidth - 328)),
    top: below ? state.rect.bottom + 6 : Math.max(8, state.rect.top - 346),
  };
  let lastGroup = "";
  return createPortal(
    <div ref={listRef} className="lesson-editor-menu lesson-editor-slash" style={style} role="listbox" aria-label="Add a block">
      {state.items.length ? state.items.map((item, index) => {
        const header = item.group !== lastGroup ? <div className="lesson-editor-menu-group" key={`g-${item.group}`}>{item.group === "Lesson" ? "Lesson blocks" : item.group}</div> : null;
        lastGroup = item.group;
        return [
          header,
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={index === state.index}
            className="lesson-editor-menu-item"
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
          >
            <span className="lesson-editor-menu-icon" aria-hidden="true">{item.icon}</span>
            <span className="lesson-editor-menu-text">
              <strong>{item.title}</strong>
              <small>{item.hint}</small>
            </span>
          </button>,
        ];
      }) : <div className="lesson-editor-menu-empty">No blocks match</div>}
    </div>,
    // Inside the community's theme scope, so the menu wears its colours.
    host?.closest<HTMLElement>("[data-community-theme]") ?? document.body,
  );
}

/* Formatting bar on a text selection --------------------------------------- */

const TURN_INTO: { key: string; label: string; icon: ReactNode; isActive: (e: Editor) => boolean; run: (e: Editor) => void }[] = [
  { key: "p", label: "Text", icon: <Pilcrow />, isActive: (e) => e.isActive("paragraph") && !e.isActive("bulletList") && !e.isActive("orderedList") && !e.isActive("blockquote"),
    run: (e) => e.chain().focus().clearNodes().setParagraph().run() },
  { key: "h1", label: "Heading 1", icon: <Heading1 />, isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { key: "h2", label: "Heading 2", icon: <Heading2 />, isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { key: "h3", label: "Heading 3", icon: <Heading3 />, isActive: (e) => e.isActive("heading", { level: 4 }), run: (e) => e.chain().focus().setHeading({ level: 4 }).run() },
  { key: "ul", label: "Bulleted list", icon: <List />, isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "ol", label: "Numbered list", icon: <ListOrdered />, isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "quote", label: "Callout", icon: <Quote />, isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
];

function FormatBar({ editor, openLinkRef }: { editor: Editor; openLinkRef: { current: (() => void) | null } }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [turnOpen, setTurnOpen] = useState(false);
  const [href, setHref] = useState("");
  const openLink = () => {
    if (editor.state.selection.empty) return;
    setHref(String(editor.getAttributes("link").href ?? ""));
    setLinkOpen(true);
  };
  openLinkRef.current = openLink;
  const [, setTick] = useState(0);
  // Redraw for what the bar shows (active marks, the block type). Not on every
  // transaction: the bar's own positioning dispatches those.
  useEffect(() => {
    const rerender = () => setTick((tick) => tick + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("update", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("update", rerender);
    };
  }, [editor]);
  const linkOpenRef = useRef(linkOpen);
  linkOpenRef.current = linkOpen;
  const options = useMemo(() => ({
    placement: "top" as const,
    offset: 8,
    onHide: () => {
      setLinkOpen(false);
      setTurnOpen(false);
    },
  }), []);
  const shouldShow = useCallback(({ editor: e, state, from, to }: { editor: Editor; state: Editor["state"]; from: number; to: number }) => {
    if (from === to || state.selection instanceof NodeSelection) return false;
    if (e.isActive("codeBlock")) return false;
    return e.isFocused || linkOpenRef.current;
  }, []);
  const current = TURN_INTO.find((item) => item.isActive(editor)) ?? TURN_INTO[0];
  const mark = (name: string, label: string, icon: ReactNode, run: () => void, shortcut: string) => (
    <button
      type="button"
      className={`lesson-editor-format-button${editor.isActive(name) ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={editor.isActive(name)}
      title={`${label} (${shortcut})`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      className="lesson-editor-menu lesson-editor-format"
      options={options}
      shouldShow={shouldShow}
    >
      {linkOpen ? (
        <form
          className="lesson-editor-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = href.trim();
            const chain = editor.chain().focus().extendMarkRange("link");
            if (value) chain.setLink({ href: /^(https?:|mailto:)/i.test(value) ? value : `https://${value}` }).run();
            else chain.unsetLink().run();
            setLinkOpen(false);
          }}
        >
          <input
            autoFocus
            className="lesson-editor-field"
            value={href}
            placeholder="Paste a link"
            aria-label="Link address"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
          />
          <button type="submit" className="lesson-editor-button is-primary">{href.trim() ? "Link" : "Remove"}</button>
        </form>
      ) : (
        <>
          <div className="lesson-editor-turn">
            <button
              type="button"
              className="lesson-editor-format-button lesson-editor-turn-button"
              aria-haspopup="menu"
              aria-expanded={turnOpen}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTurnOpen(!turnOpen)}
            >
              {current.label} <ChevronDown aria-hidden="true" />
            </button>
            {turnOpen ? (
              <div className="lesson-editor-menu lesson-editor-turn-menu" role="menu">
                {TURN_INTO.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={item === current}
                    className="lesson-editor-menu-item is-compact"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      item.run(editor);
                      setTurnOpen(false);
                    }}
                  >
                    <span className="lesson-editor-menu-icon" aria-hidden="true">{item.icon}</span>
                    <span className="lesson-editor-menu-text"><strong>{item.label}</strong></span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="lesson-editor-format-divider" aria-hidden="true" />
          {mark("bold", "Bold", <Bold />, () => editor.chain().focus().toggleBold().run(), "Ctrl+B")}
          {mark("italic", "Italic", <Italic />, () => editor.chain().focus().toggleItalic().run(), "Ctrl+I")}
          {mark("strike", "Strikethrough", <Strikethrough />, () => editor.chain().focus().toggleStrike().run(), "Ctrl+Shift+S")}
          {mark("code", "Inline code", <Code />, () => editor.chain().focus().toggleCode().run(), "Ctrl+E")}
          {mark("link", "Link", <Link2 />, openLink, "Ctrl+K")}
        </>
      )}
    </BubbleMenu>
  );
}

/* The toolbar above the page, like a post editor's ------------------------- */

// Where a block from the toolbar goes: into an empty line, or after the block
// the caret is in, so it never splits a paragraph.
function toolbarRange(editor: Editor): Range {
  const { $from } = editor.state.selection;
  if ($from.depth === 0) return { from: $from.pos, to: $from.pos };
  if ($from.parent.type.name === "paragraph" && $from.parent.childCount === 0 && $from.depth === 1) return { from: $from.pos, to: $from.pos };
  const after = $from.after(1);
  return { from: after, to: after };
}

const slashItem = (key: string) => SLASH_ITEMS.find((item) => item.key === key)!;
const TOOLBAR_LESSON_KEYS = ["button", "checklist", "quiz", "form"];
const TOOLBAR_MORE_KEYS = ["divider", "code", "video", "table", "embed"];

type ToolbarMenu = { key: string; rect: DOMRect } | null;

function ToolbarMenuList(props: {
  menu: NonNullable<ToolbarMenu>;
  items: { key: string; title: string; hint?: string; icon: ReactNode; active?: boolean; run: () => void }[];
  host: HTMLElement | null;
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && ref.current?.contains(event.target as Node)) return;
      props.onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  });
  const style = {
    left: Math.max(8, Math.min(props.menu.rect.left, window.innerWidth - 268)),
    top: props.menu.rect.bottom + 6,
  };
  return createPortal(
    <div ref={ref} className="lesson-editor-menu lesson-editor-toolbar-menu" style={style} role="menu" aria-label={props.label}>
      {props.items.map((item) => (
        <button
          key={item.key}
          type="button"
          role={item.active === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.active}
          className={`lesson-editor-menu-item${item.hint ? "" : " is-compact"}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            item.run();
            props.onClose();
          }}
        >
          <span className="lesson-editor-menu-icon" aria-hidden="true">{item.icon}</span>
          <span className="lesson-editor-menu-text">
            <strong>{item.title}</strong>
            {item.hint ? <small>{item.hint}</small> : null}
          </span>
          {item.active ? <Check className="lesson-editor-menu-check" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>,
    props.host?.closest<HTMLElement>("[data-community-theme]") ?? document.body,
  );
}

function Toolbar({ editor, followAlong, openLinkRef, host }: {
  editor: Editor;
  followAlong: boolean;
  openLinkRef: { current: (() => void) | null };
  host: HTMLElement | null;
}) {
  const [menu, setMenu] = useState<ToolbarMenu>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const rerender = () => setTick((tick) => tick + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("update", rerender);
    editor.on("focus", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("update", rerender);
      editor.off("focus", rerender);
    };
  }, [editor]);
  const run = (key: string, block: boolean) => {
    const range = block ? toolbarRange(editor) : { from: editor.state.selection.from, to: editor.state.selection.from };
    slashItem(key).run(editor, range);
  };
  const button = (key: string, label: string, icon: ReactNode, onClick: () => void, options: { active?: boolean; disabled?: boolean; shortcut?: string } = {}) => (
    <button
      key={key}
      type="button"
      className={`lesson-editor-tool${options.active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={options.active === undefined ? undefined : options.active}
      title={options.shortcut ? `${label} (${options.shortcut})` : label}
      disabled={options.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  const toggleMenu = (key: string) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((current) => (current?.key === key ? null : { key, rect }));
  };
  const menuButton = (key: string, label: string, content: ReactNode) => (
    <button
      type="button"
      className={`lesson-editor-tool is-labelled${menu?.key === key ? " is-open" : ""}`}
      aria-haspopup="menu"
      aria-expanded={menu?.key === key}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggleMenu(key)}
      title={label}
    >
      {content}
      <ChevronDown className="lesson-editor-tool-caret" aria-hidden="true" />
    </button>
  );
  const style = TURN_INTO.slice(0, 4).find((item) => item.isActive(editor)) ?? null;
  const inCode = editor.isActive("codeBlock");
  const divider = (key: string) => <span key={key} className="lesson-editor-tool-divider" aria-hidden="true" />;
  const menuItems = !menu
    ? []
    : menu.key === "style"
      ? TURN_INTO.slice(0, 4).map((item) => ({ key: item.key, title: item.label, icon: item.icon, active: item === style, run: () => item.run(editor) }))
      : (menu.key === "lesson" ? TOOLBAR_LESSON_KEYS : TOOLBAR_MORE_KEYS).map((key) => {
          const item = slashItem(key);
          return { key, title: item.title, hint: item.hint, icon: item.icon, run: () => run(key, key !== "code") };
        });

  return (
    <div className="lesson-editor-toolbar" role="toolbar" aria-label="Formatting">
      <div className="lesson-editor-toolbar-row">
        {button("undo", "Undo", <Undo2 />, () => editor.chain().focus().undo().run(), { disabled: !editor.can().undo(), shortcut: "Ctrl+Z" })}
        {button("redo", "Redo", <Redo2 />, () => editor.chain().focus().redo().run(), { disabled: !editor.can().redo(), shortcut: "Ctrl+Shift+Z" })}
        {divider("d1")}
        {menuButton("style", "Text style", <span className="lesson-editor-tool-label">{style?.label ?? "Style"}</span>)}
        {divider("d2")}
        {button("bold", "Bold", <Bold />, () => editor.chain().focus().toggleBold().run(), { active: editor.isActive("bold"), disabled: inCode, shortcut: "Ctrl+B" })}
        {button("italic", "Italic", <Italic />, () => editor.chain().focus().toggleItalic().run(), { active: editor.isActive("italic"), disabled: inCode, shortcut: "Ctrl+I" })}
        {button("strike", "Strikethrough", <Strikethrough />, () => editor.chain().focus().toggleStrike().run(), { active: editor.isActive("strike"), disabled: inCode, shortcut: "Ctrl+Shift+S" })}
        {button("inline-code", "Inline code", <Code />, () => editor.chain().focus().toggleCode().run(), { active: editor.isActive("code"), disabled: inCode, shortcut: "Ctrl+E" })}
        {button("link", "Link", <Link2 />, () => openLinkRef.current?.(), { active: editor.isActive("link"), disabled: editor.state.selection.empty || inCode, shortcut: "Ctrl+K" })}
        {divider("d3")}
        {button("image", "Image", <ImagePlus />, () => run("image", true))}
        {button("quote", "Callout", <Quote />, () => run("quote", false), { active: editor.isActive("blockquote") })}
        {button("bullets", "Bulleted list", <List />, () => run("bullets", false), { active: editor.isActive("bulletList") })}
        {button("numbers", "Numbered list", <ListOrdered />, () => run("numbers", false), { active: editor.isActive("orderedList") })}
        {divider("d4")}
        {followAlong ? menuButton("lesson", "Add a lesson block", <><CircleHelp aria-hidden="true" /><span className="lesson-editor-tool-label">Lesson</span></>) : null}
        {menuButton("more", "More blocks", <span className="lesson-editor-tool-label">More</span>)}
      </div>
      {menu ? (
        <ToolbarMenuList
          menu={menu}
          items={menuItems}
          host={host}
          label={menu.key === "style" ? "Text style" : menu.key === "lesson" ? "Lesson blocks" : "More blocks"}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/* Block handle: add below, drag to move, and a block menu ------------------- */

type HoverBlock = { pos: number; top: number; height: number };

function topLevelBlockAt(view: EditorView, clientY: number): HoverBlock | null {
  const host = view.dom.getBoundingClientRect();
  let found: HoverBlock | null = null;
  view.state.doc.forEach((_node, offset) => {
    if (found) return;
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    // Count the margin around a block as part of it, so the handle doesn't flicker.
    if (clientY >= rect.top - 10 && clientY <= rect.bottom + 10) {
      found = { pos: offset, top: rect.top - host.top, height: rect.height };
    }
  });
  return found;
}

function BlockHandle({ editor, hover, onClose }: { editor: Editor; hover: HoverBlock; onClose: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [hover.pos]);
  const node = editor.state.doc.nodeAt(hover.pos);
  if (!node) return null;

  const selectBlock = () => {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hover.pos)));
  };
  const addBelow = () => {
    const at = hover.pos + node.nodeSize;
    if (node.type.name === "paragraph" && node.childCount === 0) {
      editor.chain().focus().insertContentAt(hover.pos + 1, "/").run();
      return;
    }
    editor.chain().insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1).insertContent("/").focus().run();
  };
  const move = (direction: -1 | 1) => {
    const { doc } = editor.state;
    const $pos = doc.resolve(hover.pos);
    const index = $pos.index(0);
    const target = index + direction;
    if (target < 0 || target >= doc.childCount) return;
    const tr = editor.state.tr;
    tr.delete(hover.pos, hover.pos + node.nodeSize);
    let insertAt = 0;
    for (let i = 0; i < target; i += 1) insertAt += tr.doc.child(i).nodeSize;
    tr.insert(insertAt, node);
    tr.setSelection(NodeSelection.create(tr.doc, insertAt)).scrollIntoView();
    editor.view.dispatch(tr);
    editor.commands.focus();
  };
  const duplicate = () => {
    let copy: PMNode = node;
    if (node.type.name === "lessonBlock") {
      const id = lessonBlockId(node.attrs as never);
      if (id) {
        const taken = takenBlockIds(editor);
        let n = 2;
        while (taken.has(`${id}-${n}`)) n += 1;
        const [, ...flags] = String(node.attrs.info).trim().split(/\s+/);
        copy = node.type.create({ ...node.attrs, info: [`${id}-${n}`, ...flags].join(" ") });
      }
    }
    const at = hover.pos + node.nodeSize;
    const tr = editor.state.tr.insert(at, copy);
    editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
    editor.commands.focus();
  };
  const remove = () => {
    editor.view.dispatch(editor.state.tr.delete(hover.pos, hover.pos + node.nodeSize));
    editor.commands.focus();
    onClose();
  };

  const onDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    const view = editor.view;
    const selection = NodeSelection.create(view.state.doc, hover.pos);
    view.dispatch(view.state.tr.setSelection(selection));
    const slice = selection.content();
    const { dom, text } = view.serializeForClipboard(slice);
    event.dataTransfer.clearData();
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/html", dom.innerHTML);
    event.dataTransfer.setData("text/plain", text);
    const blockDom = view.nodeDOM(hover.pos);
    if (blockDom instanceof HTMLElement) event.dataTransfer.setDragImage(blockDom, 0, 0);
    (view as unknown as { dragging: { slice: Slice; move: boolean } | null }).dragging = { slice, move: true };
  };

  const lineHeight = Math.min(hover.height, 28);
  return (
    <div className="lesson-editor-handle" style={{ top: hover.top + Math.max(0, (lineHeight - 24) / 2) }}>
      <button type="button" className="lesson-editor-handle-button" aria-label="Add a block below" title="Add a block below" onClick={addBelow}>
        <Plus aria-hidden="true" />
      </button>
      <button
        type="button"
        draggable
        className="lesson-editor-handle-button is-grip"
        aria-label="Drag to move, or click for block options"
        title="Drag to move · Click for options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onDragStart={onDragStart}
        onClick={() => {
          selectBlock();
          setMenuOpen(!menuOpen);
        }}
      >
        <GripVertical aria-hidden="true" />
      </button>
      {menuOpen ? (
        <div className="lesson-editor-menu lesson-editor-block-menu" role="menu">
          <button type="button" role="menuitem" className="lesson-editor-menu-item is-compact" onClick={() => move(-1)}>
            <span className="lesson-editor-menu-icon" aria-hidden="true"><ArrowUp /></span><span className="lesson-editor-menu-text"><strong>Move up</strong></span>
          </button>
          <button type="button" role="menuitem" className="lesson-editor-menu-item is-compact" onClick={() => move(1)}>
            <span className="lesson-editor-menu-icon" aria-hidden="true"><ArrowDown /></span><span className="lesson-editor-menu-text"><strong>Move down</strong></span>
          </button>
          <button type="button" role="menuitem" className="lesson-editor-menu-item is-compact" onClick={duplicate}>
            <span className="lesson-editor-menu-icon" aria-hidden="true"><Copy /></span><span className="lesson-editor-menu-text"><strong>Duplicate</strong></span>
          </button>
          <button type="button" role="menuitem" className="lesson-editor-menu-item is-compact is-danger" onClick={remove}>
            <span className="lesson-editor-menu-icon" aria-hidden="true"><Trash2 /></span><span className="lesson-editor-menu-text"><strong>Delete</strong></span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* Paste and drop ------------------------------------------------------------ */

const MARKDOWN_SIGNS = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~|\|.*\|\s*$|!\[)/m;
const INLINE_MARKDOWN = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`/;

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

/* The editor ---------------------------------------------------------------- */

export default function LessonEditor(props: LessonEditorProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const lessonRef = useRef<LessonDocument | null>(null);
  const lastEmittedRef = useRef(props.initialMarkdown);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [hover, setHover] = useState<HoverBlock | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bridge = useRef<SlashBridge>({ props: null, index: 0, set: () => undefined, followAlong: true });
  bridge.current.set = setSlash;
  bridge.current.followAlong = props.followAlong ?? true;
  const editorRef = useRef<Editor | null>(null);
  const openLinkRef = useRef<(() => void) | null>(null);

  const startUpload = useCallback((file: File, options: { replacePos?: number; insertPos?: number } = {}) => {
    const editor = editorRef.current;
    const upload = propsRef.current.onUploadImage;
    if (!editor || !upload) return;
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const preview = URL.createObjectURL(file);
    const replacing = options.replacePos !== undefined ? editor.state.doc.nodeAt(options.replacePos) : null;
    const previousSrc = replacing ? String(replacing.attrs.src ?? "") : "";
    if (replacing && options.replacePos !== undefined) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(options.replacePos, undefined, { ...replacing.attrs, src: preview, uploadId }));
    } else {
      const content = { type: "image", attrs: { src: preview, alt: "", uploadId } };
      if (options.insertPos !== undefined) editor.chain().insertContentAt(options.insertPos, content).run();
      else editor.chain().focus().insertContent(content).run();
    }
    const withUpload = (apply: (pos: number, node: PMNode) => void) => {
      const current = editorRef.current;
      if (!current || current.isDestroyed) return;
      current.state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.uploadId === uploadId) apply(pos, node);
      });
    };
    upload(file)
      .then((url) => withUpload((pos, node) => {
        const current = editorRef.current!;
        current.view.dispatch(current.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url, uploadId: null }));
      }))
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "That image didn't upload. Try again.");
        withUpload((pos, node) => {
          const current = editorRef.current!;
          current.view.dispatch(previousSrc
            ? current.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: previousSrc, uploadId: null })
            : current.state.tr.delete(pos, pos + node.nodeSize));
        });
      })
      .finally(() => window.setTimeout(() => URL.revokeObjectURL(preview), 60_000));
  }, []);

  const services = useMemo<LessonEditorServices>(() => ({
    uploadImage: props.onUploadImage ? (file, replacePos) => startUpload(file, { replacePos }) : null,
    describeVideo,
  }), [props.onUploadImage, startUpload]);

  const extensions = useMemo(() => [
    ...lessonEditorBaseExtensions().map((extension) => {
      if (extension === LessonImage) return LessonImage.extend({ addNodeView: () => ReactNodeViewRenderer(LessonImageView) });
      if (extension === LessonVideo) return LessonVideo.extend({ addNodeView: () => ReactNodeViewRenderer(LessonVideoView) });
      if (extension === LessonFencedBlock) return LessonFencedBlock.extend({ addNodeView: () => ReactNodeViewRenderer(LessonFencedBlockView) });
      if (extension === LessonRawMarkdown) return LessonRawMarkdown.extend({ addNodeView: () => ReactNodeViewRenderer(LessonRawMarkdownView) });
      return extension;
    }),
    Placeholder.configure({
      placeholder: ({ editor, node }) => {
        if (node.type.name === "heading") return "Heading";
        return editor.state.doc.childCount <= 1 ? "Write your lesson, or press / for headings, images, quizzes and more" : "Press / for blocks";
      },
      showOnlyCurrent: true,
    }),
    slashExtension(bridge.current),
    Extension.create({
      name: "lessonKeys",
      addKeyboardShortcuts: () => ({
        "Mod-Enter": () => {
          propsRef.current.onDone();
          return true;
        },
        "Mod-s": () => {
          propsRef.current.onSaveNow();
          return true;
        },
        "Mod-k": () => {
          if (!openLinkRef.current) return false;
          openLinkRef.current();
          return true;
        },
      }),
    }),
  ], []);

  const editor = useEditor({
    extensions,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "resource-viewer-prose lesson-editor-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Lesson body",
      },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length && propsRef.current.onUploadImage) {
          event.preventDefault();
          files.forEach((file) => startUpload(file));
          return true;
        }
        const { $from } = view.state.selection;
        if ($from.parent.type.spec.code) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html") ?? "";
        const trimmed = text.trim();
        // A video link pasted on an empty line becomes the player.
        if (/^https?:\/\/\S+$/.test(trimmed) && isVideoUrl(trimmed) && $from.parent.type.name === "paragraph" && $from.parent.childCount === 0) {
          const pos = $from.before();
          view.dispatch(view.state.tr.replaceWith(pos, pos + $from.parent.nodeSize, view.state.schema.nodes.video.create({ url: trimmed })));
          return true;
        }
        // Markdown from an agent, a doc or a text file arrives formatted.
        if (!html && trimmed && (MARKDOWN_SIGNS.test(text) || INLINE_MARKDOWN.test(text))) {
          const nodes = parseMarkdownFragment(view.state.schema, text, { isVideoUrl });
          const single = nodes.length === 1 && nodes[0].type.name === "paragraph";
          const slice = single ? new Slice(Fragment.from(nodes[0]), 1, 1) : new Slice(Fragment.from(nodes), 0, 0);
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length || !propsRef.current.onUploadImage) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const $at = view.state.doc.resolve(at?.pos ?? view.state.selection.from);
        const insertPos = $at.depth > 0 ? $at.after(1) : $at.pos;
        files.forEach((file) => startUpload(file, { insertPos }));
        return true;
      },
    },
    onCreate: ({ editor: created }) => {
      const lesson = parseLessonMarkdown(created.schema, propsRef.current.initialMarkdown, { isVideoUrl });
      lessonRef.current = lesson;
      const tr = created.state.tr.replaceWith(0, created.state.doc.content.size, lesson.doc.content);
      tr.setMeta("addToHistory", false);
      tr.setSelection(TextSelection.atEnd(tr.doc));
      created.view.dispatch(tr);
    },
    onUpdate: ({ editor: updated }) => {
      const lesson = lessonRef.current;
      if (!lesson) return;
      const markdown = lesson.serialize(updated.state.doc);
      if (markdown === lastEmittedRef.current) return;
      lastEmittedRef.current = markdown;
      propsRef.current.onChange(markdown);
    },
  });
  editorRef.current = editor;

  // The caret starts where the owner clicked the lesson.
  useEffect(() => {
    if (!editor) return;
    const onFocus = () => propsRef.current.onFocus?.();
    editor.on("focus", onFocus);
    if (!propsRef.current.autoFocus) return () => void editor.off("focus", onFocus);
    const id = window.requestAnimationFrame(() => {
      const at = propsRef.current.focusAt;
      const hit = at ? editor.view.posAtCoords({ left: at.x, top: at.y }) : null;
      if (hit) editor.chain().focus().setTextSelection(hit.pos).run();
      else editor.commands.focus("end");
    });
    return () => {
      window.cancelAnimationFrame(id);
      editor.off("focus", onFocus);
    };
  }, [editor]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (!editor) return null;

  return (
    <LessonEditorServicesContext.Provider value={services}>
      <div
        ref={wrapperRef}
        className="lesson-editor"
        onMouseMove={(event) => {
          if ((event.target as HTMLElement).closest(".lesson-editor-handle")) return;
          if ((event.target as HTMLElement).closest(".lesson-editor-toolbar")) {
            setHover(null);
            return;
          }
          const next = topLevelBlockAt(editor.view, event.clientY);
          setHover((current) => (current?.pos === next?.pos && current?.top === next?.top ? current : next));
        }}
        onMouseLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !wrapperRef.current?.contains(event.relatedTarget)) setHover(null);
        }}
      >
        <Toolbar editor={editor} followAlong={props.followAlong ?? true} openLinkRef={openLinkRef} host={wrapperRef.current} />
        {hover ? <BlockHandle editor={editor} hover={hover} onClose={() => setHover(null)} /> : null}
        <EditorContent editor={editor} />
        <FormatBar editor={editor} openLinkRef={openLinkRef} />
        {slash ? (
          <SlashMenu
            state={slash}
            host={wrapperRef.current}
            onPick={(index) => {
              const item = bridge.current.props?.items[index];
              if (item) bridge.current.props?.command(item);
            }}
          />
        ) : null}
        {notice ? <div className="lesson-editor-notice" role="status">{notice}</div> : null}
      </div>
    </LessonEditorServicesContext.Provider>
  );
}
