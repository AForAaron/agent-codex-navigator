/** Read-only presentation model for the documented account/rateLimits/read response. */
export interface QuotaWindow {
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimits {
  /** Native account-wide paid credit balance; absent means unavailable. */
  creditBalance?: string | null;
  primary: QuotaWindow | null;
  secondary: QuotaWindow | null;
  /** Optional count of currently available manual full-reset credits. */
  resetCreditsAvailable: number | null;
}

/** Identify the two displayed windows by duration, not API ordering. */
export function codexUsageWindows(limits: CodexRateLimits): { fiveHour: QuotaWindow | null; weekly: QuotaWindow | null } {
  const windows = [limits.primary, limits.secondary];
  return {
    fiveHour: windows.find((window) => window?.windowDurationMins === 300) ?? null,
    weekly: windows.find((window) => window?.windowDurationMins === 10080) ?? null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function windowFrom(value: unknown): QuotaWindow | null {
  const input = record(value);
  if (!input) return null;
  const used = input.usedPercent;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100) return null;
  const duration = input.windowDurationMins;
  const reset = input.resetsAt;
  return {
    remainingPercent: Math.round((100 - used) * 10) / 10,
    windowDurationMins: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
    resetsAt: typeof reset === "number" && Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
  };
}

/** Ignore unrelated rate-limit buckets; never present them as Codex quota. */
export function parseCodexRateLimits(response: unknown): CodexRateLimits | null {
  const envelope = record(response);
  const result = record(envelope?.result) ?? envelope;
  const buckets = record(result?.rateLimitsByLimitId);
  const candidate = record(buckets?.codex) ?? record(result?.rateLimits);
  if (!candidate || candidate.limitId !== "codex") return null;
  const primary = windowFrom(candidate.primary);
  const secondary = windowFrom(candidate.secondary);
  const count = record(result?.rateLimitResetCredits)?.availableCount;
  const resetCreditsAvailable = typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count : null;
  return primary || secondary ? { primary, secondary, resetCreditsAvailable } : null;
}

export function quotaWindowLabel(window: QuotaWindow): string {
  const minutes = window.windowDurationMins;
  if (minutes == null) return "额度窗口";
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}天额度`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}小时额度`;
  return `${minutes}分钟额度`;
}
