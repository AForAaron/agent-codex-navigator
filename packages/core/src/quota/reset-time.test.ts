import assert from "node:assert/strict";
import test from "node:test";
import { formatQuotaReset, formatQuotaCountdown } from "./reset-time.js";

test("host timestamps preserve date, local time and year rollover", () => {
  const time = Date.parse("2026-12-31T16:05:00Z");
  const label = formatQuotaReset(time, time - 1000, "Asia/Shanghai");
  assert.equal(label.date, "1/1");
  assert.equal(label.time, "00:05");
  assert.equal(label.dateTime, "2026-12-31T16:05:00.000Z");
  assert.match(label.accessible, /2027年1月1日/);
  assert.equal(formatQuotaReset(time, time - 1000, "America/Los_Angeles").date, "12/31");
  assert.equal(formatQuotaReset(time, time - 1000, "America/Los_Angeles").time, "08:05");
});

test("missing and elapsed host times do not invent a reset or refill quota", () => {
  for (const value of [null, NaN, Infinity, 0, -1, 1e20]) {
    assert.equal(formatQuotaReset(value, 1000).kind, "unknown");
    assert.equal(formatQuotaReset(value, 1000).time, null);
  }
  assert.equal(formatQuotaReset(1000, 1000).kind, "due");
  assert.equal(formatQuotaReset(1000, 1001).date, "待更新");
});


test("five-hour countdown rounds upward to minutes without showing a date", () => {
  assert.equal(formatQuotaCountdown(60001, 1).date, "剩1分");
  assert.equal(formatQuotaCountdown(60002, 1).date, "剩2分");
  assert.equal(formatQuotaCountdown(18000001, 1).date, "剩300分");
  assert.equal(formatQuotaCountdown(60001, 1).time, null);
  assert.equal(formatQuotaCountdown(60001, 60001).date, "待更新");
  assert.equal(formatQuotaCountdown(null, 1).date, "未提供");
});
