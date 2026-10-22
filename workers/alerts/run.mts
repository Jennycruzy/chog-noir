import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient,http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {loadEnv} from '../../scripts/env.mts';
import {monad} from '../../packages/chain/src/client.mts';
import {atomicJSON} from '../../packages/publishing/src/vault.mts';
import {safeError} from '../../scripts/errors.mts';
import {operatingAlerts,type Alert} from './check.mts';

// Runs every five minutes. Writes the current alerts for /health and, when Telegram credentials are configured,
// sends each new alert once and repeats a standing one every six hours.
await loadEnv();
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=join(root,'runs/alerts'),statePath=join(directory,'status.json');
await mkdir(directory,{recursive:true,mode:0o700});
const key=process.env.SERVER_PRIVATE_KEY;
let balance:bigint|null=null;
if(key&&/^0x[0-9a-f]{64}$/i.test(key)){
 try{balance=await createPublicClient({chain:monad,transport:http(process.env.MONAD_RPC_HTTP??'https://rpc2.monad.xyz',{timeout:20_000})}).getBalance({address:privateKeyToAccount(key as `0x${string}`).address});}
 catch(error){console.error('ALERT_BALANCE_UNAVAILABLE',safeError(error));}
}
const now=Date.now(),alerts=await operatingAlerts({root,now,signerBalanceWei:balance});
const previous=await readFile(statePath,'utf8').then(text=>JSON.parse(text) as {alerts:(Alert&{since:number;sentAt:number|null})[]}).catch(()=>({alerts:[]}));
const token=process.env.ALERT_TELEGRAM_TOKEN,chat=process.env.ALERT_TELEGRAM_CHAT;
const current=[];
for(const alert of alerts){
 const before=previous.alerts.find(row=>row.code===alert.code),since=before?.since??now;let sentAt=before?.sentAt??null;
 if(token&&chat&&(sentAt===null||now-sentAt>=6*3600_000)){
  try{const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text:`Chog Noir: ${alert.message}`}),signal:AbortSignal.timeout(15_000)});if(response.ok)sentAt=now;}
  catch(error){console.error('ALERT_SEND_FAILED',safeError(error));}
 }
 current.push({...alert,since,sentAt});
}
await atomicJSON(statePath,{checkedAt:new Date(now).toISOString(),delivery:token&&chat?'TELEGRAM':'HEALTH_ONLY',signerBalanceWei:balance?.toString()??null,alerts:current});
console.log(JSON.stringify({alerts:current.map(row=>row.code)}));
