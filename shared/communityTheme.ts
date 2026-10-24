// A community's look as data: a small public vocabulary of tokens that a
// founder or their agent sets, validated here and compiled into Polynet's own
// CSS variables. Founders never see Polynet's internal variable or class
// names, so Polynet can change those freely. The compiled CSS is scoped to the
// community's own area: the app frame (community rail, Discover, messages,
// settings) always keeps Polynet's look. Contract: docs/community-theme-v1.md.

export const COMMUNITY_THEME_VERSION = 1 as const;

export type CommunityThemeScheme = "light" | "dark";

export type CommunityThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  on_accent: string;
  button: string;
  on_button: string;
};

export type CommunityThemeV1 = {
  version: 1;
  // One scheme fixes the community's look; both follow the member's Light/Dark choice.
  schemes: Partial<Record<CommunityThemeScheme, CommunityThemeColors>>;
  font_body: string;
  font_heading: string;
  font_mono: string;
  heading_weight: number;
  heading_case: "none" | "upper";
  type_scale: number;
  numerals: "proportional" | "tabular";
  radius: number;
  corner_style: "even" | "sketch";
  button_shape: "pill" | "rounded" | "square" | "sketch";
  border_width: number;
  shadow: "none" | "soft" | "hard";
  density: "compact" | "comfortable" | "roomy";
  media_plate: "none" | "light";
  // Course catalog: cover shape and how big each card is (Skool-style big
  // covers are "16:9" with "medium" or "large" cards). Which part of each
  // image shows is the course's own cover framing (focus and zoom).
  course_cover_ratio: "auto" | "16:9" | "3:2" | "4:3" | "1:1" | "21:9";
  course_card_size: "default" | "small" | "medium" | "large";
};

export type CommunityThemeProblem = {
  path: string;
  message: string;
  suggestion?: string;
};

export type CommunityThemeResult =
  | { ok: true; theme: CommunityThemeV1 }
  | { ok: false; problems: CommunityThemeProblem[] };

// Faces a theme may use. "polynet" faces ship with Polynet (Excalifont is
// still to be added; the AIEB preview inlines it); "google" faces load
// from Google Fonts; "system" faces are installed on the device. Display faces
// are for headings only: long text set in them is hard to read.
type CommunityThemeFont = {
  stack: string;
  source: "polynet" | "google" | "system";
  role: "text" | "display" | "mono";
  googleFamily?: string;
};

const SANS = "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";
const MONO = "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace";

export const COMMUNITY_THEME_FONTS: Readonly<Record<string, CommunityThemeFont>> = {
  "IBM Plex Sans": { stack: `"IBM Plex Sans Variable", "IBM Plex Sans", ${SANS}`, source: "polynet", role: "text" },
  "IBM Plex Mono": { stack: `"IBM Plex Mono", ${MONO}`, source: "polynet", role: "mono" },
  "Excalifont": { stack: `"Excalifont", ${SANS}`, source: "polynet", role: "display" },
  "Segoe UI": { stack: `"Segoe UI", ${SANS}`, source: "system", role: "text" },
  "System": { stack: SANS, source: "system", role: "text" },
  "Inter": { stack: `"Inter", ${SANS}`, source: "google", role: "text", googleFamily: "Inter:wght@400;500;600;700" },
  "DM Sans": { stack: `"DM Sans", ${SANS}`, source: "google", role: "text", googleFamily: "DM Sans:wght@400;500;600;700" },
  "Manrope": { stack: `"Manrope", ${SANS}`, source: "google", role: "text", googleFamily: "Manrope:wght@400;500;600;700;800" },
  "Source Serif 4": { stack: `"Source Serif 4", Georgia, serif`, source: "google", role: "text", googleFamily: "Source Serif 4:wght@400;600;700" },
  "Barlow Condensed": { stack: `"Barlow Condensed", "Arial Narrow", ${SANS}`, source: "google", role: "display", googleFamily: "Barlow Condensed:wght@500;600;700" },
  "Chakra Petch": { stack: `"Chakra Petch", ${SANS}`, source: "google", role: "display", googleFamily: "Chakra Petch:wght@500;600;700" },
  "Fraunces": { stack: `"Fraunces", Georgia, serif`, source: "google", role: "display", googleFamily: "Fraunces:wght@400;600;800" },
  "Caveat": { stack: `"Caveat", ${SANS}`, source: "google", role: "display", googleFamily: "Caveat:wght@500;700" },
  "JetBrains Mono": { stack: `"JetBrains Mono", ${MONO}`, source: "google", role: "mono", googleFamily: "JetBrains Mono:wght@400;500;700" },
};

