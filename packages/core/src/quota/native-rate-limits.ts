import type { CodexRateLimits, QuotaWindow } from "./codex-rate-limits.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function windowFrom(value: unknown): QuotaWindow | null {
  const input = record(value);
  const used = input?.used_percent;
  const seconds = input?.limit_window_seconds;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100
    || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const reset = input?.reset_at;
  return {
    // Keep full precision until the UI rounds, as the native menu does.
    remainingPercent: 100 - used,
    windowDurationMins: seconds / 60,
    resetsAt: typeof reset === "number" && Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
  };
}

/** Preserve decimal credit balances without guessing units or rounding. */
export function parseNativeCreditBalance(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? String(value) : null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  return value.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Read quota and account credit fields from the native usage snapshot. */
export function parseNativeRateLimits(snapshot: unknown): CodexRateLimits | null {
  const input = record(snapshot);
  const limits = record(input?.rate_limit);
  if (!limits) return null;
  const primary = windowFrom(limits.primary_window);
  const secondary = windowFrom(limits.secondary_window);
  const count = record(input?.rate_limit_reset_credits)?.available_count;
  if (!primary && !secondary) return null;
  return { primary, secondary, creditBalance: parseNativeCreditBalance(record(input?.credits)?.balance), resetCreditsAvailable:
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null };
}
