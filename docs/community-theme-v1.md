# Community theme v1

October 23, 2026. Proposal, built in the2hourclo/Polynet. Not yet a Polynet
contract: it needs Neil's approval before it is stored or served.

A community's look is data: a small set of tokens a founder or their agent
sets. Polynet validates it, compiles it into Polynet's own CSS variables, and
applies it to the community's area only. The app frame (community rail,
Discover, messages, account, settings) always keeps Polynet's look.

Code: `shared/communityTheme.ts` (validator and compiler),
`apps/web/src/styles/community-theme-hooks.css` (where components use the
shape and type tokens), tests in `convex/communityTheme.test.ts`.

## The record

```json
{
  "version": 1,
  "schemes": {
    "dark": {
      "background": "#0B0B0B", "surface": "#151515", "text": "#F2F2EF", "muted": "#9C9C96",
      "border": "#2B2B2B", "accent": "#3FD15A", "on_accent": "#0B0B0B",
      "button": "#3FD15A", "on_button": "#0B0B0B"
    }
  },
  "font_body": "IBM Plex Sans",
  "font_heading": "Barlow Condensed",
  "heading_weight": 600,
  "heading_case": "upper",
  "numerals": "tabular",
  "radius": 3,
  "button_shape": "square",
  "density": "compact",
  "media_plate": "light"
}
```

Anything left out keeps Polynet's default. One scheme fixes the community's
look; both follow the member's own Light/Dark choice.

| Setting | Values |
| --- | --- |
| `schemes.light`, `schemes.dark` | The nine colours above, as hex |
| `font_body`, `font_heading`, `font_mono` | A name from `COMMUNITY_THEME_FONTS`. Display faces only for headings |
| `heading_weight` | 300 to 900 |
| `heading_case` | `none`, `upper` |
| `type_scale` | 0.9 to 1.2 |
| `numerals` | `proportional`, `tabular` |
| `radius` | 0 to 24 (px) |
| `corner_style` | `even`, `sketch` |
| `button_shape` | `pill`, `rounded`, `square`, `sketch` |
| `border_width` | 0 to 3 (px) |
| `shadow` | `none`, `soft`, `hard` |
| `density` | `compact`, `comfortable`, `roomy` |
| `media_plate` | `none`, `light` (frames white-background images in dark schemes) |
| `course_cover_ratio` | `auto` (Polynet's fixed height), `16:9`, `3:2`, `4:3`, `1:1`, `21:9` |
| `course_card_size` | `default` (two columns), `small`, `medium`, `large` (cards at least 220, 300 or 420px wide, as many columns as fit) |

## Validation

`normalizeCommunityTheme(raw)` returns the full theme or every problem at
once, each with a path, a plain message and, for contrast, the nearest colour
that passes. Contrast floors (WCAG 2.2 AA): text and muted on their surfaces
4.5:1, labels on accent and button fills 4.5:1, accent against the background
3:1. Link colour is derived from the accent and always reaches 4.5:1.

## Output

`compileCommunityThemeCss(theme, scope)` returns CSS for one selector, the
element that wraps the community's own area (in the web app,
`.product-shell-surface--community`, which holds the community sidebar and
workspace but not the rail). It sets:

- the public `--pn-*` variables (also read by community sites and
  `<polynet-account>` through `--polynet-*`), and
- Polynet's internal colour variables, derived from the nine colours.

Themes never name Polynet's classes. Where a component should use a shape or
type token, the rule lives in `community-theme-hooks.css`, maintained with
the components.

## Not in this change

- Storing the record on the community (a `communityThemes` table with draft,
  published and revision, like `communityFunnels`), the MCP operations
  `community.theme.get/set`, and setting `data-community-theme` in the web app.
- Serving `/__polynet/theme.css` on community sites.
- Hosting Excalifont with Polynet (the AIEB preview inlines it today).
