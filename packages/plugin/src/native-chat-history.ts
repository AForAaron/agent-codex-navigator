import {parseChatMapping,type ChatHistoryCatalog} from '../../core/src/chat/history.ts';
import type {ChatHistoryProvider} from './chat-session.ts';
type Item={type?:string;message?:string;content?:string;messageId?:string;serverMessageId?:string;sourceMessageIds?:string[]};
type Entry={id?:string;turnKey?:string;turn?:{items:Item[]}};
type Fiber={return?:Fiber;memoizedProps?:Record<string,any>;memoizedState?:{memoizedState?:any;next?:Fiber['memoizedState']};updateQueue?:{memoCache?:{data?:unknown[][]}}};
const stable=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9:_-]{8,160}$/.test(v);
/** Current visible Chat only. Cached data from hidden views is never a source. */
export function createNativeChatHistoryProvider(doc:Document=document):ChatHistoryProvider {
 const cached=new WeakMap<object,ChatHistoryCatalog>();
 const binding=(conversationId:string)=>{
  if(![...doc.querySelectorAll('button[aria-label]')].some(b=>b.getAttribute('aria-label')==='切换模式，当前模式：ChatGPT'))return null;
  const scroll=[...doc.querySelectorAll<HTMLElement>('.thread-scroll-container')].find(s=>s.getBoundingClientRect().width>300&&s.querySelector<HTMLElement>('[data-map-composer-conversation]')?.dataset.mapComposerConversation===conversationId);
  const bubble=scroll?.querySelector<HTMLElement>('[data-user-message-bubble]');if(!bubble||!scroll)return null;
  const key=Object.keys(bubble).find(k=>k.startsWith('__reactFiber$'));let fiber=key?(bubble as unknown as Record<string,Fiber>)[key]:undefined;
  let entries:Entry[]|null=null;const models=new Set<any>(),reveal=new Set<(...args:any[])=>Promise<void>>();
  const model=(v:any)=>{if(v&&typeof v==='object'&&v.mapping&&stable(v.current_node))models.add(v);};
  for(let depth=0;fiber&&depth<110;depth++,fiber=fiber.return){
   const props=fiber.memoizedProps??{};
   if(!entries&&Array.isArray(props.entries)&&props.entries.some((e:Entry)=>e.turn?.items?.some(i=>i.type==='user-message')))entries=props.entries;
   model(props.conversation);
   let hook=fiber.memoizedState;
   for(let n=0;hook&&n<150;n++,hook=hook.next){const v=hook.memoizedState;model(v);model(v?.data);model(v?.current);
    if(Array.isArray(props.entries)&&typeof v?.current==='function'){
     const source=Function.prototype.toString.call(v.current);
     if(source.includes('getTargetElement')&&source.includes('turnKey')&&source.includes('signal'))reveal.add(v.current);
    }
   }
   for(const row of fiber.updateQueue?.memoCache?.data??[])for(const value of row.slice(0,1000))model(value);
  }
  if(!entries)return null;
  const loadedIds=[...scroll.querySelectorAll<HTMLElement>('[data-chatgpt-search-message-ids]')].flatMap(n=>(n.dataset.chatgptSearchMessageIds??'').split(' '));
  if(!entries.some(e=>e.turn?.items?.some(i=>i.type==='user-message'&&loadedIds.includes(i.messageId??''))))return null;
  const users=entries.flatMap(e=>e.turn?.items?.filter(i=>i.type==='user-message')??[]);
  const serverIds=users.map(i=>i.serverMessageId).filter(stable);
  const catalogs:ChatHistoryCatalog[]=[];
  for(const m of models){let catalog=cached.get(m);if(!catalog){catalog=parseChatMapping(m)??undefined;if(catalog)cached.set(m,catalog);}
   if(catalog&&serverIds.length){const ids=new Set(catalog.entries.map(e=>e.id));if(serverIds.every(id=>ids.has(id)))catalogs.push(catalog);}
  }
  const unique=new Map(catalogs.map(c=>[c.branchId,c]));
  const full=unique.size===1?[...unique.values()][0]:null;
  const nativeEntries=entries.flatMap(e=>{const answer=e.turn?.items.filter(i=>i.type==='assistant-message').map(i=>i.content??'').join('\n')??'';return (e.turn?.items.filter(i=>i.type==='user-message')??[]).map(i=>({id:i.serverMessageId??i.messageId??'',title:i.message??'（附件提问）',answer}));}).filter(e=>stable(e.id));
  const nativeById=new Map(nativeEntries.map(e=>[e.id,e]));
  // Complete graph may include an older item absent from the rendered list.
  const result=full?{...full,entries:full.entries.map(e=>nativeById.get(e.id)??e)}:{entries:nativeEntries,complete:false,reason:'无法唯一确认当前分支完整历史',branchId:'native-loaded'};
  const pending=nativeEntries.filter(e=>!result.entries.some(n=>n.id===e.id));
  result.entries=[...result.entries,...pending];
  return {scroll,entries,result,reveal:reveal.size===1?[...reveal][0]:null};
 };
 return {
  getCatalog(conversationId){const b=binding(conversationId);return b?{...b.result,conversationId}:null;},
  async reveal(conversationId,id,signal){
   const b=binding(conversationId);if(!b?.reveal)throw Error('Native virtual navigation unavailable');
   const entry=b.entries.find(e=>e.turn?.items.some(i=>i.messageId===id||i.serverMessageId===id||i.sourceMessageIds?.includes(id)));
   if(!entry?.turnKey)throw Error('Target not in native history list');
   if(signal.aborted)throw Error('Cancelled');
   let removeAbort=()=>{};
   try { await Promise.race([
    b.reveal(entry.turnKey,(row:HTMLElement)=>row.querySelector(`[data-chatgpt-search-message-ids~="${CSS.escape(id)}"]`)??row,{align:'top',signal}),
    new Promise<never>((_,reject)=>{const cancel=()=>reject(Error('Cancelled'));signal.addEventListener('abort',cancel,{once:true});removeAbort=()=>signal.removeEventListener('abort',cancel);}),
   ]); } finally { removeAbort(); }
   if(signal.aborted||!binding(conversationId))throw Error('Conversation changed');
  },
 };
}
