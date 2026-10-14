import { createNativeChatHistoryProvider } from "./native-chat-history.ts";
import type { ChatHistoryCatalog } from "../../core/src/chat/history.ts";
/** Session-only ordinary Chat navigation. It never scans a hidden Codex transcript. */
const STORAGE_KEY = "codex-navigator-chat-reading-v1";
const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,img,table";
const ID_PATTERN = /^[a-zA-Z0-9:_-]{8,160}$/;

type Anchor = { conversationId: string; turnId: string; messageId: string; blockIndex: number; viewportOffset: number; savedAt: number };
export interface ChatHistoryProvider {
  getCatalog(conversationId: string): (ChatHistoryCatalog & { conversationId: string }) | null;
  reveal(conversationId: string, messageId: string, signal: AbortSignal): Promise<void>;
}

type Context = { scroll: HTMLElement; conversationId: string; turns: HTMLElement[] };

function visibleChat(): Context | null {
  const chatMode = [...document.querySelectorAll("button[aria-label]")]
    .some((button) => button.getAttribute("aria-label") === "切换模式，当前模式：ChatGPT");
  if (!chatMode) return null;
  for (const scroll of document.querySelectorAll<HTMLElement>(".thread-scroll-container")) {
    const rect = scroll.getBoundingClientRect();
    if (rect.width < 300 || rect.height < 200) continue;
    const conversationId = scroll.querySelector<HTMLElement>("[data-map-composer-conversation]")?.dataset.mapComposerConversation;
    if (!conversationId || !ID_PATTERN.test(conversationId)) continue;
    const turns = [...scroll.querySelectorAll<HTMLElement>("[data-turn-key]")]
      .filter((turn) => ID_PATTERN.test(turn.dataset.turnKey ?? "") && turn.querySelector("[data-user-message-bubble]"));
    return { scroll, conversationId, turns };
  }
  return null;
}

function messageId(element: HTMLElement): string | null {
  const raw = element.dataset.chatgptSearchMessageIds?.split(" ")[0];
  return raw && ID_PATTERN.test(raw) ? raw : null;
}

function blocks(message: HTMLElement): HTMLElement[] {
  const children = [...message.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].filter((node) => node.getBoundingClientRect().height > 0);
  return children.length ? children : [message];
}

function readAnchors(): Record<string, Anchor> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch { return {}; }
}

function saveAnchor(anchor: Anchor): void {
  try {
    const all = readAnchors();
    all[anchor.conversationId] = anchor;
    const entries = Object.entries(all).sort((a, b) => (b[1]?.savedAt ?? 0) - (a[1]?.savedAt ?? 0)).slice(0, 100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* Browsing works when storage is unavailable; cross-session restore does not. */ }
}

function capture(context: Context): Anchor | null {
  const viewport = context.scroll.getBoundingClientRect();
  const readingY = viewport.top + Math.min(140, viewport.height * 0.3);
  let best: { node: HTMLElement; message: HTMLElement; turn: HTMLElement; index: number; distance: number } | null = null;
  for (const turn of context.turns) {
    for (const message of turn.querySelectorAll<HTMLElement>("[data-chatgpt-search-message-ids]")) {
      if (!messageId(message)) continue;
      const candidates = blocks(message);
      candidates.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (!rect.height) return;
        const distance = rect.top <= readingY && rect.bottom >= readingY ? 0 : Math.min(Math.abs(rect.top - readingY), Math.abs(rect.bottom - readingY));
        if (!best || distance < best.distance) best = { node, message, turn, index, distance };
      });
    }
  }
  if (!best) return null;
  const choice = best as { node: HTMLElement; message: HTMLElement; turn: HTMLElement; index: number };
  const id = messageId(choice.message);
  if (!id) return null;
  return {
    conversationId: context.conversationId,
    turnId: choice.turn.dataset.turnKey ?? "",
    messageId: id,
    blockIndex: choice.index,
    viewportOffset: choice.node.getBoundingClientRect().top - viewport.top,
    savedAt: Date.now(),
  };
}

