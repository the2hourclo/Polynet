# Local stack

Runs the real Polynet web app against an anonymous **local** Convex backend,
with a local sign-in provider instead of Google/WorkOS. Nothing here deploys or
talks to a hosted Convex, Vercel or auth deployment.

## Start

```bash
npm install
npm --prefix apps/web ci   # or: cd apps/web && npm install
npm run local
```

`npm run local` (`scripts/local-dev/start.mjs`) starts, in one terminal:

| Piece | URL | What it is |
|---|---|---|
| dev-idp | http://127.0.0.1:8799 | `dev-idp.mjs`: local OIDC provider. `/authorize` signs in **Rashid (owner)** straight away (`DEV_IDP_AUTO_USER`, see below), `/token` does PKCE + refresh, `/.well-known/jwks.json` serves the RS256 key. |
| site-server | http://127.0.0.1:8797/sites/{slug} | `site-server.mjs`: stand-in for `https://{slug}.polynet.page` (`/__polynet/embed.js`, `/sites/<slug>/embeds/*`, `/sites/<slug>/media/*`), plus the `/open/<slug>` links below. Sends `frame-ancestors` + CORS for localhost:5174. |
| convex | http://127.0.0.1:3210 (site :3211) | `convex dev` on the anonymous local deployment (`CONVEX_AGENT_MODE=anonymous`), pushing functions on change. |
| env | | `setup-env.mjs`: writes the root `.env` and sets the same auth vars on the **local** Convex deployment (refuses a non-local one). |
| web | http://localhost:5174 | Vite with `vite.local.config.ts`, which wraps `apps/web/vite.config.ts` unchanged and serves `api/**/*.js` (the `/api/auth/*` sign-in bridge) Vercel-style. |

The first run creates the anonymous local deployment (`.env.local`). Keys and
secrets are generated into `scripts/local-dev/.state/` (gitignored).

## Open a community without signing in

`npm run local` prints these when it is ready. Each one signs you in as the
owner and lands on that community's Knowledge page (`/c/<slug>/resources`):

- AI Employee Builders: http://localhost:8797/open/ai-employee-builders
- The 2 Hour Club: http://localhost:8797/open/the-2-hour-club

Add `?as=member` to open as **Test Member** instead.

Sign-in is automatic: `/authorize` signs in `DEV_IDP_AUTO_USER` (default
`owner`) with no picker. `DEV_IDP_AUTO_USER=member` makes the member the
default; `DEV_IDP_AUTO_USER=off` brings the picker back. A one-off hint beats
the default: `?dev_user=member` on `/authorize`, or
`http://127.0.0.1:8799/as?user=member&next=<local url>` (a two-minute cookie,
which is what `?as=member` uses). The app's own sign-in button, or
`http://localhost:5174/api/auth/google/start?return_to=/`, goes through the
same flow. Signing in again as the other user replaces the session.

## Seed

With the stack running:

```bash
npm run seed:preview
```

`scripts/seed-preview/seed.mjs` signs in through the real `/api/auth` flow and
uses the app's own Convex functions to create **AI Employee Builders**
(`ai-employee-builders`) and **The 2 Hour Club** (`the-2-hour-club`):

- each content folder with a `course.json` becomes a course (module), its
  banner uploaded to Convex storage as the cover; `"status": "draft"` stays a draft;
- each `.md` becomes a page, parsed with `parseCommunityLessonMarkdown`, with
  lesson fields (stage, stage_order, order, gate, type, minutes, video, summary)
  written through the builder changeset (`edit_page.lesson`);
- `media/...` links in lesson bodies point at the community site
  (`VITE_POLYNET_SITE_ORIGIN_TEMPLATE`); `polynet-embed` blocks are kept as-is;
- themes (CLO, Stopwatch) are saved and published with `communityThemes`;
- Test Member joins both communities.

Re-running updates in place and creates no duplicates.

Course content is read from this PC (`content-paths.mjs`, override with
`POLYNET_CONTENT_ROOT`) and is never committed.

Two steps have no public app path and use the local CLI instead: the first
platform-owner `operatorRoles` row (`convex import`, so the owner can create
communities without a Stripe founder plan), and staging the lesson-field
changeset (`stageCommunityResourceBuilderChangesetInternal`, which normally
comes from the builder agent). The owner applies the changeset through the
public `applyCommunityResourceBuilderChangeset`.

## Ports and env

- `POLYNET_SITE_PORT` (8797), `POLYNET_SITE_ALLOWED`, `POLYNET_SITE_DIRS_JSON`
  configure the site server. Port 8790 is left free for the portal stub.
- Dev users and ports live in `config.mjs`.
