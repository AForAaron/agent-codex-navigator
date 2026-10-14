import type { ProtectionEvidence } from "../../core/src/protection/controller.ts";
import { createProtectionController } from "../../core/src/protection/controller.ts";
import { findNativeProtectionManager, createNativeProtectionHost } from "./native-protection-host.ts";
import { createCodexCurrentAdapter } from "../../core/src/adapters/codex-current.ts";
import { createExplodexAppServerClient } from "../../core/src/appserver/explodex-bridge.ts";
import { createUnavailableAppServerClient } from "../../core/src/appserver/client.ts";
import { createNavigatorPanel, NAVIGATOR_PANEL_CSS, type NavigatorPanelApi } from "./ui/navigator-panel.ts";
import { createUsageIndicator, USAGE_INDICATOR_CSS } from "./ui/usage-indicator.ts";
import { computeUsagePlacement } from "./ui/usage-placement.ts";
import { startNativeUsageController, type NativeUsageStatus } from "./native-usage-controller.ts";
import { startChatSession } from "./chat-session.ts";

const PLUGIN_ID = "codex-navigator";
const ENABLED_KEY = "explodex-codex-navigator";
const USAGE_ENABLED_KEY = "explodex-codex-usage-rail";

type ExplodexPluginApi = {
  pluginId: string;
  log: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void };
  mount: (zoneId: string, factory: (ctx: { mountPoint: HTMLElement }) => Node, opts?: { replace?: boolean }) => boolean;
  waitFor: (zoneId: string, cb: () => void) => () => void;
  registerOptions: (handlers: { render: (container: HTMLElement) => void }) => void;
  storage?: { persisted?: { get: (k: string, fb?: unknown) => unknown; set: (k: string, v: unknown) => void } };
  bridge?: { isAvailable: () => boolean; send: (type: string, payload?: Record<string, unknown>) => Promise<unknown>; rpc?: (method: string, params?: Record<string, unknown>) => Promise<unknown | null> };
  codex?: { getThreadConversation: (id: string) => { id: string } | null };
  components?: {
    checkboxField: (opts: { label: string; checked?: boolean; onChange?: (v: boolean) => void }) => HTMLElement;
    metaText: (text?: string) => HTMLElement;
  };
};

function readEnabled(api: ExplodexPluginApi): boolean {
  const stored = api.storage?.persisted?.get(ENABLED_KEY, { panelEnabled: false }) as { panelEnabled?: boolean } | undefined;
  return stored?.panelEnabled === true;
}

function writeEnabled(api: ExplodexPluginApi, panelEnabled: boolean): void {
  api.storage?.persisted?.set(ENABLED_KEY, { panelEnabled });
}

function readUsageEnabled(api: ExplodexPluginApi): boolean {
  return api.storage?.persisted?.get(USAGE_ENABLED_KEY, false) === true;
}

function writeUsageEnabled(api: ExplodexPluginApi, enabled: boolean): void {
  api.storage?.persisted?.set(USAGE_ENABLED_KEY, enabled);
}

function ensureStyle(): void {
  const id = "codex-navigator-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = NAVIGATOR_PANEL_CSS;
  document.documentElement.append(style);
}

function attachPanel(api: ExplodexPluginApi, panel: NavigatorPanelApi): () => void {
  ensureStyle();
  const mounted = api.mount(
    "statusOverlay",
    () => panel.root,
    { replace: true },
  );
  if (!mounted) {
    document.body.append(panel.root);
  }
  return () => {
    panel.root.remove();
    document.getElementById("codex-navigator-style")?.remove();
  };
}

async function refreshFromAdapter(panel: NavigatorPanelApi): Promise<void> {
  const adapter = createCodexCurrentAdapter(document, window.location); // lockGate default "desktop" → lockViewport no-op
  const thread = adapter.getCurrentThreadId();
  panel.setThreadId(thread.ok ? thread.value : null);
  const prompts = await adapter.listUserPrompts();
  if (!prompts.ok) {
    panel.setPrompts([], prompts.message);
    panel.setStatus(`${prompts.code}: ${prompts.message}`);
    return;
  }
  panel.setPrompts(prompts.value.map((row) => ({ title: row.title, turnId: row.turnId })));
  panel.setStatus(`adapter scanned ${prompts.value.length} prompt node(s)`);
}