// Polynet's own look, so a theme only states what differs from it.
export const DEFAULT_COMMUNITY_THEME: CommunityThemeV1 = {
  version: 1,
  schemes: {
    light: {
      background: "#F8F8F4", surface: "#FFFFFF", text: "#171719", muted: "#5F5F5A", border: "#E2E2DE",
      accent: "#2F55FF", on_accent: "#FFFFFF", button: "#171719", on_button: "#FFFFFF",
    },
    dark: {
      background: "#1A1A1A", surface: "#2A2A2A", text: "#FCF8F0", muted: "#B3AD9F", border: "#3A3A3A",
      accent: "#D66A8A", on_accent: "#171719", button: "#F1EDE5", on_button: "#0A0A0A",
    },
  },
  font_body: "IBM Plex Sans",
  font_heading: "IBM Plex Sans",
  font_mono: "IBM Plex Mono",
  heading_weight: 650,
  heading_case: "none",
  type_scale: 1,
  numerals: "proportional",
  radius: 16,
  corner_style: "even",
  button_shape: "rounded",
  border_width: 1,
  shadow: "none",
  density: "comfortable",
  media_plate: "none",
  course_cover_ratio: "auto",
  course_card_size: "default",
};

const COLOR_KEYS: readonly (keyof CommunityThemeColors)[] = [
  "background", "surface", "text", "muted", "border", "accent", "on_accent", "button", "on_button",
];

// Contrast floors (WCAG 2.2 AA): reading text 4.5:1, accent as a control edge 3:1.
const CONTRAST_PAIRS: readonly [keyof CommunityThemeColors, keyof CommunityThemeColors, number][] = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["muted", "surface", 4.5],
  ["on_accent", "accent", 4.5],
  ["on_button", "button", 4.5],
  ["accent", "background", 3],
];

const ENUMS = {
  heading_case: ["none", "upper"],
  numerals: ["proportional", "tabular"],
  corner_style: ["even", "sketch"],
  button_shape: ["pill", "rounded", "square", "sketch"],
  shadow: ["none", "soft", "hard"],
  density: ["compact", "comfortable", "roomy"],
  media_plate: ["none", "light"],
  course_cover_ratio: ["auto", "16:9", "3:2", "4:3", "1:1", "21:9"],
  course_card_size: ["default", "small", "medium", "large"],
} as const;

const RANGES = {
  heading_weight: [300, 900],
  type_scale: [0.9, 1.2],
  radius: [0, 24],
  border_width: [0, 3],
} as const;

const KNOWN_KEYS = new Set<string>([
  "version", "schemes", "font_body", "font_heading", "font_mono",
  ...Object.keys(ENUMS), ...Object.keys(RANGES),
]);

// ---------------------------------------------------------------------------
// Colour math

type Rgb = [number, number, number];

