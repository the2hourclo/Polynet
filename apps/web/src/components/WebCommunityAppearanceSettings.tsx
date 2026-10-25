import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

type Props = { communityId: string; communitySlug: string | null; session: unknown; ensureSession: (session: any) => Promise<any | null> };

const PREVIEW_SCOPE = "look-preview";
const CUSTOMIZE_HASH = "#customize";
const TEXT_FONTS = Object.entries(COMMUNITY_THEME_FONTS).filter(([, font]) => font.role === "text").map(([name]) => name);
const HEADING_FONTS = Object.entries(COMMUNITY_THEME_FONTS).filter(([, font]) => font.role !== "mono").map(([name]) => name);
const COLOR_FIELDS: [keyof CommunityThemeColors, string][] = [
  ["background", "Background"], ["surface", "Cards"], ["text", "Text"], ["muted", "Secondary text"],
  ["border", "Borders"], ["accent", "Accent"], ["on_accent", "Text on accent"], ["button", "Buttons"], ["on_button", "Button text"],
];
type ChoiceKey = "heading_case" | "numerals" | "corner_style" | "shadow" | "density" | "button_shape" | "course_cover_ratio" | "course_card_size" | "course_cover_plate" | "course_cover_fit" | "media_plate";
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
};
// The community pages the preview can show, by their tab in the address.
const PREVIEW_PAGES: [string, string][] = [["chat", "Chat"], ["resources", "Courses"], ["events", "Events"]];
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
  const uid = useId();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
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

  const problemList = <div role="status">{problems.length ? <ul className="auth-error community-look-problems">{problems.map((problem, i) => <li key={i} id={`${uid}-problem-${i}`}>{problem.message}{problem.suggestion ? ` Try ${problem.suggestion}.` : ""}</li>)}</ul> : null}</div>;
  const errorLine = typeof error === "string" ? <div className="auth-error" role="alert">{error}</div> : null;
  const actions = <>
    <button className="secondary" type="button" disabled={busy || (!dirty && !state.hasUnpublishedChanges)} onClick={undoOrDiscard}>{dirty ? "Undo changes" : "Discard draft"}</button>
    <button className="secondary" type="button" disabled={busy || !dirty || !check?.ok} onClick={() => void save()}>Save draft</button>
    <button className="settings-primary-action" type="button" disabled={busy || !check?.ok || (!dirty && !state.hasUnpublishedChanges)} onClick={() => void publish()}>Publish</button>
  </>;
  const shown = check?.ok ? check.theme : theme;

  return <div className="settings-section community-look">
    <div className="settings-section-title">Appearance</div>
    <div className="settings-section-desc">Colours, fonts and shapes for your community. Changes stay a draft until you publish, so members only see what you publish.</div>
    <div className="appearance-overview">
      <div className="community-look-preview" data-community-theme={PREVIEW_SCOPE}>
        <style>{previewCss}</style>
        {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
        <SampleContent />
      </div>
      <div className="appearance-summary">
        <dl>
          <div><dt>Colours</dt><dd>{(["light", "dark"] as const).filter((key) => shown.schemes[key]).map((key) => <span key={key} className="appearance-summary-scheme"><Swatches colors={shown.schemes[key]} />{key === "light" ? "Light" : "Dark"}</span>)}</dd></div>
          <div><dt>Fonts</dt><dd>{shown.font_heading === shown.font_body ? shown.font_body : `${shown.font_heading} titles, ${shown.font_body} text`}</dd></div>
          <div><dt>Status</dt><dd className="community-look-status" role="status">{statusText}</dd></div>
        </dl>
        <button ref={customizeButton} className="settings-primary-action appearance-customize-button" type="button" onClick={() => openCustomize(true)}>Customize</button>
        <small>Pick a starting point, then adjust colours, fonts and shapes while the real community updates beside you.</small>
      </div>
    </div>
    {customizing ? null : <>{problemList}{errorLine}
      {dirty || state.hasUnpublishedChanges ? <div className="auth-actions">{actions}</div> : null}</>}
    {customizing ? <AppearanceEditor
      theme={theme} scheme={scheme} setScheme={setScheme} set={set} busy={busy} problems={problems} uid={uid}
      previewTheme={previewTheme} communityId={props.communityId} communitySlug={props.communitySlug}
      statusText={statusText} actions={actions} footer={<>{problemList}{errorLine}</>}
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
  statusText: string;
  actions: ReactNode;
  footer: ReactNode;
  onClose: () => void;
};

function Section(props: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="appearance-section" open={props.open ?? true}>
    <summary>{props.title}</summary>
    <div className="appearance-section-body">{props.children}</div>
  </details>;
}

// Full-screen editor: controls on the left, the real community on the right,
// wearing the unsaved draft. Like Substack's design editor.
function AppearanceEditor(props: EditorProps) {
  const { theme, scheme, set, busy } = props;
  const [page, setPage] = useState("resources");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const frame = useRef<HTMLIFrameElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastGoodTheme = useRef<CommunityThemeV1 | null>(props.previewTheme);
  if (props.previewTheme) lastGoodTheme.current = props.previewTheme;
  const previewTheme = props.previewTheme ?? lastGoodTheme.current;

  // The rest of the app sits behind the editor: keep focus and screen readers here.
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    heading.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { root?.removeAttribute("inert"); window.removeEventListener("keydown", onKey); };
  }, []);

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
  const choice = (key: ChoiceKey) => {
    const [label, options] = CHOICES[key];
    return <label className="create-community-field" key={key}><span>{label}</span>
      <select value={theme[key]} disabled={busy} {...problemFor(key)} onChange={(e) => set({ [key]: e.target.value } as Partial<CommunityThemeV1>)}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  };
  const slider = (key: "heading_weight" | "type_scale" | "radius" | "border_width", label: string, min: number, max: number, step: number, unit: (value: number) => string) =>
    <label className="create-community-field" key={key}><span>{label} · {unit(theme[key])}</span>
      <input type="range" min={min} max={max} step={step} value={theme[key]} disabled={busy} {...problemFor(key)} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<CommunityThemeV1>)} /></label>;

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

  const src = props.communitySlug ? `/c/${encodeURIComponent(props.communitySlug)}/${page}?${APPEARANCE_PREVIEW_PARAM}=1` : null;

  return createPortal(<div className="appearance-editor" role="dialog" aria-modal="true" aria-labelledby={`${props.uid}-editor-title`}>
    <header className="appearance-editor-bar">
      <button className="secondary" type="button" onClick={props.onClose}>← Back</button>
      <h2 id={`${props.uid}-editor-title`} ref={heading} tabIndex={-1}>Customize appearance</h2>
      <span className="community-look-status" role="status">{props.statusText}</span>
      <div className="appearance-editor-actions">{props.actions}</div>
    </header>
    <div className="appearance-editor-body">
      <aside className="appearance-editor-controls community-look" aria-label="Appearance settings">
        <Section title="Starting point">
          <p className="appearance-hint">Picking one replaces your draft. You can undo until you save.</p>
          <div className="appearance-presets">
            {COMMUNITY_THEME_PRESETS.map((preset) => {
              const sample = preset.theme.schemes.light ?? preset.theme.schemes.dark;
              return <button key={preset.id} type="button" className="appearance-preset" disabled={busy} onClick={() => applyPreset(preset)}
                style={{ background: sample?.background, color: sample?.text, borderColor: sample?.border }}>
                <strong style={{ fontFamily: COMMUNITY_THEME_FONTS[preset.theme.font_heading]?.stack }}>{preset.name}</strong>
                <span className="appearance-preset-chips" aria-hidden="true"><i style={{ background: sample?.accent }} /><i style={{ background: sample?.button }} /><i style={{ background: sample?.surface, borderColor: sample?.border }} /></span>
                <small style={{ color: sample?.muted }}>{preset.description}</small>
              </button>;
            })}
          </div>
        </Section>
        <Section title="Colours">
          <div className="community-look-scheme" role="group" aria-label="Light or dark">
            {SCHEME_MODES.map(([key, label]) => <button key={key} type="button" className={key === mode ? "is-active" : ""} aria-pressed={key === mode} disabled={busy} onClick={() => setMode(key)}>{label}</button>)}
          </div>
          {mode === "both" ? <div className="community-look-scheme" role="group" aria-label="Scheme to edit">
            {(["light", "dark"] as const).map((key) => <button key={key} type="button" className={key === scheme ? "is-active" : ""} aria-pressed={key === scheme} onClick={() => props.setScheme(key)}>Edit {key}</button>)}
          </div> : null}
          {colors ? <>
            <label className="appearance-brand"><input type="color" value={colors.accent} disabled={busy} onChange={(e) => setBrand(e.target.value)} />
              <span><strong>Brand colour</strong><small>Sets the accent and buttons, with readable text on them.</small></span></label>
            <div className="community-look-colors">{COLOR_FIELDS.map(([key, label]) => {
              const problem = problemFor(`schemes.${scheme}.${key}`);
              const describedBy = [problem["aria-describedby"], key === "muted" && mutedHint ? `${props.uid}-muted-hint` : ""].filter(Boolean).join(" ") || undefined;
              return <label key={key}>
                <input type="color" value={colors[key]} disabled={busy} {...problem} aria-describedby={describedBy} onChange={(e) => setColors({ [key]: e.target.value.toUpperCase() })} /><span>{label}</span></label>;
            })}
              {mutedHint ? <small id={`${props.uid}-muted-hint`} className="community-look-color-hint">Secondary text shows as {mutedHint.toUpperCase()} so it stays easy to read on {scheme === "dark" ? "dark" : "light"} backgrounds.</small> : null}</div>
          </> : null}
        </Section>
        <Section title="Fonts and text">
          <label className="create-community-field"><span>Heading font</span>
            <select value={theme.font_heading} disabled={busy} {...problemFor("font_heading")} onChange={(e) => set({ font_heading: e.target.value })}>{HEADING_FONTS.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label className="create-community-field"><span>Body font</span>
            <select value={theme.font_body} disabled={busy} {...problemFor("font_body")} onChange={(e) => set({ font_body: e.target.value })}>{TEXT_FONTS.map((name) => <option key={name}>{name}</option>)}</select></label>
          {slider("heading_weight", "Heading weight", 300, 900, 50, String)}
          {choice("heading_case")}
          {slider("type_scale", "Text size", 0.9, 1.2, 0.05, (value) => `${Math.round(value * 100)}%`)}
          {choice("numerals")}
        </Section>
        <Section title="Shape and spacing">
          {slider("radius", "Corner radius", 0, 24, 1, (value) => `${value}px`)}
          {choice("corner_style")}
          {choice("button_shape")}
          {slider("border_width", "Border width", 0, 3, 1, (value) => `${value}px`)}
          {choice("shadow")}
          {choice("density")}
        </Section>
        <Section title="Courses" open={false}>
          {choice("course_cover_ratio")}
          {choice("course_card_size")}
          {choice("course_cover_fit")}
          {choice("course_cover_plate")}
          {choice("media_plate")}
        </Section>
        {props.footer}
      </aside>
      <section className="appearance-editor-canvas" aria-label="Preview">
        <div className="appearance-canvas-bar">
          <div className="community-look-scheme" role="group" aria-label="Page to preview">
            {PREVIEW_PAGES.map(([key, label]) => <button key={key} type="button" className={key === page ? "is-active" : ""} aria-pressed={key === page} onClick={() => setPage(key)}>{label}</button>)}
          </div>
          <div className="community-look-scheme" role="group" aria-label="Screen size">
            {(["desktop", "phone"] as const).map((key) => <button key={key} type="button" className={key === device ? "is-active" : ""} aria-pressed={key === device} onClick={() => setDevice(key)}>{key === "desktop" ? "Desktop" : "Phone"}</button>)}
          </div>
          <small>Draft preview · members see it after you publish</small>
        </div>
        <div className={`appearance-frame-wrap is-${device}`}>
          {src ? <iframe ref={frame} key={src} src={src} title="Your community with the draft look" className="appearance-frame" />
            : <div className="community-look-preview" data-community-theme={PREVIEW_SCOPE}><SampleContent /></div>}
        </div>
      </section>
    </div>
  </div>, document.body);
}