/**
 * Phase 0 default: register + options only. No DOM until the user enables the panel.
 * Prompt jump uses CodexCurrentAdapter, never a fake list.
 */
function setup(api: ExplodexPluginApi): () => void {
  const teardowns: Array<() => void> = [];
  let panelApi: NavigatorPanelApi | null = null;
  let panelTeardown: (() => void) | null = null;
  let usageTeardown: (() => void) | null = null;
  const sessionUsage = (window as Window & { __CODEX_USAGE_RAIL_SESSION__?: boolean }).__CODEX_USAGE_RAIL_SESSION__ === true;

  const appserver = api.bridge
    ? createExplodexAppServerClient({ bridge: api.bridge, codex: api.codex })
    : createUnavailableAppServerClient();

  api.log.info("registered (inert until panelEnabled)", {
    appserverKind: appserver.kind,
    appserverAvailable: appserver.isAvailable(),
  });

  const hidePanel = () => {
    panelTeardown?.();
    panelTeardown = null;
    panelApi = null;
  };

  const showPanel = () => {
    if (panelApi) return;
    const restoreUsage = usageTeardown !== null;
    if (restoreUsage) hideUsage();
    panelApi = createNavigatorPanel({
      enabled: true,
      onToggleEnabled: (enabled) => {
        writeEnabled(api, enabled);
        if (!enabled) hidePanel();
      },
      onJumpLatest: () => {
        const adapter = createCodexCurrentAdapter(document, window.location); // desktop default: lockViewport no-op
        void adapter.listUserPrompts().then(() => {
          const result = adapter.jumpToLatest();
          panelApi?.setStatus(result.ok ? "jumped to latest scanned prompt" : `${result.code}: ${result.message}`);
        });
      },
      onRefresh: () => {
        if (panelApi) void refreshFromAdapter(panelApi);
      },
      onCollapse: hidePanel,
    });
    panelTeardown = attachPanel(api, panelApi);
    void refreshFromAdapter(panelApi);
    void appserver.getCurrentThreadId().then((cap) => {
      if (!panelApi) return;
      if (!cap.ok) panelApi.setStatus(`AppServer: ${cap.code} — ${cap.message}`);
    });
    if (restoreUsage) showUsage();
  };

  const hideUsage = () => {
    usageTeardown?.();
    usageTeardown = null;
  };

  const showUsage = () => {
    if (usageTeardown) return;
    // Requested preference is not authorization after restart or account changes.
    const modeKey = "explodex-codex-protection-requested";
    let protection: ReturnType<typeof createProtectionController> | null = null;
    let releaseLeadership: (() => void) | null = null;
    let modeEpoch = 0;
    let controlDisposed = false;
    const indicator = createUsageIndicator(document, {
      initialMode: "native", // New controller requires a new explicit activation.
      onModeChange: mode => {
        api.storage?.persisted?.set(modeKey, mode === "protected");
        confirmationReset = 0;
        window.clearTimeout(confirmationTimer);
        const epoch = ++modeEpoch;
        protection?.setEnabled(false);
        releaseLeadership?.(); releaseLeadership = null;
        if (mode === "native") return;
        if (!protection || !navigator.locks) {
          indicator.setProtectionStatus("unavailable", "本机管理器或跨窗口控制锁不可用。"); return;
        }
        indicator.setProtectionStatus("confirming", "正在取得本机唯一控制权。");
        void navigator.locks.request("cn-codex-quota-protection-local", { ifAvailable: true }, async lock => {
          if (controlDisposed || epoch !== modeEpoch) return;
          if (!lock) { indicator.setProtectionStatus("unavailable", "另一窗口已控制本机保护，请先在该窗口关闭。"); return; }
          protection!.setEnabled(true);
          await new Promise<void>(resolve => { releaseLeadership = resolve; });
          protection?.setEnabled(false);
        }).catch(() => indicator.setProtectionStatus("unavailable", "本机控制锁失效。"));
      },
    });
    const mounted = api.mount("statusOverlay", () => indicator.root);
    if (!mounted) {
      indicator.dispose();
      api.log.warn("usage rail not mounted: statusOverlay is unavailable");
      return;
    }
    const style = document.createElement("style");
    style.dataset.codexUsageRail = "true";
    style.textContent = `${USAGE_INDICATOR_CSS}\n.cn-usage { position: fixed; left: 0; top: 0; z-index: 2147483639; }\n@media (max-height: 540px) { .cn-usage { display: none; } }`;
    document.documentElement.append(style);
    // The native rail ends with a variable-height footer. Position above that
    // section so new update/profile controls push the quota display upward.
    let observedRail: HTMLElement | null = null;
    let observedFooter: HTMLElement | null = null;
    let placementFrame = 0;
    const queuePlacement = () => {
      if (placementFrame) return;
      placementFrame = window.requestAnimationFrame(() => {
        placementFrame = 0;
        const rail = [...document.querySelectorAll<HTMLElement>("nav[data-app-navigation-rail]")]
          .find((item) => item.getBoundingClientRect().width >= 44);
        const footer = rail?.lastElementChild;
        if (!rail || !(footer instanceof HTMLElement) || !footer.querySelector("button")) {
          indicator.root.style.visibility = "hidden";
          return;
        }
        if (rail !== observedRail || footer !== observedFooter) {
          resizeObserver.disconnect();
          mutationObserver.disconnect();
          resizeObserver.observe(indicator.root);
          resizeObserver.observe(rail);
          resizeObserver.observe(footer);
          mutationObserver.observe(rail, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
          observedRail = rail;
          observedFooter = footer;
        }
        const footerRect = footer.getBoundingClientRect();
        const lastNavigationControlBottom = [...rail.querySelectorAll<HTMLElement>("button, a, [role='button']")]
          .filter((item) => !footer.contains(item))
          .map((item) => item.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0 && rect.left < footerRect.right && rect.right > footerRect.left && rect.bottom <= footerRect.top)
          .reduce<number | null>((last, rect) => Math.max(last ?? -Infinity, rect.bottom), null);
        const position = computeUsagePlacement(rail.getBoundingClientRect(), footerRect,
          indicator.root.getBoundingClientRect(), lastNavigationControlBottom);
        if (!position) {
          indicator.root.style.visibility = "hidden";
          return;
        }
        indicator.root.style.left = `${position.left}px`;
        indicator.root.style.top = `${position.top}px`;
        indicator.root.style.visibility = "visible";
      });
    };
    const resizeObserver = new ResizeObserver(queuePlacement);
    const mutationObserver = new MutationObserver(queuePlacement);
    indicator.root.style.visibility = "hidden";
    queuePlacement();
    window.addEventListener("resize", queuePlacement);
    const placementTimer = window.setInterval(queuePlacement, 1500);
    const sessionWindow = window as Window & { __codexNavigatorGetUsageStatus?: () => NativeUsageStatus };
    let manager: ReturnType<typeof findNativeProtectionManager> = null;
    let latestEvidence: ProtectionEvidence | null = null;
    let managerAttempts = 0;
    let managerRetry = 0;
    let stopWatching: (() => void) | null = null;
    let evidenceExpiry = 0;
    let confirmationTimer = 0;
    let confirmationReset = 0;
    let currentReset = 0;
    const attachProtection = () => {
      if (controlDisposed || manager) return;
      manager = findNativeProtectionManager(document);
      if (!manager) {
        if (++managerAttempts < 6) managerRetry = window.setTimeout(attachProtection, 1500);
        return;
      }
      const adapter = createNativeProtectionHost(manager);
      protection = createProtectionController(adapter.host, (phase, reason) => {
        indicator.setProtectionStatus(phase, reason);
        if ((phase === "waiting" || phase === "confirming") && currentReset && confirmationReset !== currentReset) {
          confirmationReset = currentReset;
          window.clearTimeout(confirmationTimer);
          confirmationTimer = window.setTimeout(() => {
            if (!protection?.getStatus().enabled) return;
            void nativeUsage.requestRefresh().catch(() => indicator.setProtectionStatus("confirming", "原生刷新不可用，等待原生自动更新；不会提前接续。"));
          }, Math.min(2_147_483_647, Math.max(1, currentReset - Date.now() + 1000)));
        }
      });
      stopWatching = adapter.watch(protection.changed, protection.cancelTask);
      protection.update(latestEvidence);
    };
    const nativeUsage = startNativeUsageController(indicator.setState, document, evidence => {
      window.clearTimeout(evidenceExpiry);
      latestEvidence = evidence;
      currentReset = evidence?.resetAt ?? 0;
      const wasEnabled = protection?.getStatus().enabled;
      protection?.update(evidence);
      if (wasEnabled && !protection?.getStatus().enabled) { releaseLeadership?.(); releaseLeadership = null; }
      if (evidence) evidenceExpiry = window.setTimeout(() => protection?.changed(), Math.max(1, evidence.updatedAt + 120_001 - Date.now()));
    });
    attachProtection();
    const retryProtectionOnFocus = () => { if (!manager) { managerAttempts = 0; attachProtection(); } };
    window.addEventListener("focus", retryProtectionOnFocus);
    const protectionWindow = window as Window & { __codexNavigatorGetProtectionStatus?: () => unknown };
    protectionWindow.__codexNavigatorGetProtectionStatus = () => ({ ...protection?.getStatus(), coverage: "local-loaded-codex", managerAvailable: !!manager });
    sessionWindow.__codexNavigatorGetUsageStatus = nativeUsage.getStatus;
    usageTeardown = () => {
      delete sessionWindow.__codexNavigatorGetUsageStatus;
      delete protectionWindow.__codexNavigatorGetProtectionStatus;
      window.clearTimeout(evidenceExpiry);
      window.clearTimeout(confirmationTimer);
      window.clearTimeout(managerRetry);
      window.removeEventListener("focus", retryProtectionOnFocus);
      controlDisposed = true; modeEpoch++;
      releaseLeadership?.(); releaseLeadership = null;
      stopWatching?.();
      protection?.dispose();
      nativeUsage.dispose();
      window.cancelAnimationFrame(placementFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", queuePlacement);
      window.clearInterval(placementTimer);
      indicator.dispose();
      style.remove();
    };
  };

  if (readEnabled(api)) showPanel();
  if (sessionUsage || readUsageEnabled(api)) showUsage();

  api.registerOptions({
    render(container) {
      const box = api.components?.checkboxField
        ? api.components.checkboxField({
            label: "启用右侧 Navigator 面板（会向 statusOverlay 插入 DOM；默认关闭）",
            checked: readEnabled(api),
            onChange: (checked) => {
              writeEnabled(api, checked);
              if (checked) showPanel();
              else hidePanel();
            },
          })
        : (() => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = readEnabled(api);
            input.addEventListener("change", () => {
              writeEnabled(api, input.checked);
              if (input.checked) showPanel();
              else hidePanel();
            });
            label.append(input, " 启用右侧 Navigator 面板");
            return label;
          })();
      container.append(box);
      const usageBox = api.components?.checkboxField
        ? api.components.checkboxField({
            label: "实验性：在左侧窄栏头像上方显示 Codex 额度",
            checked: readUsageEnabled(api),
            onChange: (checked) => {
              writeUsageEnabled(api, checked);
              if (checked) showUsage();
              else hideUsage();
            },
          })
        : (() => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = readUsageEnabled(api);
            input.addEventListener("change", () => {
              writeUsageEnabled(api, input.checked);
              if (input.checked) showUsage();
              else hideUsage();
            });
            label.append(input, " 实验性：左侧窄栏 Codex 额度");
            return label;
          })();
      container.append(usageBox);
      const note = api.components?.metaText
        ? api.components.metaText(
            "Safe Mode: 直接打开 /Applications/ChatGPT.app，不要运行 explodex。本插件默认不改 Codex DOM。",
          )
        : Object.assign(document.createElement("p"), {
            textContent: "Safe Mode: 直接打开 /Applications/ChatGPT.app，不要运行 explodex。",
          });
      container.append(note);
    },
  });

  teardowns.push(hidePanel);
  teardowns.push(hideUsage);
  if ((window as Window & { __CODEX_CHAT_NAV_SESSION__?: boolean }).__CODEX_CHAT_NAV_SESSION__ === true) {
    teardowns.push(startChatSession());
  }
  return () => {
    for (const stop of teardowns) stop();
  };
}

const global = globalThis as unknown as {
  Explodex?: { plugins?: { register: (m: object, setup: (api: ExplodexPluginApi) => unknown) => unknown } };
};

if (global.Explodex?.plugins?.register) {
  global.Explodex.plugins.register({ id: PLUGIN_ID, name: "Codex Navigator", version: "0.1.0" }, setup);
}
