# Skool style

A starting point for a classroom-style community: tabs across the top, a post
feed as the home page, a course grid with progress, a calendar, members and an
About page. Every part runs on a system Polynet already has; Skool's points,
levels, leaderboard and member map are left out on purpose.

```sh
polynet init --template skool
polynet dev        # preview as a draft in your real community
polynet publish    # make it live
```

The template is a layout first. If your community already has its own
colours and fonts, they stay: `apply.theme` is `keep_existing`, so the
template's `theme.json` is only used as a starting look for a community with
no theme yet. Changing the layout never resets your colours, and changing
your colours never resets the layout.

Everything here is yours to change: colours, fonts, corners, card sizes, tab
names and order. Polynet's left community rail stays the same in every
community.

- `theme.json` is a community theme v1 record (`docs/community-theme-v1.md`).
  It works today.
- `template.json` `layout_notes` describes the top navigation and page blocks.
  They take effect once Polynet's layout record ships; until then the theme
  applies to Polynet's standard layout.
- `wanted_tokens` are styling options the theme doesn't have yet.
  `polynet check` warns about them instead of failing.

No Skool colours, logos or assets are used. Study and gap analysis:
https://claude.ai/artifact/REJNXYD1Hcxg1u2Xo5xi5D
