import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
// @ts-expect-error plain ES module without types
import { buildManifest, collectFiles, hashFile, installGuide, installSkills, mimeType, pkce, readCheckedFiles, uploadBuckets } from "../packages/polynet-cli/lib.mjs";
import { checkSite } from "../packages/polynet-cli/checks.mjs";
// @ts-expect-error plain ES module without types
import { checkCourses, checkTheme, packChangesets, readCourses, resolveCourses, resolveLessonBody } from "../packages/polynet-cli/content.mjs";
// @ts-expect-error plain ES module without types
import { readProject, siteFiles } from "../packages/polynet-cli/project.mjs";
// @ts-expect-error plain ES module without types
import { buildContract, CONTRACTS } from "../packages/polynet-cli/tools/build-contracts.mjs";
import { buildDesignGuide, DESIGN_GUIDE_TARGET } from "../packages/polynet-cli/tools/build-design-guide.mjs";

function site() {
  const root = mkdtempSync(join(tmpdir(), "polynet-site-"));
  const put = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put("index.html", "<h1>Run club</h1>");
  put("css/app.css", "h1{}");
  put("copy.txt", "<h1>Run club</h1>");
  put(".env", "SECRET=1");
  put(".well-known/security.txt", "contact");
  put("node_modules/x/index.js", "x");
  put("polynet.json", '{"community":"run-club"}');
  put("AGENTS.md", "# guide");
  put("CLAUDE.md", "@AGENTS.md");
  return root;
}

test("a site is its served files: no dotfiles, node_modules, polynet.json or agent guides", async () => {
  const files = await collectFiles(site());
  expect(files.map((file: any) => file.path)).toEqual(["/.well-known/security.txt", "/copy.txt", "/css/app.css", "/index.html"]);
});

test("the manifest hashes content plus extension, 32 hex characters", async () => {
  const built = await buildManifest(await collectFiles(site()));
  expect(built.files).toBe(4);
  expect(built.manifest["/index.html"]).toEqual({ hash: expect.stringMatching(/^[a-f0-9]{32}$/), size: 17 });
  // Same bytes, different type: different hashes.
  expect(built.manifest["/copy.txt"].hash).not.toBe(built.manifest["/index.html"].hash);
  expect(hashFile(Buffer.from("a"), "/a.css")).toBe(hashFile(Buffer.from("a"), "/b.css"));
  expect(mimeType("/x.WOFF2")).toBe("font/woff2");
  expect(mimeType("/x.unknown")).toBe("application/octet-stream");
});

test("only the files Cloudflare asks for are uploaded, with the upload pass", async () => {
  const built = await buildManifest(await collectFiles(site()));
  const css = built.manifest["/css/app.css"].hash;
  const calls: Array<{ url: string; auth: string; fields: Record<string, string> }> = [];
  const fakeFetch = async (url: string, init: any) => {
    const fields: Record<string, string> = {};
    for (const [key, value] of (init.body as FormData).entries()) fields[key] = `${(value as Blob).type}:${await (value as Blob).text()}`;
    calls.push({ url, auth: init.headers.Authorization, fields });
    return Response.json({ success: true, result: { jwt: "completion" } }, { status: 201 });
  };
  const token = await uploadBuckets({ upload: { url: "https://cf/upload?base64=true", jwt: "pass", buckets: [[css]] }, byHash: built.byHash, fetchImpl: fakeFetch });
  expect(token).toBe("completion");
  expect(calls).toEqual([{ url: "https://cf/upload?base64=true", auth: "Bearer pass", fields: { [css]: `text/css:${Buffer.from("h1{}").toString("base64")}` } }]);
  // Nothing missing: the pass itself completes the upload.
  expect(await uploadBuckets({ upload: { url: "u", jwt: "pass", buckets: [] }, byHash: built.byHash, fetchImpl: fakeFetch })).toBe("pass");
  await expect(uploadBuckets({ upload: { url: "u", jwt: "pass", buckets: [["f".repeat(32)]] }, byHash: built.byHash, fetchImpl: fakeFetch })).rejects.toThrow(/doesn't have/);
});

test("sign-in uses PKCE", () => {
  const first = pkce();
  expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.challenge).not.toBe(first.verifier);
  expect(pkce().state).not.toBe(first.state);
});

