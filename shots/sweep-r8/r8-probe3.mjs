// r8 probe 3: progress-write timing when opening course 3 ("Your first skill", no progress rows). Same guard; no screenshots.
import { guarded, browser, W, blocked, leaked } from "./r8-lib.mjs";
let times = null, t0 = 0; const note = s => console.log(s);
const report = (label) => { const g = times.slice(1).map((t, k) => t - times[k]); const s = [...g].sort((a, b) => a - b);
  note(`${label}: ${times.length} calls in ${Math.round((Date.now() - t0) / 1000)}s; first at +${times[0] ?? "-"}ms; median gap ${s[Math.floor(s.length / 2)] ?? "-"}ms; min ${s[0] ?? "-"}; max ${s.at(-1) ?? "-"}; first 25 at ${JSON.stringify(times.slice(0, 25))}`); };
const { ctx, p } = await guarded({ width: 1440, height: 900 });
const bodies = new Set();
await ctx.route(/\/api\/mutation/, r => { const b = r.request().postData() || ""; if (times && b.includes("setOwnResourceProgressStatus")) { times.push(Date.now() - t0); bodies.add(b.replace(/"(token|auth)[^,}]*/g, "").slice(0, 300)); } return r.fallback(); });
await p.goto(`${W}/c/ai-employee-builders/resources?layout=channels`, { waitUntil: "domcontentloaded" }); await p.locator(".resource-course-card").first().waitFor({ timeout: 90000 }); await p.waitForTimeout(3000);
const name = (await p.locator(".resource-course-card").nth(2).innerText()).replace(/\s+/g, " ").slice(0, 40); note(`card #3: ${name}`);
times = []; t0 = Date.now(); await p.locator(".resource-course-card").nth(2).click({ position: { x: 60, y: 60 } }); await p.waitForTimeout(60000);
report("open course 3, stay 60s");
note(`distinct bodies (${bodies.size}): ${[...bodies].slice(0, 3).join(" || ")}`);
note(`h1/outline: ${(await p.locator(".resource-course-outline").first().innerText().catch(() => "")).split("\n").slice(0, 4).join(" | ")}`);
times = null; await ctx.close();
note(`BLOCKED ${JSON.stringify(blocked)} LEAKS ${leaked.length}`); await browser.close();
