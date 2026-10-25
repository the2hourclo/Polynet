import { describe, expect, test } from "vitest";

import {
  compileCommunityThemeCss,
  communityThemeFontStylesheetUrl,
  communityThemeVariables,
  contrastRatio,
  DEFAULT_COMMUNITY_THEME,
  nearestPassingColor,
  normalizeCommunityTheme,
} from "../shared/communityTheme";

// The AI Employee Builders course look (paper, ink, green, hand-drawn corners).
// The portal's green #2D8C3C carries white text at 4.3:1; #2B863A is the
// validator's nearest passing shade.
const CLO_THEME = {
  version: 1,
  schemes: {
    light: {
      background: "#FAFAFA", surface: "#FFFFFF", text: "#21211E", muted: "#6B6B63", border: "#E2E2DC",
      accent: "#2B863A", on_accent: "#FFFFFF", button: "#21211E", on_button: "#FFFFFF",
    },
  },
  font_body: "Segoe UI",
  font_heading: "Excalifont",
  heading_weight: 400,
  radius: 15,
  corner_style: "sketch",
  button_shape: "sketch",
  border_width: 2,
  shadow: "hard",
};

// The 2-Hour Club's "Stopwatch" look: black, the logo's green, condensed type, timer numerals.
const STOPWATCH_THEME = {
  version: 1,
  schemes: {
    dark: {
      background: "#0B0B0B", surface: "#151515", text: "#F2F2EF", muted: "#9C9C96", border: "#2B2B2B",
      accent: "#3FD15A", on_accent: "#0B0B0B", button: "#3FD15A", on_button: "#0B0B0B",
    },
  },
  font_body: "IBM Plex Sans",
  font_heading: "Barlow Condensed",
  heading_weight: 600,
  heading_case: "upper",
  numerals: "tabular",
  radius: 3,
  button_shape: "square",
  density: "compact",
  media_plate: "light",
  course_cover_ratio: "16:9",
  course_card_size: "medium",
};

