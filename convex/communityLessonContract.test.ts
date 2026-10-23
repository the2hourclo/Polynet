import { describe, expect, test } from "vitest";

import {
  computeCommunityLessonStages,
  normalizeCommunityLessonFields,
  parseCommunityLessonMarkdown,
  projectCommunityLessonBody,
} from "../shared/communityLessonContract";

const PORTAL_FILE = [
  "---",
  "title: Set up Draw.io",
  "stage: Map the business",
  "stage_order: 1",
  "order: 1",
  "type: build",
  "minutes: 10   # rough",
  "video: https://share.descript.com/embed/42pEyvI1VyH",
  "gate: yes",
  "summary: Why this matters: a map first.",
  "---",
  "Draw.io holds the visual outputs.",
  "",
  "### In Cowork",
  "",
  "Open **Settings → Connectors** and paste:",
  "",
  "```",
  "https://mcp.draw.io/mcp",
  "```",
  "",
  "### In Claude Code",
  "",
  "```bash",
  "claude mcp add --transport http drawio https://mcp.draw.io/mcp",
  "```",
  "",
  "### In Codex",
  "",
  "Ask Codex to connect the project.",
  "",
  "## Slides",
  "",
  "![Slide 1: why](media/x/01.png)",
  "",
  "First note.",
  "",
  "![Slide 2: anatomy](media/x/02.png)",
  "",
  "Second note, **bold**.",
].join("\n");

describe("lesson fields", () => {
  test("portal front matter becomes lesson fields and a body", () => {
    const parsed = parseCommunityLessonMarkdown(PORTAL_FILE);
    expect(parsed.title).toBe("Set up Draw.io");
    expect(parsed.lesson).toEqual({
      kind: "build",
      stage: "Map the business",
      stage_order: 1,
      order: 1,
      minutes: 10,
      video_url: "https://share.descript.com/embed/42pEyvI1VyH",
      gate: true,
      summary: "Why this matters: a map first.",
    });
    expect(parsed.body_md.startsWith("Draw.io holds")).toBe(true);
  });

  test("a file without front matter is all body", () => {
    expect(parseCommunityLessonMarkdown("# Hi\n\nText")).toEqual({ title: null, lesson: null, body_md: "# Hi\n\nText" });
  });

  test("empty input clears the fields", () => {
    expect(normalizeCommunityLessonFields(null)).toBeNull();
    expect(normalizeCommunityLessonFields({})).toBeNull();
    expect(normalizeCommunityLessonFields({ gate: "no" })).toBeNull();
  });

  test("bad input is refused, not dropped", () => {
    expect(() => normalizeCommunityLessonFields({ colour: "red" })).toThrow("community_lesson_colour_invalid");
    expect(() => normalizeCommunityLessonFields({ kind: "quiz" })).toThrow("community_lesson_kind_invalid");
    expect(() => normalizeCommunityLessonFields({ order: -1 })).toThrow("community_lesson_order_invalid");
    expect(() => normalizeCommunityLessonFields({ minutes: 1.5 })).toThrow("community_lesson_minutes_invalid");
    expect(() => normalizeCommunityLessonFields({ video_url: "http://example.com/v" })).toThrow(
      "community_lesson_video_url_invalid",
    );
    expect(() => normalizeCommunityLessonFields({ video_url: "javascript:alert(1)" })).toThrow(
      "community_lesson_video_url_invalid",
    );
    expect(() => normalizeCommunityLessonFields({ gate: true })).toThrow("community_lesson_gate_without_stage_invalid");
    expect(() => normalizeCommunityLessonFields({ summary: "x".repeat(281) })).toThrow("community_lesson_summary_invalid");
  });
});

describe("lesson body projection", () => {
  const projection = projectCommunityLessonBody(parseCommunityLessonMarkdown(PORTAL_FILE).body_md);

  test("platform sections become variants", () => {
    expect(projection.intro_md).toBe("Draw.io holds the visual outputs.");
    expect(projection.variants.map((variant) => [variant.key, variant.label])).toEqual([
      ["cowork", "Cowork"],
      ["claude_code", "Claude Code"],
      ["codex", "Codex"],
    ]);
    expect(projection.variants[2].body_md).toBe("Ask Codex to connect the project.");
  });

  test("fenced blocks become commands tagged by variant", () => {
    expect(projection.commands).toEqual([
      { variant: "cowork", language: null, text: "https://mcp.draw.io/mcp" },
      { variant: "claude_code", language: "bash", text: "claude mcp add --transport http drawio https://mcp.draw.io/mcp" },
    ]);
  });

  test("the slides section becomes a deck and stays out of the variants", () => {
    expect(projection.slides).toEqual([
      { image: "media/x/01.png", alt: "Slide 1: why", note_md: "First note." },
      { image: "media/x/02.png", alt: "Slide 2: anatomy", note_md: "Second note, **bold**." },
    ]);
    expect(projection.variants.some((variant) => variant.body_md.includes("Slide"))).toBe(false);
  });

  test("a plain body has an intro and nothing else", () => {
    expect(projectCommunityLessonBody("Just text.")).toEqual({
      intro_md: "Just text.",
      variants: [],
      slides: [],
      commands: [],
    });
  });
});

describe("lesson stages and gates", () => {
  const lessons = [
    { ref: "resource:a1", lesson: { stage: "Map", stage_order: 1 } },
    { ref: "resource:a2", lesson: { stage: "Map", stage_order: 1, gate: true } },
    { ref: "resource:b1", lesson: { stage: "Skill", stage_order: 2, gate: true } },
    { ref: "resource:c1", lesson: { stage: "System", stage_order: 3 } },
    { ref: "resource:lib", lesson: { kind: "doc" as const } },
    { ref: "resource:plain", lesson: null },
  ];

  test("an unfinished gate locks every later stage", () => {
    const { stages, lockedRefs } = computeCommunityLessonStages({ lessons, doneRefs: new Set(["resource:a1"]) });
    expect(stages).toEqual([
      { name: "Map", order: 1, lesson_count: 2, done_count: 1, locked: false, blocked_by: null },
      { name: "Skill", order: 2, lesson_count: 1, done_count: 0, locked: true, blocked_by: "resource:a2" },
      { name: "System", order: 3, lesson_count: 1, done_count: 0, locked: true, blocked_by: "resource:a2" },
    ]);
    expect([...lockedRefs].sort()).toEqual(["resource:b1", "resource:c1"]);
  });

  test("finishing a gate opens the next stage only", () => {
    const { stages, lockedRefs } = computeCommunityLessonStages({ lessons, doneRefs: new Set(["resource:a2"]) });
    expect(stages.map((stage) => [stage.name, stage.locked, stage.blocked_by])).toEqual([
      ["Map", false, null],
      ["Skill", false, null],
      ["System", true, "resource:b1"],
    ]);
    expect(lockedRefs.has("resource:lib")).toBe(false);
  });
});
