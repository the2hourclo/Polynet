// r8: read-only capture helpers. The write-block is armed before sign-in.
import { chromium } from "playwright";
export const W = "http://localhost:5174";
export const ALLOW = new Set(["auth:bootstrapActor", "businessAnalytics:identifyBusinessVisitor", "profiles:resolveOnboardingProfileDetail", "communityCommerce:redeemPendingPurchaseClaims", "communityPublic:heartbeatCommunityPresence", "communityAttention:markCommunitySurfaceSeen"]);
export const blocked = {}; export const allowed = {}; export const leaked = []; export const other = []; export const cons = [];
export const browser = await chromium.launch();
const pathOf = (body) => { try { return JSON.parse(body || "{}").path || "?"; } catch { return "?"; } };
export async function guarded(viewport, signIn = true) {
  const phone = viewport.width < 500;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await ctx.route(/\/api\/(mutation|action)/, r => { const path = pathOf(r.request().postData()); if (ALLOW.has(path)) { allowed[path] = (allowed[path] || 0) + 1; return r.continue(); } blocked[path] = (blocked[path] || 0) + 1; return r.abort(); });
  // any other non-GET write except /api/auth/* and queries
  await ctx.route(/./, r => { const q = r.request(); if (["GET", "HEAD", "OPTIONS"].includes(q.method()) || /\/api\/(auth\/|query|mutation|action)|attachment_download/.test(q.url())) return r.fallback(); other.push(q.method() + " " + q.url().slice(0, 120)); return r.abort(); });
  await ctx.routeWebSocket(/./, ws => { const server = ws.connectToServer(); ws.onMessage(m => { const s = typeof m === "string" ? m : ""; if (/"type"\s*:\s*"(Mutation|Action)"/.test(s)) { let u = "?"; try { u = JSON.parse(s).udfPath; } catch {} if (!ALLOW.has(u)) { blocked["WS " + u] = (blocked["WS " + u] || 0) + 1; return; } } server.send(m); }); server.onMessage(m => ws.send(m)); });
  ctx.on("requestfinished", r => { if (/\/api\/(mutation|action)/.test(r.url())) { const path = pathOf(r.postData()); if (!ALLOW.has(path)) leaked.push(path); } });
  const p = await ctx.newPage();
  p.on("dialog", d => { other.push("dialog " + d.message()); d.dismiss(); });
  p.on("console", m => { if (m.type() === "error") cons.push(m.text().slice(0, 140)); });
  if (signIn) {
    await p.goto("http://127.0.0.1:8797/open/ai-employee-builders", { waitUntil: "domcontentloaded", timeout: 90000 });
    await p.waitForURL(/localhost:5174\//, { timeout: 90000 }); await p.waitForTimeout(4000);
  }
  return { ctx, p };
}
export const unverified = (p) => p.evaluate(() => document.body.innerText.includes("could not finish verifying"));