function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 0;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// The closest colour to `color` (moving toward black or white) that reaches
// `ratio` against `against`; null when even black or white can't.
export function nearestPassingColor(color: string, against: string, ratio: number): string | null {
  const start = parseHex(color);
  const base = parseHex(against);
  if (!start || !base) return null;
  if (contrastRatio(color, against) >= ratio) return toHex(start);
  const target: Rgb = luminance(base) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  for (let step = 1; step <= 100; step += 1) {
    const candidate = toHex(mix(start, target, step / 100));
    if (contrastRatio(candidate, against) >= ratio) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeColors(
  raw: unknown,
  path: string,
  problems: CommunityThemeProblem[],
): CommunityThemeColors | null {
  if (!isRecord(raw)) {
    problems.push({ path, message: "A scheme needs its colours: " + COLOR_KEYS.join(", ") + "." });
    return null;
  }
  const colors = {} as CommunityThemeColors;
  for (const key of Object.keys(raw)) {
    if (!(COLOR_KEYS as readonly string[]).includes(key)) {
      problems.push({ path: `${path}.${key}`, message: `"${key}" isn't a theme colour. Use: ${COLOR_KEYS.join(", ")}.` });
    }
  }
  for (const key of COLOR_KEYS) {
    const value = raw[key];
    const rgb = typeof value === "string" ? parseHex(value) : null;
    if (!rgb) {
      problems.push({ path: `${path}.${key}`, message: `${key} must be a hex colour like #2D8C3C.` });
      continue;
    }
    colors[key] = toHex(rgb);
  }
  if (Object.keys(colors).length !== COLOR_KEYS.length) return null;
  for (const [fg, bg, ratio] of CONTRAST_PAIRS) {
    const actual = contrastRatio(colors[fg], colors[bg]);
    if (actual < ratio) {
      // Button and accent fills are brand colours: suggest a nearby fill
      // rather than swapping their label colour.
      const adjust = bg === "accent" || bg === "button" ? bg : fg;
      const other = adjust === fg ? bg : fg;
      const fix = nearestPassingColor(colors[adjust], colors[other], ratio);
      problems.push({
        path: `${path}.${adjust}`,
        message: `${fg} ${colors[fg]} on ${bg} ${colors[bg]} is ${actual.toFixed(1)}:1; it needs ${ratio}:1 to be readable.`,
        ...(fix ? { suggestion: fix } : {}),
      });
    }
  }
  return colors;
}

function normalizeFont(
  value: unknown,
  path: string,
  allowed: readonly CommunityThemeFont["role"][],
  problems: CommunityThemeProblem[],
): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  const font = COMMUNITY_THEME_FONTS[name];
  if (!font) {
    problems.push({
      path,
      message: `"${name || String(value)}" isn't an available font.`,
      suggestion: Object.keys(COMMUNITY_THEME_FONTS).filter((key) => allowed.includes(COMMUNITY_THEME_FONTS[key].role)).join(", "),
    });
    return null;
  }
  if (!allowed.includes(font.role)) {
    problems.push({
      path,
      message: font.role === "display"
        ? `${name} is a display face; use it for headings, and a text face for reading.`
        : `${name} is a ${font.role} face and can't be used here.`,
    });
    return null;
  }
  return name;
}

// Accepts a partial theme (anything left out keeps Polynet's default) and
// returns the full theme, or every problem at once so an agent can fix them
// in one pass.
export function normalizeCommunityTheme(raw: unknown): CommunityThemeResult {
  const problems: CommunityThemeProblem[] = [];
  if (!isRecord(raw)) return { ok: false, problems: [{ path: "", message: "A theme is a JSON object." }] };
  if (raw.version !== undefined && raw.version !== COMMUNITY_THEME_VERSION) {
    problems.push({ path: "version", message: `Only theme version ${COMMUNITY_THEME_VERSION} is supported.` });
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) problems.push({ path: key, message: `"${key}" isn't a theme setting.` });
  }

  const theme: CommunityThemeV1 = { ...DEFAULT_COMMUNITY_THEME, schemes: { ...DEFAULT_COMMUNITY_THEME.schemes } };

  if (raw.schemes !== undefined) {
    if (!isRecord(raw.schemes) || Object.keys(raw.schemes).length === 0) {
      problems.push({ path: "schemes", message: "Give a light scheme, a dark scheme, or both." });
    } else {
      theme.schemes = {};
      for (const key of Object.keys(raw.schemes)) {
        if (key !== "light" && key !== "dark") {
          problems.push({ path: `schemes.${key}`, message: "Schemes are \"light\" and \"dark\"." });
          continue;
        }
        const colors = normalizeColors(raw.schemes[key], `schemes.${key}`, problems);
        if (colors) theme.schemes[key] = colors;
      }
    }
  }

  if (raw.font_body !== undefined) theme.font_body = normalizeFont(raw.font_body, "font_body", ["text"], problems) ?? theme.font_body;
  if (raw.font_heading !== undefined) theme.font_heading = normalizeFont(raw.font_heading, "font_heading", ["text", "display", "mono"], problems) ?? theme.font_heading;
  if (raw.font_mono !== undefined) theme.font_mono = normalizeFont(raw.font_mono, "font_mono", ["mono"], problems) ?? theme.font_mono;

  for (const key of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!(ENUMS[key] as readonly unknown[]).includes(value)) {
      problems.push({ path: key, message: `${key} is one of: ${ENUMS[key].join(", ")}.` });
      continue;
    }
    (theme as Record<string, unknown>)[key] = value;
  }
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const value = raw[key];
    if (value === undefined) continue;
    const [min, max] = RANGES[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      problems.push({ path: key, message: `${key} is a number from ${min} to ${max}.` });
      continue;
    }
    (theme as Record<string, unknown>)[key] = value;
  }

  return problems.length ? { ok: false, problems } : { ok: true, theme };
}

