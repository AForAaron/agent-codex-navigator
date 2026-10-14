export interface ChatHistoryEntry { id: string; title: string; answer: string; }
export interface ChatHistoryCatalog { entries: ChatHistoryEntry[]; complete: boolean; reason: string | null; branchId: string; }
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9:_-]{8,160}$/.test(v);
function text(message:Record<string,unknown>):string {
 const parts=record(message.content)?.parts;
 return Array.isArray(parts)?parts.filter((p):p is string=>typeof p==='string').join('\n'):'';
}
/** Follow only the selected branch; missing parents never imply complete history. */
export function parseChatMapping(value:unknown):ChatHistoryCatalog|null {
 const c=record(value),mapping=record(c?.mapping),current=c?.current_node;
 if(!mapping||!id(current))return null;
 const chain:Record<string,unknown>[]=[],seen=new Set<string>();let cursor:string|null=current,complete=false,reason:string|null=null;
 while(cursor!==null) {
  if(seen.has(cursor)||seen.size>=100000){reason='分支历史存在循环或超出兼容上限';break;}
  seen.add(cursor);const node=record(mapping[cursor]);if(!node){reason='尚未取得更早的历史节点';break;}
  chain.push(node);
  if(node.parent===null){complete=true;break;}
  if(!id(node.parent)){reason='历史父节点身份不兼容';break;}
  cursor=node.parent;
 }
 const entries:ChatHistoryEntry[]=[];
 for(const node of chain.reverse()) {
  const message=record(node.message);if(!message)continue;
  const role=record(message.author)?.role;
  if(role==='user') {
   if(!id(message.id)){complete=false;reason='用户消息缺少稳定ID';continue;}
   entries.push({id:message.id,title:text(message)||'（附件或非文本提问）',answer:''});
  }else if(role==='assistant'&&entries.length) {
   const answer=text(message);if(answer)entries[entries.length-1].answer+=(entries[entries.length-1].answer?'\n':'')+answer;
  }
 }
 return {entries,complete,reason,branchId:current};
}
