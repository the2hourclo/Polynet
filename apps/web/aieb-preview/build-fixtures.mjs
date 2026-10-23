// Turns the portal content folder (one folder per course, one .md file per
// lesson) into the CommunityResource / CommunityResourceModule rows Polynet's
// Resources page renders, plus each lesson's board fields from the lesson
// contract. Usage: node build-fixtures.mjs <content dir> <lesson-contract.mjs>
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [contentDir, contractPath] = process.argv.slice(2).map((p) => resolve(p));
const { parseCommunityLessonMarkdown, computeCommunityLessonStages } = await import(pathToFileURL(contractPath).href);
const label = (name) => { const t = name.replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const SLUG = "ai-employee-builders";
const modules = [];
const resources = [];
const lessons = [];
const dirs = (await readdir(contentDir, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== "media").map((d) => d.name).sort();
for (const [moduleIndex, dir] of dirs.entries()) {
  const files = (await readdir(join(contentDir, dir))).filter((f) => f.endsWith(".md")).sort();
  const parsed = await Promise.all(files.map(async (f) => ({ f, ...parseCommunityLessonMarkdown(await readFile(join(contentDir, dir, f), "utf8")) })));
  const stage = parsed.find((p) => p.lesson?.stage)?.lesson.stage;
  // Optional course.json: { "description": "...", "banner": "media/..." } for the course card.
  const course = await readFile(join(contentDir, dir, "course.json"), "utf8").then(JSON.parse, () => ({}));
  const path = `/communities/${SLUG}/resources/${dir}/`;
  modules.push({
    id: "module:" + dir, directory_uri: "polynet://" + path, directory_path: path, module_status: "live",
    name: stage || label(dir), description_md: course.description ?? null, banner_url: course.banner ?? null, banner_focus_x: 0.5, banner_focus_y: 0.5, banner_zoom: 1,
    sort_order: moduleIndex,
  });
  parsed.forEach((p, index) => {
    const ref = "resource:" + dir + "/" + p.f.replace(/\.md$/, "");
    const lesson = p.lesson || null;
    const video = lesson?.video_url || null;
    resources.push({
      id: ref, module_id: "module:" + dir, directory_uri: "polynet://" + path + p.f, directory_path: path + p.f.replace(/\.md$/, ""),
      type: video ? "embed" : "post", resource_role: "page", resource_status: "published",
      title: p.title || label(p.f.replace(/\.md$/, "")), body_md: p.body_md, body_chars: p.body_md.length,
      url: video, pinned: false, sort_order: index, created_at: "2026-10-23T00:00:00.000Z",
    });
    lessons.push({ ref, title: p.title, module_id: "module:" + dir, lesson });
  });
}
// Sanity check: the stages computed from these lessons must match what Polynet computes.
const { stages } = computeCommunityLessonStages({ lessons, doneRefs: new Set() });
await writeFile(new URL("./fixtures.json", import.meta.url), JSON.stringify({ modules, resources, lessons }, null, 1));
console.log(`${modules.length} modules, ${resources.length} resources, ${stages.length} stages`);
