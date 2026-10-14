import { parseProtectionEvidence } from "./protection-evidence.ts";
import type { ProtectionEvidence } from "../../core/src/protection/controller.ts";
import { parseNativeRateLimits } from "../../core/src/quota/native-rate-limits.ts";
import type { UsageIndicatorState } from "./ui/usage-indicator.ts";

type NativeQuery = {
  queryKey: unknown[];
  getObserversCount(): number;
  fetch?: () => Promise<unknown>;
  state: { status: string; data: unknown; dataUpdatedAt: number };
};
type NativeCache = {
  getAll(): NativeQuery[];
  subscribe(listener: (event: { query?: NativeQuery }) => void): () => void;
};
type Fiber = { return?: Fiber; memoizedProps?: { value?: { getQueryCache?: () => NativeCache; getQueryData?: unknown; userId?: unknown; accountId?: unknown } } };
export type NativeUsageStatus = { source: "native-cache"; attached: boolean; state: "loading" | "ready" | "unavailable"; updatedAt: number | null };

function findContext(doc: Document): { nav: HTMLElement; cache: NativeCache; identity?: { user: string; account: string } } | null {
  const nav = [...doc.querySelectorAll<HTMLElement>("nav[data-app-navigation-rail]")]
    .find(node => node.getBoundingClientRect().width > 0);
  if (!nav) return null;
  const key = Object.keys(nav).find(name => name.startsWith("__reactFiber$"));
  let fiber: Fiber | undefined = key ? (nav as unknown as Record<string, Fiber>)[key] : undefined;
  let identity: { user: string; account: string } | undefined;
  for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return) {
    const client = fiber.memoizedProps?.value;
    if (typeof client?.userId === "string" && client.userId && typeof client.accountId === "string") {
      identity = { user: client.userId, account: client.accountId };
    }
    if (typeof client?.getQueryCache !== "function" || typeof client?.getQueryData !== "function") continue;
    try {
      const cache = client.getQueryCache();
      if (typeof cache?.getAll === "function" && typeof cache?.subscribe === "function") return { nav, cache, identity };
    } catch { return null; }
  }
  return null;
}

function quotaQuery(query: NativeQuery): boolean {
  return !!query && Array.isArray(query.queryKey) && query.queryKey[0] === "rate-limit-status"
    && (query.queryKey.length === 1 || query.queryKey.length === 3);
}

/** Subscribe to existing host state. Never fetch, invalidate or write host queries. */
export function startNativeUsageController(setState: (state: UsageIndicatorState) => void, doc: Document = document, onEvidence?: (evidence: ProtectionEvidence | null) => void) {
  const view = doc.defaultView!;
  let context: ReturnType<typeof findContext> = null;
  let unsubscribe: (() => void) | null = null;
  let frame = 0;
  let active = true;
  let lastPublished = "";
  let status: NativeUsageStatus = { source: "native-cache", attached: false, state: "loading", updatedAt: null };
  const publish = (state: UsageIndicatorState) => {
    status = { source: "native-cache", attached: context !== null, state: state.kind,
      updatedAt: state.kind === "ready" ? state.updatedAt : null };
    const signature = JSON.stringify(state);
    if (state.kind !== "ready") onEvidence?.(null);
    if (signature === lastPublished) return;
    lastPublished = signature;
    setState(state);
  };
  const sync = () => {
    if (!active || !context) return;
    let queries: NativeQuery[];
    try {
      queries = context.cache.getAll().filter(query => quotaQuery(query)
        && typeof query.getObserversCount === "function" && query.getObserversCount() > 0);
    } catch {
      publish({ kind: "unavailable", reason: "原生额度缓存接口失效。" });
      return;
    }
    // Do not guess among account caches or take an image-generation-specific query.
    if (queries.length !== 1) {
      publish({ kind: "unavailable", reason: "无法确认当前账户的原生额度状态。" });
      return;
    }
    const query = queries[0];
    if (query.state?.status === "pending") { publish({ kind: "loading" }); return; }
    if (query.state?.status !== "success") {
      publish({ kind: "unavailable", reason: "原生额度读取失败，等待原生连接恢复。" });
      return;
    }
    const snapshot = query.state.data as Record<string, unknown> | null;
    if (query.queryKey.length === 3 && (!snapshot || snapshot.user_id !== query.queryKey[1]
      || snapshot.account_id !== query.queryKey[2] && snapshot.account_id !== "")) {
      publish({ kind: "unavailable", reason: "原生额度账户身份不匹配。" });
      return;
    }
    if (context.identity && (snapshot?.user_id !== context.identity.user
      || snapshot?.account_id && snapshot.account_id !== context.identity.account
      || query.queryKey.length === 3 && query.queryKey[2] !== context.identity.account)) {
      publish({ kind: "unavailable", reason: "账号已切换，等待新账号额度数据。" });
      return;
    }
    const limits = parseNativeRateLimits(snapshot);
    if (!limits || !Number.isFinite(query.state.dataUpdatedAt) || query.state.dataUpdatedAt <= 0) {
      publish({ kind: "unavailable", reason: "原生额度数据格式不兼容。" });
      return;
    }
        const identity = query.queryKey.length === 3 && typeof query.queryKey[1] === "string" && typeof query.queryKey[2] === "string"
      ? { user: query.queryKey[1], account: query.queryKey[2] } : context.identity;
    // The legacy bucket must include its actual account identity; empty is ambiguous.
    onEvidence?.((!identity && !snapshot?.account_id) || identity && snapshot?.user_id !== identity.user ? null
      : parseProtectionEvidence(snapshot, query.state.dataUpdatedAt, identity));
    publish({ kind: "ready", limits, updatedAt: query.state.dataUpdatedAt, source: "native-cache" });
  };
  const bind = () => {
    if (!active) return;
    const next = findContext(doc);
    if (next?.cache !== context?.cache) {
      unsubscribe?.();
      unsubscribe = null;
      context = next;
      if (context) {
        try {
          unsubscribe = context.cache.subscribe(event => {
            if (active && event.query && quotaQuery(event.query)) bind();
          });
        } catch { context = null; }
      }
    } else context = next;
    if (context) sync();
    else publish({ kind: "unavailable", reason: "没有可验证的原生额度缓存，已停止额度同步。" });
  };
  const scheduleBind = () => {
    if (!frame) frame = view.requestAnimationFrame(() => { frame = 0; bind(); });
  };
  const observer = new MutationObserver(() => {
    if (!context?.nav.isConnected) scheduleBind();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const onVisibility = () => { if (doc.visibilityState === "visible") bind(); };
  doc.addEventListener("visibilitychange", onVisibility);
  view.addEventListener("focus", bind);
  bind();
  return {
    getStatus: () => ({ ...status }),
    requestRefresh: async () => {
      const queries = context?.cache.getAll().filter(query => quotaQuery(query) && query.getObserversCount() > 0) ?? [];
      if (queries.length !== 1 || typeof queries[0].fetch !== "function") throw new Error("Native quota refresh unavailable");
      // One confirmation at the expected deadline, using the host's original query.
      await queries[0].fetch!();
    },
    dispose: () => {
      active = false;
      unsubscribe?.();
      observer.disconnect();
      view.cancelAnimationFrame(frame);
      doc.removeEventListener("visibilitychange", onVisibility);
      view.removeEventListener("focus", bind);
      context = null;
    },
  };
}
