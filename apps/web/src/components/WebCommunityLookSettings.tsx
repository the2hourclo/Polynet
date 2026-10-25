import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  compileCommunityThemeCss,
  communityTextLevels,
  communityThemeFontStylesheetUrl,
  COMMUNITY_THEME_FONTS,
  normalizeCommunityTheme,
  type CommunityThemeColors,
  type CommunityThemeProblem,
  type CommunityThemeScheme,
  type CommunityThemeV1,
} from "../../../../shared/communityTheme";
import {
  discardCloudCommunityThemeDraft,
  fetchCloudCommunityThemeDraft,
  publishCloudCommunityThemeDraft,
  saveCloudCommunityThemeDraft,
  type CommunityThemeDraftState,
} from "../../../../shared/cloudCommunityThemeGateway";
import { COMMUNITY_THEME_PUBLISHED_EVENT } from "../controllers/useWebCommunityThemeStyle";
import "./WebCommunityLookSettings.css";

type Props = { communityId: string; session: unknown; ensureSession: (session: any) => Promise<any | null> };

const PREVIEW_SCOPE = "look-preview";
const TEXT_FONTS = Object.entries(COMMUNITY_THEME_FONTS).filter(([, font]) => font.role === "text").map(([name]) => name);
const HEADING_FONTS = Object.entries(COMMUNITY_THEME_FONTS).filter(([, font]) => font.role !== "mono").map(([name]) => name);
const COLOR_FIELDS: [keyof CommunityThemeColors, string][] = [
  ["background", "Background"], ["surface", "Cards"], ["text", "Text"], ["muted", "Secondary text"],
  ["border", "Borders"], ["accent", "Accent"], ["on_accent", "Text on accent"], ["button", "Buttons"], ["on_button", "Button text"],
];
type ChoiceKey = "heading_case" | "numerals" | "corner_style" | "shadow" | "course_cover_ratio" | "course_card_size" | "course_cover_plate" | "course_cover_fit" | "media_plate";
const CHOICES: Record<ChoiceKey, [string, [string, string][]]> = {
  heading_case: ["Heading case", [["none", "As typed"], ["upper", "UPPERCASE"]]],
  numerals: ["Numbers", [["proportional", "Natural"], ["tabular", "Even width (for tables)"]]],
  corner_style: ["Corner style", [["even", "Even"], ["sketch", "Hand-drawn"]]],
  shadow: ["Shadows", [["none", "None"], ["soft", "Soft"], ["hard", "Hard"]]],
  course_cover_ratio: ["Cover shape", [["auto", "Polynet default"], ["16:9", "Wide 16:9"], ["3:2", "Photo 3:2"], ["4:3", "Classic 4:3"], ["1:1", "Square"], ["21:9", "Banner 21:9"]]],
  course_card_size: ["Card size", [["default", "Two columns"], ["small", "Small"], ["medium", "Medium"], ["large", "Large"]]],
  course_cover_plate: ["Cover background (light scheme)", [["none", "Plain"], ["tint", "Soft accent tint"]]],
  course_cover_fit: ["Cover pictures", [["crop", "Fill the box"], ["whole", "Show whole picture"]]],
  media_plate: ["White images (dark scheme)", [["none", "As they are"], ["light", "On a light plate"]]],
};

function problemText(error: unknown): CommunityThemeProblem[] | string {
  const data = (error as { data?: { code?: string; problems?: CommunityThemeProblem[] } })?.data;
  if (data?.problems?.length) return data.problems;
  if (data?.code === "community_theme_revision_conflict") return "The look changed in another session. Reload to continue.";
  return "Could not save. Your changes are still here. Try again.";
}

