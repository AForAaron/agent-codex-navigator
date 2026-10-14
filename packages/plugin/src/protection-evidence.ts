import type {ProtectionEvidence} from "../../core/src/protection/controller.ts";

/** Raw quota windows, not rounded display text or credit-based readiness. */
export function parseProtectionEvidence(value:unknown, updatedAt:number, identity?: {user:string;account:string}):ProtectionEvidence|null {
 if(!value||typeof value!=="object")return null;
 const s=value as Record<string,any>,r=s.rate_limit;
 if(typeof s.user_id!=="string"||!s.user_id||typeof s.account_id!=="string"||!r)return null;
 const windows=[r.primary_window,r.secondary_window];
 const five=windows.find(w=>w?.limit_window_seconds===18000),week=windows.find(w=>w?.limit_window_seconds===604800);
 if(!five||!week||![five.used_percent,week.used_percent].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=100)
  ||typeof five.reset_at!=="number"||!Number.isFinite(five.reset_at)||five.reset_at<=0)return null;
 const balance=s.credits?.balance;
 const creditBalance=(typeof balance==="number"||typeof balance==="string"&&/^\d+(\.\d+)?$/.test(balance))&&Number.isFinite(Number(balance))&&Number(balance)>=0?Number(balance):null;
 const hardBlocked=s.spend_control?.reached===true||s.credits?.overage_limit_reached===true;
 const blockedModels=Object.entries(s.model_usage??{}).filter(([,m]:[string,any])=>m?.available===false).map(([model])=>model);
 return {account:JSON.stringify([identity?.user ?? s.user_id,identity?.account ?? s.account_id]),updatedAt,resetAt:five.reset_at*1000,
  exhausted:five.used_percent>=100||week.used_percent>=100,
  includedAvailable:five.used_percent<100&&week.used_percent<100&&r.allowed===true&&r.limit_reached!==true&&!hardBlocked,
  creditBalance,blockedModels};
}
