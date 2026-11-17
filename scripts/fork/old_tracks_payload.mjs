// Turns the old build's tracks into the args for
// communityLessonTracks:importCommunityLessonTracksInternal (fork only).
//
//   node scripts/fork/old_tracks_payload.mjs <old export folder> <community slug> [out.json]
//
// <old export folder> is an unzipped `npx convex export` of the OLD build
// (one folder per table, each with documents.jsonl). Read only: it never
// touches either database. Each step carries its old lesson's course name
// and title, so the import can find the same lesson in the new build, and
// its minutes. The old main track, when it had no stages of its own, is
// rebuilt from the old lesson fields (stage, stage_order, order, gate).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [dir, slug, out = "old-tracks-payload.json"] = process.argv.slice(2);
if (!dir || !slug) { console.error("usage: node scripts/fork/old_tracks_payload.mjs <export dir> <slug> [out.json]"); process.exit(1); }
const table = (name) => {
  const file = join(dir, name, "documents.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
};
const community = table("communities").find((row) => row.slug === slug);
if (!community) { console.error(`no community ${slug} in the export`); process.exit(1); }
const mine = (rows) => rows.filter((row) => row.communityId === community._id);
const modules = new Map(mine(table("communityResourceModules")).map((row) => [row._id, row]));
const lessons = mine(table("communityResources")).filter((row) => (row.role ?? "page") === "page");
const byId = new Map(lessons.map((row) => [row._id, row]));
const tracks = mine(table("communityLessonTracks")).filter((row) => !row.archivedAt);

function derivedMainStages() {
  const groups = new Map();
  for (const row of lessons) {
    const stage = row.lesson?.stage;
    if (!stage) continue;
    const group = groups.get(stage) ?? { name: stage, order: Number.MAX_SAFE_INTEGER, rows: [] };
    group.order = Math.min(group.order, row.lesson?.stage_order ?? Number.MAX_SAFE_INTEGER);
    group.rows.push(row);
    groups.set(stage, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((group) => ({
    name: group.name,
    steps: group.rows.sort((a, b) => (a.lesson?.order ?? 0) - (b.lesson?.order ?? 0) || a.title.localeCompare(b.title))
      .map((row) => ({ resource_id: row._id, ...(row.lesson?.gate ? { checkpoint: true } : {}) })),
  }));
}

let main = tracks.find((row) => row.key === "main");
if (!main || !main.stages?.length) {
  const stages = derivedMainStages();
  if (stages.length) {
    main = { ...(main ?? { key: "main", title: "Roadmap", order: 0, show: "always", opensWhen: [] }), stages };
    const rest = tracks.filter((row) => row.key !== "main");
    tracks.length = 0;
    tracks.push(main, ...rest);
  }
}

const payload = {
  slug,
  dryRun: true,
  tracks: tracks.map((row) => ({
    key: row.key,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    // Pictures stored in the old build's file storage don't move with it; a plain web address does.
    ...(row.coverUrl && /^https?:\/\//.test(row.coverUrl) && !/\/api\/storage\//.test(row.coverUrl) ? { coverUrl: row.coverUrl } : {}),
    ...(row.coverStyle ? { coverStyle: row.coverStyle } : {}),
    ...(row.outcomes?.length ? { outcomes: row.outcomes } : {}),
    ...(row.audience ? { audience: row.audience } : {}),
    order: row.order ?? 0,
    show: row.show ?? "always",
    opensWhen: row.opensWhen ?? [],
    stages: (row.stages ?? []).map((stage) => ({
      name: stage.name,
      steps: stage.steps.map((step) => {
        const lesson = byId.get(step.resource_id);
        return {
          resource_id: step.resource_id,
          ...(lesson ? { title: lesson.title, course: modules.get(lesson.moduleId)?.name ?? "" } : {}),
          ...(step.checkpoint ? { checkpoint: true } : {}),
          ...(lesson?.lesson?.minutes ? { minutes: lesson.lesson.minutes } : {}),
        };
      }),
    })),
  })),
};
writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`${payload.tracks.length} tracks -> ${out}`);
for (const track of payload.tracks) console.log(`  ${track.key}: ${track.title} (${track.stages.length} modules, ${track.stages.reduce((n, s) => n + s.steps.length, 0)} lessons)`);
console.log("Run it as a dry run first; set dryRun to false to write.");
