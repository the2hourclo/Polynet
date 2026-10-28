import fs from "node:fs";
import { session, browser, OUT } from "./r7-lib4.mjs";
const W = "http://localhost:5174"; const D = OUT + "batch-1027/pin-test/"; fs.mkdirSync(D, { recursive: true });
const phase = process.argv[2];
const REPLACE = "This pod already has a pinned message. Pin this one instead?";
const p = await session("ai-employee-builders");
let acceptReplace = false; const dialogs = [];
p.on("dialog", d => {
  dialogs.push(d.type() + ": " + d.message());
  if (acceptReplace && d.type() === "confirm" && d.message() === REPLACE) { acceptReplace = false; console.log("dialog ACCEPTED:", d.message()); return d.accept(); }
  console.log("dialog DISMISSED:", d.type(), d.message()); return d.dismiss();
});
const BG = /heartbeat|bootstrapActor|identifyBusinessVisitor|resolveOnboardingProfileDetail|redeemPendingPurchaseClaims|acknowledgeCommunityChatRead|recordBusinessPageVisit|recordPublicFunnelVisit|markCommunitySurfaceSeen/;
const ALLOW = /setCommunityChannelPinnedRoot/;
const calls = []; p.on("request", r => { if (/\/api\/(mutation|action)/.test(r.url())) { const path = JSON.parse(r.postData() || "{}").path; if (!BG.test(path)) calls.push(path); } });
await p.route(/\/api\/(mutation|action)/, r => { const path = JSON.parse(r.request().postData() || "{}").path || ""; if (BG.test(path) || ALLOW.test(path)) return r.continue(); console.log("BLOCKED:", path); return r.abort(); });
const cons = []; p.on("console", m => { if (m.type() === "error") cons.push(m.text().slice(0, 160)); });
let clicks = 0; const click = async (loc, opts) => { await loc.click(opts); clicks++; };
const toasts = () => p.evaluate(() => [...document.querySelectorAll("[role=status], [role=alert], [class*=toast], [class*=Toast]")].filter(e => e.getBoundingClientRect().width > 0 && e.innerText.trim()).map(e => e.innerText.trim().slice(0, 80)));
const pinnedCard = () => p.evaluate(() => { const h = [...document.querySelectorAll(".community-pod-panel-card h2")].find(x => /Pinned/.test(x.innerText)); const c = h?.closest(".community-pod-panel-card"); return c ? c.innerText.replace(/\n+/g, " | ").slice(0, 160) : null; });

const DLG_TEXT = "Replace the pinned message? This pod keeps one pinned message. Pinning this one unpins the current one. Cancel Pin this instead";
// Accepts only the in-page replace dialog, read word for word; anything else is cancelled and stops the run.
const answerReplace = async (expect) => {
  const dlg = p.getByRole("alertdialog"); await p.waitForTimeout(1200);
  if (!(await dlg.count())) { console.log(`[${phase}] no replace dialog`); if (expect) throw new Error("STOP expected replace dialog"); return false; }
  const text = (await dlg.innerText()).replace(/\s+/g, " ").trim();
  console.log(`[${phase}] dialog text:`, text);
  if (await dlg.count() !== 1 || text !== DLG_TEXT) { await dlg.getByRole("button", { name: "Cancel", exact: true }).click().catch(() => {}); throw new Error("STOP dialog text mismatch"); }
  await p.screenshot({ path: D + `pin-${phase === "c" ? "3-confirm" : "6-confirm"}.png` });
  await click(dlg.getByRole("button", { name: "Pin this instead", exact: true })); return true;
};
const openPod = async () => {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(W + "/c/ai-employee-builders/chat?layout=classroom", { waitUntil: "domcontentloaded", timeout: 90000 });
  // AIEB shows pods as a tab after Community since 2026-10-28.
  const tab = p.getByRole("tab", { name: "Pods", exact: true }); await tab.waitFor({ timeout: 120000 }); await p.waitForTimeout(3000);
  await tab.click(); await p.waitForTimeout(3000);
  const pod = p.locator("a, button").filter({ visible: true }).filter({ hasText: /^Agency owners \(test\)/ }).filter({ hasNot: p.locator("[role=tab]") });
  if (await pod.count() < 1) throw new Error("STOP pod lookup"); await pod.first().click(); await p.waitForTimeout(9000);
};
// Marks the single feed message whose text matches, or whose only content is the thumbnail image.
const markMsg = (kind) => p.evaluate((kind) => {
  const feedMsgs = [...document.querySelectorAll("[aria-label='More actions']")].map(b => { let a = b.parentElement; while (a && a.querySelectorAll("[aria-label='More actions']").length === 1 && a.parentElement && a.parentElement.querySelectorAll("[aria-label='More actions']").length === 1) a = a.parentElement; return a; });
  const hits = feedMsgs.filter(a => kind === "welcome"
    ? /Welcome to the agency owners pod\./.test(a.innerText)
    : [...a.querySelectorAll("img")].some(i => /Copy of Youtube Thumbnail/i.test(i.alt || "")) && !/Welcome|hi, what can you help/.test(a.innerText));
  if (hits.length !== 1) return "found " + hits.length;
  document.querySelectorAll("[data-pw-msg]").forEach(e => e.removeAttribute("data-pw-msg"));
  hits[0].setAttribute("data-pw-msg", kind);
  return "ok: " + hits[0].innerText.replace(/\n+/g, " | ").slice(0, 120);
}, kind);
const openMenu = async (kind) => {
  const m = await markMsg(kind); console.log(`[${phase}] ${kind} message:`, m); if (!m.startsWith("ok")) throw new Error("STOP message lookup");
  const msg = p.locator(`[data-pw-msg=${kind}]`); await msg.scrollIntoViewIfNeeded(); await msg.hover(); await p.waitForTimeout(600);
  await click(msg.locator("[aria-label='More actions']"), { force: true }); await p.waitForTimeout(800);
  const menu = msg.locator("[role=menu]"); console.log(`[${phase}] menu:`, JSON.stringify(await menu.allInnerTexts()));
  if (await menu.count() !== 1) throw new Error("STOP menu lookup");
  return menu;
};

