import type {ProtectionHost, ProtectionTask} from "../../core/src/protection/controller.ts";

type Turn = {turnId?: string; status?: string};
type Conversation = {id:string; modelProvider?:string; latestModel?:string; parentThreadId?:string; agentNickname?:string; source?:unknown;
  threadGoal?:{status?:string;threadId?:string;createdAt?:number;objective?:string;tokenBudget?:number|null}; threadRuntimeStatus?:{type?:string}; turns?:Turn[];
  turnHistory?:{kind?:string;history?:{islands:{entries:{value:string}[]}[];entitiesByKey:Record<string,Turn>}}};
type Manager = {disposed?:boolean; getHostId():string; getCachedConversations():Conversation[];
  getConversation(id:string):Conversation|undefined; getThreadSummaries():{conversationId:string;threadRuntimeStatus?:{type?:string}}[];
  interruptConversation(id:string,mode:string,expected?:string):Promise<string|null>;
  setThreadGoalStatus(id:string,options:{status:string}):Promise<unknown>;
  sendFollowUpMessage(id:string,options:{prompt:string}):Promise<unknown>;
  addAnyConversationCallback(fn:()=>void):()=>void; addAnyConversationMetaCallback(fn:()=>void):()=>void;
  addTurnInterruptStartedListener(fn:(id:string)=>void):()=>void;
};
type Fiber={return?:Fiber;child?:Fiber;sibling?:Fiber;memoizedProps?:{value?:unknown};memoizedState?:{memoizedState?:unknown;next?:Fiber["memoizedState"]}};

