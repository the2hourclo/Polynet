// Stress test, pass 2 (writes, needs Rashid's OK): a brand-new test member
// goes through the real join → welcome → lesson → chat flow, then ONLY that
// test run is ended (which deletes everything it did).
//
// node stress-write.mjs --out <folder> [--base http://localhost:5174]
//
// Safety (polynet-pc-automation-safety):
// - Never touches Rashid's own runs, drafts or data. The only owner writes are
//   communityTestMembers.startTestMember and .endTestMember for the run THIS
//   script started, found by its exact label (a label that did not exist before
//   the run). If the label can't be found, nothing is ended and it says so.
// - The End confirm is accepted only if its text names that label.
// - Any mutation whose name looks like delete/archive/publish/settings/theme/
//   resource save/community update is dropped in every tab, and logged.
// - Test Member (dev user via ?as=member) only pastes into composers to check the
//   attachment chip and never sends; the composer is cleared afterwards.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const out = args.out ?? "stress-w1";
const base = args.base ?? "http://localhost:5174";
const signIn = args.signin ?? "http://localhost:8797/open";
const SLUG = args.slug ?? "ai-employee-builders";
mkdirSync(out, { recursive: true });
const log = [];
const report = [];
const writes = [];
const dropped = [];
const note = (s) => { console.log(s); log.push(s); };
const result = (check, problems, extra = {}) => { report.push({ check, pass: problems.length === 0, problems, ...extra }); note(`${problems.length ? "FAIL" : "pass"} ${check}${problems.length ? "\n   - " + problems.join("\n   - ") : ""}`); };

let playwright;
for (const from of [process.cwd() + "/package.json", "C:/Users/rkham/polynet-local/package.json", "C:/Users/rkham/polynet-local/apps/web/package.json"]) {
  try { playwright = createRequire(from)("playwright"); break; } catch {}
  try { playwright = createRequire(from)("playwright-core"); break; } catch {}
}
if (!playwright) throw new Error("playwright not found; run from C:/Users/rkham/polynet-local");
const browser = await playwright.chromium.launch({ channel: "chrome" }).catch(() => playwright.chromium.launch());

