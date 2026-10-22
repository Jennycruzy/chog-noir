export async function recoverDailySource<T extends {coverageAt:number}>(collect:()=>Promise<T>,saved:()=>Promise<T>,day:string,clock=()=>Date.now()){
 const midnight=Date.parse(day+'T00:00:00Z');
 try{
  const data=await collect();
  if(data.coverageAt<midnight/1000)throw new Error('DAILY_COVERAGE: Source does not cover the completed UTC day');
  return {data,fresh:true,degraded:false,reason:null};
 }catch(error){
  if(clock()<midnight+10*60_000)throw new Error('DAILY_SOURCE_WAIT: Retry the source until 00:10 UTC',{cause:error});
  return {data:await saved(),fresh:false,degraded:true,reason:error instanceof Error?error.message:'Daily source unavailable'};
 }
}
export async function sourceBefore<T,>(request:()=>Promise<T>,deadline:number):Promise<T>{
 const remaining=deadline-Date.now();if(remaining<=0)throw new Error('DAILY_SOURCE_TIMEOUT: Source build deadline elapsed');
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([request(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DAILY_SOURCE_TIMEOUT: Source build deadline elapsed')),remaining);})]);}
 finally{if(timer)clearTimeout(timer);}
}
