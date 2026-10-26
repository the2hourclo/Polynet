# @polynet/cli

Put your community's site live on Polynet.

> Preview: until Polynet's production release, deploys go to Polynet's staging
> environment. Start at https://polynet.page.

```bash
npx @polynet/cli create my-site --community <your-community-slug>   # a folder set up for your AI agent
cd my-site                                                          # open it in Claude Code, Codex or Cursor:
                                                                    # "Design our community's site."
npx @polynet/cli deploy
```

- Your site is a folder of static files with an `index.html` (HTML, CSS,
  JavaScript, images). It talks to Polynet through `/__polynet/sdk.js`; the
  guide for building one is at `https://<slug>.polynet.page/__polynet/llms.txt`.
- The first run opens your browser to sign in with Polynet. You must be the
  community's owner or an admin. The community is saved in `polynet.json`, so
  later deploys are just `npx @polynet/cli deploy`.
- Only changed files upload. The site is live at `https://<slug>.polynet.page`.
- There's no template: `create` puts `AGENTS.md`, `CLAUDE.md` and Polynet's
  skills (build-site, design, ui-design, sdk, accessibility, deploy-verify) in the
  folder, under `.agents/skills` and `.claude/skills`. Your agent asks about
  your community, shows you three directions live, and builds the one you
  pick. `polynet skills` adds or updates the skills in any site folder.
- `polynet check` checks the site: the Polynet shell on every page and the
  accessibility basics (language, title, zoom, image alt text, named buttons
  and links). `deploy` runs it first and stops on errors.
- Agent guides, `polynet.json`, dotfiles and `node_modules` are never uploaded.
- `polynet logout` forgets your sign-in (kept in `~/.polynet/auth.json`).

## Courses and lessons

Put courses next to the site and push them:

```text
polynet.json           { "community": "<slug>" }  (optional: "site", "courses", "theme", "site_origin")
index.html, embeds/, media/        the site: lesson widgets and images live here
courses/01-start-here/course.json  { "title", "description", "status": "draft" | "live" }
courses/01-start-here/01-welcome.md   front matter (title, stage, order, minutes, gate, video, summary) + Markdown
theme.json             the community theme
```

```bash
npx @polynet/cli check            # site, courses and theme, with Polynet's own validators
npx @polynet/cli push --dry-run   # what would change; sends nothing
npx @polynet/cli push             # stage the changes for the owner to apply
```

- `check` uses the same lesson, widget (`polynet-embed`) and theme rules as
  the server, and refuses what Polynet would cut off silently: lessons over
  20,000 characters, titles over 120. It checks every widget and image a
  lesson names is in the site folder.
- `push` goes through the Polynet MCP, like any agent. It stages a builder
  changeset; the owner presses **Apply** on the card on the community's Agent
  page. New lessons arrive as drafts, so nothing reaches members until it's
  published. Courses match by name and lessons by title; push never deletes.
- A community has one changeset waiting at a time, of up to 25 changes, so a
  big first push takes rounds: run `push` again after each Apply, or
  `push --wait` to keep going until everything is applied.
- The `courses/` folder and `theme.json` are never uploaded with the site.
- `--json` prints one JSON result, and errors exit 1, for CI and agents.
  `POLYNET_TOKEN` is used as the access token instead of a browser sign-in.

Limits: static files only, up to 50 MB and 2,000 files.

## The community's look

Edit a community's look like a website: files in a folder, a live preview,
then publish. Members see nothing until you publish. `theme.json` holds the
colours, type and shape; `layout.json` (optional) holds where the navigation
sits, which tabs show, and how the community page is arranged. They are
separate records, so publishing one never resets the other.

```sh
npx @polynet/cli init my-community --template stopwatch --community the-2-hour-club
npx @polynet/cli dev my-community       # saves theme.json to the draft on every edit, opens the preview
npx @polynet/cli publish my-community   # makes it the theme members see
```

- `polynet init` also puts Polynet's skills in the folder, including
  `polynet-ui-design`: design taste and craft for your agent (type, colour,
  space, polish, avoiding the generic AI look). It's guidance, not a style:
  your community's look is still yours.
- `polynet review` opens the draft in the real app at 390, 1280 and 1440px,
  screenshots every page (owner pages too) and audits it: sideways overflow,
  overlaps, contrast, colours outside the theme and `brand.json`, too many
  sizes or radii, control heights, tap targets, heavy cards, filler. Errors
  fail it, and `publish` refuses until the current files pass (or
  `--skip-review`). Sign in with `--login-url` (a local no-login link) or
  `--storage-state`; it needs Playwright in the folder. Screenshots and
  `report.md` land in `.polynet/review/`. Then a fresh reviewer (the
  `polynet-ui-reviewer` agent) judges the screenshots.
- `polynet init` without `--template` lists the templates. A template is a
  design with no content: `template.json` and `theme.json` in `templates/<name>/`.
- A layout template with `"apply": { "theme": "keep_existing" }` keeps your own
  colours and fonts: `init --community` writes the community's published theme
  into `theme.json` and takes only the template's layout. Its theme is used only
  when the community has none. Theme and layout never reset each other.
- `polynet pull` copies the community's current drafts into `theme.json`, and
  into `layout.json` when the community has a layout of its own.
- `polynet dev` checks each save against the design contract first; a broken
  theme or layout shows its problems and never reaches the draft. The preview is the
  real app at `/c/<slug>?design=draft`, which only the owner and admins can see.
- A save or publish refuses if someone else changed the draft since your last
  save or pull. Run `polynet pull` and redo your change on top.

Agents can do the same through the MCP: read `/communities/<slug>/builder/theme.json`
or `layout.json`, then call `community.theme.save_draft` and `community.theme.publish`
(or the `community.layout.*` pair). What a
theme may change is listed in `docs/community-design-contract.md`.