test("the published package is exactly the command, its library and checks, README, and the agent guide, and the design templates (no site template)", () => {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: join(__dirname, "../packages/polynet-cli"), encoding: "utf8" }))[0];
  expect(packed.name).toBe("@polynet/cli");
  expect(packed.files.map((file: { path: string }) => file.path).sort()).toEqual([
    "README.md", "bin/polynet.mjs", "checks.mjs", "content.mjs",
    "contracts/embed.mjs", "contracts/layout.mjs", "contracts/lesson.mjs", "contracts/theme.mjs", "design.mjs",
    "guide/AGENTS.md", "guide/CLAUDE.md", "guide/agents/polynet-ui-reviewer.md",
    ...["accessibility", "build-site", "deploy-verify", "design", "sdk", "ui-design"].map((name) => `guide/skills/polynet-${name}/SKILL.md`),
    ...["in-the-app", "mistakes", "owner-screens", "reviewer"].map((name) => `guide/skills/polynet-ui-design/references/${name}.md`),
    "lib.mjs", "mcp.mjs", "package.json", "project.mjs", "review.mjs",
    "templates/skool/README.md", "templates/skool/layout.json", "templates/skool/template.json", "templates/skool/theme.json",
    "templates/stopwatch/template.json", "templates/stopwatch/theme.json", "ui-audit.mjs",
  ]);
});

const problems = (html: string, extra: Array<{ path: string; text: string }> = []) => {
  const result = checkSite([{ path: "/index.html", text: html }, ...extra]);
  return { errors: result.errors.map((p: any) => p.message).join("\n"), warnings: result.warnings.map((p: any) => p.message).join("\n") };
};
const GOOD = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Run club</title><script type="module" src="/__polynet/ui.js"></script></head><body><polynet-account></polynet-account></body></html>';

test("a page's files are read for the checks; others are skipped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "polynet-check-"));
  writeFileSync(join(dir, "index.html"), GOOD);
  writeFileSync(join(dir, "logo.png"), "png");
  const files = await readCheckedFiles(await collectFiles(dir));
  expect(files.map((file: any) => file.path)).toEqual(["/index.html"]);
  expect(checkSite(files)).toEqual({ errors: [], warnings: [] });
});

test("site checks block what is certain from the source", () => {
  expect(problems(GOOD)).toEqual({ errors: "", warnings: "" });
  const bad = problems('<html><head><meta name="viewport" content="width=device-width, maximum-scale=1"></head>' +
    '<body><img src="/a.png"><button><svg></svg></button><a href="/x"></a><button aria-label="Close"><svg></svg></button>' +
    '<a href="/"><img src="/logo.svg" alt="Run club"></a></body></html>');
  expect(bad.errors).toContain("no language");
  expect(bad.errors).toContain("no <title>");
  expect(bad.errors).toContain("blocks zooming");
  expect(bad.errors).toContain("doesn't load the Polynet shell");
  expect(bad.errors).toContain("never shows <polynet-account>");
  expect(bad.errors).toContain("image has no alt");
  expect(bad.errors.match(/has no name/g)).toHaveLength(2); // the labelled button and the logo link are fine
  expect(problems(GOOD.replace("initial-scale=1", "user-scalable=no")).errors).toContain("blocks zooming");
  // The shell element may come from a script (single-page sites build it there).
  expect(problems(GOOD.replace("<polynet-account></polynet-account>", ""), [{ path: "/app.js", text: 'el("polynet-account")' }]).errors).toBe("");
  // A fragment that isn't a page isn't held to page rules.
  expect(checkSite([{ path: "/google123.html", text: "google-site-verification: google123.html" }, { path: "/index.html", text: GOOD }]).errors).toEqual([]);
});

test("site checks warn about what needs a person's judgment", () => {
  const warned = problems(GOOD.replace("<polynet-account>", '<label>Name <input></label><input id="q"><label for="q">Search</label><input type="email"><polynet-account>'), [
    { path: "/app.css", text: "button:focus { outline: none } .x { animation: spin 1s }" },
    { path: "/app.js", text: 'list.innerHTML = post.text; el.tabIndex; x.setAttribute("tabindex", "2"); fetch("https://a.convex.cloud")' },
  ]);
  expect(warned.errors).toBe("");
  expect(warned.warnings.match(/may have no label/g)).toHaveLength(1); // only the unlabelled email field
  expect(warned.warnings).toContain(":focus-visible");
  expect(warned.warnings).toContain("prefers-reduced-motion");
  expect(warned.warnings).toContain("innerHTML");
  expect(warned.warnings).toContain("Calls Polynet's servers directly");
});

