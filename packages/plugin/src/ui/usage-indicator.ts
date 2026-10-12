import { codexUsageWindows, type CodexRateLimits } from "../../../core/src/quota/codex-rate-limits.ts";
import { formatQuotaReset, formatQuotaCountdown } from "../../../core/src/quota/reset-time.ts";

/** Passive quota readings and their native reset timestamps. */
export const USAGE_INDICATOR_CSS = `
.cn-usage {
  width: 36px;
  height: 132px;
  display: grid;
  align-content: center;
  gap: 6px;
  color: #f1f1f3;
  font: 650 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}
.cn-usage-row { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.cn-usage-label { color: #b9b9bd; font-size: 9px; font-weight: 500; }
.cn-usage-reset { display: flex; flex-direction: column; align-items: center; color: #b9b9bd; font: 500 9px/11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.cn-usage-reset[hidden], .cn-usage-reset-time[hidden] { display: none; }
.cn-usage-value[data-quota="true"][data-low="false"] { color: #75d8ef; }
.cn-usage-value[data-low="true"] { color: #ffb6a9; }
@media (prefers-color-scheme: light) {
  .cn-usage { color: #25252a; }
  .cn-usage-label, .cn-usage-reset { color: #5b5b62; }
  .cn-usage-value[data-quota="true"][data-low="false"] { color: #006d85; }
  .cn-usage-value[data-low="true"] { color: #a52716; }
}
`;

export type UsageIndicatorState =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; limits: CodexRateLimits; updatedAt: number; source?: "native-cache" };

