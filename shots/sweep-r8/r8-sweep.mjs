// r8: read-only UI + Knowledge sweep of AIEB on 245fc4f. Write-block armed before sign-in (r8-lib.mjs).
// Rules: lessons only where Rashid already has a progress row (by exact title in its course);
// no View as member; pods only "Agency owners (test)"; never Save/Publish/etc.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded, browser, W, ALLOW, blocked, allowed, leaked, other, cons, unverified } from "./r8-lib.mjs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const log = []; const audits = {}; const note = s => { console.log(s); log.push(s); };
const DESKTOP = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 };
const PAGES = [["chat", "chat"], ["knowledge", "resources"], ["events", "events"], ["members-tab", "members"], ["about", "about"], ["agent", "agent"], ["members-db", "people"],
  ["wf-automations", "workflows?section=workflows"], ["wf-runs", "workflows?section=runs"], ["wf-changes", "workflows?section=changes"], ["wf-forms", "workflows?section=forms"], ["wf-welcome", "workflows?section=welcome"],
  ["funnels", "funnels"], ["analytics", "analytics"], ["set-general", "settings/community"], ["set-offers", "settings/offers"], ["set-appearance", "settings/appearance"],
  ["set-sales", "settings/sales_page"], ["set-access", "settings/access"], ["set-creators", "settings/creators"], ["set-agent", "settings/agent"]];