function anchorNode(context: Context, anchor: Anchor): HTMLElement | null {
  if (anchor.conversationId !== context.conversationId) return null;
  const turn = context.turns.find((item) => item.dataset.turnKey === anchor.turnId);
  if (!turn) return null;
  const message = [...turn.querySelectorAll<HTMLElement>("[data-chatgpt-search-message-ids]")]
    .find((item) => messageId(item) === anchor.messageId);
  if (!message) return turn;
  return blocks(message)[anchor.blockIndex] ?? message;
}

function scrollToOffset(context: Context, target: HTMLElement, viewportOffset: number): number {
  const top = target.getBoundingClientRect().top;
  const desired = context.scroll.getBoundingClientRect().top + viewportOffset;
  const delta = top - desired;
  if (Math.abs(delta) > 1) context.scroll.scrollTop += delta;
  return delta;
}

const CSS = `
.cn-chat-rail { position:absolute; left:16px; top:50%; transform:translateY(-50%); z-index:20; width:36px; max-height:min(70vh,40rem); overflow-y:auto; overscroll-behavior:contain; scrollbar-width:none; display:flex; flex-direction:column; color:var(--color-codex-description,#8e8e93); }
.cn-chat-rail-coverage { font: 9px/14px -apple-system,BlinkMacSystemFont,sans-serif; color:inherit; padding-top:4px; }
.cn-chat-rail::-webkit-scrollbar { display:none; }
.cn-chat-rail-tick { display:flex; align-items:center; width:36px; height:10px; min-height:10px; padding:0; border:0; background:transparent; cursor:pointer; color:inherit; outline:none; }
.cn-chat-rail-tick[data-active=true] { color:var(--color-text,currentColor); }
.cn-chat-rail-marker { display:flex; align-items:center; width:26px; height:2px; opacity:.4; }
.cn-chat-rail-tick[data-active=true] .cn-chat-rail-marker { opacity:.6; }
.cn-chat-rail-line { display:block; width:26px; height:2px; border-radius:2px; background:currentColor; transform:scaleX(var(--cn-progress,.2308)); transform-origin:left center; transition:transform 160ms cubic-bezier(.2,0,0,1),opacity 160ms; }
.cn-chat-rail-tick[data-cn-neighbor="0"] .cn-chat-rail-marker,.cn-chat-rail-tick:focus-visible .cn-chat-rail-marker { opacity:1; color:var(--color-text,currentColor); }
.cn-chat-rail-tick[data-cn-neighbor="0"] .cn-chat-rail-line,.cn-chat-rail-tick:focus-visible .cn-chat-rail-line { --cn-progress:1; }
.cn-chat-rail-tick[data-cn-neighbor="1"] .cn-chat-rail-line { --cn-progress:.7692; }
.cn-chat-rail-tick[data-cn-neighbor="2"] .cn-chat-rail-line { --cn-progress:.5385; }
.cn-chat-rail-tick[data-cn-neighbor="3"] .cn-chat-rail-line { --cn-progress:.3846; }
.cn-chat-rail-preview { position:absolute; left:52px; z-index:30; width:320px; max-width:calc(100vw - 64px); box-sizing:border-box; padding:8px; border:1px solid var(--color-border,#5555); border-radius:12px; background:var(--color-surface-elevated-secondary,#29292e); color:var(--color-text,#f5f5f5); box-shadow:0 12px 32px #0005; font:14px/20px -apple-system,BlinkMacSystemFont,sans-serif; pointer-events:none; }
.cn-chat-rail-preview[hidden] { display:none; }
.cn-chat-rail-preview-title { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cn-chat-rail-preview-answer { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; margin-top:4px; font-size:13px; line-height:19px; white-space:pre-wrap; }
@media (prefers-color-scheme:light) { .cn-chat-rail-preview { background:var(--color-surface-elevated-secondary,#fff); color:var(--color-text,#29292f); box-shadow:0 12px 32px #0003; } }
@media (prefers-reduced-motion:reduce) { .cn-chat-rail-line { transition:none; } }
`;

