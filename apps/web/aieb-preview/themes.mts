// Community theme records for the preview, compiled into compiled-themes.css
// with Polynet's theme compiler (shared/communityTheme.ts). Each theme applies
// to the community area only (data-community-theme on the wrapper around the
// community nav and workspace), so the rail keeps Polynet's look.
// Run: node aieb-preview/themes.mts (from apps/web)
import { writeFileSync } from "node:fs";
import { compileCommunityThemeCss, normalizeCommunityTheme } from "../../../shared/communityTheme.ts";

const THEMES: Record<string, unknown> = {
  // AI Employee Builders: the CLO course look (paper, ink, green, hand-drawn corners).
  // The portal green #2D8C3C is too light under white text; #2B863A passes.
  clo: {
    version: 1,
    schemes: {
      light: {
        background: "#FAFAFA", surface: "#FFFFFF", text: "#21211E", muted: "#6B6B63", border: "#E2E2DC",
        accent: "#2B863A", on_accent: "#FFFFFF", button: "#21211E", on_button: "#FFFFFF",
      },
    },
    font_body: "Segoe UI", font_heading: "Excalifont", heading_weight: 400,
    radius: 15, corner_style: "sketch", button_shape: "sketch", border_width: 2, shadow: "hard",
  },
  // The 2-Hour Club: "Stopwatch" (black, the logo's green, condensed type, timer numerals).
  "the-2-hour-club": {
    version: 1,
    schemes: {
      dark: {
        background: "#0B0B0B", surface: "#151515", text: "#F2F2EF", muted: "#9C9C96", border: "#2B2B2B",
        accent: "#3FD15A", on_accent: "#0B0B0B", button: "#3FD15A", on_button: "#0B0B0B",
      },
    },
    font_body: "IBM Plex Sans", font_heading: "Barlow Condensed", heading_weight: 600, heading_case: "upper",
    numerals: "tabular", radius: 3, button_shape: "square", density: "compact", media_plate: "light",
  },
};

const css = Object.entries(THEMES).map(([key, raw]) => {
  const result = normalizeCommunityTheme(raw);
  if (!result.ok) throw new Error(`${key}: ${JSON.stringify(result)}`);
  return compileCommunityThemeCss(result.theme, `[data-community-theme="${key}"]`);
}).join("\n");
writeFileSync(new URL("./compiled-themes.css", import.meta.url), css);
console.log(`compiled ${Object.keys(THEMES).length} themes`);
