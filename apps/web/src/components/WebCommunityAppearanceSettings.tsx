import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CalendarDays, Check, ChevronDown, ChevronLeft, GraduationCap, MessagesSquare, Monitor, Palette, Smartphone, type LucideIcon } from "lucide-react";
import {
  compileCommunityThemeCss,
  communityTextLevels,
  communityThemeFontStylesheetUrl,
  contrastRatio,
  COMMUNITY_THEME_FONTS,
  DEFAULT_COMMUNITY_THEME,
  normalizeCommunityTheme,
  type CommunityThemeColors,
  type CommunityThemeProblem,
  type CommunityThemeScheme,
  type CommunityThemeV1,
} from "../../../../shared/communityTheme";
import { COMMUNITY_THEME_PRESETS, type CommunityThemePreset } from "../../../../shared/communityThemePresets";
import {
  discardCloudCommunityThemeDraft,
  fetchCloudCommunityThemeDraft,
  publishCloudCommunityThemeDraft,
  saveCloudCommunityThemeDraft,
  type CommunityThemeDraftState,
} from "../../../../shared/cloudCommunityThemeGateway";
import {
  APPEARANCE_PREVIEW_PARAM,
  APPEARANCE_PREVIEW_READY_MESSAGE,
  APPEARANCE_PREVIEW_THEME_MESSAGE,
  COMMUNITY_THEME_PUBLISHED_EVENT,
} from "../controllers/useWebCommunityThemeStyle";
import "./WebCommunityAppearanceSettings.css";

// hasBanner: the community has a banner image, so the side column prints its name over it.
type Props = { communityId: string; communitySlug: string | null; hasBanner?: boolean; session: unknown; ensureSession: (session: any) => Promise<any | null> };

const PREVIEW_SCOPE = "look-preview";
// The width the Desktop preview lays the community out at before scaling it to fit.
const DESKTOP_PREVIEW_WIDTH = 1280;
const MIN_PREVIEW_SCALE = 0.6;
const CUSTOMIZE_HASH = "#customize";
const TEXT_FONTS = Object.entries(COMMUNITY_THEME_FONTS).filter(([, font]) => font.role === "text").map(([name]) => name);
const HEADING_FONTS = Object.entries(COMMUNITY_THEME_FONTS).filter(([, font]) => font.role !== "mono").map(([name]) => name);
const COLOR_FIELDS: [keyof CommunityThemeColors, string][] = [
  ["background", "Background"], ["surface", "Cards"], ["text", "Text"], ["muted", "Secondary text"],
  ["border", "Borders"], ["accent", "Accent"], ["on_accent", "Text on accent"], ["button", "Buttons"], ["on_button", "Button text"],
];
type ChoiceKey = "heading_case" | "numerals" | "corner_style" | "shadow" | "density" | "button_shape" | "course_cover_ratio" | "course_card_size" | "course_cover_plate" | "course_cover_fit" | "media_plate" | "banner_name" | "channels_look" | "rail_size" | "rail_color";
const CHOICES: Record<ChoiceKey, [string, [string, string][]]> = {
  heading_case: ["Heading case", [["none", "As typed"], ["upper", "UPPERCASE"]]],
  numerals: ["Numbers", [["proportional", "Natural"], ["tabular", "Even width (for tables)"]]],
  corner_style: ["Corner style", [["even", "Even"], ["sketch", "Hand-drawn"]]],
  shadow: ["Shadows", [["none", "None"], ["soft", "Soft"], ["hard", "Hard"]]],
  density: ["Spacing", [["compact", "Compact"], ["comfortable", "Comfortable"], ["roomy", "Roomy"]]],
  button_shape: ["Buttons", [["rounded", "Rounded"], ["pill", "Pill"], ["square", "Square"], ["sketch", "Sketch"]]],
  course_cover_ratio: ["Cover shape", [["auto", "Polynet default"], ["16:9", "Wide 16:9"], ["3:2", "Photo 3:2"], ["4:3", "Classic 4:3"], ["1:1", "Square"], ["21:9", "Banner 21:9"]]],
  course_card_size: ["Card size", [["default", "Two columns"], ["small", "Small"], ["medium", "Medium"], ["large", "Large"]]],
  course_cover_plate: ["Cover background (light scheme)", [["none", "Plain"], ["tint", "Soft accent tint"]]],
  course_cover_fit: ["Cover pictures", [["crop", "Fill the box"], ["whole", "Show whole picture"]]],
  media_plate: ["White images (dark scheme)", [["none", "As they are"], ["light", "On a light plate"]]],
  banner_name: ["Name on the banner", [["show", "Show it"], ["hide", "Hide it"]]],
  channels_look: ["Page style", [["current", "Polynet (today)"], ["quiet", "Quiet: plain menu, one column"], ["reader", "Reader: reading column, post lists"], ["publication", "Publication: masthead, editorial cards"]]],
  rail_size: ["Icon size", [["standard", "Standard"], ["large", "Bigger"]]],
  rail_color: ["Colour", [["polynet", "Polynet (today)"], ["blend", "Blend with the page"], ["tint", "Soft brand tint"], ["brand", "Solid brand colour"]]],
};
// The community pages the preview can show, by their tab in the address.
const PREVIEW_PAGES: [string, string][] = [["chat", "Chat"], ["resources", "Courses"], ["events", "Events"]];
const PAGE_ICONS: Record<string, LucideIcon> = { chat: MessagesSquare, resources: GraduationCap, events: CalendarDays };
type SchemeMode = "light" | "dark" | "both";
const SCHEME_MODES: [SchemeMode, string][] = [["light", "Always light"], ["dark", "Always dark"], ["both", "Member chooses"]];

