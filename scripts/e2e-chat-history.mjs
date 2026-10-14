/** Synthetic native graph/virtualizer contract; never uses account data. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const bundle=await build({entryPoints:['packages/plugin/src/chat-session.ts'],bundle:true,format:'iife',globalName:'FixtureChat',write:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 await page.setContent(`<style>body{margin:0;position:relative}.thread-scroll-container{margin-left:300px;height:800px;overflow:auto}.content{padding:100px 0 900px}[data-turn-key]{height:600px}</style><button aria-label="切换模式，当前模式：ChatGPT">ChatGPT</button><div class="thread-scroll-container"><div class="content" data-map-composer-conversation="fixture-chat-12345"></div></div>`);
 await page.evaluate(()=>{
  const entries=[],mapping={'root-123456':{id:'root-123456',parent:null}};let parent='root-123456';
  for(let i=0;i<100;i++) {const id='question-'+String(i).padStart(5,'0');mapping[id]={id,parent,message:{id,author:{role:'user'},content:{parts:['Question '+i]}}};parent=id;entries.push({id:'entry-'+i,turnKey:'turn-key-'+String(i).padStart(5,'0'),turn:{items:[{type:'user-message',messageId:id,serverMessageId:id,message:'Question '+i}]}});}
  const model={mapping,current_node:parent};
  const render=(at)=>{const content=document.querySelector('.content');content.innerHTML=entries.slice(at,at+4).map(e=>`<div data-turn-key="${e.turnKey}"><div data-chatgpt-search-message-ids="${e.turn.items[0].messageId}"><div data-user-message-bubble>${e.turn.items[0].message}</div></div><p>Fixture answer</p></div>`).join('');for(const bubble of content.querySelectorAll('[data-user-message-bubble]'))bubble.__reactFiber$fixture=fiber;};
  async function scrollToKey(turnKey,getTargetElement,{signal}) {if(signal.aborted)return;const at=entries.findIndex(e=>e.turnKey===turnKey);render(at);getTargetElement(document.querySelector('[data-turn-key]')).scrollIntoView();}
  const fiber={memoizedProps:{entries},memoizedState:{memoizedState:{current:scrollToKey}},updateQueue:{memoCache:{data:[[model]]}}};render(96);
 });
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{window.stopFixture=FixtureChat.startChatSession();});
 await page.waitForFunction(()=>document.querySelectorAll('.cn-chat-rail-tick').length===100);
 assert.equal(await page.locator('.cn-chat-rail').getAttribute('data-coverage'),'complete');
 assert.equal(await page.locator('[data-user-message-bubble]').count(),4);
 for(const index of [0,50,96]) {
  await page.locator('.cn-chat-rail-tick').nth(index).evaluate(b=>b.click());
  await page.waitForTimeout(150);
  const result=await page.evaluate((i)=>{const s=document.querySelector('.thread-scroll-container');const id='question-'+String(i).padStart(5,'0');const n=s.querySelector('[data-chatgpt-search-message-ids="'+id+'"]');return {offset:n?.getBoundingClientRect().top-s.getBoundingClientRect().top,active:document.querySelector('.cn-chat-rail-tick[data-active="true"]')?.dataset.cnTurnId,error:document.querySelector('.cn-chat-rail')?.dataset.jumpError};},index);
  assert.ok(Math.abs(result.offset-82)<=4,JSON.stringify(result));assert.equal(result.active,'question-'+String(index).padStart(5,'0'));assert.equal(result.error,undefined);
 }
 await page.evaluate(()=>window.stopFixture());assert.equal(await page.locator('.cn-chat-rail').count(),0);
 console.log('PASS native history: 100 complete questions with only 4 rendered; exact virtual jumps 0/50/96; disposal');
}finally{await browser.close();}