// The owner's fonts, sizing and colours for Classic Polynet, kept as a draft
// with a live preview until published. The same draft the CLI and agents edit.
export function WebCommunityLookSettings(props: Props) {
  const [state, setState] = useState<CommunityThemeDraftState | null>(null);
  const [theme, setTheme] = useState<CommunityThemeV1 | null>(null);
  const [scheme, setScheme] = useState<CommunityThemeScheme>("light");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommunityThemeProblem[] | string | null>(null);
  const [reload, setReload] = useState(0);
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

  const check = useMemo(() => (theme ? normalizeCommunityTheme(theme) : null), [theme]);
  // The preview shows the scheme being edited, whatever the app is in now.
  const previewCss = useMemo(() => {
    if (!check?.ok || !check.theme.schemes[scheme]) return "";
    return compileCommunityThemeCss({ ...check.theme, schemes: { [scheme]: check.theme.schemes[scheme] } }, `[data-community-theme="${PREVIEW_SCOPE}"]`);
  }, [check, scheme]);
  const fontUrl = check?.ok ? communityThemeFontStylesheetUrl(check.theme) : null;
  const dirty = Boolean(state && theme && JSON.stringify(state.draft) !== JSON.stringify(theme));

  if (!theme || !state) {
    return <div className="settings-section">{typeof error === "string" ? <p role="alert">{error} <button className="secondary" type="button" onClick={() => setReload((n) => n + 1)}>Retry</button></p> : <p role="status">Loading…</p>}</div>;
  }
  const set = (change: Partial<CommunityThemeV1>) => { setError(null); setTheme({ ...theme, ...change }); };
  const choice = (key: ChoiceKey) => {
    const [label, options] = CHOICES[key];
    return <label className="create-community-field" key={key}><span>{label}</span>
      <select value={theme[key]} disabled={busy} {...problemFor(key)} onChange={(e) => set({ [key]: e.target.value } as Partial<CommunityThemeV1>)}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  };
  const colors = theme.schemes[scheme];
  // Secondary text is lifted until it reads clearly, so say so when the shown colour isn't the pick.
  const shownMuted = colors ? communityTextLevels(colors, scheme).muted : null;
  const mutedHint = colors && shownMuted && shownMuted.toLowerCase() !== colors.muted.toLowerCase() ? shownMuted : null;
  const setColor = (key: keyof CommunityThemeColors, value: string) => {
    if (!colors) return;
    set({ schemes: { ...theme.schemes, [scheme]: { ...colors, [key]: value.toUpperCase() } } });
  };
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
  const problems = check && !check.ok ? check.problems : Array.isArray(error) ? error : [];
  // Each control names the problems about it, so they're read out on focus.
  const problemFor = (path: string): { "aria-invalid"?: true; "aria-describedby"?: string } => {
    const ids = problems.map((problem, i) => (problem.path === path ? `${uid}-problem-${i}` : "")).filter(Boolean).join(" ");
    return ids ? { "aria-invalid": true, "aria-describedby": ids } : {};
  };

  return <div className="settings-section community-look">
    <div className="settings-section-title">Look</div>
    <div className="settings-section-desc">Fonts, sizing and colours for your community. Changes stay a draft until you publish; the preview shows the draft.</div>
    <div className="community-look-grid">
      <div className="community-look-controls">
        <label className="create-community-field"><span>Body font</span>
          <select value={theme.font_body} disabled={busy} {...problemFor("font_body")} onChange={(e) => set({ font_body: e.target.value })}>{TEXT_FONTS.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="create-community-field"><span>Heading font</span>
          <select value={theme.font_heading} disabled={busy} {...problemFor("font_heading")} onChange={(e) => set({ font_heading: e.target.value })}>{HEADING_FONTS.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="create-community-field"><span>Heading weight · {theme.heading_weight}</span>
          <input type="range" min={300} max={900} step={50} value={theme.heading_weight} disabled={busy} {...problemFor("heading_weight")} onChange={(e) => set({ heading_weight: Number(e.target.value) })} /></label>
        <label className="create-community-field"><span>Text size · {Math.round(theme.type_scale * 100)}%</span>
          <input type="range" min={0.9} max={1.2} step={0.05} value={theme.type_scale} disabled={busy} {...problemFor("type_scale")} onChange={(e) => set({ type_scale: Number(e.target.value) })} /></label>
        <label className="create-community-field"><span>Spacing</span>
          <select value={theme.density} disabled={busy} {...problemFor("density")} onChange={(e) => set({ density: e.target.value as CommunityThemeV1["density"] })}>
            <option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="roomy">Roomy</option></select></label>
        <label className="create-community-field"><span>Corner radius · {theme.radius}px</span>
          <input type="range" min={0} max={24} step={1} value={theme.radius} disabled={busy} {...problemFor("radius")} onChange={(e) => set({ radius: Number(e.target.value) })} /></label>
        <label className="create-community-field"><span>Buttons</span>
          <select value={theme.button_shape} disabled={busy} {...problemFor("button_shape")} onChange={(e) => set({ button_shape: e.target.value as CommunityThemeV1["button_shape"] })}>
            <option value="rounded">Rounded</option><option value="pill">Pill</option><option value="square">Square</option><option value="sketch">Sketch</option></select></label>
        {choice("corner_style")}
        <label className="create-community-field"><span>Border width · {theme.border_width}px</span>
          <input type="range" min={0} max={3} step={1} value={theme.border_width} disabled={busy} {...problemFor("border_width")} onChange={(e) => set({ border_width: Number(e.target.value) })} /></label>
        {choice("shadow")}
        {choice("heading_case")}
        {choice("numerals")}
        <fieldset className="community-look-group">
          <legend>Courses</legend>
          {choice("course_cover_ratio")}
          {choice("course_card_size")}
          {choice("course_cover_fit")}
          {choice("course_cover_plate")}
          {choice("media_plate")}
        </fieldset>
        <div className="community-look-scheme" role="group" aria-label="Colour scheme">
          {(["light", "dark"] as const).filter((key) => theme.schemes[key]).map((key) => <button key={key} type="button" className={key === scheme ? "is-active" : ""} aria-pressed={key === scheme} onClick={() => setScheme(key)}>{key === "light" ? "Light" : "Dark"}</button>)}
        </div>
        {colors ? <div className="community-look-colors">{COLOR_FIELDS.map(([key, label]) => {
          const problem = problemFor(`schemes.${scheme}.${key}`);
          const describedBy = [problem["aria-describedby"], key === "muted" && mutedHint ? `${uid}-muted-hint` : ""].filter(Boolean).join(" ") || undefined;
          return <label key={key}>
            <input type="color" value={colors[key]} disabled={busy} {...problem} aria-describedby={describedBy} onChange={(e) => setColor(key, e.target.value)} /><span>{label}</span></label>;
        })}
          {mutedHint ? <small id={`${uid}-muted-hint`} className="community-look-color-hint">Secondary text shows as {mutedHint.toUpperCase()} so it stays easy to read on {scheme === "dark" ? "dark" : "light"} backgrounds.</small> : null}</div> : null}
      </div>
      <div className="community-look-preview" data-community-theme={PREVIEW_SCOPE}>
        <style>{previewCss}</style>
        {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
        <div className="community-look-sample">
          <small>Preview</small>
          <h2>Build your first AI employee</h2>
          <p>Lessons, check-ins and your community in one place. This is how text reads at the size you picked.</p>
          <div className="community-look-card"><strong>Module 1 · Foundations</strong><span>3 of 5 lessons done</span></div>
          <button type="button" className="settings-primary-action">Continue lesson</button>
        </div>
      </div>
    </div>
    <div role="status">{problems.length ? <ul className="auth-error community-look-problems">{problems.map((problem, i) => <li key={i} id={`${uid}-problem-${i}`}>{problem.message}{problem.suggestion ? ` Try ${problem.suggestion}.` : ""}</li>)}</ul> : null}</div>
    {typeof error === "string" ? <div className="auth-error" role="alert">{error}</div> : null}
    <div className="auth-actions">
      <span className="community-look-status" role="status">{busy ? "Working…" : dirty ? "Unsaved changes" : state.hasUnpublishedChanges ? "Draft saved · not published" : state.published ? "Published" : "Polynet default"}</span>
      <button className="secondary" type="button" disabled={busy || (!dirty && !state.hasUnpublishedChanges)} onClick={() => { if (dirty) setTheme(state.draft); else void discard(); }}>{dirty ? "Undo changes" : "Discard draft"}</button>
      <button className="secondary" type="button" disabled={busy || !dirty || !check?.ok} onClick={() => void save()}>Save draft</button>
      <button className="settings-primary-action" type="button" disabled={busy || !check?.ok || (!dirty && !state.hasUnpublishedChanges)} onClick={() => void publish()}>Publish</button>
    </div>
  </div>;
}