const DENY = /delete|archive|remove|publish|Theme|Appearance|Settings|saveCommunityResource|updateCommunity|setCommunity|Offer|grantAccess|revoke|ban|kick/i;
const ALLOW = /communityTestMembers:(startTestMember|endTestMember)/;
// The test member may delete its OWN stress message, once, right after posting it.
let allowOneDelete = false;
const allowed = (p) => { if (ALLOW.test(p)) return true; if (allowOneDelete && /communityInteractions:deleteCommunityInteractionMessage/.test(p)) { allowOneDelete = false; return true; } return false; };
const pathOf = (s) => (s.match(/"(?:udfPath|path)"\s*:\s*"([^"]+)"/) ?? [])[1] ?? "";
async function guard(context, who) {
  await context.route(/\/api\/(mutation|action)/, (route) => {
    const p = pathOf(route.request().postData() ?? "");
    if (DENY.test(p) && !allowed(p)) { dropped.push(`${who} HTTP ${p}`); return route.abort(); }
    writes.push(`${who} HTTP ${p}`); return route.continue();
  });
  if (typeof context.routeWebSocket !== "function") throw new Error("routeWebSocket unavailable: refusing to run unguarded");
  await context.routeWebSocket(/./, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const s = typeof m === "string" ? m : "";
      if (/"type"\s*:\s*"(Mutation|Action)"/.test(s)) {
        const p = pathOf(s);
        if (DENY.test(p) && !allowed(p)) { dropped.push(`${who} WS ${p}`); return; }
        if (!/heartbeat|markCommunitySurfaceSeen|bootstrapActor/i.test(p)) writes.push(`${who} WS ${p}`);
      }
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
}
let errs = [];
function watch(page, who) {
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED/i.test(m.text())) errs.push(`${who} console: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => errs.push(`${who} pageerror: ${String(e.message).slice(0, 300)}`));
}
const takeErrs = () => { const e = errs; errs = []; return e; };
const settle = async (page, ms = 1800) => { await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms); };
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) }).catch((e) => note(`SHOT FAILED ${name}: ${e.message}`));
const text = (page) => page.evaluate(() => document.body.innerText).catch(() => "");

// A tiny PNG made in the page, pasted as a clipboard file.
async function pasteImage(page, selector) {
  return page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "no composer";
    const c = document.createElement("canvas"); c.width = 40; c.height = 40;
    const g = c.getContext("2d"); g.fillStyle = "#1f8a4c"; g.fillRect(0, 0, 40, 40);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "stress-test.png", { type: "image/png" }));
    el.focus();
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return null;
  }, selector);
}
async function chipShown(page) {
  await page.waitForTimeout(1500);
  return page.evaluate(() => [...document.querySelectorAll("[class*=attachment], [class*=chip], img[src^='blob:']")].some((el) => /stress-test|blob:/.test(el.outerHTML)));
}

// Run history lists test runs (and their End buttons) only under its "Tests" filter.
async function testsTab(page) {
  const t = page.getByRole("tab", { name: /^\s*tests\s*$/i });
  if (await t.count()) { await t.first().click().catch(() => {}); await settle(page, 1200); } else note("no Tests filter on Run history");
}
// Answers whatever the welcome screen asks (only the test member's own form answers; End deletes them).
async function answerScreen(tab) {
  // Real typing (fill) so React and the form's own validation see it; numbers where the question asks for one.
  const fields = tab.locator(".community-welcome textarea:visible, .community-welcome input:visible:not([type=radio]):not([type=checkbox]):not([type=hidden])");
  for (let i = 0; i < await fields.count(); i++) {
    const f = fields.nth(i);
    if ((await f.inputValue().catch(() => "x")) !== "") continue;
    const type = (await f.getAttribute("type")) ?? "";
    const near = await tab.locator(".community-welcome").innerText().catch(() => "");
    const value = type === "url" ? "https://example.com" : type === "email" ? "stress.test@example.com"
      : type === "number" || /answer with a number|enter a number|how many|hours|number/i.test(near) ? "3" : "Stress test answer";
    await f.fill(value).catch(() => {});
  }
  // A number question that already holds text gets a number instead.
  if (/enter a number/i.test(await tab.locator(".community-welcome").innerText().catch(() => ""))) {
    await tab.locator(".community-welcome input:visible").first().fill("3").catch(() => {});
  }
  for (const name of await tab.$$eval(".community-welcome input[type=radio]", (rs) => [...new Set(rs.map((r) => r.name))]).catch(() => [])) {
    const group = tab.locator(`.community-welcome input[type=radio][name="${name}"]`);
    if (!(await group.evaluateAll((rs) => rs.some((r) => r.checked)).catch(() => true))) await group.first().check({ force: true }).catch(() => {});
  }
  const cbs = tab.locator(".community-welcome input[type=checkbox]:visible");
  if ((await cbs.count()) && !(await cbs.evaluateAll((c) => c.some((x) => x.checked)).catch(() => true))) await cbs.first().check().catch(() => {});
  const sel = tab.locator(".community-welcome select:visible");
  for (let i = 0; i < await sel.count(); i++) if (!(await sel.nth(i).inputValue().catch(() => "x"))) await sel.nth(i).selectOption({ index: 1 }).catch(() => {});
  const card = tab.locator(".community-welcome [role=radio][aria-checked=false]").first();
  if ((await tab.locator(".community-welcome [role=radio][aria-checked=true]").count()) === 0 && (await card.count())) await card.click().catch(() => {});
}

// Where the welcome page sits on the page (for the phone layout fix).
async function welcomeDom(tab, tag) {
  const chain = await tab.evaluate(() => {
    const out = []; let el = document.querySelector(".community-welcome");
    while (el && out.length < 8) { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} display=${st.display} h=${Math.round(r.height)} top=${Math.round(r.top)} pad-top=${st.paddingTop} overflow=${st.overflowY}`); el = el.parentElement; }
    return out;
  }).catch(() => []);
  note(`${tag} welcome DOM: ${chain.join("  <  ")}`);
}

