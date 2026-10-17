import { mkdir, writeFile } from 'node:fs/promises';
const source='https://raw.githubusercontent.com/monad-crypto/token-list/refs/heads/main/tokenlist-mainnet.json';
const fetchedAt=new Date().toISOString();const response=await fetch(source,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error('REGISTRY_SOURCE: Monad reference list unavailable');
const body=await response.json() as {tokens:{chainId:number;address:string;symbol:string}[]};
const wanted=new Set(['WMON','USDC','USDT','USDT0','AUSD','WETH','WBTC','CHOG','SHMON','SMON']);
const assets:Record<string,string[]>={MON:['0x0000000000000000000000000000000000000000']};
for(const token of body.tokens){const symbol=token.symbol.toUpperCase();if(token.chainId===143&&wanted.has(symbol)){if(!/^0x[0-9a-f]{40}$/i.test(token.address))throw new Error('REGISTRY_ADDRESS');(assets[symbol]??=[]).push(token.address.toLowerCase());}}
assets.CHOG??=['0x350035555e10d9afaf1566aaebfced5ba6c27777'];
await mkdir(new URL('../data/wallet-audit/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/wallet-audit/reference-token-list.json',import.meta.url),JSON.stringify({fetchedAt,source,body}));
await writeFile(new URL('../config/reference-tokens.json',import.meta.url),JSON.stringify({fetchedAt,source,note:'Address references for symbol comparisons; list inclusion does not establish token safety or endorsement. Unlisted symbols are not classified.',assets},null,2));
console.log(JSON.stringify({symbols:Object.keys(assets),addresses:Object.values(assets).flat().length},null,2));
