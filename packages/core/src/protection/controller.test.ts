import test from "node:test";
import assert from "node:assert/strict";
import {createProtectionController, type ProtectionTask, type ProtectionEvidence} from "./controller.js";
const flush = () => new Promise<void>(r => setTimeout(r, 0));
function fixture() {
 let now=1000, stops=0, resumes=0;
 const tasks: ProtectionTask[]=[{id:"a",turnId:"t",state:"active",supported:true,revision:"t"}];
 const phases:string[]=[];
 const c=createProtectionController({list:()=>tasks,interrupt:async t=>{stops++;tasks.find(x=>x.id===t.id)!.state="interrupted";return true;},resume:async t=>{resumes++;tasks.find(x=>x.id===t.id)!.state="active";}},p=>phases.push(p),()=>now);
 const data=(available:boolean,patch:Partial<ProtectionEvidence>={})=>({account:"one",updatedAt:now,resetAt:5000,includedAvailable:available,exhausted:!available,creditBalance:100,...patch});
 return {c,tasks,phases,data,setNow:(n:number)=>now=n,counts:()=>({stops,resumes})};
}
test("stops all eligible tasks, does not resume on deadline alone, resumes exactly once on fresh evidence",async()=>{
 const f=fixture();f.tasks.push({...f.tasks[0],id:"b"});f.c.update(f.data(false));f.c.setEnabled(true);await flush();
 assert.deepEqual(f.counts(),{stops:2,resumes:0});f.setNow(6000);f.c.changed();await flush();assert.equal(f.counts().resumes,0);
 f.c.update(f.data(true,{resetAt:9000}));await flush();assert.equal(f.counts().resumes,2);f.c.changed();await flush();assert.equal(f.counts().resumes,2);
});
test("closing, account change, manual stop, or newer turn prevents old automatic continuation",async()=>{
 for(const kind of ["close","account","manual","new-turn","model"]){const f=fixture();f.c.update(f.data(false));f.c.setEnabled(true);await flush();
 if(kind==="close")f.c.setEnabled(false);if(kind==="manual")f.c.cancelTask("a");if(kind==="new-turn")f.tasks[0].turnId="new";if(kind==="model")f.tasks[0].model="changed";
 f.setNow(2000);f.c.update(f.data(true,{account:kind==="account"?"two":"one"}));await flush();assert.equal(f.counts().resumes,0,kind);}
});
test("rounded zero does not stop, balance drop is supplementary and needs a new window to resume",async()=>{
 const f=fixture();f.c.update(f.data(true));f.c.setEnabled(true);await flush();assert.equal(f.counts().stops,0);
 f.setNow(2000);f.c.update(f.data(true,{creditBalance:99}));await flush();assert.equal(f.counts().stops,1);
 f.setNow(3000);f.c.update(f.data(true,{creditBalance:99}));await flush();assert.equal(f.counts().resumes,0);
 f.setNow(6000);f.c.update(f.data(true,{creditBalance:99,resetAt:9000}));await flush();assert.equal(f.counts().resumes,1);
});
test("unknown, stale, unsupported tasks and failed dispatch fail closed without retries",async()=>{
 const f=fixture();f.tasks[0].supported=false;f.c.update(f.data(false));f.c.setEnabled(true);await flush();assert.equal(f.counts().stops,0);assert.equal(f.phases.at(-1),"waiting");
 f.tasks[0].supported=true;f.setNow(200000);f.c.changed();await flush();assert.equal(f.counts().stops,0);
 f.c.dispose();
});
test("failed continuation is never retried and asynchronous stop is not retained after closing",async()=>{
 let now=1,resumes=0;const task:ProtectionTask={id:"x",turnId:"t",state:"active",revision:"t",supported:true};
 const data=(available:boolean):ProtectionEvidence=>({account:"a",updatedAt:now,resetAt:100,includedAvailable:available,exhausted:!available,creditBalance:null});
 const c=createProtectionController({list:()=>[task],interrupt:async()=>{task.state="interrupted";return true},resume:async()=>{resumes++;throw Error("uncertain delivery")}},()=>{},()=>now);
 c.update(data(false));c.setEnabled(true);await flush();now=2;c.update(data(true));await flush();c.changed();await flush();assert.equal(resumes,1);assert.equal(c.getStatus().failed,true);c.dispose();
 let finish!: (v:boolean)=>void;const d=createProtectionController({list:()=>[{...task,state:"active"}],interrupt:()=>new Promise(r=>finish=r),resume:async()=>{throw Error("unexpected")}},()=>{},()=>now);
 d.update(data(false));d.setEnabled(true);await flush();d.setEnabled(false);finish(true);await flush();assert.equal(d.getStatus().paused,0);d.dispose();
});