export function startChatSession(history: ChatHistoryProvider = createNativeChatHistoryProvider()): () => void {
  const runtime = window as Window & { __cnChatSessionStop?: () => void };
  runtime.__cnChatSessionStop?.();
  const style = document.createElement("style");
  style.dataset.cnChatRail = "true";
  style.textContent = CSS;
  document.documentElement.append(style);
  let current: Context | null = null;
  let rail: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let scrollTimer = 0;
  let generation = 0;
  let programmatic = false;
  let reading = false;
  let lastUserInput = 0;
  let lastAnchor: Anchor | null = null;
  let lastIds = "";
  let resizeObserver: ResizeObserver | null = null;
  let disposed = false;
  let previewTimer = 0;
  let jumpAbort: AbortController | null = null;
  let catalog: ChatHistoryCatalog | null = null;

  const removeRail = () => { window.clearTimeout(previewTimer); rail?.remove(); preview?.remove(); rail = null; preview = null; lastIds = ""; };
  const save = () => {
    if (!current || programmatic) return;
    const anchor = capture(current);
    if (anchor) { lastAnchor = anchor; saveAnchor(anchor); updateActive(anchor.turnId); }
  };
  const updateActive = (turnId: string) => {
    rail?.querySelectorAll<HTMLElement>("[data-cn-turn-id]").forEach((tick) => {
      const turn = current?.turns.find(node => node.dataset.turnKey === turnId);
      const matched = tick.dataset.cnTurnId === turnId || !!turn && [...turn.querySelectorAll<HTMLElement>("[data-chatgpt-search-message-ids]")]
        .some(node => node.dataset.chatgptSearchMessageIds?.split(" ").includes(tick.dataset.cnTurnId ?? ""));
      tick.dataset.active = String(matched);
      if (tick.dataset.active === "true") tick.setAttribute("aria-current", "true");
      else tick.removeAttribute("aria-current");
    });
    const active = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (active && rail && !rail.matches(":hover")) {
      const top = active.offsetTop;
      if (top < rail.scrollTop) rail.scrollTop = top;
      else if (top + active.offsetHeight > rail.scrollTop + rail.clientHeight) rail.scrollTop = top + active.offsetHeight - rail.clientHeight + 1;
    }
  };
  const onScroll = () => {
    if (programmatic || !current) return;
    reading = Math.abs(current.scroll.scrollTop) > 20;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(save, 180);
  };
  const onUserInput = () => { jumpAbort?.abort(); lastUserInput = performance.now(); if (programmatic) { generation++; programmatic = false; } };
  const onResize = () => {
    if (!current || !reading || programmatic || performance.now() - lastUserInput < 250 || !lastAnchor) return;
    const node = anchorNode(current, lastAnchor);
    if (node) scrollToOffset(current, node, lastAnchor.viewportOffset);
  };
  const detach = () => {
    if (current) current.scroll.removeEventListener("scroll", onScroll);
    resizeObserver?.disconnect(); resizeObserver = null;
    jumpAbort?.abort(); catalog = null;
    current = null; removeRail();
  };
  const findTarget = (context: Context, id: string): HTMLElement | null => {
    const direct = context.turns.find(item => item.dataset.turnKey === id);
    if (direct) return direct.querySelector<HTMLElement>("[data-user-message-bubble]") ?? direct;
    const message = [...context.scroll.querySelectorAll<HTMLElement>("[data-chatgpt-search-message-ids]")]
      .find(node => node.dataset.chatgptSearchMessageIds?.split(" ").includes(id) && node.querySelector("[data-user-message-bubble]"));
    return message?.querySelector<HTMLElement>("[data-user-message-bubble]") ?? null;
  };
  const jump = async (id: string) => {
    if (!current) return;
    jumpAbort?.abort(); const abort = new AbortController(); jumpAbort = abort;
    const context = current, token = ++generation;
    programmatic = true;
    try {
      let target = findTarget(context, id);
      if (!target && history) {
        const timeout = window.setTimeout(() => abort.abort(), 10000);
        try { await history.reveal(context.conversationId, id, abort.signal); }
        finally { window.clearTimeout(timeout); }
        target = findTarget(context, id);
      }
      if (abort.signal.aborted || token !== generation || current !== context || !context.scroll.isConnected) return;
      if (!target) { rail?.setAttribute("data-jump-error", "目标尚未加载，无法定位"); return; }
      context.turns = [...context.scroll.querySelectorAll<HTMLElement>("[data-turn-key]")].filter(turn=>!!turn.querySelector("[data-user-message-bubble]"));
      rail?.removeAttribute("data-jump-error");
      scrollToOffset(context, target, 82);
      requestAnimationFrame(() => {
        if (abort.signal.aborted || token !== generation || current !== context || !target?.isConnected) return;
        scrollToOffset(context, target, 82);
        programmatic = false; reading = true; save(); updateActive(id);
      });
    } catch { if (token === generation) { programmatic = false; rail?.setAttribute("data-jump-error", "历史定位失败，已停止跳转"); } }
    finally { if (token === generation && (!findTarget(context, id) || abort.signal.aborted)) programmatic = false; }
  };
  const render = () => {
    if (!current) return;
    let supplied: ReturnType<ChatHistoryProvider["getCatalog"]> = null;
    try { supplied = history?.getCatalog(current.conversationId); } catch { /* Fail closed to loaded-only coverage. */ }
    catalog = supplied?.conversationId === current.conversationId ? supplied : null;
    const entries = catalog?.entries ?? current.turns.map(turn => ({
      id: turn.dataset.turnKey ?? "",
      title: turn.querySelector<HTMLElement>("[data-user-message-bubble]")?.textContent ?? "",
      answer: [...turn.querySelectorAll<HTMLElement>("[data-chatgpt-search-message-ids]")]
        .find(message => !message.querySelector("[data-user-message-bubble]"))?.textContent ?? "",
    }));
    const complete = catalog?.complete === true;
    const signature = `${complete}:${catalog?.branchId ?? "dom"}:` + entries.map(entry => entry.id).join("|");
    if (signature === lastIds && rail) return;
    removeRail();
    lastIds = signature;
    // Codex's own floating question rail appears only once a thread has four prompts.
    if (entries.length < 4) return;
    const host = current.scroll.parentElement;
    if (!host || getComputedStyle(host).position === "static") return;
    const nav = document.createElement("nav");
    nav.className = "cn-chat-rail";
    nav.dataset.coverage = complete ? "complete" : "partial";
    nav.setAttribute("aria-label", `Chat ${complete ? "完整分支" : "仅已加载"} ${entries.length} 次提问`);
    nav.title = complete ? `当前分支完整目录：${entries.length} 次提问` : `目录尚不完整：${catalog?.reason ?? "尚未验证完整历史数据源"}`;
    const card = document.createElement("div");
    card.className = "cn-chat-rail-preview";
    card.hidden = true;
    const title = document.createElement("div");
    title.className = "cn-chat-rail-preview-title";
    const answer = document.createElement("div");
    answer.className = "cn-chat-rail-preview-answer";
    card.append(title, answer);
    const clearHover = () => {
      window.clearTimeout(previewTimer);
      card.hidden = true;
      nav.querySelectorAll<HTMLElement>("[data-cn-neighbor]").forEach((tick) => delete tick.dataset.cnNeighbor);
    };
    nav.addEventListener("mouseleave", clearHover);
    for (const [index, entry] of entries.entries()) {
      const id = entry.id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cn-chat-rail-tick";
      button.dataset.cnTurnId = id;
      button.setAttribute("aria-label", `跳转到用户消息 ${index + 1}`);
      const marker = document.createElement("span");
      marker.className = "cn-chat-rail-marker";
      const line = document.createElement("span");
      line.className = "cn-chat-rail-line";
      marker.append(line);
      button.append(marker);
      button.addEventListener("click", () => jump(id));
      const showPreview = () => {
        if (!current || !nav.isConnected) return;
        const liveTurn = current.turns.find(turn => turn.dataset.turnKey === id);
        let latestEntry = entry;
        try { const updated = history?.getCatalog(current.conversationId); if (updated?.conversationId === current.conversationId) latestEntry = updated.entries.find(e => e.id === id) ?? entry; } catch {}
        const liveTitle = liveTurn?.querySelector<HTMLElement>("[data-user-message-bubble]")?.textContent;
        const liveAnswer = liveTurn ? [...liveTurn.querySelectorAll<HTMLElement>("[data-chatgpt-search-message-ids]")].find(n=>!n.querySelector("[data-user-message-bubble]"))?.textContent : null;
        title.textContent = (liveTitle ?? latestEntry.title).trim().replace(/\s+/g, " ").slice(0, 180) || "（无内容）";
        answer.textContent = (liveAnswer ?? latestEntry.answer).trim().replace(/\s+/g, " ").slice(0, 350);
        answer.hidden = !answer.textContent;
        const hostTop = host.getBoundingClientRect().top;
        const preferred = button.getBoundingClientRect().top - hostTop + button.getBoundingClientRect().height / 2 - 16;
        card.style.top = `${Math.max(8, Math.min(preferred, host.clientHeight - card.offsetHeight - 8))}px`;
        card.hidden = false;
        card.style.top = `${Math.max(8, Math.min(preferred, host.clientHeight - card.offsetHeight - 8))}px`;
      };
      button.addEventListener("mouseenter", () => {
        window.clearTimeout(previewTimer);
        nav.querySelectorAll<HTMLElement>("[data-cn-turn-id]").forEach((tick, otherIndex) => {
          const distance = Math.abs(index - otherIndex);
          if (distance <= 3) tick.dataset.cnNeighbor = String(distance);
          else delete tick.dataset.cnNeighbor;
        });
        previewTimer = window.setTimeout(showPreview, 150);
      });
      button.addEventListener("focus", () => {
        window.clearTimeout(previewTimer);
        showPreview();
      });
      button.addEventListener("blur", () => {
        if (!nav.matches(":hover")) clearHover();
      });
      nav.append(button);
    }
    if (!complete) {
      const status = document.createElement("span"); status.textContent = "未完整";
      status.className = "cn-chat-rail-coverage"; status.setAttribute("role", "status"); nav.append(status);
    }
    host.append(nav, card);
    rail = nav; preview = card;
    updateActive(capture(current)?.turnId ?? current.turns.at(-1)?.dataset.turnKey ?? "");
  };
  const restore = (context: Context) => {
    const saved = readAnchors()[context.conversationId];
    if (!saved || !ID_PATTERN.test(saved.turnId) || !ID_PATTERN.test(saved.messageId)) return;
    const token = ++generation;
    programmatic = true;
    let attempts = 0;
    const apply = () => {
      if (disposed || token !== generation || current?.conversationId !== saved.conversationId) return;
      const node = anchorNode(context, saved);
      if (!node) { programmatic = false; return; }
      scrollToOffset(context, node, saved.viewportOffset);
      if (++attempts < 4) requestAnimationFrame(apply);
      else { programmatic = false; reading = true; lastAnchor = saved; updateActive(saved.turnId); }
    };
    requestAnimationFrame(apply);
  };
  const sync = () => {
    if (disposed) return;
    const next = visibleChat();
    if (!next) { if (current) { save(); detach(); } return; }
    if (next.scroll !== current?.scroll || next.conversationId !== current?.conversationId) {
      if (current) { save(); detach(); }
      current = next;
      current.scroll.addEventListener("scroll", onScroll, { passive: true });
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(current.scroll.firstElementChild ?? current.scroll);
      render();
      restore(current);
    } else { current.turns = next.turns; render(); }
  };
  const interval = window.setInterval(sync, 500);
  document.addEventListener("wheel", onUserInput, { passive: true });
  document.addEventListener("touchstart", onUserInput, { passive: true });
  document.addEventListener("keydown", onUserInput);
  window.addEventListener("pagehide", save);
  sync();
  const stop = () => {
    disposed = true;
    save(); detach();
    window.clearInterval(interval);
    window.clearTimeout(scrollTimer);
    document.removeEventListener("wheel", onUserInput);
    document.removeEventListener("touchstart", onUserInput);
    document.removeEventListener("keydown", onUserInput);
    window.removeEventListener("pagehide", save);
    style.remove();
    if (runtime.__cnChatSessionStop === stop) delete runtime.__cnChatSessionStop;
  };
  runtime.__cnChatSessionStop = stop;
  return stop;
}
