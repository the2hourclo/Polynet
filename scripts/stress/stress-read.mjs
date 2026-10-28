// Stress test, pass 1 (read-only): click through the main member and owner
// flows on the combined build and record everything that breaks.
//
// node stress-read.mjs --out <folder> [--base http://localhost:5174]
//
// WRITE-PROOF. Sign-in and session upkeep pass (see SESSION_WRITES). Every other
// Convex mutation/action is dropped before it leaves the browser (WebSocket
// frames and HTTP /api/mutation|/api/action), as is every non-GET request except
// queries, auth and protected-image downloads. It never types into the app and
// never presses Save/Publish/Delete/End/etc. Member = the dev user "Test Member"
// via the sign-in opener ?as=member (creates nothing). Owner = the default opener.
//
// Records per page: console errors, uncaught page errors, HTTP >= 400, visible
// error text, horizontal overflow at phone width, members seeing owner pages.
// Writes _report.json (one row per check) and _log.txt next to the screenshots.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const out = args.out ?? "stress-r1";
const base = args.base ?? "http://localhost:5174";
const signIn = args.signin ?? "http://localhost:8797/open";
const SLUG = args.slug ?? "ai-employee-builders";
mkdirSync(out, { recursive: true });
const log = [];
const report = [];
const blocked = [];
const note = (s) => { console.log(s); log.push(s); };

let playwright;
for (const from of [process.cwd() + "/package.json", "C:/Users/rkham/polynet-local/package.json", "C:/Users/rkham/polynet-local/apps/web/package.json"]) {
  try { playwright = createRequire(from)("playwright"); break; } catch {}
  try { playwright = createRequire(from)("playwright-core"); break; } catch {}
}
if (!playwright) throw new Error("playwright not found; run from C:/Users/rkham/polynet-local");
const browser = await playwright.chromium.launch({ channel: "chrome" }).catch(() => playwright.chromium.launch());

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const MEMBER_PAGES = [["chat", "chat"], ["knowledge", "resources"], ["events", "events"], ["members", "members"], ["about", "about"], ["agent", "agent"]];
const OWNER_PAGES = [
  ["people", "people"], ["analytics", "analytics"],
  ["wf-automations", "workflows?section=workflows"], ["wf-runs", "workflows?section=runs"], ["wf-changes", "workflows?section=changes"],
  ["wf-forms", "workflows?section=forms"], ["wf-welcome", "workflows?section=welcome"],
  ["set-general", "settings/community"], ["set-appearance", "settings/appearance"], ["set-offers", "settings/offers"],
  ["set-access", "settings/access"], ["set-creators", "settings/creators"], ["set-agent", "settings/agent"],
];
// Owner-only text a member must never see on an owner URL.
const OWNER_ONLY = /\b(Automations|Run history|Recent changes|Customi[sz]e|Offers you sell|Export members|Add member|Give access)\b/;
const ERROR_TEXT = /something went wrong|unexpected error|server error|could not finish verifying|failed to load|couldn['’]t load|not found|uncaught|cannot read prop|is not a function|undefined is not|\[object Object\]|NaN\b/i;
const BLOCK = /save|publish|apply|\bend\b|delete|remove|archive|start|send|post|invite|create|add|submit|join|leave|run|restore|discard|confirm|pay|buy|mark|done|complete|undo|approve|upgrade|cancel/i;

const withLayout = (path, layout, extra = "") => `${base}/c/${SLUG}/${path}${path.includes("?") ? "&" : "?"}layout=${layout}${extra}`;
const SESSION_WRITES = /"path"\s*:\s*"[^"]*(bootstrapActor|identifyBusinessVisitor|resolveOnboardingProfileDetail|redeemPendingPurchaseClaims|heartbeatCommunityPresence|markCommunitySurfaceSeen)"/;
async function guard(context) {
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === "GET" || req.method() === "HEAD" || req.method() === "OPTIONS") return route.continue();
    if (/\/api\/query|\/api\/auth\/|attachment|download/i.test(url) && !/\/api\/(mutation|action)/i.test(url)) return route.continue();
    const body = req.postData() ?? "";
    if (/\/api\/(mutation|action)/i.test(url) && SESSION_WRITES.test(body)) return route.continue();
    blocked.push(`${req.method()} ${url.slice(0, 100)} ${(body.match(/"path"\s*:\s*"([^"]+)"/) ?? [])[1] ?? ""}`);
    return route.abort();
  });
  if (typeof context.routeWebSocket !== "function") throw new Error("routeWebSocket unavailable (Playwright too old): refusing to run unguarded");
  await context.routeWebSocket(/./, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const s = typeof m === "string" ? m : "";
      if (/"type"\s*:\s*"(Mutation|Action)"/.test(s) && !SESSION_WRITES.test(s)) { blocked.push(`WS ${s.slice(0, 140)}`); return; }
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
}

