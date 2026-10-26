// Splits the AIEB community's roadmap into skill tracks on the local build.
// Run from the polynet-local repo root (the convex dev deployment must be up):
//   node seed-aieb-tracks.mjs [community-slug]
// Safe to run again: each track is saved at its current revision.
import { execFileSync } from "node:child_process";

const slug = process.argv[2] ?? "ai-employee-builders";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (fn, args) => JSON.parse(execFileSync(npx, ["convex", "run", fn, JSON.stringify(args)], { encoding: "utf8", shell: process.platform === "win32" }).trim());

const library = run("communityLessonTracks:listCommunityLessonLibraryInternal", { slug });
const revision = (key) => library.tracks.find((track) => track.key === key)?.revision ?? 0;
const course = (pattern) => library.courses.find((entry) => pattern.test(entry.name ?? ""));
const save = (track) => {
  const result = run("communityLessonTracks:saveCommunityLessonTrackInternal", {
    userId: library.owner_id, communityId: library.community_id, expectedRevision: revision(track.key), opensWhen: [], ...track,
  });
  console.log(`saved ${track.key} (revision ${result.revision})`);
};
// Groups a course's lessons into stages by how many each stage takes, in order.
const stagesOf = (entry, plan) => {
  let at = 0;
  const stages = plan.map(([name, count]) => ({ name, steps: entry.lessons.slice(at, (at += count)).map((lesson) => ({ resource_id: lesson.id })) }));
  if (at < entry.lessons.length) stages[stages.length - 1].steps.push(...entry.lessons.slice(at).map((lesson) => ({ resource_id: lesson.id })));
  return stages.filter((stage) => stage.steps.length);
};

// The main roadmap keeps its stages from the lessons; it only gets its name.
save({ key: "main", title: "Build your AI Employee", summary: "From install to an AI Employee that runs on its own.", order: 0, stages: [] });

const xray = course(/x-?ray/i);
if (xray) save({
  key: "business-x-ray", title: "Business X-Ray deep dive", order: 1,
  summary: "Map how your business runs, find the bottlenecks, and pick what to build first.",
  stages: stagesOf(xray, [["Get ready", 3], ["Map the business", 5], ["Map your assets", 4], ["Plan what's next", 5], ["Workshop replays", 2]]),
});
else console.log("No Business X-Ray course found; skipped.");

const claudeCode = course(/claude code/i);
if (claudeCode) save({
  key: "claude-code-101", title: "Claude Code 101", order: 2,
  summary: "What Claude Code is and how its parts fit together.",
  stages: stagesOf(claudeCode, [["The basics", 3], ["Extend it", 3], ["The whole picture", 2]]),
});
else console.log("No Claude Code 101 course found; skipped.");
