// r8 probe: card crops (monogram check) + timing of setOwnResourceProgressStatus. Same guard (r8-lib.mjs); read-only.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded, browser, W, blocked, leaked } from "./r8-lib.mjs";
const out = process.argv[2]; const log = []; const note = s => { console.log(s); log.push(s); };
const settle = async (p, ms) => { await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(ms); };
const grid = async (p, layout) => { await p.goto(`${W}/c/ai-employee-builders/resources?layout=${layout}`, { waitUntil: "domcontentloaded", timeout: 90000 }); await p.locator(".resource-course-card").first().waitFor({ timeout: 90000 }); await settle(p, 2000); };
async function crop(p, idx, name) {
  const file = join(out, `${name}.png`); if (existsSync(file)) return note(`SKIP ${name}`);
  const c = p.locator(".resource-course-card").nth(idx); await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
  await c.screenshot({ path: file }); note(`saved ${name} (${(await c.innerText()).split("\n").slice(0, 2).join(" | ")})`);
}
let times = null, t0 = 0;
const track = (ctx) => ctx.route(/\/api\/mutation/, r => { if (times && (r.request().postData() || "").includes("setOwnResourceProgressStatus")) times.push(Date.now() - t0); return r.fallback(); });
const report = (label) => { const g = times.slice(1).map((t, k) => t - times[k]); const s = [...g].sort((a, b) => a - b);
  note(`${label}: ${times.length} calls in ${Math.round((Date.now() - t0) / 1000)}s; first at +${times[0] ?? "-"}ms; median gap ${s[Math.floor(s.length / 2)] ?? "-"}ms; min ${s[0] ?? "-"}; max ${s.at(-1) ?? "-"}; first 20 at ${JSON.stringify(times.slice(0, 20))}`); };
try {
  { const { ctx, p } = await guarded({ width: 390, height: 844 }); await grid(p, "channels"); await crop(p, 2, "channels-390-k-cardcrop-course3"); await crop(p, 0, "channels-390-k-cardcrop-course1"); await ctx.close(); }
  const { ctx, p } = await guarded({ width: 1440, height: 900 }); await track(ctx);
  await grid(p, "classroom"); await crop(p, 6, "classroom-1440-k-cardcrop-course7"); await crop(p, 2, "classroom-1440-k-cardcrop-course3");
  // A: open the course card only, stay 60s
  times = []; t0 = Date.now(); await p.locator(".resource-course-card").nth(6).click({ position: { x: 60, y: 60 } }); await p.waitForTimeout(60000);
  report("A course card open (Business X-Ray, lands on Welcome)");
  // B: click a started lesson in the outline, stay 60s
  const hit = p.locator(".resource-course-outline").first().getByText("Why Map Your Business", { exact: true });
  if (await hit.count() === 1) { times = []; t0 = Date.now(); await hit.click(); await p.waitForTimeout(60000); report("B lesson click (Why Map Your Business)"); } else note("B lesson lookup failed, skipped");
  // C: idle on the grid 30s (control)
  times = []; t0 = Date.now(); await grid(p, "classroom"); await p.waitForTimeout(30000); report("C resources grid, no lesson open (control)");
  times = null; await ctx.close();
} catch (e) { note(`STOPPED: ${e.message}`); process.exitCode = 2; }
finally {
  writeFileSync(join(out, "_log-probe.txt"), log.join("\n") + `\n\nBLOCKED:\n${JSON.stringify(blocked)}\n\nLEAK CHECK:\n${leaked.join("\n") || "none"}`);
  await browser.close();
}
