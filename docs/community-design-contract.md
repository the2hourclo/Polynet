# Community design contract

October 24, 2026. Proposal, built in the2hourclo/Polynet. Needs Neil's
approval before it becomes a promise Polynet keeps.

A founder, or their agent, customizes a community only through what this
contract lists. Polynet keeps all of it working across updates. Everything
else, such as class names, internal CSS variables and component structure,
stays Polynet's to change.

Code: `shared/communityDesignContract.ts`. `describeCommunityDesignContract()`
returns the whole vocabulary as JSON, for the CLI and for agents.

## What it lists

| Part | What a design can use | Defined in |
| --- | --- | --- |
| Theme | The colour, type, shape, density and course catalog tokens | `shared/communityTheme.ts`, [community-theme-v1.md](community-theme-v1.md) |
| Surfaces | The parts of a community's area that the tokens reach: headings, cards, buttons, course catalog, images, the community area itself | `COMMUNITY_DESIGN_SURFACES` |
| Lesson elements | `button`, `checklist`, `quiz` and `form` blocks, and the button actions | `shared/communityLessonContract.ts` |
| Widgets | `polynet-embed` blocks and the messages a widget may send: `ready`, `resize`, `load`, `save` | `shared/communityEmbed.ts` |

Surfaces never name Polynet's classes to founders. Each surface records which
of Polynet's classes carry it today, so the styles in
`apps/web/src/styles/community-theme-hooks.css` and the components stay in step.

## Checked from both sides

- **A founder's design**, before it goes live: `polynet check` and the server
  validate the theme and lessons against the contract. Unknown tokens, blocks
  or options are errors with the file named, never dropped.
- **A Polynet change**, before it merges: `scripts/community_design_contract.test.ts`
  fails when a component loses a class a surface uses, when the hooks file
  styles a class no surface lists, or when Polynet's styles read a theme
  variable the compiler never sets. The message says which surface broke.

The next step adds rendered checks: every published community's theme
screenshotted on fixture lessons at phone and desktop width, in Polynet's CI.
