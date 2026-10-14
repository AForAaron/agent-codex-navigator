export type ProtectionMode = "native" | "protected";
export type ProtectionStatus = "protecting" | "partial" | "waiting" | "confirming" | "resuming" | "unavailable";

/** Mode preference is separate from verified runtime capability. No task commands here. */
export function createProtectionControl(doc: Document, options: {
  initialMode?: ProtectionMode;
  onModeChange?: (mode: ProtectionMode) => void;
} = {}) {
  const root = doc.createElement("div");
  root.className = "cn-protection";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "cn-protection-button";
  const status = doc.createElement("span");
  status.className = "cn-protection-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.id = `cn-protection-status-${Math.random().toString(36).slice(2)}`;
  button.setAttribute("aria-describedby", status.id);
  root.append(button, status);
  let mode = options.initialMode ?? "native";
  let runtime: ProtectionStatus = "unavailable";
  let disposed = false;
  let reason = "";
  const labels: Record<ProtectionStatus, string> = {
    protecting: "本机保护", partial: "部分\n保护", waiting: "已暂停\n等额度", confirming: "待确认\n恢复",
    resuming: "正在接续", unavailable: "保护\n不可用",
  };
  const render = () => {
    root.dataset.mode = mode;
    root.dataset.status = runtime;
    button.textContent = mode === "native" ? "原生" : "套餐\n保护";
    button.setAttribute("aria-pressed", String(mode === "protected"));
    const unavailable = reason || "任务停止与自动接续尚未接通；此选择不会停止任务，也不能阻止点数消耗。";
    button.setAttribute("aria-label", mode === "native" ? "原生模式，点击选择套餐保护" :
      `已选择套餐保护，${runtime === "unavailable" ? unavailable : labels[runtime].replace(/\n/g, "")} 点击切回原生模式`);
    button.title = mode === "native" ? "跟随原生，不自动停止。点击选择套餐保护。" :
      runtime === "unavailable" ? unavailable : `${reason ? reason + " " : ""}已选择套餐保护。点击关闭；关闭不会自动重启已停止任务。`;
    status.hidden = mode === "native";
    status.textContent = labels[runtime];
    status.dataset.kind = runtime;
    status.setAttribute("aria-label", reason || labels[runtime].replace(/\n/g, ""));
    status.title = reason || (runtime === "unavailable" ? unavailable : labels[runtime].replace(/\n/g, ""));
  };
  const toggle = () => {
    if (disposed) return;
    mode = mode === "native" ? "protected" : "native";
    render();
    options.onModeChange?.(mode);
  };
  button.addEventListener("click", toggle);
  render();
  return { root, getMode: () => mode, setStatus: (value: ProtectionStatus, detail = "") => {
    if (disposed) return;
    runtime = value; reason = detail; render();
  }, dispose: () => { disposed = true; button.removeEventListener("click", toggle); root.remove(); } };
}

export const PROTECTION_CONTROL_CSS = `
.cn-protection { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 4px; }
.cn-protection-button { width: 36px; height: 36px; box-sizing: border-box; border: 0; border-radius: 12.5px; padding: 0; background: transparent; color: #b9b9bd; font: 500 10px/12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: pre-line; cursor: pointer; pointer-events: auto; transition: background-color 150ms, color 150ms, transform 100ms; }
.cn-protection-button:hover { background: rgba(255,255,255,.08); color: #fcfcfc; }
.cn-protection-button:active { transform: scale(.96); background: rgba(255,255,255,.12); }
.cn-protection-button:focus-visible { outline: 2px solid #75d8ef; outline-offset: 2px; }
.cn-protection-button[aria-pressed="true"] { background: rgba(255,255,255,.10); color: #fcfcfc; }
.cn-protection-status { pointer-events: auto; color: #ffb6a9; font: 500 9px/11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; white-space: pre-line; }
.cn-protection-status[data-kind="partial"] { color: #e6c47f; }
.cn-protection-status[hidden] { display: none; }
@media(prefers-color-scheme: light) {
  .cn-protection-button { color: #5b5b62; }
  .cn-protection-button:hover { background: rgba(0,0,0,.06); color: #25252a; }
  .cn-protection-button:active, .cn-protection-button[aria-pressed="true"] { background: rgba(0,0,0,.09); color: #25252a; }
  .cn-protection-button:focus-visible { outline-color: #006d85; }
  .cn-protection-status { color: #a52716; }
  .cn-protection-status[data-kind="partial"] { color: #785500; }
}
@media(prefers-reduced-motion: reduce) { .cn-protection-button { transition: none; } .cn-protection-button:active { transform: none; } }
`;