test("model limitation retains paused records until model readiness arrives",async()=>{
 const f=fixture();f.tasks[0].model="fixture";f.c.update(f.data(false));f.c.setEnabled(true);await flush();
 f.setNow(2000);f.c.update(f.data(true,{blockedModels:["fixture"]}));await flush();assert.equal(f.c.getStatus().paused,1);assert.equal(f.counts().resumes,0);
 f.setNow(3000);f.c.update(f.data(true,{blockedModels:[]}));await flush();assert.equal(f.counts().resumes,1);f.c.dispose();
});
test("a modified paused Goal is not restarted by an old protection record",async()=>{
 const f=fixture();f.tasks[0].kind="goal";f.tasks[0].turnId=null;f.tasks[0].revision="goal-created-1";
 f.c.update(f.data(false));f.c.setEnabled(true);await flush();assert.equal(f.c.getStatus().paused,1);
 f.tasks[0].revision="changed-objective";f.setNow(2000);f.c.update(f.data(true));await flush();assert.equal(f.counts().resumes,0);f.c.dispose();
});

test("five consecutive native windows keep protection enabled and resume each current turn exactly once",async()=>{
 for(const kind of ["turn","goal"] as const) {
 const f=fixture();f.tasks[0].kind=kind;f.c.update(f.data(true));f.c.setEnabled(true);
 for(let cycle=1;cycle<=5;cycle++){
  f.tasks[0].turnId=`turn-${cycle}`;f.tasks[0].revision=kind==="goal"?"same-goal":`turn-${cycle}`;f.tasks[0].state="active";
  f.setNow(cycle*20000000);const resetAt=cycle*20000000+18000000;
  f.c.update(f.data(false,{resetAt}));await flush();assert.equal(f.counts().stops,cycle);
  // Time alone is insufficient; stale/absent data does not resume a cycle.
  f.setNow(resetAt+1);f.c.changed();await flush();assert.equal(f.counts().resumes,cycle-1);
  f.c.update(f.data(true,{resetAt:resetAt+18000000}));await flush();
  assert.equal(f.counts().resumes,cycle);assert.equal(f.c.getStatus().enabled,true);assert.equal(f.c.getStatus().completedCycles,cycle);
  assert.equal(f.c.getStatus().paused,0);f.c.changed();await flush();assert.equal(f.counts().resumes,cycle);
 }
 f.c.dispose();
 }
});
test("new five-hour deadline does not resume while weekly quota remains exhausted",async()=>{
 const f=fixture();f.c.update(f.data(false));f.c.setEnabled(true);await flush();
 f.setNow(6000);f.c.update(f.data(false,{resetAt:18006000}));await flush();assert.equal(f.counts().resumes,0);assert.equal(f.c.getStatus().enabled,true);
 f.setNow(7000);f.c.update(f.data(true,{resetAt:18006000}));await flush();assert.equal(f.counts().resumes,1);f.c.dispose();
});

test("partial coverage is distinct from failure and does not hide waiting or stop eligible tasks",async()=>{
 const f=fixture();f.tasks.push({id:"blocked-goal",kind:"goal",turnId:null,state:"blocked",supported:false,revision:"g"});
 f.c.update(f.data(true));f.c.setEnabled(true);await flush();assert.equal(f.phases.at(-1),"partial");assert.equal(f.c.getStatus().failed,false);
 f.setNow(2000);f.c.update(f.data(false));await flush();assert.equal(f.counts().stops,1);assert.equal(f.phases.at(-1),"waiting");
 f.setNow(3000);f.c.update(f.data(true));await flush();assert.equal(f.counts().resumes,1);assert.equal(f.phases.at(-1),"partial");
 f.c.update(null);await flush();assert.equal(f.phases.at(-1),"unavailable");f.c.dispose();
});