try {
  await openPod();
  console.log(`[${phase}] pinned card before:`, await pinnedCard());
  if (phase === "c") {
    const menu = await openMenu("welcome");
    const item = menu.getByRole("button", { name: "Pin to pod", exact: true }); if (await item.count() !== 1) throw new Error("STOP pin item");
    await click(item); await answerReplace(true); await p.waitForTimeout(400);
    console.log("[c] toasts right after:", JSON.stringify(await toasts()));
    await p.waitForTimeout(3000);
    console.log("[c] toasts after 3s:", JSON.stringify(await toasts()), "| pinned card:", await pinnedCard());
    await p.screenshot({ path: D + "pin-3-after.png" });
  } else if (phase === "d") {
    const item = p.locator("button.community-pod-pinned"); if (await item.count() !== 1) throw new Error("STOP pinned item");
    await click(item); await p.waitForTimeout(3500);
    console.log("[d] url:", p.url().replace(W, ""), "| opened:", JSON.stringify(await p.evaluate(() => { const sel = document.querySelector(".is-selected, [aria-current=true], .community-thread-panel, [class*=thread-panel], [role=dialog]"); return sel ? String(sel.className).slice(0, 60) + " :: " + sel.innerText.replace(/\n+/g, " | ").slice(0, 160) : null; })));
    await p.screenshot({ path: D + "pin-4-open.png" });
    console.log("[d] unpin controls visible:", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")].filter(b => b.getBoundingClientRect().width > 0 && /unpin/i.test((b.getAttribute("aria-label") || "") + b.innerText)).map(b => (b.getAttribute("aria-label") || b.innerText.trim()) + " @" + Math.round(b.getBoundingClientRect().left) + "," + Math.round(b.getBoundingClientRect().top)))));
  } else if (phase === "e") {
    console.log("[e] unpin controls on screen before opening any menu:", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().width > 0 && /unpin/i.test((b.getAttribute("aria-label") || "") + b.innerText)).map(b => b.getAttribute("aria-label") || b.innerText.trim()))));
    const menu = await openMenu("welcome");
    const item = menu.getByRole("button", { name: "Unpin from pod", exact: true }); if (await item.count() !== 1) throw new Error("STOP unpin item");
    await p.screenshot({ path: D + "pin-5-unpin-menu.png" });
    await click(item); await p.waitForTimeout(3500);
    console.log("[e] toasts:", JSON.stringify(await toasts()), "| pinned card:", await pinnedCard());
    await p.screenshot({ path: D + "pin-5-unpin.png" });
  } else if (phase === "f") {
    // The thumbnail message shows its More actions button only on hover: mark its row from the image, then hover.
    const m = await p.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")].filter(i => /Copy of Youtube Thumbnail/i.test(i.alt || "") && i.getBoundingClientRect().width > 150);
      if (imgs.length !== 1) return "found " + imgs.length;
      let a = imgs[0].parentElement; while (a && !(/Rashid/.test(a.innerText) && /Yesterday|Oct 27/.test(a.innerText))) a = a.parentElement;
      if (!a || /Welcome|hi, what can you help/.test(a.innerText)) return "row not isolated";
      document.querySelectorAll("[data-pw-msg]").forEach(e => e.removeAttribute("data-pw-msg")); a.setAttribute("data-pw-msg", "thumb");
      return "ok: " + a.innerText.replace(/\n+/g, " | ").slice(0, 100);
    });
    console.log("[f] thumb row:", m); if (!m.startsWith("ok")) throw new Error("STOP thumb row lookup");
    const row = p.locator("[data-pw-msg=thumb]"); await row.scrollIntoViewIfNeeded(); await row.hover(); await p.waitForTimeout(800);
    const more = row.locator("[aria-label='More actions']"); if (await more.count() !== 1) throw new Error("STOP thumb More actions count " + await more.count());
    await click(more, { force: true }); await p.waitForTimeout(800);
    const menu = row.locator("[role=menu]"); console.log("[f] menu:", JSON.stringify(await menu.allInnerTexts())); if (await menu.count() !== 1) throw new Error("STOP menu lookup");
    const item = menu.getByRole("button", { name: "Pin to pod", exact: true }); if (await item.count() !== 1) throw new Error("STOP pin item");
    await click(item); await answerReplace(false); await p.waitForTimeout(3500);
    console.log("[f] toasts:", JSON.stringify(await toasts()), "| pinned card:", await pinnedCard());
    await p.screenshot({ path: D + "pin-6-restored.png" });
  }
} catch (e) { console.log(`[${phase}] END:`, e.message.slice(0, 200)); await p.screenshot({ path: D + `_err-${phase}.png` }); }
console.log(`[${phase}] clicks: ${clicks} | dialogs:`, JSON.stringify(dialogs), "| calls:", JSON.stringify(calls), "| console errors:", JSON.stringify(cons.slice(0, 6)));
await browser.close();