// ---------------------------------------------------------------------------
// Compilation

const SHAPE = {
  sketchButton: "255px 15px 225px 15px / 15px 225px 15px 255px",
};

function cardRadius(theme: CommunityThemeV1): string {
  if (theme.corner_style === "sketch") {
    const minor = Math.max(2, Math.round(theme.radius / 4));
    return `${theme.radius}px ${minor}px ${theme.radius}px ${minor}px`;
  }
  return `${theme.radius}px`;
}

function cardTopRadius(theme: CommunityThemeV1): string {
  const minor = theme.corner_style === "sketch" ? Math.max(2, Math.round(theme.radius / 4)) : theme.radius;
  return `${theme.radius}px ${minor}px 0 0`;
}

function buttonRadius(theme: CommunityThemeV1): string {
  switch (theme.button_shape) {
    case "pill": return "999px";
    case "square": return `${Math.min(theme.radius, 3)}px`;
    case "sketch": return SHAPE.sketchButton;
    default: return `${Math.min(Math.max(theme.radius, 6), 12)}px`;
  }
}

function shadows(theme: CommunityThemeV1, scheme: CommunityThemeScheme): { card: string; button: string } {
  if (theme.shadow === "hard") {
    return {
      card: "3px 4px 0 color-mix(in srgb, var(--pn-text) 10%, transparent)",
      button: "3px 4px 0 color-mix(in srgb, var(--pn-text) 55%, transparent)",
    };
  }
  if (theme.shadow === "soft") {
    const alpha = scheme === "dark" ? 0.45 : 0.12;
    return { card: `0 10px 28px rgba(0, 0, 0, ${alpha})`, button: "none" };
  }
  return { card: "none", button: "none" };
}

const DENSITY = { compact: 0.85, comfortable: 1, roomy: 1.15 } as const;

// Minimum card width per size; "default" keeps Polynet's two-column catalog.
const COURSE_CARD_MIN_WIDTH = { small: 220, medium: 300, large: 420 } as const;

function courseColumns(theme: CommunityThemeV1): string {
  if (theme.course_card_size === "default") return "repeat(2, minmax(0, 1fr))";
  return `repeat(auto-fill, minmax(min(100%, ${COURSE_CARD_MIN_WIDTH[theme.course_card_size]}px), 1fr))`;
}

// Every text size inside a community is one of these roles, so one text-size
// setting moves all of them together. Sizes are Polynet's defaults at 100%.
export const COMMUNITY_TYPE_ROLES = {
  display: 32, title: 24, heading: 22, subheading: 18, reading: 16, body: 15, ui: 14, small: 13, label: 12, meta: 11, micro: 10,
} as const;

function typeRoles(scale: number): Record<string, string> {
  const px = (size: number) => `${Math.round(size * scale * 10) / 10}px`;
  const roles: Record<string, string> = {};
  for (const [role, size] of Object.entries(COMMUNITY_TYPE_ROLES)) roles[`--pn-type-${role}`] = px(size);
  // Page titles still shrink on narrow screens, at the same proportions.
  roles["--pn-type-display"] = `clamp(${px(26)}, ${Math.round(3 * scale * 100) / 100}vw, ${px(COMMUNITY_TYPE_ROLES.display)})`;
  return roles;
}