// Per-page problem capture.
let current = { errors: [] };
function watch(page) {
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED|Failed to load resource.*(mutation|action)/i.test(m.text())) current.errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => current.errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on("response", async (r) => {
    if (r.status() < 400 || /favicon|i\.ytimg|\/api\/(mutation|action)/.test(r.url())) return;
    const fn = ((r.request().postData() ?? "").match(/"path"\s*:\s*"([^"]+)"/) ?? [])[1] ?? "";
    const body = await r.text().catch(() => "");
    current.errors.push(`http ${r.status()} ${r.url().slice(0, 100)} ${fn} ${body.slice(0, 160)}`);
  });
}
async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  watch(page);
  return { context, page };
}
const settle = async (page, ms = 1800) => { await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms); };
async function signedIn(s, who) {
  await s.page.goto(`${signIn}/${SLUG}${who === "member" ? "?as=member" : ""}`);
  await s.page.waitForURL((url) => url.toString().startsWith(base), { timeout: 30000 });
  await settle(s.page);
  await guard(s.context);
  await s.page.reload(); await settle(s.page);
}
async function shot(page, name, full = false) {
  try { await page.screenshot({ path: join(out, `${name}.png`), fullPage: full }); }
  catch (e) { note(`SHOT FAILED ${name}: ${e.message.split("\n")[0]}`); }
}
// One check = one row in the report.
async function check(page, name, { expectOwnerHidden = false, full = false } = {}) {
  await shot(page, name, full);
  const facts = await page.evaluate(() => {
    const body = document.body.innerText || "";
    const vw = innerWidth;
    const wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.right > vw + 2 && s.position !== "fixed" && s.visibility !== "hidden"; })
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} right=${Math.round(el.getBoundingClientRect().right)}`);
    // Floating chrome (fixed, small, near the top) sitting on top of content at scroll 0.
    const chrome = [...document.querySelectorAll("body *")].filter((el) => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.position === "fixed" && r.top < 100 && r.height > 0 && r.height < 90 && r.width < vw * 0.8 && st.visibility !== "hidden" && Number(st.opacity) > 0.1; });
    const covered = [];
    for (const c of chrome) {
      const cr = c.getBoundingClientRect();
      for (const el of document.querySelectorAll("h1,h2,h3,p,input,textarea,[class*=card],[class*=composer]")) {
        if (c.contains(el) || el.contains(c)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).position === "fixed") continue;
        if (r.left < cr.right && r.right > cr.left && r.top < cr.bottom - 2 && r.bottom > cr.top + 2) { covered.push(`${(c.innerText || c.getAttribute("aria-label") || c.className).toString().trim().slice(0, 20)} over ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`); break; }
      }
    }
    return { covered: covered.slice(0, 3), url: location.pathname + location.search, title: document.title, scrollW: document.documentElement.scrollWidth, vw, wide, text: body.slice(0, 2500), empty: body.trim().length < 40 };
  }).catch((e) => ({ url: page.url(), evalError: e.message }));
  const problems = [...current.errors];
  if (facts.evalError) problems.push(`page could not be read: ${facts.evalError}`);
  const m = facts.text?.match(ERROR_TEXT);
  if (m) problems.push(`error text on page: "${facts.text.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, " ")}"`);
  if (facts.scrollW > facts.vw + 2) problems.push(`sideways scroll: page ${facts.scrollW}px wide at ${facts.vw}px (${facts.wide.join("; ")})`);
  if (facts.empty) problems.push("page is (nearly) blank");
  if (facts.vw < 500 && facts.covered?.length) problems.push(`floating chrome covers content at the top: ${facts.covered.join("; ")}`);
  if (expectOwnerHidden && OWNER_ONLY.test(facts.text ?? "")) problems.push(`member sees owner-only screen: "${facts.text.match(OWNER_ONLY)[0]}"`);
  report.push({ check: name, url: facts.url, pass: problems.length === 0, problems });
  note(`${problems.length ? "FAIL" : "pass"} ${name}${problems.length ? "\n   - " + problems.join("\n   - ") : ""}`);
  current = { errors: [] };
}
async function visit(page, url) { current = { errors: [] }; await page.goto(url).catch((e) => current.errors.push(`goto: ${e.message.split("\n")[0]}`)); await settle(page); }
async function click(page, locator, what) {
  if (!(await locator.count().catch(() => 0))) { report.push({ check: what, pass: false, problems: ["control not found"] }); note(`FAIL ${what}: control not found`); return false; }
  const label = ((await locator.first().innerText().catch(() => "")) || (await locator.first().getAttribute("aria-label").catch(() => "")) || "").trim();
  if (BLOCK.test(label) && !/^(view|open|display|messages|customi[sz]e|roadmap|resources|graph|pods|shape|continue reading)/i.test(label)) { note(`skipped click on "${label}" (${what})`); return false; }
  current = { errors: [] };
  await locator.first().click({ timeout: 5000 }).catch((e) => current.errors.push(`click: ${e.message.split("\n")[0]}`));
  await settle(page);
  return true;
}
const tab = (page, label) => page.locator("[role=tab], button.community-category-chip, nav a, nav button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") });

async function memberFlow(who, layout, vpName, vp) {
  const s = await newPage(vp);
  const { page } = s;
  const p = `${who}-${layout}-${vpName}`;
  await signedIn(s, who);
  for (const [name, path] of MEMBER_PAGES) { await visit(page, withLayout(path, layout)); await check(page, `${p}-${name}`); }
  // Knowledge: views, a course, its first lessons, phone Done/Next placement.
  await visit(page, withLayout("resources", layout));
  for (const v of ["Roadmap", "Resources"]) if (await click(page, tab(page, v), `${p}-knowledge-${v}`)) await check(page, `${p}-knowledge-${v.toLowerCase()}`);
  await visit(page, withLayout("resources", layout));
  // Courses are cards (button.resource-course-card-main), not links.
  const cardSel = ".resource-course-card:not(.is-locked) .resource-course-card-main";
  const nCards = await page.locator(cardSel).count().catch(() => 0);
  const nLocked = await page.locator(".resource-course-card.is-locked").count().catch(() => 0);
  note(`${p}: ${nCards} open course cards, ${nLocked} locked`);
  if (!nCards) report.push({ check: `${p}-courses`, pass: false, problems: ["no open course card in Knowledge"] });
  for (let i = 0; i < Math.min(nCards, vp === PHONE ? 1 : 3); i++) {
    await visit(page, withLayout("resources", layout));
    if (!(await click(page, page.locator(cardSel).nth(i), `${p}-course${i + 1}`))) continue;
    await check(page, `${p}-course${i + 1}`);
    // Walk the first lessons with Next (opening a lesson's start-mark is dropped by the guard).
    for (let j = 1; j <= 2; j++) {
      const next = page.locator("button.lesson-next-button");
      if (!(await next.count())) { note(`${p}-course${i + 1}: no Next button after lesson ${j}`); break; }
      if (!(await click(page, next, `${p}-course${i + 1}-next${j}`))) break;
      await check(page, `${p}-course${i + 1}-lesson${j + 1}`);
      if (vp === PHONE) {
        const covered = await page.evaluate(() => {
          const btn = document.querySelector("button.lesson-done-button, button.lesson-next-button");
          if (!btn) return null;
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return top && (btn === top || btn.contains(top)) ? null : `Done/Next covered by ${top?.tagName}.${String(top?.className).split(" ")[0]}`;
        }).catch(() => null);
        if (covered) { report.push({ check: `${p}-course${i + 1}-lesson${j + 1}-done-reachable`, pass: false, problems: [covered] }); note(`FAIL done-reachable: ${covered}`); }
      }
    }
  }
  // Chat: Display menu, Messages, Pods tab (Classroom) or pod in the list.
  await visit(page, withLayout("chat", layout));
  if (await click(page, page.getByRole("button", { name: /^display$/i }), `${p}-display-menu`)) { await check(page, `${p}-display-menu`); await page.keyboard.press("Escape"); }
  const dmBtn = page.locator("button[aria-label*='essage' i], button[title*='essage' i], a[aria-label*='essage' i]").filter({ hasNot: page.locator("textarea") });
  if (!(await dmBtn.count())) note(`${p}: header buttons = ${JSON.stringify(await page.$$eval("header button, nav button, [class*=top-nav] button, [class*=bar] button", (bs) => bs.slice(0, 30).map((b) => b.getAttribute("aria-label") || b.title || b.innerText.trim()).filter(Boolean)).catch(() => []))}`);
  if (await click(page, dmBtn, `${p}-messages`)) { await check(page, `${p}-messages`); await page.keyboard.press("Escape"); }
  await visit(page, withLayout("chat", layout));
  if (layout === "classroom") { if (await click(page, tab(page, "Pods"), `${p}-pods-tab`)) await check(page, `${p}-pods-tab`); }
  else { const pod = page.locator("nav a, nav button, aside a, aside button").filter({ hasText: /\(test\)/i }); if (await pod.count()) { await click(page, pod, `${p}-pod`); await check(page, `${p}-pod`); } }
  // Members must not get owner screens.
  if (who === "member") for (const [name, path] of OWNER_PAGES.filter(([n]) => ["people", "analytics", "wf-automations", "set-appearance", "set-offers"].includes(n))) {
    await visit(page, withLayout(path, layout)); await check(page, `${p}-ownerurl-${name}`, { expectOwnerHidden: true });
  }
  await s.context.close();
}

async function ownerFlow(layout, vpName, vp) {
  const s = await newPage(vp);
  const { page } = s;
  const p = `owner-${layout}-${vpName}`;
  await signedIn(s, "owner");
  for (const [name, path] of OWNER_PAGES) { await visit(page, withLayout(path, layout)); await check(page, `${p}-${name}`); }
  if (vp === DESKTOP) {
    for (const [path, sel, tag] of [
      ["people", "table tbody tr, [role=row][aria-rowindex]", "member-open"],
      ["workflows?section=workflows", "table tbody tr, [class*=automation-row], [class*=workflow-row], [class*=pn-wf] li", "automation-open"],
      ["workflows?section=changes", "table tbody tr, [class*=pn-chg] li, [class*=change-row]", "change-open"],
    ]) {
      await visit(page, withLayout(path, layout));
      if (await click(page, page.locator(sel), `${p}-${tag}`)) await check(page, `${p}-${tag}`);
    }
    await visit(page, withLayout("settings/appearance", layout));
    if (await click(page, page.getByRole("button", { name: /^customi[sz]e/i }).or(page.getByRole("tab", { name: /^customi[sz]e/i })), `${p}-customize`)) {
      await check(page, `${p}-customize`);
      if (await click(page, page.getByRole("button", { name: /^shape$/i }).or(page.locator("summary, h3, button").filter({ hasText: /^\s*Shape\s*$/ })), `${p}-shape`)) await check(page, `${p}-shape`);
    }
    await visit(page, withLayout("resources", layout));
    if (await click(page, page.getByRole("button", { name: /view as member/i }), `${p}-view-as-member`)) await check(page, `${p}-view-as-member`);
  }
  await s.context.close();
}

try {
  for (const layout of ["classroom", "channels"]) {
    for (const [vpName, vp] of [["1440", DESKTOP], ["390", PHONE]]) {
      await memberFlow("member", layout, vpName, vp).catch((e) => note(`member ${layout} ${vpName} crashed: ${e.message}`));
      await ownerFlow(layout, vpName, vp).catch((e) => note(`owner ${layout} ${vpName} crashed: ${e.message}`));
    }
  }
  for (const [vpName, vp] of [["1440", DESKTOP], ["390", PHONE]]) {
    const s = await newPage(vp);
    await guard(s.context);
    await visit(s.page, `${base}/c/${SLUG}`); await check(s.page, `signedout-${vpName}-about`, { expectOwnerHidden: true, full: true });
    await s.context.close();
  }
} finally {
  const fails = report.filter((r) => !r.pass);
  writeFileSync(join(out, "_report.json"), JSON.stringify({ base, slug: SLUG, at: new Date().toISOString(), total: report.length, failed: fails.length, report }, null, 1));
  writeFileSync(join(out, "_log.txt"), log.join("\n") + `\n\n${report.length} checks, ${fails.length} failed\n\nBLOCKED WRITES (expected, guard working):\n` + blocked.join("\n"));
  await browser.close();
  console.log(`\nDONE: ${report.length} checks, ${fails.length} failed. Report: ${join(out, "_report.json")}`);
}
