// r8 probe 2: which action fires setOwnResourceProgressStatus. Same guard; screenshots go to the scratch dir only.
import { guarded, browser, W, blocked, leaked } from "./r8-lib.mjs";
const scratch = process.argv[2];
let times = null, t0 = 0; const note = s => console.log(s);
const report = (label) => { const g = times.slice(1).map((t, k) => t - times[k]); const s = [...g].sort((a, b) => a - b);
  note(`${label}: ${times.length} calls in ${Math.round((Date.now() - t0) / 1000)}s; first at +${times[0] ?? "-"}ms; median gap ${s[Math.floor(s.length / 2)] ?? "-"}ms; min ${s[0] ?? "-"}; max ${s.at(-1) ?? "-"}; first 20 at ${JSON.stringify(times.slice(0, 20))}`); };
const phase = async (label, fn, wait = 20000) => { times = []; t0 = Date.now(); await fn(); await new Promise(r => setTimeout(r, wait)); report(label); };
for (const [vp, size] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
  const { ctx, p } = await guarded(size);
  await ctx.route(/\/api\/mutation/, r => { if (times && (r.request().postData() || "").includes("setOwnResourceProgressStatus")) times.push(Date.now() - t0); return r.fallback(); });
  const layout = "classroom";
  await p.goto(`${W}/c/ai-employee-builders/resources?layout=${layout}`, { waitUntil: "domcontentloaded" }); await p.locator(".resource-course-card").first().waitFor({ timeout: 90000 }); await p.waitForTimeout(3000);
  await phase(`${vp} open Business X-Ray card`, () => p.locator(".resource-course-card").nth(6).click({ position: { x: 60, y: 60 } }));
  await phase(`${vp} viewport screenshot`, () => p.screenshot({ path: `${scratch}/p2-${vp}-a.png` }), 10000);
  await phase(`${vp} scroll content to middle`, () => p.evaluate(() => { const els = [...document.querySelectorAll("*")].filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 200 && e.getBoundingClientRect().width > 300); const s = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (s) s.scrollTop = (s.scrollHeight - s.clientHeight) / 2; }));
  await phase(`${vp} scroll content to bottom`, () => p.evaluate(() => { const els = [...document.querySelectorAll("*")].filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 200 && e.getBoundingClientRect().width > 300); const s = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (s) s.scrollTop = s.scrollHeight; }));
  await phase(`${vp} full-page screenshot`, () => p.screenshot({ path: `${scratch}/p2-${vp}-b.png`, fullPage: true }), 10000);
  await phase(`${vp} mouse move to bottom-left`, () => p.mouse.move(2, size.height - 2), 10000);
  await ctx.close();
}
note(`BLOCKED ${JSON.stringify(blocked)} LEAKS ${leaked.length}`);
await browser.close();