const PHONE_PAGES = ["chat", "knowledge", "events", "members-tab", "about", "agent", "members-db", "wf-automations", "wf-forms", "funnels", "set-general", "set-offers"];
// Rashid's own in_progress rows (communityResourceProgress, 2026-10-28 snapshot), by course + exact title.
const LESSONS = [
  ["Business X-Ray course", "Welcome", "v576w27d5hwd442n4f3d0hbg3h8gtkdv"],
  ["Business X-Ray course", "Why Map Your Business", "v57091hry0es6n6fkm8dndbrb18gt5mt"],
  ["Business X-Ray course", "Set Up the Skill", "v57dd97hapjbd30z6yrmzp65z18gt5j8"],
  ["Get set up", "Watch: how your AI Employee actually works", "v570jrznmc522qk0admb962n8s8gt56y"],
  ["Get set up", "Install Claude Code", "v57dtvhy71ccyewpz3bmx1vqgx8gvr5z"],
  ["Get set up", "Connect & onboard", "v57dpa3gpmz9mmgxzx8w1bm1gs8gvef2"],
];
const url = (path, layout, extra = "") => `${W}/c/ai-employee-builders/${path}${path.includes("?") ? "&" : "?"}layout=${layout}${extra}`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slug = (s, n) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, n);
const settle = async (p, ms = 2500) => { await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(ms); };
let firstChecked = false;
async function shot(p, name, full = true) {
  try {
    await p.mouse.move(2, p.viewportSize().height - 2).catch(() => {});
    await p.screenshot({ path: join(out, `${name}.png`), fullPage: full });
    const bad = await unverified(p);
    note(`saved ${name}${bad ? "  !! UNVERIFIED SESSION" : ""}`);
    if (!firstChecked) { firstChecked = true; if (bad) throw new Error("ABORT first page shows 'could not finish verifying your session'"); }
  } catch (e) { if (String(e.message).startsWith("ABORT")) throw e; note(`FAILED ${name}: ${e.message.split("\n")[0]}`); }
}
async function audit(p, name) {
  try {
    audits[name] = await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const st = (el) => { const s = getComputedStyle(el); return { fs: s.fontSize, fw: s.fontWeight, ff: s.fontFamily.split(",")[0].replace(/"/g, ""), r: s.borderRadius, bg: s.backgroundColor, c: s.color, h: Math.round(el.getBoundingClientRect().height), pad: s.padding, bd: s.borderTopWidth + " " + s.borderTopColor }; };
      const txt = (el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const headings = [...document.querySelectorAll("h1,h2,h3,h4")].filter(vis).slice(0, 30).map((el) => ({ tag: el.tagName, text: txt(el), cls: String(el.className).slice(0, 80), ...st(el) }));
      const buttons = [...document.querySelectorAll("button,a[role=button],[class*=btn],[class*=button]")].filter(vis).slice(0, 120).map((el) => ({ text: txt(el), cls: String(el.className).slice(0, 80), ...st(el) }));
      const pills = [...document.querySelectorAll("[class*=pill],[class*=chip],[class*=badge],[class*=status]")].filter(vis).slice(0, 80).map((el) => ({ text: txt(el), cls: String(el.className).slice(0, 80), ...st(el) }));
      const empties = [...document.querySelectorAll("p,div,span")].filter((el) => el.children.length === 0 && vis(el) && /^(no |nothing|none yet|.*\byet\b\.?$|empty)/i.test((el.innerText || "").trim())).slice(0, 20).map((el) => ({ text: txt(el), cls: String(el.className).slice(0, 80), ...st(el) }));
      const body = document.body.innerText; const naming = {};
      for (const w of ["Skool", "Slack", "Cowork", "Space", "Spaces", "Tier", "Client", "Clients", "client property", "Private channels", "Workflow", "Workflows", "Automation", "Automations", "Stage", "Stages", "Pod", "Pods", "Builder", "Agent", "Knowledge", "Resources", "Courses", "Course", "Module", "Lesson", "Classroom", "Channels", "Roadmap", "Board", "Funnel", "Sales page", "About", "People", "Members", "Appearance", "Customize", "Display"]) { const m = body.match(new RegExp(`\\b${w}\\b`, "g")); if (m) naming[w] = m.length; }
      return { url: location.pathname + location.search, headings, buttons, pills, empties, naming, scrollW: document.documentElement.scrollWidth, vw: innerWidth, text: body.slice(0, 4000) };
    });
  } catch (e) { note(`AUDIT FAILED ${name}: ${e.message.split("\n")[0]}`); }
}
const both = async (p, name, full = true) => { await shot(p, name, full); await audit(p, name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { if (String(e.message).startsWith("ABORT")) throw e; note(`FAILED ${name}: ${e.message.split("\n")[0].slice(0, 200)}`); } };
async function openCourse(p, layout, course) {
  await p.goto(url("resources", layout), { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.locator(".resource-course-card").first().waitFor({ timeout: 90000 }); await settle(p, 1500);
  const card = p.locator(".resource-course-card").filter({ hasText: new RegExp("^\\s*" + esc(course)) });
  if (await card.count() !== 1) throw new Error(`course lookup "${course}" = ${await card.count()}`);
  await card.click({ position: { x: 60, y: 60 } }); await settle(p, 3000);
}
async function knowledge(p, layout, vp, full) {
  const k = `${layout}-${vp}-k`;
  await p.goto(url("resources", layout), { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.locator(".resource-course-card").first().waitFor({ timeout: 90000 }).catch(() => note(`no course cards rendered (${layout} ${vp})`)); await settle(p);
  await both(p, `${k}-resources`, full);
  const names = await p.locator(".resource-course-card").evaluateAll(cs => cs.map(c => c.innerText.split(String.fromCharCode(10))[0].trim()));
  note(`${k} courses: ${JSON.stringify(names)}`);
  for (const v of ["Roadmap", "Graph"]) await step(`${k}-${v}`, async () => {
    const sw = p.locator("button.community-category-chip[role=tab]").filter({ hasText: new RegExp(`^\\s*${v}\\s*$`) }).filter({ visible: true });
    if (await sw.count() !== 1) throw new Error(`${v} switch count ${await sw.count()}`);
    await sw.click(); await settle(p, 3500); await both(p, `${k}-${v.toLowerCase()}`, full);
    const back = p.locator("button.community-category-chip[role=tab]").filter({ hasText: /^\s*Resources\s*$/ }).filter({ visible: true });
    if (await back.count() === 1) { await back.click(); await settle(p, 1500); }
  });
  for (const [i, name] of names.entries()) await step(`${k}-course${i + 1}`, async () => {
    await openCourse(p, layout, name); await both(p, `${k}-course${i + 1}-${slug(name, 30)}`, full);
  });
}
async function scrollMid(p) {
  return p.evaluate(() => {
    const els = [...document.querySelectorAll("*")].filter(e => { const cs = getComputedStyle(e); return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 200 && e.getBoundingClientRect().width > 300; });
    const s = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (!s) return "no scroller";
    s.scrollTop = (s.scrollHeight - s.clientHeight) / 2; return String(s.className).slice(0, 40) + " -> " + Math.round(s.scrollTop);
  });
}
async function lessons(p, layout) {
  for (const [i, [course, title, id]] of LESSONS.entries()) await step(`lesson ${title}`, async () => {
    await openCourse(p, layout, course);
    const hit = p.locator(".resource-course-outline").first().getByText(title, { exact: true });
    if (await hit.count() !== 1) throw new Error(`lesson lookup "${title}" = ${await hit.count()} (not opened)`);
    await hit.click(); await settle(p, 6000);
    const h1 = await p.locator("h1").filter({ visible: true }).first().innerText().catch(() => "?");
    note(`lesson ${id} opened: "${title}" | page h1: "${h1.trim().slice(0, 60)}"`);
    const tag = `${layout}-1440-lesson${i + 1}-${slug(title, 28)}`;
    await both(p, `${tag}-top`, false);
    note(`  mid-scroll: ${await scrollMid(p)}`); await p.waitForTimeout(1200); await shot(p, `${tag}-mid`, false);
  });
}
async function pane(p, layout, path, tag, pick) {
  await step(tag, async () => {
    await p.goto(url(path, layout), { waitUntil: "domcontentloaded", timeout: 90000 }); await settle(p, 7000);
    const row = await pick(p); if (!row) throw new Error("row lookup failed");
    await row.click({ timeout: 5000 }); await settle(p, 3000);
    await both(p, `${layout}-1440-x-${tag}`, false);
    await p.keyboard.press("Escape"); await p.waitForTimeout(800);
  });
}
const exactRow = (rx) => async (p) => { const r = p.locator("tbody tr").filter({ hasText: rx }); return (await r.count()) >= 1 ? r.first() : null; };
try {
  for (const layout of ["channels", "classroom"]) {
    for (const [vp, size] of [["1440", DESKTOP], ["390", PHONE]]) {
      const { ctx, p } = await guarded(size);
      for (const [name, path] of PAGES) {
        if (size === PHONE && !PHONE_PAGES.includes(name)) continue;
        await step(name, async () => { await p.goto(url(path, layout), { waitUntil: "domcontentloaded", timeout: 90000 }); await settle(p, 4000); await both(p, `${layout}-${vp}-${name}`, name !== "chat"); });
      }
      await knowledge(p, layout, vp, size === DESKTOP);
      await ctx.close();
    }
    const { ctx, p } = await guarded(DESKTOP);
    await lessons(p, layout);
    await step("display", async () => {
      await p.goto(url("chat", layout), { waitUntil: "domcontentloaded" }); await settle(p, 4000);
      const d = p.getByRole("button", { name: /^Display$/ }).filter({ visible: true }); if (await d.count() !== 1) throw new Error("display count " + await d.count());
      await d.click(); await p.waitForTimeout(800); await shot(p, `${layout}-1440-x-display-menu`, false); await p.keyboard.press("Escape");
    });
    await step("pod", async () => {
      await p.goto(url("chat", layout), { waitUntil: "domcontentloaded" }); await settle(p, 4000);
      const pod = p.locator("a,button").filter({ visible: true }).filter({ hasText: /^\s*Agency owners \(test\)/ }); if (await pod.count() < 1) throw new Error("pod lookup");
      await pod.first().click(); await settle(p, 5000); await both(p, `${layout}-1440-x-pod`, false);
    });
    if (layout === "classroom") await step("pods-tab", async () => {
      await p.goto(url("chat", layout, "&pods=tab"), { waitUntil: "domcontentloaded" });
      const tab = p.getByRole("tab", { name: "Pods", exact: true }); await tab.waitFor({ timeout: 60000 }); await settle(p, 2000);
      await tab.click(); await settle(p, 3000); await both(p, `${layout}-1440-x-pods-grid`, true);
      const card = p.locator("a, button").filter({ visible: true }).filter({ hasText: /^Agency owners \(test\)/ }).filter({ hasNot: p.locator("[role=tab]") });
      if (await card.count() < 1) throw new Error("pods grid card lookup");
      await card.first().click(); await settle(p, 5000); await both(p, `${layout}-1440-x-pods-room`, false);
    });
    await pane(p, layout, "workflows?section=workflows", "automation-open", async (p) => { const b = p.locator("button.pn-au-step").filter({ hasText: /Member joins/ }); return (await b.count()) ? b.first() : null; });
    await pane(p, layout, "workflows?section=forms", "form-open", exactRow(/Untitled form/));
    await pane(p, layout, "people", "member-open", exactRow(/Fresh Member 0ff70/));
    await pane(p, layout, "workflows?section=runs", "run-open", exactRow(/^\s*Done/));
    await ctx.close();
  }
  for (const [vp, size] of [["1440", DESKTOP], ["390", PHONE]]) {
    const { ctx, p } = await guarded(size, false);
    await step("public", async () => { await p.goto(`${W}/c/ai-employee-builders`, { waitUntil: "domcontentloaded" }); await settle(p, 4000); await both(p, `public-signedout-${vp}`); });
    await ctx.close();
  }
} catch (e) { note(`STOPPED: ${e.message}`); process.exitCode = 2; }
finally {
  writeFileSync(join(out, "_audit.json"), JSON.stringify(audits, null, 1));
  const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} × ${k}`).join("\n") || "none";
  writeFileSync(join(out, "_log.txt"), log.join("\n")
    + `\n\nALLOW-LIST: /api/auth/* + ${[...ALLOW].join(", ")}`
    + `\n\nALLOWED (count):\n${fmt(allowed)}`
    + `\n\nBLOCKED MUTATIONS/ACTIONS (count):\n${fmt(blocked)}`
    + `\n\nOTHER BLOCKED REQUESTS:\n${other.join("\n") || "none"}`
    + `\n\nLEAK CHECK (non-allow-listed calls that reached the server):\n${leaked.join("\n") || "none"}`
    + `\n\nCONSOLE ERRORS (first 20):\n${cons.slice(0, 20).join("\n")}`);
  await browser.close();
}
