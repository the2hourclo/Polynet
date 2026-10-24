// What Polynet promises a community's design can rely on. A founder, or their
// agent, customizes a community only through what is listed here: theme
// tokens, the lesson elements, and the widget bridge. Polynet keeps everything
// in this file working across updates; everything else (class names, internal
// CSS variables, component structure) stays Polynet's to change.
//
// The contract is checked from both sides. `polynet check` tests a design
// against it before it goes live, and scripts/community_design_contract.test.ts
// fails a Polynet change that drops a surface a theme styles. Contract:
// docs/community-design-contract.md.

import { COMMUNITY_EMBED_LANGUAGE, COMMUNITY_EMBED_MAX_KEY_LENGTH, COMMUNITY_EMBED_MAX_VALUE_LENGTH } from "./communityEmbed";
import { COMMUNITY_LESSON_BUTTON_ACTIONS, COMMUNITY_LESSON_ELEMENT_TYPES } from "./communityLessonContract";
import { COMMUNITY_THEME_FONTS, COMMUNITY_THEME_VERSION, DEFAULT_COMMUNITY_THEME } from "./communityTheme";

export const COMMUNITY_DESIGN_CONTRACT_VERSION = 1 as const;

export type CommunityDesignSurface = {
  // What a founder recognizes on the page.
  label: string;
  // Theme tokens that change it.
  tokens: readonly string[];
  // Polynet's own classes that carry the surface today, styled in
  // apps/web/src/styles/community-theme-hooks.css. Internal: themes never name
  // them. A rename updates this list and the hooks file together.
  classes: readonly string[];
};

// Every part of a community's area a theme reaches. Colours reach everything
// through Polynet's own variables and need no entry here; these are the
// surfaces that take the shape, type and catalog tokens.
export const COMMUNITY_DESIGN_SURFACES = {
  headings: {
    label: "Page, column and course headings",
    tokens: ["font_heading", "heading_weight", "heading_case"],
    classes: [
      "community-knowledge-header",
      "workflow-milestone-column-header",
      "resource-course-outline-title",
      "resource-course-card-heading",
      "resource-viewer-title",
    ],
  },
  cards: {
    label: "Course cards, workflow columns and member cards",
    tokens: ["radius", "corner_style", "border_width", "shadow"],
    classes: ["resource-course-card", "resource-course-create-card", "workflow-milestone-column", "workflow-member-stub"],
  },
  buttons: {
    label: "Primary buttons",
    tokens: ["button_shape", "shadow"],
    classes: ["settings-primary-action", "community-events-primary-link", "knowledge-source-intake-primary", "platform-save-button"],
  },
  course_catalog: {
    label: "Course grid, covers and card text",
    tokens: ["course_card_size", "course_cover_ratio", "type_scale"],
    classes: [
      "resource-course-grid",
      "resource-course-card-cover",
      "resource-course-card-heading",
      "resource-course-card-description",
    ],
  },
  images: {
    label: "Course covers and lesson images on dark themes",
    tokens: ["media_plate"],
    classes: ["resource-course-card-cover-image", "resource-viewer-prose"],
  },
  community_area: {
    label: "The community's own area (never the community rail or Polynet's navigation)",
    tokens: ["font_body", "font_mono", "numerals", "density"],
    classes: ["community-theme-scope"],
  },
} as const satisfies Record<string, CommunityDesignSurface>;

export type CommunityDesignSurfaceName = keyof typeof COMMUNITY_DESIGN_SURFACES;

// Messages a widget may send through /__polynet/embed.js, and what each does.
export const COMMUNITY_WIDGET_CAPABILITIES = {
  ready: "Tell Polynet the widget has loaded",
  resize: "Ask for a new height",
  load: "Read one of the member's saved answers for this widget",
  save: "Save one answer for the member",
} as const;

// The vocabulary an agent may use. Anything not listed is rejected with an
// error, never silently dropped.
export function describeCommunityDesignContract() {
  const { version: _version, schemes: _schemes, ...themeTokens } = DEFAULT_COMMUNITY_THEME;
  return {
    version: COMMUNITY_DESIGN_CONTRACT_VERSION,
    theme: {
      version: COMMUNITY_THEME_VERSION,
      colors: Object.keys(DEFAULT_COMMUNITY_THEME.schemes.light ?? {}),
      schemes: ["light", "dark"],
      tokens: Object.keys(themeTokens),
      fonts: Object.entries(COMMUNITY_THEME_FONTS).map(([name, font]) => ({ name, role: font.role })),
      defaults: DEFAULT_COMMUNITY_THEME,
    },
    surfaces: Object.fromEntries(
      Object.entries(COMMUNITY_DESIGN_SURFACES).map(([name, surface]) => [name, { label: surface.label, tokens: surface.tokens }]),
    ),
    lesson_elements: { types: [...COMMUNITY_LESSON_ELEMENT_TYPES], button_actions: [...COMMUNITY_LESSON_BUTTON_ACTIONS] },
    widgets: {
      fence: COMMUNITY_EMBED_LANGUAGE,
      capabilities: COMMUNITY_WIDGET_CAPABILITIES,
      max_key_length: COMMUNITY_EMBED_MAX_KEY_LENGTH,
      max_value_length: COMMUNITY_EMBED_MAX_VALUE_LENGTH,
    },
  };
}