function problemText(error: unknown): CommunityThemeProblem[] | string {
  const data = (error as { data?: { code?: string; problems?: CommunityThemeProblem[] } })?.data;
  if (data?.problems?.length) return data.problems;
  if (data?.code === "community_theme_revision_conflict") return "The look changed in another session. Reload to continue.";
  return "Could not save. Your changes are still here. Try again.";
}

// White or near-black, whichever reads better on `fill`.
function readableOn(fill: string): string {
  return contrastRatio("#FFFFFF", fill) >= contrastRatio("#0B0B0B", fill) ? "#FFFFFF" : "#0B0B0B";
}

function schemeMode(theme: CommunityThemeV1): SchemeMode {
  if (theme.schemes.light && theme.schemes.dark) return "both";
  return theme.schemes.dark ? "dark" : "light";
}

// The theme with only one scheme, so a preview shows it whatever the app is in.
function withOneScheme(theme: CommunityThemeV1, scheme: CommunityThemeScheme): CommunityThemeV1 {
  const colors = theme.schemes[scheme];
  return colors ? { ...theme, schemes: { [scheme]: colors } } : theme;
}

function Swatches(props: { colors: CommunityThemeColors | undefined }) {
  if (!props.colors) return null;
  const keys: (keyof CommunityThemeColors)[] = ["background", "surface", "text", "accent", "button"];
  return <span className="appearance-swatches" aria-hidden="true">{keys.map((key) => <span key={key} style={{ background: props.colors?.[key] }} />)}</span>;
}

// The starting point the theme still matches exactly, if any.
function matchingPreset(theme: CommunityThemeV1): CommunityThemePreset | null {
  return COMMUNITY_THEME_PRESETS.find((preset) => JSON.stringify(preset.theme) === JSON.stringify(theme)) ?? null;
}

// A label on the left with a muted line of help under it, Substack's settings row.
function Fact(props: { label: string; help: string; children: ReactNode }) {
  return <div className="appearance-fact">
    <dt><span className="appearance-label">{props.label}</span><span className="appearance-help">{props.help}</span></dt>
    <dd>{props.children}</dd>
  </div>;
}