async function ownerTestRun(vpName, vp) {
  const context = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const page = await context.newPage();
  watch(page, "owner");
  await page.goto(`${signIn}/${SLUG}`);
  await page.waitForURL((u) => u.toString().startsWith(base), { timeout: 30000 });
  await guard(context, "owner");
  await page.goto(`${base}/c/${SLUG}/workflows?section=runs`); await settle(page);
  await testsTab(page);
  const before = new Set(await page.$$eval(".test-run-member-name strong", (els) => els.map((e) => e.textContent.trim())).catch(() => []));
  note(`${vpName}: existing test runs (left alone): ${[...before].join(", ") || "none"}`);
  const startBtn = page.getByRole("button", { name: /try it yourself in a new tab|test as a new member/i });
  if (!(await startBtn.count())) { result(`${vpName}-start-test-run`, ["no 'Try it yourself in a new tab' / 'Test as a new member' button on Run history"]); await shot(page, `${vpName}-runs-no-button`); await context.close(); return; }
  const [tab] = await Promise.all([context.waitForEvent("page", { timeout: 30000 }), startBtn.first().click()]);
  watch(tab, "test");
  await tab.waitForURL(/test_run|\/c\//, { timeout: 30000 }).catch(() => {});
  await settle(tab, 3000);
  await page.reload(); await settle(page); await testsTab(page);
  const after = await page.$$eval(".test-run-member-name strong", (els) => els.map((e) => e.textContent.trim())).catch(() => []);
  const label = after.find((l) => !before.has(l)) ?? null;
  note(`${vpName}: new test run = ${label ?? "NOT FOUND"}`);
  result(`${vpName}-start-test-run`, [...(label ? [] : ["new run did not appear in the list"]), ...takeErrs()]);

  try {
    // 1. Welcome page: shows, has the Continue with Polynet step, can be walked through.
    await shot(tab, `${vpName}-welcome-1`);
    await welcomeDom(tab, vpName);
    const t = await text(tab);
    const welcomeProblems = [];
    if (!/welcome|get set up|getting started|set up/i.test(t)) welcomeProblems.push("no welcome page on first open");
    if (!/continue with polynet/i.test(t)) welcomeProblems.push("'Continue with Polynet' not visible on the first welcome screen (may be on a later card)");
    result(`${vpName}-welcome-shows`, [...welcomeProblems, ...takeErrs()]);
    for (let step = 2; step <= 20; step++) {
      await answerScreen(tab);
      const next = tab.getByRole("button", { name: /^(mark done and continue|mark done and open the community|next|continue|finish|submit|done|skip for now)$/i });
      if (!(await next.count())) break;
      const label2 = (await next.first().innerText()).trim();
      await next.first().click({ timeout: 5000 }).catch((e) => errs.push(`click ${label2}: ${e.message.split("\n")[0]}`));
      await settle(tab);
      await shot(tab, `${vpName}-welcome-${step}`);
      const err = (await text(tab)).match(/please answer this question|required/i);
      if (err && step > 2) note(`${vpName}: welcome step ${step} still asks for an answer`);
      if (/continue with polynet/i.test(await text(tab))) note(`${vpName}: Continue with Polynet seen at welcome step ${step}`);
      if (/open the community/i.test(label2)) break;
    }
    const inside = await tab.evaluate(() => !document.querySelector(".community-welcome")).catch(() => false);
    result(`${vpName}-welcome-finish`, [...(inside ? [] : ["still on the welcome page after walking its buttons"]), ...takeErrs()]);

    // 2. Knowledge: open the first lesson, Mark as done, then undo.
    await tab.goto(tab.url().replace(/\/c\/[^/]+\/[^?]*/, `/c/${SLUG}/resources`)); await settle(tab);
    const href = await tab.$eval("a[href*='/resources/']", (a) => a.getAttribute("href")).catch(() => null);
    if (href) {
      await tab.locator(`a[href='${href}']`).first().click().catch(() => {}); await settle(tab);
      await tab.locator("[data-lesson-id], [class*=lesson-row], [class*=lesson-item], [class*=outline] li a").first().click({ timeout: 5000 }).catch(() => {}); await settle(tab);
      const done = tab.locator("button.lesson-done-button");
      if (await done.count()) {
        await done.first().scrollIntoViewIfNeeded().catch(() => {});
        await done.first().click(); await settle(tab, 2500);
        const pressed = await done.first().getAttribute("aria-pressed");
        await shot(tab, `${vpName}-lesson-done`);
        await done.first().click(); await settle(tab, 2500);
        const unpressed = await done.first().getAttribute("aria-pressed");
        result(`${vpName}-mark-done-and-undo`, [...(pressed === "true" ? [] : [`after Mark as done aria-pressed=${pressed}`]), ...(unpressed === "false" ? [] : [`after undo aria-pressed=${unpressed}`]), ...takeErrs()]);
      } else result(`${vpName}-mark-done-and-undo`, ["no Mark as done button on the first lesson", ...takeErrs()]);
    } else result(`${vpName}-mark-done-and-undo`, ["no course link in Knowledge as a new member", ...takeErrs()]);

    // 3. Chat: post a message with a pasted image as the test member.
    await tab.goto(tab.url().replace(/\/c\/[^/]+\/[^?]*/, `/c/${SLUG}/chat`)); await settle(tab);
    if (!(await tab.locator("textarea.chat-input").count())) await tab.locator(".community-posts-composer-bar").first().click().catch(() => {});
    await settle(tab, 800);
    const pasteErr = await pasteImage(tab, "textarea.chat-input");
    const chip = pasteErr ? false : await chipShown(tab);
    await tab.locator("textarea.chat-input").first().fill("Stress test message from a test run, please ignore").catch(() => {});
    await shot(tab, `${vpName}-chat-composer`);
    await tab.getByRole("button", { name: /^send$/i }).first().click({ timeout: 5000 }).catch((e) => errs.push(`send: ${e.message.split("\n")[0]}`));
    await settle(tab, 3000);
    const posted = /Stress test message from a test run/.test(await text(tab));
    await shot(tab, `${vpName}-chat-posted`);
    result(`${vpName}-chat-post-with-image`, [...(pasteErr ? [pasteErr] : []), ...(chip ? [] : ["pasted image chip did not show"]), ...(posted ? [] : ["message did not appear after Send"]), ...takeErrs()]);
    // Delete that one message again (End keeps chat posts). Exact text, own message, confirm checked.
    if (posted) {
      const MSG = "Stress test message from a test run, please ignore";
      const row = tab.locator("li, article, div").filter({ hasText: MSG }).filter({ has: tab.getByRole("button", { name: "More actions" }) }).last();
      const delProblems = [];
      if (!(await row.count())) delProblems.push("could not find the posted message with a More actions button");
      else {
        await row.hover().catch(() => {});
        await row.getByRole("button", { name: "More actions" }).last().click({ timeout: 5000 }).catch((e) => delProblems.push(`More actions: ${e.message.split("\n")[0]}`));
        const del = tab.locator(".community-interaction-overflow-item.is-danger").filter({ hasText: /^\s*Delete\s*$/ });
        if (!(await del.count())) delProblems.push("no Delete in the message menu (test member can't delete own message?)");
        else {
          tab.once("dialog", (d) => { if (d.message() === "Delete this message?") { allowOneDelete = true; d.accept(); } else { note(`delete confirm text unexpected, dismissed: ${d.message()}`); d.dismiss(); } });
          await del.first().click(); await settle(tab, 3000);
          allowOneDelete = false;
          if (/Stress test message from a test run/.test(await text(tab))) delProblems.push("message still shows after Delete");
        }
      }
      await shot(tab, `${vpName}-chat-deleted`);
      if (delProblems.length) note(`LEFTOVER: the stress message in AIEB chat was not deleted (${vpName}); remove it by hand`);
      result(`${vpName}-chat-delete-own-message`, [...delProblems, ...takeErrs()]);
    }
    // Pods tab for a brand-new member (Classroom).
    const pods = tab.locator("[role=tab]").filter({ hasText: /^\s*Pods\s*$/ });
    if (await pods.count()) { await pods.first().click(); await settle(tab); await shot(tab, `${vpName}-pods-new-member`); result(`${vpName}-pods-new-member`, takeErrs()); }
  } finally {
    // 4. End ONLY this run.
    await tab.close().catch(() => {});
    if (!label) note("NOT ENDING anything: the new run's label was not found. Rashid/owner can End it by hand.");
    else {
      await page.goto(`${base}/c/${SLUG}/workflows?section=runs`); await settle(page); await testsTab(page);
      const endBtn = page.getByRole("button", { name: `End ${label}`, exact: true });
      if ((await endBtn.count()) !== 1) note(`NOT ENDING: expected exactly one "End ${label}" button, found ${await endBtn.count()}`);
      else {
        page.removeAllListeners("dialog");
        let accepted = false;
        page.once("dialog", (d) => { if (d.message().startsWith(`End ${label}?`)) { accepted = true; d.accept(); } else { note(`confirm text did not match, dismissed: ${d.message()}`); d.dismiss(); } });
        await endBtn.click(); await settle(page, 3000);
        const still = await page.getByRole("button", { name: `End ${label}`, exact: true }).count();
        result(`${vpName}-end-test-run`, [...(accepted ? [] : ["confirm not accepted"]), ...(still ? [`${label} still listed after End`] : []), ...takeErrs()]);
      }
    }
    await context.close();
  }
}

async function memberPaste(vpName, vp) {
  const context = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const page = await context.newPage();
  watch(page, "member");
  await page.goto(`${signIn}/${SLUG}?as=member`);
  await page.waitForURL((u) => u.toString().startsWith(base), { timeout: 30000 });
  await guard(context, "member");
  // Never send: drop every send-like mutation from this context, belt and braces.
  await context.route(/\/api\/(mutation|action)/, (route) => { const p = pathOf(route.request().postData() ?? ""); if (/send|post|message|upload/i.test(p)) { dropped.push(`member ${p}`); return route.abort(); } return route.fallback(); });
  for (const [where, open] of [
    ["channel", async () => { await page.goto(`${base}/c/${SLUG}/chat`); await settle(page); return "textarea.chat-input"; }],
    ["dm", async () => {
      await page.goto(`${base}/c/${SLUG}/chat`); await settle(page);
      await page.getByRole("button", { name: /^messages$/i }).or(page.getByRole("link", { name: /^messages$/i })).first().click({ timeout: 5000 }).catch(() => {});
      await settle(page);
      await page.locator("[class*=dm-list] button, [class*=direct-message] li button, [class*=conversation] button").first().click({ timeout: 5000 }).catch(() => {});
      await settle(page);
      return "[class*=direct] textarea, textarea[aria-label*='message' i]";
    }],
  ]) {
    const sel = await open();
    const err = await pasteImage(page, sel);
    const chip = err ? false : await chipShown(page);
    await shot(page, `${vpName}-member-paste-${where}`);
    result(`${vpName}-member-paste-${where}`, [...(err ? [err] : []), ...(chip ? [] : ["pasted image chip did not show"]), ...takeErrs()]);
    await page.reload().catch(() => {});
  }
  await context.close();
}

try {
  await ownerTestRun("1440", { width: 1440, height: 900 }).catch((e) => result("1440-flow", [`crashed: ${e.message.split("\n")[0]}`]));
  await ownerTestRun("390", { width: 390, height: 844 }).catch((e) => result("390-flow", [`crashed: ${e.message.split("\n")[0]}`]));
  await memberPaste("1440", { width: 1440, height: 900 }).catch((e) => result("member-paste", [`crashed: ${e.message.split("\n")[0]}`]));
} finally {
  const fails = report.filter((r) => !r.pass);
  writeFileSync(join(out, "_report.json"), JSON.stringify({ at: new Date().toISOString(), total: report.length, failed: fails.length, report, writes, dropped }, null, 1));
  writeFileSync(join(out, "_log.txt"), `${log.join("\n")}\n\n${report.length} checks, ${fails.length} failed\n\nWRITES SENT:\n${writes.join("\n")}\n\nDROPPED BY GUARD:\n${dropped.join("\n")}`);
  await browser.close();
  console.log(`\nDONE: ${report.length} checks, ${fails.length} failed.`);
}
