# Cowork cleanup plan (dry run, nothing saved)

2026-10-27 · AIEB community on the local backend (communityId js76ry9kd19tk43qn77yz55evs8gtk09) · 11 lessons mention Cowork · full backups of each lesson are in `.local-transfer/backups/2026-10-27-cowork-*.json`.

Rules applied:
- "Cowork" as the place you work → "the Claude app"
- "Claude Code or Cowork" → "the Claude app or Claude Code"
- Cowork-only steps → the Claude app equivalent

Nothing below has been written. It waits for Rashid's "go ahead with the Cowork cleanup".

---

## (a) Lessons whose whole subject is Cowork

No lesson is about Cowork itself. Four lessons and three sections are labelled Cowork-only, but their steps (install the plugin, connect AIEB, Draw.io) are the Claude app's plugin flow, so I'd **relabel them, not hide them**.

| Lesson | What's Cowork-only | Proposal |
|---|---|---|
| Get set up / Install the plugin (v57a6pzj) | L0 `*In Cowork only.*` | L0 → `*In the Claude app only.*` |
| Get set up / Connect & onboard (v57dpa3g) | L0 `*In Cowork only.*`, whole lesson | L0 → `*In the Claude app only.*`, sentence edits in (b) |
| Get set up / Install Draw.io Desktop (optional) (v57c2zjz) | L0 `*In Cowork only.*` | L0 → `*In the Claude app only.*` |
| Get set up / Connect the Draw.io connector (optional) (v577bd9k) | L0 `*In Cowork only.*` | L0 → `*In the Claude app only.*` |
| Map the business / Set up Draw.io — connector + app (v5712ex0) | L0 `### In Cowork` section (has Claude Code + Codex siblings) | L0 → `### In the Claude app` |
| Map the business / Run your Business X-Ray (v57f36k7) | L0 `### In Cowork` section | L0 → `### In the Claude app` |
| Your AI employee / Schedule it — do it (v57fwvx5) | L0 `### In Cowork` section | L0 → `### In the Claude app` |

**Can the app hide or unpublish one lesson?** No.
- A lesson's own `status` is `draft` for all 59 AIEB lessons, and the server refuses `published` at page level (`community_resource_page_status_deprecated`, convex/communityCore.ts:593). Page status doesn't control what members see.
- Visibility is set per course (module): `draft` or `live` (communityCore.ts:604). Every course these lessons sit in is `live`. Setting a course to draft hides the **whole** course, not one lesson.
- The only way to hide a single lesson would be to move it into a draft course. I don't recommend it for any of these.

---

## (b) Sentence changes, before → after

### Get set up / Connect & onboard (v57dpa3g)
- L0: `*In Cowork only.*` → `*In the Claude app only.*`
- L2: "Open the **Cowork Project** that will hold your Business OS" → "Open the **Claude app Project** that will hold your Business OS"
- L15: "open its existing Cowork Project" → "open its existing Claude app Project"
- L18: "In that **Cowork Project chat**" → "In that **Claude app Project chat**"; "Cowork may shorten the chip" → "the Claude app may shorten the chip"
- L20: "**If Cowork shows an AIEB Connect action, click it.**" → "**If the Claude app shows an AIEB Connect action, click it.**"
- L23: "merely because Cowork changed runtimes" → "merely because the Claude app changed runtimes"
- L25: "**If Cowork says the authorization expired…**" → "**If the Claude app says the authorization expired…**"
- L26: "Return to the same Cowork Project chat" → "Return to the same Claude app Project chat"
- L44: "Cowork manages the secure connection for you." → "The Claude app manages the secure connection for you."
- L46: "return to the same Cowork Project with the same folder attached" → "return to the same Claude app Project with the same folder attached"

### Get set up / Install the plugin (v57a6pzj)
- L0: `*In Cowork only.*` → `*In the Claude app only.*`
- L18: "inside the Cowork Project and folder" → "inside the Claude app Project and folder"
- L20 image alt: "…marketplace menu in Cowork…" → "…marketplace menu in the Claude app…"
- L24 image alt: "…plugin in Cowork showing the Update button" → "…plugin in the Claude app showing the Update button"
- The image files are named `cowork-aieb-*.png`. Renaming isn't needed for members; the pictures only need re-taking if the screen itself shows the word Cowork. **Rashid to check.**

### Get set up / Install Draw.io Desktop (optional) (v57c2zjz)
- L0: `*In Cowork only.*` → `*In the Claude app only.*`

### Get set up / Connect the Draw.io connector (optional) (v577bd9k)
- L0: `*In Cowork only.*` → `*In the Claude app only.*`

### Map the business / Set up Draw.io — connector + app (v5712ex0)
- L0: `### In Cowork` → `### In the Claude app`

### Map the business / Run your Business X-Ray (v57f36k7)
- L0: `### In Cowork` → `### In the Claude app`
- L2: "inside the same Cowork Project" → "inside the same Claude app Project"

### Your AI employee / Schedule it / autonomy (v570wem4)
- L0: "*Cowork, Claude Code, and Codex schedule differently…*" → "*The Claude app, Claude Code, and Codex schedule differently…*"

### Your AI employee / Schedule it — do it (v57fwvx5)
- L0: `### In Cowork` → `### In the Claude app`
- L2: "Cowork runs scheduled tasks **on Anthropic's servers**" → "The Claude app runs scheduled tasks **on Anthropic's servers**"
- L21: "A Cowork scheduled task **cannot reach a folder on your computer**" → "A Claude app scheduled task **cannot reach a folder on your computer**"
- **Rashid to check L2 and L21:** a workspace note (2026-10) says Claude app scheduled tasks are remote by default, but a task can use a folder when it runs from the desktop app. If that's right, L21 should say "unless you run it from the desktop app" rather than "cannot". I haven't changed the meaning here.

### Reference / Prompts & cheat sheet (v572d7g7)
- L44: "Works in Claude Code and Cowork." → "Works in the Claude app and Claude Code."

### Business X-Ray course / Set Up the Skill (v57dd97h)
- L59: "runs in the Claude desktop app (Cowork)" → "runs in the Claude app"
- L77: "Start a Cowork chat" → "Start a Claude app chat"; "Cowork may shorten the selected chip" → "the Claude app may shorten the selected chip"

### Claude Code 101 / What Claude Code actually is (v57agq2x)
This lesson compares three places Claude runs. Swapping the word alone would compare "the Claude app" with "the chat app (Claude.ai)", which reads as the same thing twice.
- L45: "The chat app (Claude.ai) is great for thinking out loud. Cowork hands a task off and waits." → "The chat app (Claude.ai) is great for thinking out loud, and it can hand a task off and wait."
- L47 image (`cc-why-cc.png`, alt "Claude.ai (2 of 7), Cowork (4 of 7) and Claude Code (9 of 9)"): the picture itself shows a Cowork column. It needs a new image without that column, or the lesson keeps it as is. **Rashid to choose.** Alt text after a new image: "A capability table comparing Claude.ai and Claude Code (9 of 9) across skills, sub-agents, custom MCPs, memory, hooks, CLAUDE.md routing, action visibility and parallel work."

---

## Open questions for Rashid
1. Relabel the Cowork-only lessons as "the Claude app" (my recommendation) rather than hide them?
2. Schedule it — do it, L21: "cannot reach a folder" or "can when run from the desktop app"?
3. Claude Code 101 comparison picture: new image without Cowork, or keep it?
4. Install the plugin screenshots: do they show the word Cowork on screen?
