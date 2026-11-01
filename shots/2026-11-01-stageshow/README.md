# Craft pass before/after (2026-11-01)

Commit ee82ebf3 on claude/local-combined (cherry-pick of 4863b08), owner view of AI Employee Builders, light mode.

- chat-1440 / chat-390 / track-1440: the owner's saved Display choice (Channels). Pixel-identical before and after:
  Channels shows the chat timeline, not the posts feed, and the Cards track view doesn't use the restyled parts.
- chat-classroom-1440 / chat-classroom-390: the same Chat tab in the Classroom layout via the read-only `?layout=classroom`
  URL override (nothing saved). This is where the hairline posts list and hidden zero counts show.
- Not captured: the track page's "Up next: Module N" and "What you'll be able to do" heading only render inside the
  lesson reader, and opening a lesson starts progress.
