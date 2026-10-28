// Light-mode borders + alignment pass (2026-10-28): AIEB, Channels + Classroom,
// owner + member view, desktop + phone. Saves a PNG AND an MHTML per screen so
// the cloud thread can restyle the real pages offline. READ-ONLY: same write
// guard as capture-sweep3.mjs (only session upkeep writes pass). Never types,
// never presses Save/Publish/etc. Member view is the per-tab "View as member" eye.
//
// node capture-borders.mjs --out <folder> [--base http://localhost:5174]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const out = args.out ?? "borders-shots";
const base = args.base ?? "http://localhost:5174";
const signIn = args.signin ?? "http://localhost:8797/open";
const SLUG = "ai-employee-builders";
mkdirSync(out, { recursive: true });
const log = [];
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
const BLOCK = /save|publish|apply|end\b|delete|remove|archive|start|send|post|invite|create|add|submit|join|leave|run|restore|discard|confirm|pay|buy|mark|done|complete|undo|approve/i;
const withLayout = (path, layout, extra = "") => `${base}/c/${SLUG}/${path}${path.includes("?") ? "&" : "?"}layout=${layout}${extra}`;
const SESSION_WRITES = /"path"\s*:\s*"[^"]*(bootstrapActor|identifyBusinessVisitor|resolveOnboardingProfileDetail|redeemPendingPurchaseClaims|heartbeatCommunityPresence|markCommunitySurfaceSeen)"/;
async function guard(context) {
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === "GET" || req.method() === "HEAD" || req.method() === "OPTIONS") return route.continue();
    if (/\/api\/query|\/api\/auth\/|attachment|download/i.test(url) && !/\/api\/(mutation|action)/i.test(url)) return route.continue();
    // The session's own background writes (sign-in, presence, seen markers) must
    // pass or the app shows "could not finish verifying your session".
    const body = req.postData() ?? "";
    if (/\/api\/(mutation|action)/i.test(url) && SESSION_WRITES.test(body)) return route.continue();
    blocked.push(`${req.method()} ${url.slice(0, 100)} ${((req.postData() ?? "").match(/"path"\s*:\s*"([^"]+)"/) ?? [])[1] ?? ""}`);
    return route.abort();
  });
  if (typeof context.routeWebSocket === "function") {
    await context.routeWebSocket(/./, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        const s = typeof m === "string" ? m : "";
        if (/"type"\s*:\s*"(Mutation|Action)"/.test(s)) { blocked.push(`WS ${s.slice(0, 140)}`); return; }
        server.send(m);
      });
      server.onMessage((m) => ws.send(m));
    });
    return true;
  }
  note("routeWebSocket unavailable: lessons will NOT be opened");
  return false;
}
let wsGuarded = true;
async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  return { context, page };
}
const settle = async (page, ms = 2000) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
// Signs in unguarded (sign-in may POST), then arms the guard before any app page.
async function signedIn(s) {
  await s.page.goto(`${signIn}/${SLUG}`);
  await s.page.waitForURL((url) => url.toString().startsWith(base), { timeout: 30000 });
  await settle(s.page);
  wsGuarded = (await guard(s.context)) && wsGuarded;
  // Reload so the app's WebSocket opens through the guard.
  await s.page.reload(); await settle(s.page);
}
async function shot(page, name, full = true) {
  try { await page.screenshot({ path: join(out, `${name}.png`), fullPage: full }); note(`saved ${name}`); }
  catch (e) { note(`FAILED ${name}: ${e.message.split("\n")[0]}`); }
}
async function snap(page, name) {
  try {
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
    writeFileSync(join(out, `${name}.mhtml`), data);
    await cdp.detach().catch(() => {});
    note(`saved ${name}`);
  } catch (e) { note(`FAILED ${name}: ${e.message.split("\n")[0]}`); }
}
async function firstCourse(page, layout) {
  await page.goto(withLayout("resources", layout)); await settle(page);
  const href = await page.$eval("a[href*='/resources/']", (a) => a.getAttribute("href")).catch(() => null);
  return href ? `${base}${href}${href.includes("?") ? "&" : "?"}layout=${layout}` : null;
}
async function firstLesson(page) {
  const it = page.locator("[class*=lesson-row], [class*=lesson-item], [class*=outline] li a, [class*=outline] button, [data-lesson-id], [class*=resource-row]").first();
  if (!(await it.count())) return false;
  await it.click({ timeout: 4000 }).catch(() => {}); await settle(page, 2500); return true;
}
async function memberView(page, on) {
  const b = page.getByRole("button", { name: on ? /^view as member$/i : /^exit member view$/i });
  if (!(await b.count())) return false;
  await b.first().click({ timeout: 4000 }).catch(() => {}); await settle(page, 1200); return true;
}
const DESK_PAGES = [["chat", "chat"], ["knowledge", "resources"], ["events", "events"], ["members-tab", "members"], ["members-db", "people"], ["workflows", "workflows?section=workflows"], ["settings", "settings/community"]];
const PHONE_PAGES = [["chat", "chat"], ["knowledge", "resources"], ["settings", "settings/community"]];

try {
  for (const layout of ["channels", "classroom"]) {
    for (const [vpName, vp, pages] of [["1440", DESKTOP, DESK_PAGES], ["390", PHONE, PHONE_PAGES]]) {
      const s = await newPage(vp);
      await signedIn(s);
      const { page } = s;
      for (const [name, path] of pages) {
        await page.goto(withLayout(path, layout)).catch(() => {}); await settle(page);
        await snap(page, `${layout}-${vpName}-owner-${name}`);
      }
      const course = await firstCourse(page, layout);
      if (course && wsGuarded) {
        await page.goto(course); await settle(page);
        await snap(page, `${layout}-${vpName}-owner-course`);
        if (await firstLesson(page)) await snap(page, `${layout}-${vpName}-owner-lesson`);
      }
      // Member view (owner preview), where the page offers it.
      for (const [name, path] of [["chat", "chat"], ["knowledge", "resources"]]) {
        await page.goto(withLayout(path, layout)); await settle(page);
        if (await memberView(page, true)) {
          await snap(page, `${layout}-${vpName}-member-${name}`);
          if (name === "knowledge" && course && wsGuarded) { await page.goto(course); await settle(page); await snap(page, `${layout}-${vpName}-member-course`); }
          await memberView(page, false);
        } else note(`no member view on ${layout} ${vpName} ${name}`);
      }
      await s.context.close();
    }
  }
} finally {
  writeFileSync(join(out, "_log.txt"), log.join("\n") + "\n\nBLOCKED WRITES:\n" + blocked.join("\n"));
  await browser.close();
}
