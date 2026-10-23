# AIEB portal on Polynet's own UI

This preview renders the portal with Polynet's real web components from the fork
(`the2hourclo/Polynet`, `apps/web`): the community shell and nav, the Knowledge
page's Resources catalog and reader, and the Workflows board styling for the Board
view. Same resources, two views: **Resources** (courses and lessons) and **Board**
(stages, checkpoints and locks from the lesson contract).

Run: `node serve.mjs` in this folder, then open http://localhost:8790/

- `app/` is the built page. Lesson progress is kept in the browser here; on
  Polynet it comes from `progress()` / `setProgress()`.
- Content comes from `../.dev/content/` (one folder per course, one `.md` per
  lesson, optional `course.json` with the card's `description` and `banner`).

Rebuild after changing content (needs the fork checked out with `npm ci` in the
repo root and in `apps/web`): copy `source/` to `apps/web/aieb-preview/`, then

    node aieb-preview/build-fixtures.mjs <path to .dev/content> <path to .dev/lesson-contract.mjs>
    npx vite build --config aieb-preview/vite.config.ts

and copy `aieb-preview/dist/` here as `app/`.
