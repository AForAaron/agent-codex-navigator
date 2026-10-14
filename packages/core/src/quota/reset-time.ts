export interface QuotaResetLabel {
  kind: "scheduled" | "due" | "unknown";
  date: string;
  time: string | null;
  dateTime: string | null;
  accessible: string;
}

/** Absolute host reset timestamp, rendered in the device's local time zone. */
export function formatQuotaReset(resetsAt: number | null, now = Date.now(), timeZone?: string): QuotaResetLabel {
  if (resetsAt === null || !Number.isFinite(resetsAt) || resetsAt <= 0 || !Number.isFinite(new Date(resetsAt).getTime())) {
    return { kind: "unknown", date: "未提供", time: null, dateTime: null, accessible: "原生未提供重置时间" };
  }
  if (resetsAt <= now) {
    return { kind: "due", date: "待更新", time: null, dateTime: null, accessible: "重置时间已到，等待原生数据更新" };
  }
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(resetsAt);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const date = `${Number(part("month"))}/${Number(part("day"))}`;
  const time = `${part("hour")}:${part("minute")}`;
  return { kind: "scheduled", date, time, dateTime: new Date(resetsAt).toISOString(),
    accessible: `${part("year")}年${Number(part("month"))}月${Number(part("day"))}日 ${time}（本地时间）自动重置` };
}

/** Minute-precision countdown from the same absolute native reset timestamp. */
export function formatQuotaCountdown(resetsAt: number | null, now = Date.now()): QuotaResetLabel {
  if (resetsAt === null || !Number.isFinite(resetsAt) || resetsAt <= 0
    || !Number.isFinite(new Date(resetsAt).getTime()) || resetsAt <= now) {
    return formatQuotaReset(resetsAt, now);
  }
  const minutes = Math.ceil((resetsAt - now) / 60_000);
  // Local arithmetic only: no locale/date formatting is needed for a countdown.
  return { kind: "scheduled", date: `剩${minutes}分`, time: null,
    dateTime: new Date(resetsAt).toISOString(), accessible: `距离自动重置还有 ${minutes} 分钟` };
}
