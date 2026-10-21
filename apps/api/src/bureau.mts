import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {holderRoutes} from './auth.mts';
import {holderServices} from '../../../packages/auth/src/services.mts';
import {loadEnv} from '../../../scripts/env.mts';

export function bureauServer(routes:ReturnType<typeof holderRoutes>){
 const server=createServer(async(request,response)=>{
  try{
   if(await routes(request,response))return;
   response.writeHead(404,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
   response.end(JSON.stringify({v:1,generatedAt:new Date().toISOString(),sources:[],code:'ROUTE_NOT_FOUND',error:'That bureau page is unavailable.'}));
  }catch{
   if(response.headersSent){response.destroy();return;}
   response.writeHead(503,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
   response.end(JSON.stringify({v:1,generatedAt:new Date().toISOString(),sources:[],code:'BUREAU_UNAVAILABLE',error:'The bureau is temporarily unavailable. Try again.'}));
  }
 });server.requestTimeout=15_000;server.headersTimeout=10_000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await loadEnv();const root=fileURLToPath(new URL('../../../',import.meta.url)),origin=process.env.BUREAU_ORIGIN;
 const port=Number(process.env.BUREAU_PORT??8312);
 if(!origin||!Number.isInteger(port)||port<1||port>65535)throw new Error('BUREAU_CONFIG: Set a sign-in origin and valid port');
 const services=await holderServices({root,origin}),server=bureauServer(holderRoutes({origin,...services,trustProxy:true}));
 server.listen(port,'127.0.0.1',()=>console.log('Chog Noir wallet service listening on 127.0.0.1:'+port));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