test("skills install into both agent folders without overwriting the founder's guides", async () => {
  const dir = mkdtempSync(join(tmpdir(), "polynet-guide-"));
  writeFileSync(join(dir, "AGENTS.md"), "# mine");
  const written = await installGuide(dir);
  expect(written).toEqual(["CLAUDE.md", ".agents/skills/ (6 skills)", ".claude/skills/ (6 skills)", ".claude/agents/ (1 agent)"]);
  expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# mine");
  for (const skills of [".agents/skills", ".claude/skills"]) {
    expect(readdirSync(join(dir, skills)).sort()).toEqual(["polynet-accessibility", "polynet-build-site", "polynet-deploy-verify", "polynet-design", "polynet-sdk", "polynet-ui-design"]);
    for (const skill of readdirSync(join(dir, skills))) {
      const text = readFileSync(join(dir, skills, skill, "SKILL.md"), "utf8");
      expect(text).toMatch(new RegExp(`^---\nname: ${skill}\ndescription: .{40,}\n---\n`));
    }
  }
  // Running it again replaces older skills; a stale file inside a skill goes away.
  writeFileSync(join(dir, ".claude/skills/polynet-sdk/old.md"), "stale");
  await installGuide(dir);
  expect(existsSync(join(dir, ".claude/skills/polynet-sdk/old.md"))).toBe(false);
  expect(existsSync(join(dir, ".claude/skills/polynet-ui-design/references/in-the-app.md"))).toBe(true);
});

test("a community design folder gets the skills but not the site guides", async () => {
  const dir = mkdtempSync(join(tmpdir(), "polynet-design-skills-"));
  expect(await installSkills(dir)).toEqual([".agents/skills/ (6 skills)", ".claude/skills/ (6 skills)", ".claude/agents/ (1 agent)"]);
  expect(readFileSync(join(dir, ".claude/agents/polynet-ui-reviewer.md"), "utf8")).toMatch(/^---\nname: polynet-ui-reviewer\n/);
  expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  expect(existsSync(join(dir, ".agents/skills/polynet-ui-design/SKILL.md"))).toBe(true);
});

test("the MCP's design guide matches the polynet-ui-design skill", async () => {
  expect(readFileSync(join(__dirname, "..", DESIGN_GUIDE_TARGET), "utf8"), "run node packages/polynet-cli/tools/build-design-guide.mjs")
    .toBe(await buildDesignGuide());
});

test("the CLI's copies of Polynet's lesson, embed, theme and layout contracts match shared/", async () => {
  for (const [file, source] of Object.entries(CONTRACTS as Record<string, string>)) {
    expect(readFileSync(join(__dirname, "../packages/polynet-cli/contracts", file), "utf8"), `${file}: run node packages/polynet-cli/tools/build-contracts.mjs`)
      .toBe(await buildContract(source));
  }
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "polynet-project-"));
  const put = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put("polynet.json", '{"community":"run-club"}');
  put("index.html", GOOD);
  put("embeds/pace.html", '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pace</title><script src="/__polynet/embed.js"></script></head><body></body></html>');
  put("media/route.png", "png");
  put("theme.json", JSON.stringify({ version: 1, font_heading: "Barlow Condensed", radius: 3 }));
  put("courses/01-start/course.json", '{"title":"Start here","description":"Your first week.","status":"live"}');
  put("courses/01-start/01-welcome.md", "---\ntitle: Welcome\nstage: Week 1\norder: 1\nminutes: 4\n---\nHello ![Route](../media/route.png)\n\n```polynet-embed\nsrc: embeds/pace.html\nheight: 700\n```\n");
  put("courses/01-start/02-plan.md", "---\ntitle: Plan\n---\nPlan it.");
  return root;
}

test("a project folder: courses and the theme are never served with the site", async () => {
  const p = await readProject(project());
  expect(p).toMatchObject({ community: "run-club", siteOrigin: "https://run-club.polynet.page" });
  expect((await siteFiles(p)).map((file: any) => file.path)).toEqual(["/embeds/pace.html", "/index.html", "/media/route.png"]);
});

test("courses are read with Polynet's own lesson parser, and lesson images point at the site", async () => {
  const p = await readProject(project());
  const read = await readCourses(p.courses);
  expect(read.problems).toEqual([]);
  const [course] = resolveCourses(read.courses, p.siteOrigin);
  expect(course).toMatchObject({ key: "01-start", name: "Start here", status: "live" });
  expect(course.lessons[0]).toMatchObject({ title: "Welcome", lesson: { stage: "Week 1", order: 1, minutes: 4 } });
  expect(course.lessons[0].body_md).toContain("![Route](https://run-club.polynet.page/media/route.png)");
  expect(course.lessons[0].body_md).toContain("src: embeds/pace.html");
  expect(resolveLessonBody('![a](https://x.test/a.png) <img src="./media/b.png">', "https://s")).toBe('![a](https://x.test/a.png) <img src="https://s/media/b.png">');
  const files = new Set((await siteFiles(p)).map((file: any) => file.path));
  expect(checkCourses([course], files)).toEqual([]);
});

