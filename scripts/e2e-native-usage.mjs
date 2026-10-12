import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const output = await build({ stdin: { contents: `export { startNativeUsageController } from './packages/plugin/src/native-usage-controller.ts'; export { createUsageIndicator } from './packages/plugin/src/ui/usage-indicator.ts';`, resolveDir: process.cwd() },
  bundle: true, format: "iife", globalName: "NativeUsage", platform: "browser", write: false });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<body><nav data-app-navigation-rail style="width:52px;height:700px"></nav></body>');
  await page.clock.install();
  await page.addScriptTag({ content: output.outputFiles[0].text });
  await page.evaluate(() => {
    window.requests = 0;
    window.fetch = () => { requests++; throw Error("Unexpected network request"); };
    window.listeners = new Set();
    window.snapshot = (account, used) => ({ user_id: "user", account_id: account, rate_limit: {
      primary_window: { used_percent: 84, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 3600 }, secondary_window: { used_percent: used, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 6 * 86400 } },
      rate_limit_reset_credits: { available_count: 2 } });
    const main = { queryKey: ["rate-limit-status", "user", "account-a"], count: 1, getObserversCount() { return this.count; },
      state: { status: "success", data: snapshot("account-a", 99.6), dataUpdatedAt: Date.now() } };
    window.queries = [main, { ...main, queryKey: ["rate-limit-status", "image-generation", "other", 0] }];
    const cache = { getAll: () => queries, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
    window.emit = query => listeners.forEach(fn => fn({ query }));
    window.client = { getQueryCache: () => cache, getQueryData() {} };
    document.querySelector("nav").__reactFiber$fixture = { memoizedProps: { value: client } };
    window.widget = NativeUsage.createUsageIndicator(); document.body.append(widget.root);
    window.controller = NativeUsage.startNativeUsageController(widget.setState);
  });
  const values = () => page.locator(".cn-usage-value").allTextContents();
  assert.deepEqual(await values(), ["16%", "0%", "2次"]);
  const initialReset = await page.evaluate(() => new Date(queries[0].state.data.rate_limit.primary_window.reset_at * 1000).toISOString());
  assert.equal(await page.locator(".cn-usage-reset-time").first().getAttribute("datetime"), initialReset);
  await page.evaluate(() => { queries[0].state.data.rate_limit.primary_window.reset_at += 7200; emit(queries[0]); });
  assert.notEqual(await page.locator(".cn-usage-reset-time").first().getAttribute("datetime"), initialReset, "native reset changes must update without a network request");
  await page.clock.fastForward(8 * 60 * 60 * 1000);
  assert.deepEqual(await values(), ["16%", "0%", "2次"], "native cache is not expired by an unrelated local polling clock");
  await page.evaluate(() => {
    queries[0].count = 0;
    queries.push({ queryKey: ["rate-limit-status", "user", "account-b"], count: 1, getObserversCount() { return this.count; },
      state: { status: "pending", data: undefined, dataUpdatedAt: 0 } });
    emit(queries[2]);
  });
  assert.deepEqual(await values(), ["—", "—", "—"], "account switch must clear account-a");
  await page.evaluate(() => {
    queries[2].state = { status: "success", data: snapshot("account-b", 70), dataUpdatedAt: Date.now() };
    emit(queries[2]);
  });
  assert.deepEqual(await values(), ["16%", "30%", "2次"]);
  await page.evaluate(() => { queries[2].state.status = "error"; emit(queries[2]); });
  assert.deepEqual(await values(), ["—", "—", "—"]);
  await page.evaluate(() => { queries[2].state.status = "success"; emit(queries[2]); });
  assert.deepEqual(await values(), ["16%", "30%", "2次"]);
  await page.evaluate(() => {
    window.newListeners = new Set();
    const query = { queryKey: ["rate-limit-status"], getObserversCount: () => 1,
      state: { status: "success", data: snapshot("account-c", 40), dataUpdatedAt: Date.now() } };
    const cache = { getAll: () => [query], subscribe: fn => { newListeners.add(fn); return () => newListeners.delete(fn); } };
    const next = document.createElement("nav"); next.dataset.appNavigationRail = "true";
    next.style.cssText = "width:52px;height:700px";
    next.__reactFiber$fixture = { memoizedProps: { value: { getQueryCache: () => cache, getQueryData() {} } } };
    document.querySelector("nav").replaceWith(next);
  });
  await page.clock.runFor(50);
  assert.deepEqual(await values(), ["16%", "60%", "2次"], "replacement host cache must rebind");
  assert.equal(await page.evaluate(() => listeners.size), 0, "old cache listener must be removed");
  assert.equal(await page.evaluate(() => newListeners.size), 1);
  assert.equal(await page.evaluate(() => requests), 0);
  await page.evaluate(() => { controller.dispose(); widget.dispose(); });
  assert.equal(await page.evaluate(() => listeners.size), 0);
  assert.equal(await page.evaluate(() => newListeners.size), 0);
  assert.equal(await page.locator("output").count(), 0);
  await page.evaluate(() => {
    delete document.querySelector("nav").__reactFiber$fixture;
    window.stateWrites = 0;
    window.widget = NativeUsage.createUsageIndicator(); document.body.append(widget.root);
    window.controller = NativeUsage.startNativeUsageController(state => { stateWrites++; widget.setState(state); });
  });
  await page.clock.runFor(500);
  assert.equal(await page.evaluate(() => stateWrites), 1, "missing host cache must not cause a self-triggered DOM loop");
  await page.evaluate(() => { controller.dispose(); widget.dispose(); });
  console.log("PASS native quota events, fractional rounding, account switch, error recovery, no fetch and cleanup");
} finally { await browser.close(); }
