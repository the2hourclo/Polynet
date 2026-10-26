// Splits the AIEB community's roadmap into skill tracks on the local build.
// Run from the polynet-local repo root (the convex dev deployment must be up):
//   node seed-aieb-tracks.mjs [community-slug] [--dress]
// Safe to run again: each track is saved at its current revision, with its cover,
// promise, outcomes and who it's for (needs the sellable-tracks build, 9f2d578).
import { execFileSync } from "node:child_process";

const slug = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "ai-employee-builders";
// Calls convex's own CLI through node, never a shell: cmd.exe strips the JSON's quotes.
const run = (fn, args) => JSON.parse(execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "run", fn, JSON.stringify(args)], { encoding: "utf8" }).trim());

const library = run("communityLessonTracks:listCommunityLessonLibraryInternal", { slug });
const revision = (key) => library.tracks.find((track) => track.key === key)?.revision ?? 0;
const course = (pattern) => library.courses.find((entry) => pattern.test(entry.name ?? ""));
// --dress changes only the cover, promise, outcomes and who it's for of tracks that
// already exist: their title, stages, rules and order stay exactly as the owner left them.
const dressOnly = process.argv.includes("--dress");
const save = (track) => {
  const stored = library.tracks.find((row) => row.key === track.key);
  if (dressOnly) {
    if (!stored) { console.log(`skipped ${track.key} (not saved yet)`); return; }
    track = { key: track.key, title: stored.title, summary: track.summary, coverStyle: track.coverStyle, outcomes: track.outcomes, audience: track.audience,
      order: stored.order, show: stored.show, opensWhen: stored.opens_when, stages: stored.stages };
  }
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
save({
  key: "main", title: "Build your AI Employee", summary: "From install to an AI Employee that runs on its own.", order: 0, stages: [],
  coverStyle: "route",
  outcomes: [
    "Install the plugin and connect your workspace",
    "Map your business with the X-Ray and lock your first target",
    "Build a skill and run it once on real data",
    "Chain skills into a system that runs a whole job",
    "Hand a real job to your AI Employee",
  ],
  audience: "Owners who do the same work by hand every week and want an AI Employee to take it over.",
});

const xray = course(/x-?ray/i);
if (xray) save({
  key: "business-x-ray", title: "Business X-Ray deep dive", order: 1,
  summary: "Map how your business runs, find the bottlenecks, and pick what to build first.",
  coverStyle: "diagram",
  outcomes: ["Draw how your business runs today", "Score your assets and spot the bottleneck", "Pick the first AI Employee to build"],
  audience: "Owners who aren't sure what to hand to AI first.",
  stages: stagesOf(xray, [["Get ready", 3], ["Map the business", 5], ["Map your assets", 4], ["Plan what's next", 5], ["Workshop replays", 2]]),
});
else console.log("No Business X-Ray course found; skipped.");

const claudeCode = course(/claude code/i);
if (claudeCode) save({
  key: "claude-code-101", title: "Claude Code 101", order: 2,
  summary: "What Claude Code is and how its parts fit together.",
  coverStyle: "terminal",
  outcomes: ["Know what Claude Code can do for you", "Add skills, agents and hooks", "See how the parts fit into one system"],
  audience: "Anyone new to Claude Code.",
  stages: stagesOf(claudeCode, [["The basics", 3], ["Extend it", 3], ["The whole picture", 2]]),
});
else console.log("No Claude Code 101 course found; skipped.");