export function createUsageIndicator(doc: Document = document): {
  root: HTMLOutputElement;
  setState: (state: UsageIndicatorState) => void;
  dispose: () => void;
} {
  const root = doc.createElement("output");
  root.className = "cn-usage";
  const fiveHour = doc.createElement("span");
  const weekly = doc.createElement("span");
  const resetCredits = doc.createElement("span");
  for (const [row, label] of [[fiveHour, "5h"], [weekly, "周"], [resetCredits, "可重置"]] as const) {
    row.className = "cn-usage-row";
    const labelNode = doc.createElement("span");
    labelNode.className = "cn-usage-label";
    labelNode.textContent = label;
    const valueNode = doc.createElement("span");
    valueNode.className = "cn-usage-value";
    if (row !== resetCredits) valueNode.dataset.quota = "true";
    row.append(labelNode, valueNode);
  }
  const timeNodes = new Map<HTMLElement, { container: HTMLElement; date: HTMLElement; clock: HTMLTimeElement }>();
  for (const [row, windowName] of [[fiveHour, "five-hour"], [weekly, "weekly"]] as const) {
    const container = doc.createElement("span");
    container.className = "cn-usage-reset";
    container.dataset.resetWindow = windowName;
    const date = doc.createElement("span");
    date.className = "cn-usage-reset-date";
    const clock = doc.createElement("time");
    clock.className = "cn-usage-reset-time";
    container.append(date, clock);
    row.append(container);
    timeNodes.set(row, { container, date, clock });
  }
  root.append(fiveHour, weekly, resetCredits);
  let expiryTimer = 0;
  let resetTimer = 0;
  let lastUpdatedAt: number | null = null;
  let currentState: UsageIndicatorState = { kind: "loading" };
  let disposed = false;
  const view = doc.defaultView;
  const setValue = (row: HTMLElement, value: string | null, low = false) => {
    const target = row.querySelector<HTMLElement>(".cn-usage-value")!;
    target.textContent = value ?? "—";
    if (value === null) target.removeAttribute("data-low");
    else target.dataset.low = String(low);
  };
  const setReset = (row: HTMLElement, resetsAt: number | null, now: number) => {
    const nodes = timeNodes.get(row)!;
    const label = row === fiveHour ? formatQuotaCountdown(resetsAt, now) : formatQuotaReset(resetsAt, now);
    nodes.container.hidden = false;
    nodes.container.dataset.state = label.kind;
    nodes.container.setAttribute("aria-label", label.accessible);
    nodes.date.textContent = label.date;
    nodes.clock.textContent = label.time ?? "";
    nodes.clock.hidden = label.time === null;
    if (label.dateTime) nodes.clock.dateTime = label.dateTime;
    else nodes.clock.removeAttribute("datetime");
    return label.accessible;
  };
  const setState = (state: UsageIndicatorState) => {
    if (disposed) return;
    currentState = state;
    root.dataset.state = state.kind;
    view?.clearTimeout(expiryTimer);
    view?.clearTimeout(resetTimer);
    expiryTimer = resetTimer = 0;
    lastUpdatedAt = null;
    if (state.kind !== "ready") {
      delete root.dataset.updatedAt;
      setValue(fiveHour, null);
      setValue(weekly, null);
      setValue(resetCredits, null);
      for (const nodes of timeNodes.values()) {
        nodes.container.hidden = true;
        nodes.clock.removeAttribute("datetime");
      }
      root.setAttribute("aria-label", state.kind === "loading" ? "Codex 额度读取中" : `Codex 额度不可用：${state.reason}`);
      return;
    }
    const now = Date.now();
    if (!Number.isFinite(state.updatedAt) || state.source !== "native-cache" && now - state.updatedAt >= 150_000) {
      setState({ kind: "unavailable", reason: "额度数据已过期，正在等待更新。" });
      return;
    }
    root.dataset.source = state.source ?? "external";
    if (state.source !== "native-cache") {
      lastUpdatedAt = state.updatedAt;
      expiryTimer = view?.setTimeout(() => setState({ kind: "unavailable", reason: "额度数据已过期，正在等待更新。" }),
        Math.max(0, state.updatedAt + 150_000 - now)) ?? 0;
    }
    root.dataset.updatedAt = String(state.updatedAt);
    const windows = codexUsageWindows(state.limits);
    const fiveHourPercent = windows.fiveHour ? Math.round(windows.fiveHour.remainingPercent) : null;
    const weeklyPercent = windows.weekly ? Math.round(windows.weekly.remainingPercent) : null;
    setValue(fiveHour, fiveHourPercent === null ? null : `${fiveHourPercent}%`, fiveHourPercent !== null && fiveHourPercent <= 20);
    setValue(weekly, weeklyPercent === null ? null : `${weeklyPercent}%`, weeklyPercent !== null && weeklyPercent <= 20);
    const resetCount = state.limits.resetCreditsAvailable;
    setValue(resetCredits, resetCount === null ? null : `${resetCount}次`);
    const fiveHourReset = setReset(fiveHour, windows.fiveHour?.resetsAt ?? null, now);
    const weeklyReset = setReset(weekly, windows.weekly?.resetsAt ?? null, now);
    root.setAttribute("aria-label", `Codex 五小时剩余 ${fiveHourPercent === null ? "不可用" : `${fiveHourPercent}%`}，${fiveHourReset}；每周剩余 ${weeklyPercent === null ? "不可用" : `${weeklyPercent}%`}，${weeklyReset}；可用手动重置 ${resetCount === null ? "不可用" : `${resetCount}次`}`);
    const future = [windows.fiveHour?.resetsAt, windows.weekly?.resetsAt]
      .filter((time): time is number => typeof time === "number" && Number.isFinite(time) && time > now);
    if (future.length) {
      // Refresh the countdown only at its next minute boundary; no network request.
      const fiveHourDelta = (windows.fiveHour?.resetsAt ?? 0) - now;
      const nextMinute = fiveHourDelta > 0 ? (fiveHourDelta % 60_000 || 60_000) + 1 : Infinity;
      const delay = Math.min(Math.min(...future) - now + 1, nextMinute, 2_147_483_647);
      resetTimer = view?.setTimeout(() => setState(currentState), delay) ?? 0;
    }
  };
  const checkFreshness = () => {
    if (lastUpdatedAt !== null && Date.now() - lastUpdatedAt >= 150_000) {
      setState({ kind: "unavailable", reason: "额度数据已过期，正在等待更新。" });
    } else if (currentState.kind === "ready") setState(currentState);
  };
  doc.addEventListener("visibilitychange", checkFreshness);
  view?.addEventListener("focus", checkFreshness);
  setState({ kind: "loading" });
  return { root, setState, dispose: () => {
    disposed = true;
    view?.clearTimeout(expiryTimer);
    view?.clearTimeout(resetTimer);
    doc.removeEventListener("visibilitychange", checkFreshness);
    view?.removeEventListener("focus", checkFreshness);
    root.remove();
  } };
}