// The variables a community area gets for one scheme: the public --pn-* set
// (also what custom sites and <polynet-account> read) and Polynet's internal
// variables derived from it.
export function communityThemeVariables(
  theme: CommunityThemeV1,
  scheme: CommunityThemeScheme,
): Record<string, string> {
  const c = theme.schemes[scheme];
  if (!c) throw new Error(`The theme has no ${scheme} scheme.`);
  const font = (name: string) => COMMUNITY_THEME_FONTS[name]?.stack ?? COMMUNITY_THEME_FONTS["IBM Plex Sans"].stack;
  const link = nearestPassingColor(c.accent, c.background, 4.5) ?? c.text;
  const shadow = shadows(theme, scheme);
  const upper = theme.heading_case === "upper";
  const plate = theme.media_plate === "light" && scheme === "dark";

  const pn: Record<string, string> = {
    "--pn-background": c.background,
    "--pn-surface": c.surface,
    "--pn-text": c.text,
    "--pn-muted": c.muted,
    "--pn-border": c.border,
    "--pn-accent": c.accent,
    "--pn-on-accent": c.on_accent,
    "--pn-button": c.button,
    "--pn-on-button": c.on_button,
    "--pn-link": link,
    "--pn-font-body": font(theme.font_body),
    "--pn-font-heading": font(theme.font_heading),
    "--pn-font-mono": font(theme.font_mono),
    "--pn-heading-weight": String(theme.heading_weight),
    "--pn-heading-case": upper ? "uppercase" : "none",
    "--pn-heading-tracking": upper ? "0.04em" : "normal",
    "--pn-type-scale": String(theme.type_scale),
    ...typeRoles(theme.type_scale),
    "--pn-numerals": theme.numerals === "tabular" ? "tabular-nums" : "normal",
    // Polynet's own corners scale with the theme's radius (16px is Polynet's default).
    "--pn-radius-scale": String(Math.round((theme.radius / DEFAULT_COMMUNITY_THEME.radius) * 1000) / 1000),
    "--pn-radius-card": cardRadius(theme),
    "--pn-radius-card-top": cardTopRadius(theme),
    "--pn-radius-button": buttonRadius(theme),
    "--pn-border-width": `${theme.border_width}px`,
    "--pn-shadow-card": shadow.card,
    "--pn-shadow-button": shadow.button,
    "--pn-space": String(DENSITY[theme.density]),
    "--pn-media-plate": plate ? "#F4F4F0" : "transparent",
    "--pn-media-plate-pad": plate ? "8px" : "0px",
    "--pn-course-columns": courseColumns(theme),
    "--pn-course-cover-ratio": theme.course_cover_ratio === "auto" ? "auto" : theme.course_cover_ratio.replace(":", " / "),
    "--pn-course-cover-height": theme.course_cover_ratio === "auto" ? "clamp(118px, 17vw, 158px)" : "auto",
    // <polynet-account> on community sites.
    "--polynet-accent": c.accent,
    "--polynet-on-accent": c.on_accent,
    "--polynet-surface": c.surface,
    "--polynet-text": c.text,
    "--polynet-radius": `${Math.min(theme.radius, 16)}px`,
  };

  const mixed = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  const arx: Record<string, string> = {
    "--bg-app": c.background,
    "--bg-workspace": c.background,
    "--surface-workspace": c.background,
    "--bg-header": c.background,
    "--bg-panel": mixed(c.background, 60, c.surface),
    "--surface-panel": mixed(c.background, 60, c.surface),
    // The community's own sidebar; the community rail sits outside the scope.
    "--surface-nav": mixed(c.background, 60, c.surface),
    "--bg-card": c.surface,
    "--bg-card-solid": c.surface,
    "--surface-card": c.surface,
    "--bg-modal": c.surface,
    "--bg-input": c.surface,
    "--surface-input": c.surface,
    "--workspace-composer-bg": c.surface,
    "--composer-surface": c.surface,
    "--bg-card-alt": c.background,
    "--surface-card-alt": c.background,
    "--bg-card-hover": mixed(c.surface, 92, c.text),
    "--surface-card-hover": mixed(c.surface, 92, c.text),
    "--text-primary": c.text,
    "--text-ink-primary": c.text,
    "--text-selected": c.text,
    "--text-secondary": mixed(c.text, 70, c.muted),
    "--text-ink-secondary": mixed(c.text, 70, c.muted),
    "--text-muted": c.muted,
    "--text-ink-muted": c.muted,
    "--text-faint": mixed(c.muted, 75, c.background),
    "--text-ink-faint": mixed(c.muted, 75, c.background),
    "--icon-default": c.muted,
    "--icon-hover": c.text,
    "--border-default": c.border,
    "--stroke-default": c.border,
    "--stroke-panel-edge": c.border,
    "--stroke-divider-accent": c.border,
    "--composer-border": c.border,
    "--scrollbar-thumb": c.border,
    "--border-muted": mixed(c.border, 60, c.background),
    "--stroke-muted": mixed(c.border, 60, c.background),
    "--border-strong": mixed(c.border, 50, c.text),
    "--stroke-strong": mixed(c.border, 50, c.text),
    "--accent-gold": c.accent,
    "--accent-brand": c.accent,
    "--accent-selection": c.accent,
    "--accent-agent": c.accent,
    "--accent-agent-foreground": link,
    "--accent-success": c.accent,
    "--border-active": c.accent,
    "--stroke-active": c.accent,
    "--icon-active": c.accent,
    "--accent-gold-subtle": mixed(c.accent, 84, c.text),
    "--accent-agent-strong": mixed(c.accent, 84, c.text),
    "--accent-gold-glow": mixed(c.accent, 18, "transparent"),
    "--accent-agent-surface": mixed(c.accent, 14, c.surface),
    "--surface-selected": mixed(c.accent, 14, c.surface),
    "--stroke-selected": mixed(c.accent, 50, c.border),
    "--focus-ring": mixed(c.accent, 45, "transparent"),
    "--text-link": link,
    "--chat-link": link,
    "--text-link-hover": mixed(link, 84, c.text),
    "--chat-link-hover": mixed(link, 84, c.text),
    "--bg-button": c.button,
    "--bg-button-hover": mixed(c.button, 88, c.background),
    "--bg-button-text": c.on_button,
    "--conversation-primary-action-surface": c.button,
    "--conversation-primary-action-hover-surface": mixed(c.button, 88, c.background),
    "--conversation-primary-action-foreground": c.on_button,
    "--hover-overlay": mixed(c.text, 6, "transparent"),
    "--active-overlay": mixed(c.text, 10, "transparent"),
    // Polynet's shared corner sizes, at the theme's radius.
    "--radius-sm": `${Math.round(8 * theme.radius / DEFAULT_COMMUNITY_THEME.radius)}px`,
    "--radius-md": `${Math.round(14 * theme.radius / DEFAULT_COMMUNITY_THEME.radius)}px`,
    "--radius-lg": `${Math.round(16 * theme.radius / DEFAULT_COMMUNITY_THEME.radius)}px`,
    "--font-sans": font(theme.font_body),
    "--font-mono": font(theme.font_mono),
  };

  return { ...pn, ...arx };
}