describe("community theme validation", () => {
  test("the CLO and Stopwatch themes are valid", () => {
    expect(normalizeCommunityTheme(CLO_THEME)).toMatchObject({ ok: true });
    expect(normalizeCommunityTheme(STOPWATCH_THEME)).toMatchObject({ ok: true });
  });

  test("a banner that already shows the name can hide the side column's name", () => {
    expect(DEFAULT_COMMUNITY_THEME.banner_name).toBe("show");
    expect(communityThemeVariables(DEFAULT_COMMUNITY_THEME, "dark")["--pn-banner-name"]).toBe("visible");
    const result = normalizeCommunityTheme({ banner_name: "hide" });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(communityThemeVariables(result.theme, "dark")).toMatchObject({ "--pn-banner-name": "hidden", "--pn-banner-scrim": "0.45" });
    expect(normalizeCommunityTheme({ banner_name: "maybe" }).ok).toBe(false);
  });

  test("an empty theme is Polynet's own look", () => {
    expect(normalizeCommunityTheme({})).toEqual({ ok: true, theme: DEFAULT_COMMUNITY_THEME });
  });

  test("Polynet's default schemes pass their own contrast rules", () => {
    expect(normalizeCommunityTheme({ schemes: DEFAULT_COMMUNITY_THEME.schemes }).ok).toBe(true);
  });

  test("unreadable text is rejected with a colour that would pass", () => {
    const result = normalizeCommunityTheme({
      schemes: { dark: { ...STOPWATCH_THEME.schemes.dark, muted: "#3A3A3A" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const problem = result.problems.find((p) => p.path === "schemes.dark.muted");
    expect(problem?.message).toMatch(/needs 4.5:1/);
    expect(contrastRatio(problem?.suggestion ?? "", "#151515")).toBeGreaterThanOrEqual(4.5);
  });

  test("a brand fill too light for its label gets a nearby passing fill", () => {
    const result = normalizeCommunityTheme({
      schemes: { light: { ...CLO_THEME.schemes.light, accent: "#2D8C3C" } },
    });
    expect(result).toEqual({
      ok: false,
      problems: [{
        path: "schemes.light.accent",
        message: "on_accent #FFFFFF on accent #2D8C3C is 4.3:1; it needs 4.5:1 to be readable.",
        suggestion: "#2B863A",
      }],
    });
  });

  test("every problem comes back at once", () => {
    const result = normalizeCommunityTheme({
      font_body: "Barlow Condensed",
      font_heading: "Comic Sans",
      radius: 40,
      shadow: "glow",
      sparkle: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.path).sort()).toEqual(["font_body", "font_heading", "radius", "shadow", "sparkle"]);
    expect(result.problems.find((p) => p.path === "font_body")?.message).toMatch(/display face/);
  });

  test("colours must be hex and complete", () => {
    const result = normalizeCommunityTheme({ schemes: { light: { background: "white" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((p) => p.path === "schemes.light.background")).toBe(true);
    expect(result.problems.some((p) => p.path === "schemes.light.accent")).toBe(true);
  });
});

describe("community theme compilation", () => {
  test("a one-scheme theme is scoped to the community area only", () => {
    const result = normalizeCommunityTheme(STOPWATCH_THEME);
    if (!result.ok) throw new Error("invalid");
    const css = compileCommunityThemeCss(result.theme, '[data-community-theme="the-2-hour-club"]');
    expect(css).toContain('[data-community-theme="the-2-hour-club"] {\n  color-scheme: dark;');
    expect(css).not.toMatch(/(^|\n):root\b/);
    expect(css).not.toContain("--surface-rail");
    expect(css).toContain("--pn-heading-case: uppercase;");
    expect(css).toContain("--pn-numerals: tabular-nums;");
    expect(css).toContain("--pn-media-plate: #F4F4F0;");
  });

  test("a two-scheme theme follows the member's Light/Dark choice", () => {
    const css = compileCommunityThemeCss(DEFAULT_COMMUNITY_THEME, ".community");
    expect(css).toContain(".community {\n  color-scheme: dark;");
    expect(css).toContain(':root[data-theme="light"] .community {\n  color-scheme: light;');
  });

  test("links are always readable, even when the accent alone is not", () => {
    const result = normalizeCommunityTheme(CLO_THEME);
    if (!result.ok) throw new Error("invalid");
    const vars = communityThemeVariables(result.theme, "light");
    expect(contrastRatio(vars["--pn-link"], "#FAFAFA")).toBeGreaterThanOrEqual(4.5);
    expect(vars["--accent-brand"]).toBe("#2B863A");
    expect(vars["--pn-radius-card"]).toBe("15px 4px 15px 4px");
    expect(vars["--pn-radius-button"]).toContain("255px");
  });

  test("course cards: Polynet's two columns by default, or sized cards with a cover ratio", () => {
    const defaults = communityThemeVariables(DEFAULT_COMMUNITY_THEME, "light");
    expect(defaults["--pn-course-columns"]).toBe("repeat(2, minmax(0, 1fr))");
    expect(defaults["--pn-course-cover-ratio"]).toBe("auto");
    const stopwatch = normalizeCommunityTheme(STOPWATCH_THEME);
    if (!stopwatch.ok) throw new Error("invalid");
    const vars = communityThemeVariables(stopwatch.theme, "dark");
    expect(vars["--pn-course-columns"]).toBe("repeat(auto-fill, minmax(min(100%, 300px), 1fr))");
    expect(vars["--pn-course-cover-ratio"]).toBe("16 / 9");
    expect(vars["--pn-course-cover-height"]).toBe("auto");
    expect(normalizeCommunityTheme({ course_cover_ratio: "2:1" }).ok).toBe(false);
  });

  test("only Google faces add a stylesheet", () => {
    const stopwatch = normalizeCommunityTheme(STOPWATCH_THEME);
    if (!stopwatch.ok) throw new Error("invalid");
    expect(communityThemeFontStylesheetUrl(stopwatch.theme)).toBe(
      "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap",
    );
    expect(communityThemeFontStylesheetUrl(DEFAULT_COMMUNITY_THEME)).toBeNull();
  });

  test("nearestPassingColor keeps a passing colour and moves a failing one", () => {
    expect(nearestPassingColor("#000000", "#FFFFFF", 4.5)).toBe("#000000");
    const fixed = nearestPassingColor("#9BE59B", "#FFFFFF", 4.5);
    expect(contrastRatio(fixed ?? "", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});
