export type ProtectionPhase = "protecting" | "partial" | "waiting" | "confirming" | "resuming" | "unavailable";
export interface ProtectionEvidence {
  account: string;
  updatedAt: number;
  resetAt: number;
  includedAvailable: boolean;
  exhausted: boolean;
  creditBalance: number | null;
  blockedModels?: string[];
}
export interface ProtectionTask {
  id: string;
  turnId: string | null;
  state: "active" | "interrupted" | "idle" | "blocked";
  kind?: "turn" | "goal";
  supported: boolean;
  revision: string;
  model?: string;
}
export interface ProtectionHost {
  list(): ProtectionTask[];
  interrupt(task: ProtectionTask): Promise<boolean>;
  resume(task: ProtectionTask): Promise<void>;
}
/** Event-driven controller: records only tasks it actually interrupted. */
export function createProtectionController(host: ProtectionHost, report: (phase: ProtectionPhase, reason: string) => void,
  now: () => number = Date.now) {
  let enabled = false, disposed = false, generation = 0, busy = false, queued = false;
  let account: string | null = null, evidence: ProtectionEvidence | null = null, previousBalance: number | null = null;
  let stoppedAt = 0, stopResetAt = 0, creditTrigger = false;
  const paused = new Map<string, ProtectionTask>();
  let failed = false;
  let cycleResumed = false;
  let completedCycles = 0;
  const valid = () => evidence !== null && now() >= evidence.updatedAt && now() - evidence.updatedAt <= 120_000;
  const phase = () => {
    if (!enabled || disposed) return;
    try {
    if (failed) report("unavailable", "原生任务控制失败，已停止自动接续。");
    else if (!valid()) report("unavailable", "等待当前账号的新额度数据。");
    else {
      const tasks = host.list().filter(t => t.state !== "idle");
      const supported = tasks.filter(t => t.supported).length;
      const excluded = tasks.length - supported;
      const coverage = `本机可控制 ${supported} 项，未纳入 ${excluded} 项；不覆盖其他设备、CLI、云端和子任务。`;
      if (paused.size || creditTrigger || evidence!.exhausted) report(now() >= evidence!.resetAt ? "confirming" : "waiting", `${coverage} 等待套餐恢复确认。`);
      else if (excluded) report("partial", coverage);
      else report("protecting", coverage);
    }
    } catch { failed = true; report("unavailable", "原生任务管理器已失效。"); }
  };
  const run = async () => {
    if (busy) { queued = true; return; }
    if (!enabled || disposed || failed || !valid()) { phase(); return; }
    busy = true;
    const epoch = generation, owner = account;
    const current = () => enabled && !disposed && !failed && generation === epoch && account === owner && valid();
    try {
      do {
        queued = false;
        if (!current()) break;
        if (creditTrigger && evidence!.includedAvailable && !evidence!.exhausted
          && evidence!.updatedAt > stoppedAt && evidence!.resetAt !== stopResetAt) creditTrigger = false;
        if (evidence!.exhausted || creditTrigger) {
          for (const task of host.list()) {
            if (!current() || !(evidence!.exhausted || creditTrigger)) break;
            if (!task.supported || task.state !== "active" || (paused.get(task.id)?.turnId === task.turnId && task.kind !== "goal")) continue;
            const saved = { ...task };
            const ok = await host.interrupt(saved);
            if (ok && current()) {
              paused.set(task.id, saved);
              stoppedAt = Math.max(stoppedAt, now());
              stopResetAt = evidence!.resetAt;
            }
          }
        } else if (paused.size && evidence!.includedAvailable && evidence!.updatedAt > stoppedAt) {
          for (const [id, saved] of paused) {
            if (!current() || !evidence!.includedAvailable || evidence!.exhausted) break;
            const task = host.list().find(t => t.id === id);
            if (evidence!.blockedModels?.includes(saved.model ?? "")) continue;
            paused.delete(id);
            if (!task || !task.supported || task.turnId !== saved.turnId || task.state !== "interrupted" || task.revision !== saved.revision || task.model !== saved.model) continue;
            report("resuming", "仅接续本功能暂停的本机任务。");
            await host.resume(saved);
            cycleResumed = true;
          }
        }
        if (current() && cycleResumed && paused.size === 0 && evidence!.includedAvailable && !evidence!.exhausted && !creditTrigger) {
          // Rearm for the next native window without switching off or releasing ownership.
          completedCycles++;
          cycleResumed = false;
          stoppedAt = 0;
          stopResetAt = 0;
          previousBalance = evidence!.creditBalance;
        }
      } while (queued && current());
    } catch { failed = true; }
    finally { busy = false; phase(); }
  };
  return {
    setEnabled(value: boolean) {
      if (disposed) return;
      cycleResumed = false; completedCycles = 0;
      enabled = value; generation++; paused.clear(); failed = false; creditTrigger = false;
      stoppedAt = 0; stopResetAt = 0; previousBalance = evidence?.creditBalance ?? null;
      if (enabled) void run();
    },
    update(next: ProtectionEvidence | null) {
      if (disposed) return;
      if (next && account !== next.account) {
        // Selection is not automatic authorization for a different account.
        if (account !== null) { enabled = false; report("unavailable", "账号已变化，请重新选择保护模式；旧账号任务不会自动接续。"); }
        cycleResumed = false; completedCycles = 0;
        generation++; paused.clear(); creditTrigger = false; previousBalance = null; failed = false;
        account = next.account;
      }
      if (next && evidence?.account === next.account && next.updatedAt < evidence.updatedAt) return;
      if (enabled && next && previousBalance !== null && next.creditBalance !== null && next.creditBalance < previousBalance) {
        creditTrigger = true; stoppedAt = now(); stopResetAt = next.resetAt;
      }
      evidence = next;
      if (next) previousBalance = next.creditBalance;
      void run();
    },
    changed: () => { void run(); },
    cancelTask: (id: string) => { paused.delete(id); },
    getStatus: () => ({ enabled, paused: paused.size, failed, completedCycles, accountKnown: account !== null }),
    dispose: () => { disposed = true; enabled = false; generation++; paused.clear(); },
  };
}