function block(selector: string, vars: Record<string, string>, scheme: CommunityThemeScheme): string {
  const lines = Object.entries(vars).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n  color-scheme: ${scheme};\n${lines.join("\n")}\n}`;
}

// The CSS for one community's area. `scope` is the selector of the element
// that wraps the community's content (never :root or the app frame). With
// both schemes, the member's own Light/Dark choice (data-theme on <html>)
// picks one; with one scheme, the community always looks that way.
export function compileCommunityThemeCss(theme: CommunityThemeV1, scope: string): string {
  const schemes = (["light", "dark"] as const).filter((scheme) => theme.schemes[scheme]);
  if (schemes.length === 0) throw new Error("The theme has no colour scheme.");
  const parts = schemes.length === 1
    ? [block(scope, communityThemeVariables(theme, schemes[0]), schemes[0])]
    : [
        block(scope, communityThemeVariables(theme, "dark"), "dark"),
        block(`:root[data-theme="light"] ${scope}`, communityThemeVariables(theme, "light"), "light"),
      ];
  return `/* Community theme v${theme.version}; compiled, do not edit. */\n${parts.join("\n\n")}\n`;
}

// The Google Fonts stylesheet the theme needs, or null when it only uses
// Polynet's and the device's own faces.
export function communityThemeFontStylesheetUrl(theme: CommunityThemeV1): string | null {
  const families = [...new Set([theme.font_body, theme.font_heading, theme.font_mono])]
    .map((name) => COMMUNITY_THEME_FONTS[name])
    .filter((font) => font?.source === "google" && font.googleFamily)
    .map((font) => `family=${encodeURIComponent(font.googleFamily as string).replace(/%20/g, "+").replace(/%3A/g, ":").replace(/%3B/g, ";").replace(/%40/g, "@")}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap` : null;
}