/** Bounded metadata-only traversal. Do not inspect authentication values or message text. */
export function findNativeProtectionManager(doc:Document):Manager|null {
 const root=doc.querySelector("#root") as (HTMLElement & Record<string,unknown>)|null;
 if(!root)return null;
 const key=Object.keys(root).find(k=>k.startsWith("__reactContainer$")||k.startsWith("__reactFiber$"));
 let fiber=key?root[key] as Fiber:undefined;while(fiber?.return)fiber=fiber.return;
 const stack=[fiber],seen=new Set<Fiber>(),objects=new WeakSet<object>(),matches=new Set<Manager>();let visits=0;
 const scan=(v:unknown,d:number)=>{
  if(!v||typeof v!=="object"||objects.has(v)||d>3||visits>=60000)return;visits++;objects.add(v);
  const candidate=v as Manager;
  if(["interruptConversation","getConversation","getCachedConversations","sendFollowUpMessage","getHostId","getThreadSummaries","addAnyConversationCallback","addAnyConversationMetaCallback","addTurnInterruptStartedListener","setThreadGoalStatus"].every(k=>typeof (v as Record<string,unknown>)[k]==="function")) {matches.add(candidate);return;}
  if(Array.isArray(v))for(const x of v.slice(0,12))scan(x,d+1);
  else if(v instanceof Map)for(const x of [...v.values()].slice(0,80))scan(x,d+1);
  else for(const k of Object.keys(v).filter(k=>/value|client|manager|scope|current|state|store|^v$|^d$/.test(k)).slice(0,20))scan(Object.getOwnPropertyDescriptor(v,k)?.value,d+1);
 };
 for(let count=0;stack.length&&count<50000;count++){
  const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);scan(f.memoizedProps?.value,0);
  let h=f.memoizedState;for(let n=0;h&&n<100;n++,h=h.next)scan(h.memoizedState,0);
  if(f.child)stack.push(f.child);if(f.sibling)stack.push(f.sibling);
 }
 const local=[...matches].filter(m=>!m.disposed&&m.getHostId()==="local");return local.length===1?local[0]:null;
}
function latest(c:Conversation):Turn|undefined {
 const h=c.turnHistory?.history;
 if(c.turnHistory?.kind==="canonical"&&h) {
  for(let i=h.islands.length-1;i>=0;i--)for(let j=h.islands[i].entries.length-1;j>=0;j--) {
   const t=h.entitiesByKey[h.islands[i].entries[j].value]; if(t?.turnId)return t;
  }
  return undefined;
 }
 const turns=c.turns??[];
 for(let i=turns.length-1;i>=0;i--)if(turns[i]?.turnId)return turns[i];
 return undefined;
}
export function createNativeProtectionHost(manager:Manager) {
 const selfInterrupt=new Set<string>();
 const list=():ProtectionTask[]=>{
  if(manager.disposed)throw Error("Native manager disposed");
  const cached=manager.getCachedConversations();
  const tasks:ProtectionTask[]=cached.map(c=>{
   const t=latest(c),goal=c.threadGoal;
   let hash=2166136261;
   for(const char of goal?.objective??"") hash=Math.imul(hash^char.charCodeAt(0),16777619);
   const validGoal=goal && goal.threadId===c.id && typeof goal.createdAt==="number" && typeof goal.objective==="string";
   const root=c.modelProvider==="openai"&&!c.parentThreadId&&!c.agentNickname&&!(c.source && typeof c.source === "object" && "subAgent" in c.source);
   return {id:c.id,turnId:t?.turnId??null,kind:goal?"goal":"turn",
    state:t?.status==="inProgress"||goal?.status==="active"?"active":goal?.status==="paused"||t?.status==="interrupted"?"interrupted":goal&&!["complete"].includes(goal.status??"")?"blocked":"idle",
    supported:!!root && (goal?!!validGoal&&["active","paused"].includes(goal.status??""):!!t?.turnId),
    revision:goal?`${goal.createdAt}:${goal.tokenBudget??"none"}:${hash>>>0}`:t?.turnId??"",model:c.latestModel};
  });
  for(const summary of manager.getThreadSummaries())if(summary.threadRuntimeStatus?.type==="active"&&!cached.some(c=>c.id===summary.conversationId))
   tasks.push({id:summary.conversationId,turnId:null,state:"active",supported:false,revision:""});
  return tasks.filter(t=>t.state!=="idle");
 };
 const host:ProtectionHost={list,interrupt:async task=>{
  const current=list().find(t=>t.id===task.id);
  if(!current?.supported||current.state!=="active"||current.turnId!==task.turnId||current.revision!==task.revision)return false;
  selfInterrupt.add(task.id);
  try {
   if(task.kind==="goal") {
    if(manager.getConversation(task.id)?.threadGoal?.status==="active") await manager.setThreadGoalStatus(task.id,{status:"paused"});
    const c=manager.getConversation(task.id);
    if(!c||c.threadGoal?.status!=="paused")throw Error("Goal pause not confirmed");
    const turn=latest(c);
    if(turn?.status==="inProgress"&&turn.turnId) {
     if(turn.turnId!==task.turnId)return false;
     return await manager.interruptConversation(task.id,"system",turn.turnId)===turn.turnId;
    }
    return true;
   }
   if(!task.turnId)return false;
   return await manager.interruptConversation(task.id,"system",task.turnId)===task.turnId;
  } finally {selfInterrupt.delete(task.id);}
 },resume:async task=>{
  const current=list().find(t=>t.id===task.id);
  if(!current?.supported||current.turnId!==task.turnId||current.state!=="interrupted")throw Error("Task changed before resume");
  if(current.revision!==task.revision)throw Error("Goal changed before resume");
  if(task.kind==="goal") {
    if(manager.getConversation(task.id)?.threadGoal?.status!=="paused")throw Error("Goal is not paused");
    // The host automatically continues active Goals. Sending a message duplicates work.
    await manager.setThreadGoalStatus(task.id,{status:"active"});
    return;
  }
  await manager.sendFollowUpMessage(task.id,{prompt:"套餐额度保护此前中断了本任务，现在已确认套餐额度恢复。请从本对话未完成的工作继续；先核对已经完成的步骤和现有状态，避免重复执行。保留原有权限及审批要求，不重做已完成的操作。"});
 }};
 return {host,watch:(changed:()=>void,manualStop:(id:string)=>void)=>{
  let pending=false,active=true;
  const notify=()=>{if(pending||!active)return;pending=true;queueMicrotask(()=>{pending=false;if(active)changed();});};
  const off=[manager.addAnyConversationCallback(notify),manager.addAnyConversationMetaCallback(notify),manager.addTurnInterruptStartedListener(id=>{if(!selfInterrupt.has(id))manualStop(id);})];
  return ()=>{active=false;off.forEach(fn=>fn());};
 }};
}
