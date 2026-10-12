import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const output = await build({ stdin: { contents: `export { createUsageIndicator, USAGE_INDICATOR_CSS } from './packages/plugin/src/ui/usage-indicator.ts'; export { computeUsagePlacement } from './packages/plugin/src/ui/usage-placement.ts';`, resolveDir: process.cwd() }, bundle: true, format: "iife", globalName: "ResetUsage", platform: "browser", write: false });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 901 }, timezoneId: "Asia/Shanghai" });
  await page.clock.install({ time: new Date("2026-10-12T01:00:00Z") });
  await page.setContent(`<style>body{margin:0;background:#151515}nav{position:fixed;left:0;top:44px;bottom:4px;width:52px;background:#242424}.footer{position:absolute;left:8px;bottom:4px;width:36px;display:flex;flex-direction:column;gap:8px}.footer button{width:36px;height:36px;padding:0;border:0;border-radius:50%;color:white;background:#a879ef}.footer button:last-child{background:#14b8a6}@media(prefers-color-scheme:light){body{background:#fff}nav{background:#f5f5f7}}</style><nav><div class=footer><button>↓</button><button>AA</button></div></nav>`);
  await page.addScriptTag({ content: output.outputFiles[0].text });
  await page.evaluate(() => {
    const style = document.createElement("style"); style.textContent = ResetUsage.USAGE_INDICATOR_CSS; document.head.append(style);
    window.requests = 0; window.fetch = () => { requests++; throw Error("No quota network request expected"); };
    window.widget = ResetUsage.createUsageIndicator(); document.body.append(widget.root);
    window.data = { kind: "ready", source: "native-cache", updatedAt: Date.now(), limits: {
      primary: { remainingPercent: 91, windowDurationMins: 300, resetsAt: Date.parse("2026-10-12T01:58:24Z") },
      secondary: { remainingPercent: 96, windowDurationMins: 10080, resetsAt: Date.parse("2026-10-18T05:39:43Z") }, resetCreditsAvailable: 1 } };
    widget.setState(data);
    const position = ResetUsage.computeUsagePlacement(document.querySelector("nav").getBoundingClientRect(), document.querySelector(".footer").getBoundingClientRect(), widget.root.getBoundingClientRect(), 308);
    Object.assign(widget.root.style, { position: "fixed", left: position.left + "px", top: position.top + "px" });
  });
  assert.deepEqual(await page.locator(".cn-usage-reset-date").allTextContents(), ["剩59分", "10/18"]);
  assert.deepEqual(await page.locator(".cn-usage-reset-time").allTextContents(), ["", "13:39"]);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector(".cn-usage").getBoundingClientRect();
    const footer = document.querySelector(".footer").getBoundingClientRect();
    return { width: root.width, height: root.height, left: root.left, gap: footer.top - root.bottom,
      overflow: [...document.querySelectorAll(".cn-usage span,.cn-usage time")].some(n => { const r = n.getBoundingClientRect(); return r.width && (r.left < root.left - .5 || r.right > root.right + .5); }) };
  });
  assert.deepEqual(geometry, { width: 36, height: 132, left: 8, gap: 12, overflow: false });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: `/private/tmp/cn-reset-${theme}.png`, clip: { x: 0, y: 600, width: 52, height: 301 } });
  }
  await page.clock.fastForward(24001);
  assert.equal(await page.locator(".cn-usage-reset-date").first().textContent(), "剩58分", "countdown changes at its minute boundary without native events");
  assert.equal(await page.locator(".cn-usage-reset-time").first().isVisible(), false);
  assert.equal(await page.locator(".cn-usage-reset-time").nth(1).textContent(), "13:39");
  await page.clock.fastForward(3480000);
  assert.equal(await page.locator(".cn-usage-reset-date").first().textContent(), "待更新");
  assert.equal(await page.locator(".cn-usage-value").first().textContent(), "91%", "a local deadline cannot pretend quota was refilled");
  assert.equal(await page.locator(".cn-usage-reset-time").first().isVisible(), false);
  await page.evaluate(() => { data.limits.primary.resetsAt = Date.parse("2026-10-12T04:00:00Z"); data.updatedAt = Date.now(); widget.setState(data); });
  assert.equal(await page.locator(".cn-usage-reset-date").first().textContent(), "剩122分");
  await page.evaluate(() => { data.limits.secondary.resetsAt = null; widget.setState(data); });
  assert.equal(await page.locator(".cn-usage-reset-date").nth(1).textContent(), "未提供");
  assert.equal(await page.locator(".cn-usage-reset-time").nth(1).isVisible(), false);
  assert.match(await page.locator("output").getAttribute("aria-label"), /原生未提供重置时间/);
  await page.evaluate(() => widget.setState({ kind: "unavailable", reason: "native failure" }));
  assert.equal(await page.locator(".cn-usage-reset:visible").count(), 0);
  assert.equal(await page.evaluate(() => requests), 0);
  await page.evaluate(() => widget.dispose());
  await page.clock.fastForward(8 * 3600000);
  assert.equal(await page.locator("output").count(), 0);
  console.log("PASS native reset dates, time-zone display, deadline/no refill, missing data, 132px clearance, themes and disposal");
} finally { await browser.close(); }
