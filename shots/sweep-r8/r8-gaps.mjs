// r8 gaps: the 390 courses 3/5/6 (both layouts) and the 3 Business X-Ray lessons in classroom 1440.
// Cards are clicked by position; the full course title is confirmed before any shot. Same guard as r8 (r8-lib.mjs).
// Also: card DOM dump + crops (monogram question) and setOwnResourceProgressStatus timing for one lesson open.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded, browser, W, ALLOW, blocked, allowed, leaked, other, cons, unverified } from "./r8-lib.mjs";
const out = process.argv[2];
const log = []; const note = s => { console.log(s); log.push(s); };
const DESKTOP = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 };
const COURSES = ["Get set up", "Map the business", "Your first skill", "A skill system", "Make it reliable", "Your AI employee", "Business X-Ray course", "Claude Code 101", "Reference"];
const XRAY = [["Welcome", "v576w27d5hwd442n4f3d0hbg3h8gtkdv"], ["Why Map Your Business", "v57091hry0es6n6fkm8dndbrb18gt5mt"], ["Set Up the Skill", "v57dd97hapjbd30z6yrmzp65z18gt5j8"]];
const url = (path, layout) => `${W}/c/ai-employee-builders/${path}?layout=${layout}`;
const slug = (s, n) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, n);
const settle = async (p, ms = 2500) => { await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(ms); };
let firstChecked = false;
async function shot(p, name, opts = {}) {
  const file = join(out, `${name}.png`);
  if (existsSync(file)) { note(`SKIP ${name} (exists, not overwriting)`); return; }
  await p.mouse.move(2, p.viewportSize().height - 2).catch(() => {});
  await p.screenshot({ path: file, ...opts });
  const bad = await unverified(p);
  note(`saved ${name}${bad ? "  !! UNVERIFIED SESSION" : ""}`);
  if (!firstChecked) { firstChecked = true; if (bad) throw new Error("ABORT first page shows 'could not finish verifying your session'"); }
}
const step = async (name, fn) => { try { await fn(); } catch (e) { if (String(e.message).startsWith("ABORT")) throw e; note(`FAILED ${name}: ${e.message.split("\n")[0].slice(0, 200)}`); } };
async function grid(p, layout) {
  await p.goto(url("resources", layout), { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.locator(".resource-course-card").first().waitFor({ timeout: 90000 }); await settle(p, 1500);
}
const cardInfo = (p) => p.locator(".resource-course-card").evaluateAll(cs => cs.map(c => ({
  text: c.innerText.replace(/\s+/g, " ").trim().slice(0, 120), aria: c.getAttribute("aria-label"), title: c.getAttribute("title"),
  heading: (c.querySelector("h1,h2,h3,h4,[class*=title]") || {}).innerText || null,
  imgs: [...c.querySelectorAll("img")].map(i => i.alt || i.src.slice(-40)),
  firstLineEl: (() => { const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.trim()) { const e = n.parentElement; const s = getComputedStyle(e); return { cls: String(e.className).slice(0, 80), text: n.textContent.trim().slice(0, 40), fs: s.fontSize, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), aria: e.getAttribute("aria-hidden") }; } return null; })(),
})));
// Open the course at grid position idx, then confirm the full title on the opened page.
async function openByIndex(p, layout, idx, expect) {
  await grid(p, layout);
  const cards = p.locator(".resource-course-card"); const n = await cards.count();
  if (n !== COURSES.length) throw new Error(`card count ${n}, expected ${COURSES.length}`);
  const cardText = (await cards.nth(idx).innerText()).replace(/\s+/g, " ");
  const cardOk = cardText.includes(expect) || (await cards.nth(idx).getAttribute("aria-label") || "").includes(expect);
  await cards.nth(idx).click({ position: { x: 60, y: 60 } }); await settle(p, 3000);
  const outline = await p.locator(".resource-course-outline").first().innerText().catch(() => "");
  const body = await p.evaluate(() => document.body.innerText);
  const pageOk = outline.includes(expect) || body.includes(expect);
  note(`card #${idx + 1} "${expect}": card text match=${cardOk}, opened page shows title=${pageOk}`);
  if (!pageOk) throw new Error(`opened page does not show "${expect}" (not shooting)`);
}
// Timing for setOwnResourceProgressStatus during one lesson open.
let watch = null;
function hookProgress(p) {
  p.on("request", r => { if (watch && /\/api\/mutation/.test(r.url()) && (r.postData() || "").includes("setOwnResourceProgressStatus")) watch.push(Date.now()); });
}
try {
  for (const layout of ["channels", "classroom"]) {
    const { ctx, p } = await guarded(PHONE); hookProgress(p);
    await step(`${layout}-390 cards`, async () => {
      await grid(p, layout);
      const info = await cardInfo(p); note(`${layout}-390 card DOM: ${JSON.stringify(info)}`);
      await shot(p, `${layout}-390-k-cardcrop-course3`, { clip: await p.locator(".resource-course-card").nth(2).boundingBox() });
    });
    for (const idx of [2, 4, 5]) await step(`${layout}-390 course${idx + 1}`, async () => {
      await openByIndex(p, layout, idx, COURSES[idx]);
      await shot(p, `${layout}-390-k-course${idx + 1}-${slug(COURSES[idx], 30)}`, { fullPage: true });
    });
    await ctx.close();
  }
  const { ctx, p } = await guarded(DESKTOP); hookProgress(p);
  await step("classroom-1440 cards", async () => {
    await grid(p, "classroom");
    const info = await cardInfo(p); note(`classroom-1440 card DOM: ${JSON.stringify(info)}`);
    await shot(p, `classroom-1440-k-cardcrop-course7`, { clip: await p.locator(".resource-course-card").nth(6).boundingBox() });
  });
  for (const [i, [title, id]] of XRAY.entries()) await step(`lesson ${title}`, async () => {
    await openByIndex(p, "classroom", 6, "Business X-Ray course");
    const hit = p.locator(".resource-course-outline").first().getByText(title, { exact: true });
    if (await hit.count() !== 1) throw new Error(`lesson lookup "${title}" = ${await hit.count()} (not opened)`);
    watch = []; const t0 = Date.now();
    await hit.click(); await settle(p, 6000);
    const h = await p.locator("h1,h2").filter({ hasText: title }).count();
    note(`lesson ${id} opened: "${title}" | heading with title visible: ${h > 0}`);
    const tag = `classroom-1440-lesson${i + 1}-${slug(title, 28)}`;
    await shot(p, `${tag}-top`);
    await p.evaluate(() => { const els = [...document.querySelectorAll("*")].filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 200 && e.getBoundingClientRect().width > 300); const s = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (s) s.scrollTop = (s.scrollHeight - s.clientHeight) / 2; });
    await p.waitForTimeout(1200); await shot(p, `${tag}-mid`);
    if (i === 0) { // stay on this one lesson for 60s total and record the progress-write spacing
      const left = 60000 - (Date.now() - t0); if (left > 0) await p.waitForTimeout(left);
      const gaps = watch.slice(1).map((t, k) => t - watch[k]);
      const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
      note(`PROGRESS TIMING one open of "${title}": ${watch.length} setOwnResourceProgressStatus calls in ${Math.round((Date.now() - t0) / 1000)}s; first at +${watch.length ? watch[0] - t0 : "-"}ms; median gap ${med}ms; min ${gaps.length ? Math.min(...gaps) : "-"}ms; max ${gaps.length ? Math.max(...gaps) : "-"}ms; first 15 gaps ${JSON.stringify(gaps.slice(0, 15))}`);
    }
    watch = null;
  });
  await ctx.close();
} catch (e) { note(`STOPPED: ${e.message}`); process.exitCode = 2; }
finally {
  const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} × ${k}`).join("\n") || "none";
  writeFileSync(join(out, "_log-gaps.txt"), log.join("\n")
    + `\n\nALLOW-LIST: /api/auth/* + ${[...ALLOW].join(", ")}`
    + `\n\nALLOWED (count):\n${fmt(allowed)}`
    + `\n\nBLOCKED MUTATIONS/ACTIONS (count):\n${fmt(blocked)}`
    + `\n\nOTHER BLOCKED REQUESTS:\n${other.join("\n") || "none"}`
    + `\n\nLEAK CHECK (non-allow-listed calls that reached the server):\n${leaked.join("\n") || "none"}`
    + `\n\nCONSOLE ERRORS (first 20):\n${cons.slice(0, 20).join("\n")}`);
  await browser.close();
}