// The owner's fonts, sizing and colours, kept as a draft until published. The
// pane sums up the look; Customize opens a full-screen editor beside the real
// community, like a website builder. The same draft the CLI and agents edit.
export function WebCommunityAppearanceSettings(props: Props) {
  const [state, setState] = useState<CommunityThemeDraftState | null>(null);
  const [theme, setTheme] = useState<CommunityThemeV1 | null>(null);
  const [scheme, setScheme] = useState<CommunityThemeScheme>("light");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommunityThemeProblem[] | string | null>(null);
  const [reload, setReload] = useState(0);
  const [customizing, setCustomizing] = useState(() => typeof window !== "undefined" && window.location.hash === CUSTOMIZE_HASH);
  const customizeButton = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const uid = useId();
  const alive = useRef(true);
  // Set in the body too: StrictMode's dev double-mount runs the cleanup once,
  // which would otherwise leave every save and publish stuck on "Saving…".
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const run = async <T,>(operation: (session: unknown) => Promise<T>) => {
    const session = await props.ensureSession(props.session);
    if (!session) throw new Error("auth_session_required");
    return operation(session);
  };
  useEffect(() => {
    let active = true;
    setError(null);
    run((session) => fetchCloudCommunityThemeDraft({ session, communityId: props.communityId }))
      .then((loaded) => {
        if (!active) return;
        setState(loaded); setTheme(loaded.draft);
        setScheme(loaded.draft.schemes.light ? "light" : "dark");
      })
      .catch(() => { if (active) setError("Could not load this community's look."); });
    return () => { active = false; };
  }, [props.communityId, reload]);

  // The address says when the editor is open, so it can be linked to directly.
  const openCustomize = (open: boolean) => {
    setCustomizing(open);
    const url = new URL(window.location.href);
    url.hash = open ? CUSTOMIZE_HASH : "";
    window.history.replaceState(window.history.state, "", url.toString());
    if (!open) window.requestAnimationFrame(() => customizeButton.current?.focus());
  };

  const check = useMemo(() => (theme ? normalizeCommunityTheme(theme) : null), [theme]);
  // Previews show the scheme being edited, whatever the app is in now.
  const previewTheme = useMemo(() => (check?.ok ? withOneScheme(check.theme, scheme) : null), [check, scheme]);
  const previewCss = useMemo(() => (previewTheme ? compileCommunityThemeCss(previewTheme, `[data-community-theme="${PREVIEW_SCOPE}"]`) : ""), [previewTheme]);
  const fontUrl = check?.ok ? communityThemeFontStylesheetUrl(check.theme) : null;
  const dirty = Boolean(state && theme && JSON.stringify(state.draft) !== JSON.stringify(theme));

  if (!theme || !state) {
    return <div className="settings-section">{typeof error === "string" ? <p role="alert">{error} <button className="secondary" type="button" onClick={() => setReload((n) => n + 1)}>Retry</button></p> : <p role="status">Loading…</p>}</div>;
  }
  const set = (change: Partial<CommunityThemeV1>) => { setError(null); setTheme({ ...theme, ...change }); };
  const act = async (operation: () => Promise<CommunityThemeDraftState>, published = false) => {
    setBusy(true); setError(null);
    try {
      const next = await operation();
      if (!alive.current) return;
      setState(next); setTheme(next.draft);
      if (published) window.dispatchEvent(new CustomEvent(COMMUNITY_THEME_PUBLISHED_EVENT, { detail: { communityId: props.communityId } }));
    } catch (caught) {
      if (alive.current) setError(problemText(caught));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const save = () => act(() => run((session) => saveCloudCommunityThemeDraft({ session, communityId: props.communityId, expectedDraftRevision: state.draftRevision, theme })));
  const publish = () => act(async () => {
    const saved = dirty ? await run((session) => saveCloudCommunityThemeDraft({ session, communityId: props.communityId, expectedDraftRevision: state.draftRevision, theme })) : state;
    // Keep the saved draft even if publishing then fails, so a retry publishes
    // this revision instead of saving again against the old one.
    if (dirty && alive.current) { setState(saved); setTheme(saved.draft); }
    return run((session) => publishCloudCommunityThemeDraft({ session, communityId: props.communityId, expectedDraftRevision: saved.draftRevision }));
  }, true);
  const discard = () => act(() => run((session) => discardCloudCommunityThemeDraft({ session, communityId: props.communityId, expectedDraftRevision: state.draftRevision })));
  const undoOrDiscard = () => { if (dirty) setTheme(state.draft); else void discard(); };
  const problems = check && !check.ok ? check.problems : Array.isArray(error) ? error : [];
  const statusText = busy ? "Working…" : dirty ? "Unsaved changes" : state.hasUnpublishedChanges ? "Draft saved · not published" : state.published ? "Published" : "Polynet default";
  // The dot beside the status: green once published, amber while members can't see the changes yet.
  const statusTone = busy ? "busy" : dirty || state.hasUnpublishedChanges ? "draft" : state.published ? "live" : "default";
  const status = <span className={`appearance-status is-${statusTone}`} role="status"><i aria-hidden="true" />{statusText}</span>;

  const problemList = <div role="status">{problems.length ? <ul className="auth-error community-look-problems">{problems.map((problem, i) => <li key={i} id={`${uid}-problem-${i}`}>{problem.message}{problem.suggestion ? ` Try ${problem.suggestion}.` : ""}</li>)}</ul> : null}</div>;
  const errorLine = typeof error === "string" ? <div className="auth-error" role="alert">{error}</div> : null;
  const actions = <>
    <button className="appearance-button" type="button" disabled={busy || (!dirty && !state.hasUnpublishedChanges)} onClick={undoOrDiscard}>{dirty ? "Undo changes" : "Discard draft"}</button>
    <button className="appearance-button" type="button" disabled={busy || !dirty || !check?.ok} onClick={() => void save()}>Save draft</button>
    <button className="appearance-button is-primary" type="button" disabled={busy || !check?.ok || (!dirty && !state.hasUnpublishedChanges)} onClick={() => void publish()}>Publish</button>
  </>;
  const shown = check?.ok ? check.theme : theme;
  const preset = matchingPreset(shown);
  const mode = schemeMode(shown);

  const hasDraft = dirty || state.hasUnpublishedChanges;
  // Like Substack's Settings → Website: a card that sums up the look and links
  // out to the visual editor instead of repeating its controls here.
  return <div ref={pane} className="settings-section community-look appearance-pane">
    <style>{previewCss}</style>
    {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
    <section className="appearance-card" aria-labelledby={`${uid}-title`}>
      <header className="appearance-card-header">
        <h2 id={`${uid}-title`}>Look and feel</h2>
        <p>The colours, fonts and shapes members see across your community.</p>
      </header>
      <div className="appearance-callout">
        <span className="appearance-callout-icon" aria-hidden="true"><Palette size={20} /></span>
        <div className="appearance-callout-text">
          <strong>Customize your community</strong>
          <small>Change the look beside a live preview. Members see it once you publish.</small>
        </div>
        <button ref={customizeButton} className="appearance-button is-primary" type="button" onClick={() => openCustomize(true)}>
          Customize <ArrowRight size={16} aria-hidden="true" /></button>
      </div>
      <dl className="appearance-facts">
        <Fact label="Theme" help="The starting point, until you change it">{preset ? preset.name : "Your own look"}</Fact>
        <Fact label="Colours" help={SCHEME_MODES.find(([key]) => key === mode)?.[1] ?? ""}>
          {(["light", "dark"] as const).filter((key) => shown.schemes[key]).map((key) => <span key={key} className="appearance-summary-scheme"><Swatches colors={shown.schemes[key]} />{key === "light" ? "Light" : "Dark"}</span>)}
        </Fact>
        <Fact label="Fonts" help="Headings and body text">{shown.font_heading === shown.font_body ? shown.font_body : `${shown.font_heading} and ${shown.font_body}`}</Fact>
        <Fact label="Status" help="Members see only what you publish">{status}</Fact>
      </dl>
      {customizing ? null : <>{problemList}{errorLine}</>}
      {!customizing && hasDraft ? <footer className="appearance-card-footer">
        <span className="appearance-help">{dirty ? "You have changes that aren't saved." : "Members don't see your draft yet."}</span>
        <div className="appearance-actions">{actions}</div>
      </footer> : null}
    </section>
    {customizing ? <AppearanceEditor
      theme={theme} scheme={scheme} setScheme={setScheme} set={set} busy={busy} problems={problems} uid={uid}
      previewTheme={previewTheme} communityId={props.communityId} communitySlug={props.communitySlug} hasBanner={Boolean(props.hasBanner)} pane={pane}
      status={status} actions={actions} footer={<>{problemList}{errorLine}</>}
      onClose={() => openCustomize(false)}
    /> : null}
  </div>;
}

function SampleContent() {
  return <div className="community-look-sample">
    <small>Preview</small>
    <h2>Build your first AI employee</h2>
    <p>Lessons, check-ins and your community in one place. This is how text reads at the size you picked.</p>
    <div className="community-look-card"><strong>Module 1 · Foundations</strong><span>3 of 5 lessons done</span></div>
    <button type="button" className="settings-primary-action" tabIndex={-1}>Continue lesson</button>
  </div>;
}

type EditorProps = {
  theme: CommunityThemeV1;
  scheme: CommunityThemeScheme;
  setScheme: (scheme: CommunityThemeScheme) => void;
  set: (change: Partial<CommunityThemeV1>) => void;
  busy: boolean;
  problems: CommunityThemeProblem[];
  uid: string;
  previewTheme: CommunityThemeV1 | null;
  communityId: string;
  communitySlug: string | null;
  hasBanner: boolean;
  // The Settings pane the editor opened from: the editor wears the same community colours.
  pane: { current: HTMLElement | null };
  status: ReactNode;
  actions: ReactNode;
  footer: ReactNode;
  onClose: () => void;
};

// A group of inspector rows under a small uppercase label, like Substack's
// website editor: label on the left, control on the right.
function Group(props: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className="appearance-group" aria-labelledby={id}>
    <h3 id={id}>{props.title}</h3>
    {props.children}
  </section>;
}

function Row(props: { label: ReactNode; htmlFor?: string; children: ReactNode; wide?: boolean }) {
  return <div className={`appearance-row${props.wide ? " is-wide" : ""}`}>
    {props.htmlFor ? <label htmlFor={props.htmlFor}>{props.label}</label> : <span>{props.label}</span>}
    <div className="appearance-row-control">{props.children}</div>
  </div>;
}

const HEX = /^#?[0-9a-f]{6}$/i;

// A colour as Substack shows it: a swatch that opens the picker, and the hex.
function ColorField(props: { id: string; label: string; value: string; disabled: boolean; describedBy?: string; invalid?: boolean; onChange: (value: string) => void }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = () => {
    if (HEX.test(text.trim())) props.onChange(`#${text.trim().replace("#", "")}`.toUpperCase());
    else setText(props.value);
  };
  return <span className="appearance-color">
    <input type="color" aria-label={`${props.label} colour picker`} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value.toUpperCase())} />
    <input id={props.id} type="text" inputMode="text" spellCheck={false} maxLength={7} value={text} disabled={props.disabled}
      aria-invalid={props.invalid || undefined} aria-describedby={props.describedBy}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
  </span>;
}

// Starting points as a two-line list (name and what it is), with a check on
// the one the draft matches.
function PresetPicker(props: { theme: CommunityThemeV1; disabled: boolean; onPick: (preset: CommunityThemePreset) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = matchingPreset(props.theme);
  useEffect(() => { if (open) list.current?.focus(); }, [open]);
  const pick = (preset: CommunityThemePreset) => { props.onPick(preset); setOpen(false); button.current?.focus(); };
  return <div className="appearance-preset-picker">
    <button ref={button} type="button" className="appearance-select-button" disabled={props.disabled} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={`${id}-list`} onClick={() => { setActive(Math.max(0, COMMUNITY_THEME_PRESETS.indexOf(current as CommunityThemePreset))); setOpen(!open); }}>
      <span>{current ? current.name : "Your own look"}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open ? <ul ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label="Starting point" aria-activedescendant={`${id}-option-${active}`}
      className="appearance-menu"
      onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(COMMUNITY_THEME_PRESETS.length - 1, i + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(COMMUNITY_THEME_PRESETS[active]); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
      }}>
      {COMMUNITY_THEME_PRESETS.map((preset, i) => {
        const sample = preset.theme.schemes.light ?? preset.theme.schemes.dark;
        return <li key={preset.id} id={`${id}-option-${i}`} role="option" aria-selected={preset === current}
          className={i === active ? "is-active" : undefined} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(preset)}>
          <span className="appearance-menu-chips" aria-hidden="true"><i style={{ background: sample?.background, borderColor: sample?.border }} /><i style={{ background: sample?.accent }} /></span>
          <span className="appearance-menu-text"><strong>{preset.name}</strong><small>{preset.description}</small></span>
          {preset === current ? <Check size={16} aria-hidden="true" /> : null}
        </li>;
      })}
    </ul> : null}
  </div>;
}

