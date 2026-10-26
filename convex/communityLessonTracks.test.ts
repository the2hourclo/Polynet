import { describe, expect, test } from "vitest";
import {
  checkCommunityTrackDefinition,
  computeCommunityTracks,
  resolveCommunityTrackDefinitions,
  type CommunityTrackDefinition,
} from "../shared/communityLessonTracks";

const lessons = [
  { id: "a1", title: "Install the plugin", lesson: { stage: "Get set up", stage_order: 1, order: 1 } },
  { id: "a2", title: "Connect & onboard", lesson: { stage: "Get set up", stage_order: 1, order: 2, gate: true } },
  { id: "b1", title: "Run your X-Ray", lesson: { stage: "Map the business", stage_order: 2, order: 1 } },
  { id: "b2", title: "Lock your first target", lesson: { stage: "Map the business", stage_order: 2, order: 2, gate: true } },
  { id: "c1", title: "What is a skill", lesson: { stage: "Your first skill", stage_order: 3, order: 1 } },
  { id: "x1", title: "Content basics", lesson: { kind: "lesson" as const } },
  { id: "x2", title: "Publish a post", lesson: null },
];
const done = (...ids: string[]) => new Set(ids.map((id) => `resource:${id}`));

const content: CommunityTrackDefinition = {
  key: "content", title: "Content Employee", order: 2, show: "always",
  opens_when: [{ type: "after_checkpoint", resource_id: "a2" }],
  stages: [{ name: "Start", steps: [{ resource_id: "x1" }, { resource_id: "a1" }] }, { name: "Ship", steps: [{ resource_id: "x2" }] }],
};

describe("skill tracks", () => {
  test("the main track is today's roadmap, read from the lesson fields", () => {
    const [main] = resolveCommunityTrackDefinitions({ stored: [], lessons });
    expect(main).toMatchObject({ key: "main", derived: true });
    expect(main.stages.map((stage) => [stage.name, stage.steps.map((step) => step.resource_id + (step.checkpoint ? "*" : ""))])).toEqual([
      ["Get set up", ["a1", "a2*"]],
      ["Map the business", ["b1", "b2*"]],
      ["Your first skill", ["c1"]],
    ]);
  });

  test("only the first locked stage is blocked by a checkpoint; next up is the first open step", () => {
    const tracks = resolveCommunityTrackDefinitions({ stored: [], lessons });
    const { tracks: [main], lockedRefs } = computeCommunityTracks({ tracks, lessons, doneRefs: done("a1") });
    expect(main.stages.map((stage) => [stage.name, stage.locked, stage.blocked_by])).toEqual([
      ["Get set up", false, null],
      ["Map the business", true, "resource:a2"],
      ["Your first skill", true, "resource:a2"],
    ]);
    expect(main.next).toMatchObject({ resource_id: "a2", stage: "Get set up" });
    expect(main.status).toBe("in_progress");
    expect([...lockedRefs].sort()).toEqual(["resource:b1", "resource:b2", "resource:c1"]);
  });

  test("a follow-on track opens after a checkpoint, and a shared lesson done once counts in both", () => {
    const tracks = resolveCommunityTrackDefinitions({ stored: [content], lessons });
    const before = computeCommunityTracks({ tracks, lessons, doneRefs: done("a1") });
    const closed = before.tracks.find((track) => track.key === "content")!;
    expect(closed).toMatchObject({ open: false, status: "locked", opens_reason: 'Opens when you finish "Connect & onboard"' });
    // x1 is only in the closed track; a1 is open in main, so it stays open.
    expect(before.lockedRefs.has("resource:x1")).toBe(true);
    expect(before.lockedRefs.has("resource:a1")).toBe(false);
    expect(before.tracks[0].opens_tracks).toEqual([{ resource_id: "a2", track: "content", title: "Content Employee" }]);

    const after = computeCommunityTracks({ tracks, lessons, doneRefs: done("a1", "a2") });
    const opened = after.tracks.find((track) => track.key === "content")!;
    expect(opened).toMatchObject({ open: true, status: "in_progress", done_count: 1, step_count: 3 });
    expect(opened.next).toMatchObject({ resource_id: "x1" });
    expect(after.lockedRefs.has("resource:x1")).toBe(false);
    expect(after.lockedRefs.has("resource:x2")).toBe(false);
  });

  test("tracks open after another track, at a Workflow stage, or on a client property", () => {
    const tracks = resolveCommunityTrackDefinitions({
      lessons,
      stored: [
        { ...content, key: "after", title: "After content", opens_when: [{ type: "after_track", track: "content" }] },
        { ...content, key: "stage", title: "Client work", opens_when: [{ type: "workflow_stage", milestone_key: "building" }] },
        { ...content, key: "prop", title: "Agency", opens_when: [{ type: "client_property", property: "business_type", equals: "agency" }] },
      ],
    });
    const open = (doneRefs: Set<string>, context: Parameters<typeof computeCommunityTracks>[0]["context"]) =>
      Object.fromEntries(computeCommunityTracks({ tracks, lessons, doneRefs, context }).tracks.map((track) => [track.key, track.open]));
    expect(open(done(), { workflowMilestoneKey: "onboarding", workflowMilestoneOrder: ["onboarding", "building", "client"] }))
      .toEqual({ main: true, after: false, stage: false, prop: false });
    expect(open(done("x1", "a1", "x2"), { workflowMilestoneKey: "client", workflowMilestoneOrder: ["onboarding", "building", "client"], clientValues: { business_type: ["agency", "coach"] } }))
      .toEqual({ main: true, after: false, stage: true, prop: true });
  });

  test("an owner-stored main track keeps derived stages until it gets its own", () => {
    const stored: CommunityTrackDefinition = { key: "main", title: "Build your AI Employee", order: 0, show: "always", opens_when: [], stages: [] };
    const [main] = resolveCommunityTrackDefinitions({ stored: [stored], lessons });
    expect(main).toMatchObject({ title: "Build your AI Employee", derived: true });
    expect(main.stages).toHaveLength(3);
  });

  test("saving checks keys, lessons and rules in plain words", () => {
    const problems = checkCommunityTrackDefinition(
      { ...content, key: "Bad Key", opens_when: [{ type: "after_track", track: "Bad Key" }], stages: [{ name: "S", steps: [{ resource_id: "zz" }, { resource_id: "a1" }, { resource_id: "a1" }] }] },
      { lessonIds: new Set(lessons.map((lesson) => lesson.id)), trackKeys: new Set(["main"]) },
    );
    expect(problems).toEqual([
      "The track key must be lowercase letters, digits and dashes.",
      "Lesson zz isn't in this community's library.",
      "Lesson a1 is in this track twice.",
      '"After track" must name another track (Bad Key).',
    ]);
  });
});
