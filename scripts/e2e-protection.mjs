import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const output=await build({stdin:{contents:`export {createProtectionController} from './packages/core/src/protection/controller.ts'; export {createNativeProtectionHost} from './packages/plugin/src/native-protection-host.ts'; export {parseProtectionEvidence} from './packages/plugin/src/protection-evidence.ts'; export {createUsageIndicator,USAGE_INDICATOR_CSS} from './packages/plugin/src/ui/usage-indicator.ts';`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'Probe',write:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();await page.clock.install({time:new Date('2026-10-12T08:00:00Z')});
 await page.setContent('<body></body>');await page.addScriptTag({content:output.outputFiles[0].text});
 await page.evaluate(()=>{
  window.stops=[];window.resumes=[];
  const tasks=window.fixtureTasks=['one','two'].map(id=>({id,modelProvider:'openai',latestModel:'fixture',turns:[{turnId:'turn-'+id,status:'inProgress'}]}));
  const manager={getCachedConversations:()=>tasks,getConversation:id=>tasks.find(t=>t.id===id),getThreadSummaries:()=>[],
   interruptConversation:async(id,mode,expected)=>{const t=tasks.find(t=>t.id===id);if(t.turns[0].turnId!==expected)throw Error('wrong turn');stops.push(id);t.turns[0].status='interrupted';return expected;},
   sendFollowUpMessage:async(id)=>{resumes.push(id);tasks.find(t=>t.id===id).turns[0].status='completed';}};
  const adapter=Probe.createNativeProtectionHost(manager);
  window.widget=Probe.createUsageIndicator(document,{onModeChange:mode=>controller.setEnabled(mode==='protected')});
  const style=document.createElement('style');style.textContent=Probe.USAGE_INDICATOR_CSS;document.head.append(style);document.body.append(widget.root);
  window.controller=Probe.createProtectionController(adapter.host,widget.setProtectionStatus);
  window.update=(used,reset)=>{const raw={user_id:'fixture-user',account_id:'fixture-account',credits:{balance:'1506'},rate_limit:{allowed:used<100,limit_reached:used>=100,primary_window:{used_percent:used,limit_window_seconds:18000,reset_at:reset},secondary_window:{used_percent:25,limit_window_seconds:604800}}};controller.update(Probe.parseProtectionEvidence(raw,Date.now()));};
  update(99.6,Math.floor(Date.now()/1000)+300);
 });
 await page.locator('.cn-protection-button').click();
 assert.equal(await page.locator('.cn-protection').getAttribute('data-status'),'protecting');
 assert.equal(await page.evaluate(()=>stops.length),0,'rounding to zero must not interrupt');
 await page.clock.fastForward(1000);await page.evaluate(()=>update(100,Math.floor(Date.now()/1000)+300));
 await page.waitForFunction(()=>stops.length===2);
 assert.deepEqual(await page.evaluate(()=>stops),['one','two']);
 assert.equal(await page.locator('.cn-protection').getAttribute('data-status'),'waiting');
 await page.clock.fastForward(301000);await page.evaluate(()=>controller.changed());
 assert.equal(await page.evaluate(()=>resumes.length),0,'local deadline cannot resume work');
 await page.evaluate(()=>update(0,Math.floor(Date.now()/1000)+18000));
 await page.waitForFunction(()=>resumes.length===2);
 assert.deepEqual(await page.evaluate(()=>resumes),['one','two']);
 await page.evaluate(()=>controller.changed());assert.equal(await page.evaluate(()=>resumes.length),2);
 // No second toggle: protect another native window with newly running turns.
 await page.clock.fastForward(1000);
 await page.evaluate(()=>{fixtureTasks.forEach(t=>{t.turns[0]={turnId:'second-'+t.id,status:'inProgress'};});update(100,Math.floor(Date.now()/1000)+300);});
 await page.waitForFunction(()=>stops.length===4);
 assert.equal(await page.evaluate(()=>controller.getStatus().enabled),true);
 await page.clock.fastForward(301000);await page.evaluate(()=>controller.changed());
 assert.equal(await page.evaluate(()=>resumes.length),2);
 await page.evaluate(()=>update(0,Math.floor(Date.now()/1000)+18000));
 await page.waitForFunction(()=>resumes.length===4);
 assert.equal(await page.evaluate(()=>controller.getStatus().completedCycles),2);
 assert.equal(await page.evaluate(()=>controller.getStatus().enabled),true);
 await page.locator('.cn-protection-button').click();assert.equal(await page.evaluate(()=>controller.getStatus().enabled),false);
 await page.evaluate(()=>{
  controller.dispose();
  window.goalStatuses=[]; window.goalMessages=0;
  window.goalConversation={id:'goal',modelProvider:'openai',latestModel:'fixture',threadGoal:{threadId:'goal',createdAt:1,objective:'fixture goal',status:'active'},turns:[{turnId:'goal-turn',status:'inProgress'}]};
  const manager={getCachedConversations:()=>[goalConversation],getConversation:()=>goalConversation,getThreadSummaries:()=>[],
   setThreadGoalStatus:async(id,{status})=>{goalStatuses.push(status);goalConversation.threadGoal.status=status;},
   interruptConversation:async(id,mode,expected)=>{if(expected!=='goal-turn')throw Error('wrong goal turn');goalConversation.turns[0].status='interrupted';return expected;},
   sendFollowUpMessage:async()=>{goalMessages++;}};
  const adapter=Probe.createNativeProtectionHost(manager);
  window.goalController=Probe.createProtectionController(adapter.host,()=>{});
  window.goalEvidence=(available)=>({account:'fixture',updatedAt:Date.now(),resetAt:Date.now()+300000,includedAvailable:available,exhausted:!available,creditBalance:100});
  goalController.update(goalEvidence(false));goalController.setEnabled(true);
 });
 await page.waitForFunction(()=>goalController.getStatus().paused===1);
 assert.deepEqual(await page.evaluate(()=>goalStatuses),['paused']);
 await page.clock.fastForward(1000);await page.evaluate(()=>goalController.update(goalEvidence(true)));
 await page.waitForFunction(()=>goalStatuses.length===2);
 assert.deepEqual(await page.evaluate(()=>goalStatuses),['paused','active']);
 assert.equal(await page.evaluate(()=>goalMessages),0,'Goal must resume through native status, never duplicate a continuation message');
 await page.evaluate(()=>{goalController.dispose();widget.dispose()});
 assert.equal(await page.locator('.cn-protection-button').count(),0);
 console.log('PASS synthetic raw quota → native adapter → stop → wait → fresh recovery → once-only continuation → disable → dispose');
}finally{await browser.close()}
