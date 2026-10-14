#!/usr/bin/env node
/** Standalone launcher resolver, copied into the user's launcher app. */
import {readFileSync,existsSync,readdirSync,realpathSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const repos=new Set(['aforaaron/agent-codex-navigator','aforaaron/codex-thread-navigator']);
export function validProject(input) {
 try {
  if(typeof input!=='string'||!isAbsolute(input))return null;
  const root=realpathSync(input);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const plugin=JSON.parse(readFileSync(join(root,'packages/plugin/plugin.json'),'utf8'));
  if(pkg.name!=='codex-navigator'||plugin.id!=='codex-navigator'||!existsSync(join(root,'scripts/launch-usage-rail.sh')))return null;
  const remote=execFileSync('git',['-C',root,'remote','get-url','origin'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2000}).trim();
  const repo=remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1].toLowerCase();
  return repo&&repos.has(repo)?root:null;
 }catch{return null;}
}
export function resolveProject(config,override) {
 if(override) {const root=validProject(override);if(!root)throw Error('指定的项目路径未通过Navigator项目身份校验。');return {root,source:'override'};}
 const configured=validProject(config?.projectRoot);
 if(configured)return {root:configured,source:'configured'};
 const parents=[...new Set([dirname(typeof config?.projectRoot==='string'?config.projectRoot:''),...(Array.isArray(config?.searchParents)?config.searchParents:[])])]
  .filter(p=>typeof p==='string'&&isAbsolute(p)&&p!=='/').slice(0,4);
 const matches=new Set();
 for(const parent of parents){let children;try{children=readdirSync(parent,{withFileTypes:true});}catch{continue;}
  if(children.length>200)throw Error('候选目录过多，已停止自动定位。请在正确项目目录重新运行install-launcher.sh。');
  for(const child of children){if(!child.isDirectory()&&!child.isSymbolicLink())continue;const root=validProject(join(parent,child.name));if(root)matches.add(root);}
 }
 if(matches.size===1)return {root:[...matches][0],source:'rediscovered'};
 if(matches.size>1)throw Error('找到多个Navigator项目副本，已停止启动。请在所需副本中重新运行bash scripts/install-launcher.sh。');
 throw Error('未找到Navigator项目。请在新项目位置运行bash scripts/install-launcher.sh以更新指向。');
}
export function saveConfig(file,root,previous={}) {
 const parents=[dirname(root),...(Array.isArray(previous.searchParents)?previous.searchParents:[])].filter(p=>typeof p==='string'&&isAbsolute(p)&&p!=='/');
 mkdirSync(dirname(file),{recursive:true});const temporary=`${file}.${process.pid}.tmp`;
 writeFileSync(temporary,JSON.stringify({schemaVersion:1,projectRoot:root,searchParents:[...new Set(parents)].slice(0,4)},null,2)+'\n',{mode:0o600});renameSync(temporary,file);
}
async function main() {
 const file=join(homedir(),'.config/codex-navigator/launcher.json');let config={};
 try{config=JSON.parse(readFileSync(file,'utf8'));}catch{}
 try{
  const result=resolveProject(config,process.env.CODEX_NAVIGATOR_PROJECT_ROOT);
  if(process.argv.includes('--resolve')) {console.log(result.root);return;}
  if(result.source==='rediscovered')saveConfig(file,result.root,config);
  console.log(`Navigator project source: ${result.source}; root: ${result.root}`);
  const child=spawn('/bin/bash',[join(result.root,'scripts/launch-usage-rail.sh'),'--background'],{stdio:'inherit',detached:true});
  await new Promise((ok,bad)=>{child.once('error',bad);child.once('spawn',ok);});
  child.unref(); // Resolver exits after launch; no additional long-lived Node process.
 }catch(error){
  const message=String(error?.message??error);console.error(message);process.exitCode=2;
  if(!process.argv.includes('--resolve'))try{execFileSync('/usr/bin/osascript',['-e',`display alert "Codex Navigator" message ${JSON.stringify(message)} as warning`]);}catch{}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