test("course checks catch what Polynet would refuse or silently cut", async () => {
  const lesson = (title: string, source_md: string) => ({ path: `c/${title}.md`, title, lesson: null, source_md, body_md: source_md });
  const course = { key: "c", folder: "c", name: "Course", description: "", status: "draft", lessons: [
    lesson("Long", "x".repeat(20_001)),
    lesson("Widget", "```polynet-embed\nsrc: embeds/missing.html\nfallback: media/missing.png\n```"),
    lesson("Bad widget", "```polynet-embed\nsrc: https://evil.test/x.html\n```"),
    lesson("Image", "![a](media/nope.png)"),
    lesson("long", "dup"),
  ] };
  const found = checkCourses([course, { ...course, folder: "d", lessons: [] }], new Set(["/index.html"]));
  const text = found.map((p: any) => `${p.level} ${p.path} ${p.message}`).join("\n");
  expect(text).toContain("error c/Long.md The lesson is 20,001 characters; Polynet keeps 20,000");
  expect(text).toContain("The widget embeds/missing.html isn't in the site folder");
  expect(text).toContain("warning c/Widget.md:1 The fallback image media/missing.png");
  expect(text).toContain("src must be an .html file on your community site");
  expect(text).toContain("The image media/nope.png isn't in the site folder");
  expect(text).toContain('Two lessons in this course are called "long"');
  expect(text).toContain('Two courses are called "Course"');
  expect(checkTheme({ version: 1, font_heading: "Comic Sans" })[0].path).toBe("theme.json → font_heading");
});

test("bad front matter is reported per file instead of stopping the read", async () => {
  const root = project();
  writeFileSync(join(root, "courses/01-start/03-bad.md"), "---\ntitle: Bad\nvideo: http://insecure.test/v\n---\nx");
  const read = await readCourses(join(root, "courses"));
  expect(read.problems).toEqual([{ level: "error", path: "01-start/03-bad.md", message: "The \"video_url\" front matter value isn't valid." }]);
  expect(read.courses[0].lessons).toHaveLength(2);
});

test("lesson widgets are checked as widgets: embed.js, not the site shell", () => {
  const widget = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>W</title></head><body></body></html>';
  const result = checkSite([{ path: "/index.html", text: GOOD }, { path: "/embeds/w.html", text: widget }, { path: "/quiz.html", text: widget }], { embeds: new Set(["/quiz.html"]) });
  expect(result.errors).toEqual([]);
  expect(result.warnings.map((p: any) => p.path)).toEqual(["/embeds/w.html", "/quiz.html"]);
  expect(result.warnings[0].message).toContain("/__polynet/embed.js");
});

test("changesets hold at most 25 changes, and a new course's lessons stay with it", () => {
  const page = (i: number) => ({ op: "create_page", module_key: "big", title: `L${i}`, body_md: "x" });
  const edit = (i: number) => ({ op: "edit_page", resource_id: `r${i}`, expected_updated_at: 1, body_md: "y" });
  const packed = packChangesets("run-club", [
    { course: "Edits", created: false, operations: Array.from({ length: 10 }, (_, i) => edit(i)) },
    { course: "Big", created: true, operations: [{ op: "create_module", module_key: "big", name: "Big" }, ...Array.from({ length: 30 }, (_, i) => page(i))] },
  ]);
  expect(packed.map((c: any) => c.operations.length)).toEqual([10, 25]);
  expect(packed[1].operations[0].op).toBe("create_module");
  expect(packed[1].summary).toBe("polynet push: Big");
  expect(packed[0].idempotency_key).toMatch(/^polynet-cli:[a-f0-9]{48}$/);
  // The same changes always get the same key, so pushing twice before Apply stages once.
  expect(packChangesets("run-club", [{ course: "Edits", created: false, operations: Array.from({ length: 10 }, (_, i) => edit(i)) }])[0].idempotency_key)
    .toBe(packed[0].idempotency_key);
});

test("polynet check runs headless: --json and a failing exit code for CI", () => {
  const root = project();
  const cli = join(__dirname, "../packages/polynet-cli/bin/polynet.mjs");
  const ok = JSON.parse(execFileSync(process.execPath, [cli, "check", root, "--json"], { encoding: "utf8" }));
  expect(ok).toMatchObject({ ok: true, courses: 1, lessons: 2, site_files: 3 });
  writeFileSync(join(root, "courses/01-start/02-plan.md"), "---\ntitle: Plan\n---\n![x](media/gone.png)");
  let failed: any = null;
  try {
    execFileSync(process.execPath, [cli, "check", root, "--json"], { encoding: "utf8" });
  } catch (error) {
    failed = error;
  }
  expect(failed?.status).toBe(1);
  expect(JSON.parse(failed.stdout).problems[0].message).toContain("media/gone.png");
});