// Full-screen editor laid out like Substack's website editor: pages on the
// left, the real community in the middle wearing the unsaved draft, and the
// design settings on the right.
function AppearanceEditor(props: EditorProps) {
  const { theme, scheme, set, busy } = props;
  const [page, setPage] = useState("resources");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLElement>(null);
  const [canvasBox, setCanvasBox] = useState<{ width: number; height: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastGoodTheme = useRef<CommunityThemeV1 | null>(props.previewTheme);
  if (props.previewTheme) lastGoodTheme.current = props.previewTheme;
  const previewTheme = props.previewTheme ?? lastGoodTheme.current;
  // The editor sits on document.body, outside the community's themed area, so
  // it carries the theme over from the pane, as Settings has it. Read before
  // the first paint, so it never flashes Polynet's own colours.
  const [themeScope, setThemeScope] = useState<string | null>(null);
  useLayoutEffect(() => {
    setThemeScope(props.pane.current?.closest("[data-community-theme]")?.getAttribute("data-community-theme") ?? null);
  }, []);

  // The rest of the app sits behind the editor: keep focus and screen readers here.
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    heading.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { root?.removeAttribute("inert"); window.removeEventListener("keydown", onKey); };
  }, []);

  // Desktop shows the community at a real desktop width, scaled down to fit,
  // so pages keep their wide layout instead of switching to the narrow one.
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCanvasBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The fitted frame sits inside a 1px border on each side. On small screens
  // it stops shrinking at MIN_PREVIEW_SCALE, so text stays readable.
  const innerWidth = canvasBox ? canvasBox.width - 2 : 0;
  const layoutWidth = Math.min(DESKTOP_PREVIEW_WIDTH, innerWidth / MIN_PREVIEW_SCALE);
  const scale = device === "desktop" && canvasBox && innerWidth < layoutWidth ? innerWidth / layoutWidth : 1;

  // The preview frame asks for the draft when it loads; every change is sent again.
  const send = () => {
    if (!previewTheme) return;
    frame.current?.contentWindow?.postMessage({ type: APPEARANCE_PREVIEW_THEME_MESSAGE, communityId: props.communityId, theme: previewTheme }, window.location.origin);
  };
  useEffect(send, [previewTheme]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type === APPEARANCE_PREVIEW_READY_MESSAGE) send();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  const problemFor = (path: string): { "aria-invalid"?: true; "aria-describedby"?: string } => {
    const ids = props.problems.map((problem, i) => (problem.path === path ? `${props.uid}-problem-${i}` : "")).filter(Boolean).join(" ");
    return ids ? { "aria-invalid": true, "aria-describedby": ids } : {};
  };
  const fieldId = (key: string) => `${props.uid}-field-${key.replace(/\W/g, "-")}`;
  const choice = (key: ChoiceKey) => {
    const [label, options] = CHOICES[key];
    return <Row key={key} label={label} htmlFor={fieldId(key)}>
      <select id={fieldId(key)} value={theme[key]} disabled={busy} {...problemFor(key)} onChange={(e) => set({ [key]: e.target.value } as Partial<CommunityThemeV1>)}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Row>;
  };
  const slider = (key: "heading_weight" | "type_scale" | "radius" | "border_width", label: string, min: number, max: number, step: number, unit: (value: number) => string) =>
    <Row key={key} label={<>{label} <span className="appearance-row-value">{unit(theme[key])}</span></>} htmlFor={fieldId(key)}>
      <input id={fieldId(key)} type="range" min={min} max={max} step={step} value={theme[key]} disabled={busy} {...problemFor(key)} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<CommunityThemeV1>)} /></Row>;
  const fontSelect = (key: "font_heading" | "font_body", label: string, fonts: string[]) =>
    <Row label={label} htmlFor={fieldId(key)}>
      <select id={fieldId(key)} value={theme[key]} disabled={busy} {...problemFor(key)} onChange={(e) => set({ [key]: e.target.value })}>{fonts.map((name) => <option key={name}>{name}</option>)}</select></Row>;

  const colors = theme.schemes[scheme];
  // Secondary text is lifted until it reads clearly, so say so when the shown colour isn't the pick.
  const shownMuted = colors ? communityTextLevels(colors, scheme).muted : null;
  const mutedHint = colors && shownMuted && shownMuted.toLowerCase() !== colors.muted.toLowerCase() ? shownMuted : null;
  const setColors = (change: Partial<CommunityThemeColors>) => {
    if (!colors) return;
    set({ schemes: { ...theme.schemes, [scheme]: { ...colors, ...change } } });
  };
  // One brand colour sets the accent and the buttons, with readable text on both.
  const setBrand = (value: string) => {
    const color = value.toUpperCase();
    setColors({ accent: color, button: color, on_accent: readableOn(color), on_button: readableOn(color) });
  };
  const setMode = (mode: SchemeMode) => {
    const current = theme.schemes;
    const fallback = (key: CommunityThemeScheme): CommunityThemeColors => {
      const base = DEFAULT_COMMUNITY_THEME.schemes[key] as CommunityThemeColors;
      const other = current[key === "light" ? "dark" : "light"];
      return other ? { ...base, accent: other.accent, on_accent: readableOn(other.accent) } : base;
    };
    const schemes = mode === "both"
      ? { light: current.light ?? fallback("light"), dark: current.dark ?? fallback("dark") }
      : { [mode]: current[mode] ?? fallback(mode) };
    set({ schemes });
    props.setScheme(mode === "both" ? scheme : mode);
  };
  const applyPreset = (preset: CommunityThemePreset) => {
    set(structuredClone(preset.theme));
    props.setScheme(preset.theme.schemes.light ? "light" : "dark");
  };
  const mode = schemeMode(theme);

  // Phone loads the phone app (/m/), as a real phone gets it, not the desktop
  // layout squeezed into 390px.
  const src = props.communitySlug
    ? `${device === "phone" ? "/m" : ""}/c/${encodeURIComponent(props.communitySlug)}/${page}?${APPEARANCE_PREVIEW_PARAM}=1`
    : null;

  const editor = <div className="appearance-editor" role="dialog" aria-modal="true" aria-labelledby={`${props.uid}-editor-title`}>
    <header className="appearance-editor-bar">
      <div className="appearance-editor-bar-start">
        <button className="appearance-icon-button" type="button" onClick={props.onClose} aria-label="Back to settings"><ChevronLeft size={20} aria-hidden="true" /></button>
        <h2 id={`${props.uid}-editor-title`} ref={heading} tabIndex={-1}>Customize</h2>
        {props.status}
      </div>
      <div className="appearance-segmented" role="group" aria-label="Screen size">
        <button type="button" className={`appearance-seg${device === "desktop" ? " is-active" : ""}`} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={16} aria-hidden="true" />Desktop</button>
        <button type="button" className={`appearance-seg${device === "phone" ? " is-active" : ""}`} aria-pressed={device === "phone"} onClick={() => setDevice("phone")}><Smartphone size={16} aria-hidden="true" />Phone</button>
      </div>
      <div className="appearance-actions">{props.actions}</div>
    </header>
    <div className="appearance-editor-body">
      <nav className="appearance-pages" aria-label="Page to preview">
        <h3>Pages</h3>
        {PREVIEW_PAGES.map(([key, label]) => {
          const Icon = PAGE_ICONS[key];
          return <button key={key} type="button" aria-current={key === page ? "page" : undefined} className={key === page ? "is-active" : ""} onClick={() => setPage(key)}>
            <Icon size={16} aria-hidden="true" /><span>{label}</span></button>;
        })}
        <p className="appearance-hint">Members see this look only after you publish.</p>
      </nav>
      <section ref={canvas} className={`appearance-canvas is-${device}`} aria-label="Preview">
        {src && scale < 1 && canvasBox ? <div className="appearance-frame-fit" style={{ width: canvasBox.width, height: canvasBox.height }}>
          <iframe ref={frame} key={src} src={src} title="Your community with the draft look" className="appearance-frame is-scaled"
            style={{ width: layoutWidth, height: (canvasBox.height - 2) / scale, transform: `scale(${scale})` }} />
        </div>
        : src ? <iframe ref={frame} key={src} src={src} title="Your community with the draft look" className="appearance-frame" />
          : <div className="community-look-preview" data-community-theme={PREVIEW_SCOPE}><SampleContent /></div>}
      </section>
      <aside className="appearance-inspector community-look" aria-label="Design settings">
        <Group title="Theme">
          <Row label="Starting point" wide><PresetPicker theme={theme} disabled={busy} onPick={applyPreset} /></Row>
          <p className="appearance-hint">Picking one replaces your draft. Undo until you save.</p>
        </Group>
        {props.hasBanner ? <Group title="Banner">
          {choice("banner_name")}
          <p className="appearance-hint">Hide the name when your banner artwork already spells it out.</p>
        </Group> : null}
        <Group title="Colors">
          <Row label="Light or dark" htmlFor={fieldId("mode")}>
            <select id={fieldId("mode")} value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as SchemeMode)}>
              {SCHEME_MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Row>
          {mode === "both" ? <Row label="Editing" htmlFor={fieldId("scheme")}>
            <select id={fieldId("scheme")} value={scheme} onChange={(e) => props.setScheme(e.target.value as CommunityThemeScheme)}>
              <option value="light">Light version</option><option value="dark">Dark version</option></select></Row> : null}
          {colors ? <>
            <Row label={<>Brand colour<small>Accent and buttons</small></>} htmlFor={fieldId("brand")}>
              <ColorField id={fieldId("brand")} label="Brand" value={colors.accent} disabled={busy} onChange={setBrand} /></Row>
            {COLOR_FIELDS.map(([key, label]) => {
              const problem = problemFor(`schemes.${scheme}.${key}`);
              const describedBy = [problem["aria-describedby"], key === "muted" && mutedHint ? `${props.uid}-muted-hint` : ""].filter(Boolean).join(" ") || undefined;
              return <Row key={key} label={label} htmlFor={fieldId(key)}>
                <ColorField id={fieldId(key)} label={label} value={colors[key]} disabled={busy} invalid={Boolean(problem["aria-invalid"])} describedBy={describedBy}
                  onChange={(value) => setColors({ [key]: value })} /></Row>;
            })}
            {mutedHint ? <small id={`${props.uid}-muted-hint`} className="community-look-color-hint">Secondary text shows as {mutedHint.toUpperCase()} so it stays easy to read on {scheme === "dark" ? "dark" : "light"} backgrounds.</small> : null}
          </> : null}
        </Group>
        <Group title="Typography">
          {fontSelect("font_heading", "Headings", HEADING_FONTS)}
          {fontSelect("font_body", "Body text", TEXT_FONTS)}
          {slider("heading_weight", "Heading weight", 300, 900, 50, String)}
          {choice("heading_case")}
          {slider("type_scale", "Text size", 0.9, 1.2, 0.05, (value) => `${Math.round(value * 100)}%`)}
          {choice("numerals")}
        </Group>
        <Group title="Shape">
          {slider("radius", "Corner radius", 0, 24, 1, (value) => `${value}px`)}
          {choice("corner_style")}
          {choice("button_shape")}
          {slider("border_width", "Border width", 0, 3, 1, (value) => `${value}px`)}
          {choice("shadow")}
          {choice("density")}
        </Group>
        <Group title="Courses">
          {choice("course_cover_ratio")}
          {choice("course_card_size")}
          {choice("course_cover_fit")}
          {choice("course_cover_plate")}
          {choice("media_plate")}
        </Group>
        <Group title="Channels look · draft">
          {choice("channels_look")}
          <p className="appearance-hint">Substack-style pages for the Channels layout. Classroom keeps its own look.</p>
        </Group>
        <Group title="Left rail · draft">
          {choice("rail_size")}
          {choice("rail_color")}
          <p className="appearance-hint">The column of community icons on the far left, while members are in your community.</p>
        </Group>
        {props.footer}
      </aside>
    </div>
  </div>;
  // The wrapper is always there, so finding the theme doesn't remount the editor.
  return createPortal(<div className="community-theme-scope" data-community-theme={themeScope ?? undefined}>{editor}</div>, document.body);
}
