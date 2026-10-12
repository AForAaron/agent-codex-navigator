import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const output = await build({
  entryPoints: ["packages/plugin/src/ui/usage-placement.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { computeUsagePlacement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const rail = { left: 0, top: 44, right: 52, bottom: 897, width: 52, height: 853 };
const indicator = { width: 36, height: 132 };

test("native footer buttons push the quota display upward", () => {
  const profileOnly = { left: 8, top: 857, right: 44, bottom: 893, width: 36, height: 36 };
  const withUpdate = { ...profileOnly, top: 813, height: 80 };
  assert.deepEqual(computeUsagePlacement(rail, profileOnly, indicator, 308), { left: 8, top: 713 });
  assert.deepEqual(computeUsagePlacement(rail, withUpdate, indicator, 308), { left: 8, top: 669 });
});

test("hides when the native rail cannot fit the display without covering controls", () => {
  const footer = { left: 8, top: 813, right: 44, bottom: 893, width: 36, height: 80 };
  assert.equal(computeUsagePlacement(rail, footer, indicator, 705), null);
  assert.equal(computeUsagePlacement({ ...rail, top: 720 }, footer, indicator, null), null);
  assert.equal(computeUsagePlacement(rail, { ...footer, bottom: 850 }, indicator, null), null);
});
