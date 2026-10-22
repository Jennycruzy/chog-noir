// Chog Noir web client. The server decides every catch, cost and score; this file only renders and sends actions.
const $=(selector,root=document)=>root.querySelector(selector);
const app=$('#app');
/** replaceChildren that skips empty slots; the DOM version would print a null child as the text "null". */
const fill=(node,...children)=>node.replaceChildren(...children.flat(Infinity).filter(child=>child!==null&&child!==undefined&&child!==false));
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const store={get(key){try{return localStorage.getItem(key);}catch{return null;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
const state={roster:null,address:null,detective:null,view:null,selected:{statement:null,receipt:null,blank:null},tiles:{},seen:new Set(),streams:[],today:null};

/** Builds an element. Strings become text nodes, so chain text is never parsed as markup. */
function h(tag,attrs={},...children){
 const node=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs||{})){
  if(value===null||value===undefined||value===false)continue;
  if(key.startsWith('on'))node.addEventListener(key.slice(2),value);
  else if(key==='class')node.className=value;
  else if(value===true)node.setAttribute(key,'');
  else node.setAttribute(key,String(value));
 }
 for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
 return node;
}
const art=(id,size='medium')=>`/${size}/${Number(id)}.webp`;
/** A real Chog portrait from the collection art, sized for where it sits. */
const portrait=(id,{alt='',eager=false,sizes='(max-width:860px) 100vw, 520px'}={})=>h('img',{src:art(id),srcset:`${art(id,'thumbs')} 256w, ${art(id)} 512w, ${art(id,'art')} 1000w`,sizes,alt,width:512,height:512,decoding:'async',loading:eager?'eager':'lazy',fetchpriority:eager?'high':null});
/** Sections fade in as they scroll into view; with reduced motion they are simply there. */
const revealer='IntersectionObserver' in window?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('in');revealer.unobserve(entry.target);}},{rootMargin:'0px 0px -8% 0px'}):null;
function watchReveals(){for(const node of document.querySelectorAll('[data-reveal]:not(.in)')){if(revealer&&!reduced.matches)revealer.observe(node);else node.classList.add('in');}}
/** A day-stable pick of real Chog Genesis token ids (1–1969) for the wall. */
function wallIds(seed,count){let x=0;for(const char of seed)x=(x*31+char.charCodeAt(0))>>>0;const ids=new Set();while(ids.size<count){x=(Math.imul(x,1103515245)+12345)>>>0;ids.add(1+x%1969);}return [...ids];}
const explorer=tx=>`https://monadscan.com/tx/${encodeURIComponent(tx)}`;
const sourceLinks=sources=>(sources||[]).map((source,index)=>h('a',{href:explorer(source.tx),target:'_blank',rel:'noopener'},index?' · receipt '+(index+1):'View on explorer'));
const link=(href,text,attrs={})=>h('a',{href,'data-link':true,...attrs},text);
const OPENSEA='https://opensea.io/collection/chog-genesis';

async function api(path,{method='GET',body}={}){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 let value={};try{value=await response.json();}catch{}
 if(!response.ok)throw Object.assign(new Error(value.error||'The bureau is temporarily unavailable. Try again.'),{code:value.code||'UNAVAILABLE',status:response.status});
 return value;
}
let noticeTimer;
function notify(text,kind=''){const node=$('#notice');node.textContent=text;node.className='show '+kind;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.className='';},5000);}
function fail(error){notify(error.message||'Something went wrong. Try again.','alarm');}

/* Sound: generated in the browser, muted until the player turns it on. */
const sound={on:store.get('sound')==='on',context:null,rain:null,
 ctx(){this.context??=new AudioContext();return this.context;},
 tone(frequency,duration,type='sine',gain=.15){if(!this.on)return;const ctx=this.ctx(),osc=ctx.createOscillator(),amp=ctx.createGain();osc.type=type;osc.frequency.value=frequency;amp.gain.setValueAtTime(gain,ctx.currentTime);amp.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+duration);osc.connect(amp).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+duration);},
 tick(){this.tone(1800,.03,'square',.03);},thud(){this.tone(70,.35,'sine',.5);this.tone(140,.15,'triangle',.2);},
 siren(){if(!this.on)return;[0,.4,.8].forEach(at=>setTimeout(()=>{this.tone(880,.35,'sawtooth',.06);setTimeout(()=>this.tone(660,.35,'sawtooth',.06),200);},at*1000));},
 rainStart(){if(!this.on||this.rain)return;const ctx=this.ctx(),buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.25;const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),amp=ctx.createGain();source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.frequency.value=900;amp.gain.value=.08;source.connect(filter).connect(amp).connect(ctx.destination);source.start();this.rain=source;},
 rainStop(){this.rain?.stop();this.rain=null;},
};
function renderControls(){
 const button=$('#sound');button.textContent=sound.on?'Sound on':'Sound off';button.setAttribute('aria-pressed',String(sound.on));button.title=sound.on?'Sound is on':'Sound is off';
 const theme=document.documentElement.dataset.theme;$('#theme').textContent=theme==='dark'?'Light':'Dark';$('#theme').setAttribute('aria-pressed',String(theme==='light'));
}
$('#sound').addEventListener('click',()=>{sound.on=!sound.on;store.set('sound',sound.on?'on':'off');if(!sound.on)sound.rainStop();else if($('.room'))sound.rainStart();renderControls();});
$('#theme').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;store.set('theme',next);renderControls();});
document.documentElement.dataset.theme=store.get('theme')==='light'?'light':'dark';renderControls();

/* Header: today's case and the active detective or the Rookie badge. */
function renderBadge(){
 const badge=$('#badge');fill(badge,);
 const view=state.view;
 if(view?.mode==='ROOKIE')badge.append(h('img',{src:art(view.badge.tokenId,'thumbs'),alt:''}),h('span',{class:'stamp-label rookie-stamp'},'Rookie'),h('span',{},view.badge.name));
 else if(state.detective)badge.append(h('img',{src:art(state.detective.tokenId,'thumbs'),alt:''}),h('span',{},state.detective.name+(state.detective.streak?` · streak ${state.detective.streak} 🔥`:'')));
 else if(state.address)badge.append(h('span',{},'Wallet connected'));
 const today=$('#today-link');if(state.today){today.hidden=false;today.textContent=`Case #${state.today.number} · ${state.today.weekday}`;}else today.hidden=true;
}

/* Routing */
const routes=[
 [/^\/$/,home],[/^\/rookie$/,rookie],[/^\/connect$/,connect],[/^\/pick$/,pick],[/^\/case$/,caseFile],[/^\/case\/room$/,room],[/^\/training$/,training],
 [/^\/precinct$/,precinct],[/^\/issues$/,issues],[/^\/issues\/(\d+)$/,issue],[/^\/chog\/(\d+)$/,profile],[/^\/verify(?:\/(case-[a-f0-9]{24}))?$/,verify],
 [/^\/report$/,report],[/^\/scam-desk$/,scamDesk],[/^\/about$/,about],[/^\/arc$/,arcPage],
];
function closeStreams(){for(const stream of state.streams)stream.close();state.streams=[];sound.rainStop();}
async function render(){
 closeStreams();const path=location.pathname.replace(/\/+$/,'')||'/';
 for(const [pattern,page] of routes){const match=path.match(pattern);if(match){try{await page(...match.slice(1));enter();watchReveals();}catch(error){fill(app,h('h2',{},'The bureau is unavailable'),h('p',{},error.message||'Try again shortly.'),link('/','Back to the front door'));}renderBadge();return;}}
 fill(app,h('h2',{},'Page not found'),link('/','Back to the front door'));
}
/** Fades the next page in. In-page redraws (a selection, a catch, a tile) never fade. */
function enter(){app.classList.remove('enter');void app.offsetWidth;app.classList.add('enter');setTimeout(()=>app.classList.remove('enter'),300);}
function go(path){history.pushState({},'',path);void render();app.focus({preventScroll:false});window.scrollTo(0,0);}
document.addEventListener('click',event=>{const anchor=event.target.closest('a[data-link]');if(!anchor||event.metaKey||event.ctrlKey||event.shiftKey||anchor.target==='_blank')return;event.preventDefault();go(anchor.getAttribute('href'));});
addEventListener('popstate',()=>void render());

/* Front door */
async function replayPanel(){
 const replay=await api('/replay').catch(()=>null);if(!replay)return null;
 const node=h('section',{class:'replay','aria-label':'Replay of a real caught lie'},
  h('span',{class:'stamp-label replay-label'},'REPLAY'),h('p',{class:'muted'},replay.caseLine),
  h('div',{class:'statement type'},h('strong',{},replay.witness.name+': '),'“'+replay.statement+'”'),
  h('div',{class:'receipt receipt-card'},replay.receipt.text,' ',...sourceLinks(replay.receipt.sources)),
  h('p',{class:'type'},'CAUGHT — false statement. '+replay.inference),
  h('div',{class:'replay-stamp','aria-hidden':'true'},'CAUGHT'));
 requestAnimationFrame(()=>node.classList.add('play'));if(!reduced.matches)setTimeout(()=>sound.thud(),3800);
 return node;
}
function caseCard(summary){
 return h('article',{class:'case-card'},h('span',{class:'folder-tab'},`CASE #${summary.number}`),
  h('figure',{class:'polaroid'},portrait(summary.subject.tokenId,{alt:`${summary.subject.name}, the subject of today's case`,sizes:'150px'}),h('figcaption',{},summary.subject.name)),
  h('div',{},h('p',{class:'muted type'},`Case #${summary.number} · ${summary.weekday}`),h('h2',{},summary.title),h('p',{class:'type'},summary.setup),h('p',{class:'rule'},summary.ruleLine),
   h('div',{class:'cast-row'},summary.cast.map(row=>h('img',{src:art(row.tokenId,'thumbs'),alt:'',width:38,height:38,loading:'lazy'})),h('span',{class:'muted'},'Witnesses: '+summary.cast.map(row=>row.name).join(', ')))),
  summary.openTx?h('a',{class:'locked',href:explorer(summary.openTx),target:'_blank',rel:'noopener','aria-label':'Answer locked on chain: view the transaction'},'LOCKED ON CHAIN'):null);
}
function ticker(){
 const node=h('div',{class:'ticker','aria-live':'polite'},'Evidence coming in…');
 const breaking=h('div',{hidden:true});
 try{
  const source=new EventSource('/api/events');state.streams.push(source);
  source.addEventListener('feed',event=>{
   const feed=JSON.parse(event.data);
   if(!['LIVE','POLLING','CATCHING_UP'].includes(feed.state)){node.textContent='Live feed: '+(feed.state==='STALE'?'catching up':'offline')+'. Tomorrow’s case is built from the stored chain history.';return;}
   const events=(feed.events||[]).slice(0,5);fill(node,h('strong',{},'Evidence coming in: '),events.length?events.map(row=>row.text).join(' · '):'quiet so far tonight.');
   const sale=events.find(row=>row.kind==='SALE');const last=Number(store.get('breakingAt')||0);
   if(sale&&sale.id!==store.get('breakingId')&&Date.now()-last>30*60_000){store.set('breakingAt',String(Date.now()));store.set('breakingId',sale.id);breaking.replaceWith(breakingScene(sale));}
  });
 }catch{node.textContent='Live feed unavailable in this browser.';}
 return [breaking,node];
}
function breakingScene(sale){sound.siren();return h('div',{class:'breaking',role:'status'},h('img',{src:art(sale.tokenId,'thumbs'),alt:''}),h('span',{},`BREAKING · ${sale.text}. This could be tomorrow's case.`));}
async function home(){
 const [today,replay]=await Promise.all([api('/case/today').catch(()=>({case:null})),replayPanel()]);state.today=today.case;
 const c=today.case,subject=c?.subject??replay?.witness??{tokenId:1931,name:'The bureau'},day=c?.day??new Date().toISOString().slice(0,10);
 const hero=h('section',{class:'hero'},
  h('div',{class:'hero-copy'},
   h('p',{class:'kicker'},c?`Case #${c.number} · ${c.weekday} · Monad mainnet`:'Monad mainnet · Chog Genesis'),
   h('h1',{},h('span',{},'Catch the'),h('span',{class:'lamp'},'lying Chog.')),
   h('p',{class:'line'},'Every night something real happens to Chogs on Monad. Every morning your Chog takes the case. One witness is lying. The chain never does.'),
   h('div',{class:'actions'},c?h('button',{class:'primary cta',onclick:()=>go('/rookie')},'Play as a rookie',h('span',{class:'arrow','aria-hidden':'true'},'→')):null,h('button',{class:'cta',onclick:()=>go('/connect')},'Connect wallet')),
   h('p',{class:'proof'},h('span',{},'Real sales on Monad'),h('span',{},'No wallet needed to play'),c?.openTx?h('span',{},h('a',{href:explorer(c.openTx),target:'_blank',rel:'noopener'},'Answer locked on chain')):h('span',{},'Answers locked on chain'))),
  h('figure',{class:'spotlight'},portrait(subject.tokenId,{alt:c?`${subject.name}, the subject of today's case`:`${subject.name}, a real Chog`,eager:true,sizes:'(max-width:860px) 60vw, 520px'}),
   h('div',{class:'blinds','aria-hidden':'true'}),h('div',{class:'flash','aria-hidden':'true'}),
   h('figcaption',{class:'plaque'},h('span',{},c?'SUBJECT':'ON THE RECORD'),h('strong',{},subject.name)),
   c?h('span',{class:'tape','aria-hidden':'true'},`CASE #${c.number} · OPEN`):null));
 const lineup=c?h('section',{class:'section','data-reveal':true,'aria-labelledby':'lineup-title'},
  h('div',{class:'section-head'},h('h2',{id:'lineup-title'},'Today’s lineup'),h('p',{class:'muted'},'Real Chogs from the real move. One of them is lying about its own life on chain.')),
  h('div',{class:'lineup'},c.cast.map((member,index)=>h('a',{class:'suspect',href:'/chog/'+member.tokenId,'data-link':true,'aria-label':`${member.name}, ${member.nickname}: detective record`},
   h('div',{class:'mug'},portrait(member.tokenId,{sizes:'(max-width:760px) 33vw, 360px'})),h('div',{class:'placard'},h('span',{class:'no'},String(index+1).padStart(2,'0')),h('strong',{},member.name),h('span',{},member.link??member.nickname)))))):null;
 const file=h('section',{class:'section','data-reveal':true,'aria-label':'The case file'},
  h('div',{class:'case-row'},h('div',{},c?caseCard(c):h('p',{class:'type'},'No case is open right now. A new case opens at 00:20 UTC.'),h('button',{onclick:()=>alertMe(null)},'Alert me when a new case opens')),replay??h('div',{})));
 const cast=c?.cast??[];const face=index=>cast[index]?.tokenId??wallIds(day,3)[index];
 const steps=h('section',{class:'section','data-reveal':true,'aria-labelledby':'how-title'},
  h('div',{class:'section-head'},h('h2',{id:'how-title'},'How a case plays'),h('p',{class:'muted'},'Two minutes. Three moves. Every fact links to a real transaction.')),
  h('div',{class:'steps'},
   h('article',{class:'step'},h('img',{src:art(face(0),'thumbs'),alt:'',width:56,height:56,loading:'lazy'}),h('h3',{},'Read the witnesses'),h('p',{class:'muted'},'Each Chog tells you what happened. Press one to make it say more.'),h('p',{class:'demo bubble type'},'“I was the only Chog in that wallet.”')),
   h('article',{class:'step'},h('img',{src:art(face(1),'thumbs'),alt:'',width:56,height:56,loading:'lazy'}),h('h3',{},'Present the receipt'),h('p',{class:'muted'},'Hold a real on-chain receipt against the statement it breaks. CAUGHT.'),h('p',{class:'demo slip type'},'Another Chog is recorded in the same wallet.')),
   h('article',{class:'step'},h('img',{src:art(face(2),'thumbs'),alt:'',width:56,height:56,loading:'lazy'}),h('h3',{},'Say what happened'),h('p',{class:'muted'},'Fill the sentence with the right tiles. Two tries. Then share your grid.'),h('p',{class:'demo fill type'},'It ',h('u',{},'moved in'),' through ',h('u',{},'a listing purchase'),'.'))));
 const wall=h('section',{class:'section','data-reveal':true,'aria-labelledby':'wall-title'},
  h('div',{class:'section-head'},h('h2',{id:'wall-title'},'Anyone can be called'),h('p',{class:'muted'},'1,969 Chog Genesis tokens. When one moves on Monad, it can end up on the stand.')),
  h('div',{class:'wall'},h('div',{class:'wall-track'},[0,1].map(copy=>wallIds(day,18).map(id=>h('a',{href:'/chog/'+id,'data-link':true,tabindex:copy?'-1':null,'aria-hidden':copy?'true':null,'aria-label':copy?null:`Chog token ${id}: detective record`},h('img',{src:art(id,'thumbs'),alt:'',width:120,height:120,loading:'lazy',decoding:'async'})))))));
 const band=h('section',{class:'cta-band','data-reveal':true},h('div',{},h('h2',{},'Hold a Chog?'),h('p',{class:'muted'},'Your Chog becomes the detective: its traits are its skill, its hold time is its questions, and its record is kept on the token.')),h('button',{class:'primary cta',onclick:()=>go('/connect')},'Bring your Chog',h('span',{class:'arrow','aria-hidden':'true'},'→')));
 fill(app,hero,...ticker(),lineup??h('div',{}),file,steps,wall,band,h('nav',{class:'page-links','aria-label':'More from the bureau'},link('/precinct','Precinct board'),link('/arc','The story'),link('/issues','Issues'),link('/report','Precinct Report'),link('/scam-desk','Scam Desk')));
}

/* Wallet */
async function connect(){
 fill(app,h('h2',{},'Connect the wallet that holds your Chog'),h('p',{},'One signature, no gas. Your Chog becomes the detective.'),h('div',{class:'actions'},h('button',{class:'primary',onclick:signIn},'Sign in'),link('/rookie','No Chog? Play as a rookie')));
}
async function signIn(){
 const wallet=window.ethereum;
 if(!wallet){notify('No browser wallet found. Open Chog Noir in a wallet browser, or play as a rookie.','alarm');return;}
 try{
  const [address]=await wallet.request({method:'eth_requestAccounts'});
  const challenge=await api('/auth/nonce',{method:'POST',body:{address}});
  const signature=await wallet.request({method:'personal_sign',params:[challenge.message,address]});
  const roster=await api('/auth/verify',{method:'POST',body:{nonce:challenge.nonce,signature}});
  state.address=roster.address;state.roster=roster;go(roster.total?'/pick':'/pick');
 }catch(error){fail(error.code==='AUTH_BAD_SIGNATURE'||error.code===4001?Object.assign(error,{message:"That signature didn't check out. Try again."}):error);}
}
async function pick(){
 let roster=state.roster;if(!roster)roster=await api('/me/chogs').catch(error=>{if(error.status===401){go('/connect');return null;}throw error;});if(!roster)return;
 state.roster=roster;
 if(!roster.total){fill(app,h('h2',{},'The bureau only hires Chogs.'),h('p',{},'The bureau only hires Chogs. You can still work today\'s case at the Rookie desk.'),h('div',{class:'actions'},h('button',{class:'primary',onclick:()=>go('/rookie')},'Play as a rookie'),h('a',{href:OPENSEA,target:'_blank',rel:'noopener'},'See the collection on OpenSea')),h('p',{},link('/issues','Issues'),' · ',link('/precinct','Precinct'),' · ',link('/report','Report'),' · ',link('/scam-desk','Scam Desk')));return;}
 const list=h('div',{class:'grid'});
 const add=chogs=>{for(const chog of chogs)list.append(h('button',{class:'chog-card',onclick:()=>{state.detective=chog;go('/case');},'aria-label':`${chog.name}, ${chog.skillName}, ${chog.budget.total} questions${chog.playedToday?', worked today':''}`},
  h('img',{src:art(chog.tokenId,'thumbs'),alt:''}),h('span',{},h('strong',{},chog.name),h('br'),h('span',{class:'meta'},`${chog.skillName}: ${chog.skillLine}`),h('br'),h('span',{class:'meta'},`${chog.budget.total} questions · ${chog.rank} · streak ${chog.streak}${chog.founder?' · Founder':''}`),chog.playedToday?h('span',{class:'tag'},'Worked today'):null)));};
 add(roster.chogs);
 const more=h('button',{hidden:roster.nextCursor===null,onclick:async()=>{const next=await api('/me/chogs?after='+roster.nextCursor);roster.nextCursor=next.nextCursor;add(next.chogs);more.hidden=next.nextCursor===null;}},'More Chogs');
 fill(app,h('h2',{},'Choose today’s detective'),h('p',{class:'muted'},`${roster.total} Chog${roster.total===1?'':'s'} in this wallet. Each one works the case once a day with its own skill and record. The hold time counts from when this wallet received the Chog; moving it between your own wallets resets it.`),list,more);
}

/* Case file and room */
async function caseFile(){
 const today=(await api('/case/today')).case;state.today=today;
 if(!today){fill(app,h('h2',{},'No case is open'),h('p',{},'A new case opens at 00:20 UTC.'));return;}
 if(!state.detective&&!state.address){go('/connect');return;}
 if(!state.detective){go('/pick');return;}
 fill(app,caseCard(today),h('p',{},`Detective: ${state.detective.name} · ${state.detective.skillName} · ${state.detective.budget.total} questions`),
  h('div',{class:'actions'},h('button',{class:'primary',onclick:async()=>{try{const view=await api('/case/start',{method:'POST',body:{tokenId:state.detective.tokenId}});enterRoom(view);}catch(error){if(error.code==='PLAY_ALREADY_TODAY'){const view=await api('/case/state?tokenId='+state.detective.tokenId).catch(()=>null);if(view){enterRoom(view);return;}}fail(error);}}},'Take the case'),link('/pick','Choose another Chog')));
}
async function rookie(){
 const today=(await api('/case/today')).case;state.today=today;
 if(!today){fill(app,h('h2',{},'No case is open'),h('p',{},'A new case opens at 00:20 UTC.'));return;}
 const view=await api('/rookie/start',{method:'POST',body:{}}).catch(error=>{if(error.code==='ROOKIE_DONE_TODAY'||error.code==='ROOKIE_LIMIT'){fill(app,h('h2',{},'Rookie desk'),h('p',{},error.message));return null;}throw error;});
 if(!view)return;
 if(!view.state.done&&view.state.revision===0&&!store.get('training:'+today.id)){offerTraining(view);return;}
 enterRoom(view);
}
function offerTraining(view){
 fill(app,h('span',{class:'stamp-label rookie-stamp'},'Rookie desk'),h('h2',{},view.badge.label),h('p',{},'Sixty seconds of practice on a real archived case first?'),
  h('div',{class:'actions'},h('button',{class:'primary',onclick:()=>{store.set('training:'+view.case.id,'offered');go('/training');}},'Training case'),h('button',{onclick:()=>{store.set('training:'+view.case.id,'skipped');enterRoom(view);}},'Skip to today’s case')));
}
function enterRoom(view){state.view=view;state.selected={statement:null,receipt:null,blank:null};state.tiles={};history.pushState({},'','/case/room');drawRoom();renderBadge();}
async function room(){
 if(state.view){drawRoom();return;}
 if(state.detective){const view=await api('/case/state?tokenId='+state.detective.tokenId).catch(()=>null);if(view){state.view=view;drawRoom();return;}}
 go('/');
}
async function act(action){
 const view=state.view,before=view.state;
 try{
  const next=await api('/case/action',{method:'POST',body:{...(view.mode==='HOLDER'?{tokenId:view.detective.tokenId}:{}),action:{...action,revision:before.revision}}});
  state.view=next;const notice=next.state.notice;
  if(action.type==='solve'&&!next.state.done){notify(`Feedback: ${next.state.feedback}. One more try.`,'alarm');drawSolve();return;}
  if(notice?.startsWith('CAUGHT'))caughtMoment(next,before);else if(notice)notify(notice,'alarm');
  state.selected={statement:null,receipt:null,blank:state.selected.blank};drawRoom();
 }catch(error){
  if(error.code==='CASE_REVISION_CHANGED'||error.code==='ROOKIE_REVISION_CHANGED'){notify('The case moved on in another tab. Showing the latest view.');await room();return;}
  fail(error);
 }
}
function caughtMoment(next,before){
 const fresh=next.state.caught.find(row=>!before.caught.some(old=>old.id===row.id));
 sound.thud();notify(next.state.notice+(fresh?' '+fresh.unlockedTruth:''),'clue');
 if(reduced.matches)return;
 const overlay=h('div',{class:'stamp','aria-hidden':'true'},h('span',{},'CAUGHT'));document.body.append(overlay);setTimeout(()=>overlay.remove(),900);
 const liar=fresh&&next.state.case.cast.length&&fresh.statementId.match(/^w(\d+)-/)?.[1];
 requestAnimationFrame(()=>{$('.room')?.classList.add('flicker');if(liar)$(`[data-witness="${liar}"]`)?.classList.add('shake');document.querySelectorAll('[data-witness]').forEach(node=>{if(node.dataset.witness!==liar&&next.state.case.ruleLine.startsWith('Two'))node.classList.add('react');});});
}
function typeOut(node,text){
 if(reduced.matches||state.seen.has(text)){node.textContent=text;return;}
 state.seen.add(text);let index=0;const step=()=>{node.textContent=text.slice(0,++index);if(index%3===0)sound.tick();if(index<text.length)setTimeout(step,18);};step();
}
function drawRoom(){
 const view=state.view,s=view.state;
 if(s.done&&s.result){drawReveal();return;}
 sound.rainStart();
 const known=new Map((view.known||[]).map(row=>[row.witness,row.tag]));
 const witnesses=h('div',{class:'witnesses'},s.case.cast.map(member=>{
  const statements=s.statements.filter(row=>row.witness===member.tokenId),caughtIds=new Set(s.caught.map(row=>row.statementId)),hasFollow=statements.some(row=>row.slot==='followup');
  const identified=s.identified.find(row=>row.witness===member.tokenId);
  return h('section',{class:'witness'+(hasFollow?' lean':''),'data-witness':member.tokenId,'aria-label':`Witness ${member.name}`},
   h('header',{},h('span',{class:'mug'},h('img',{src:art(member.tokenId),alt:`${member.name}`,width:76,height:76})),h('div',{},h('div',{class:'name'},member.name),h('div',{class:'nick'},member.nickname),member.link?h('div',{class:'why'},member.link):null,known.has(member.tokenId)?h('span',{class:'tag'},known.get(member.tokenId)):null,identified?h('span',{class:'tag',style:'border-color:var(--alarm);color:var(--alarm)'},identified.message):null)),
   statements.map(row=>{const button=h('button',{class:'statement'+(caughtIds.has(row.id)?' caught':''),'data-statement':row.id,'aria-pressed':String(state.selected.statement===row.id),'aria-label':`${member.name} says: ${row.line}${caughtIds.has(row.id)?' (caught)':''}`,disabled:caughtIds.has(row.id),
     onclick:()=>{state.selected.statement=state.selected.statement===row.id?null:row.id;drawRoom();},ondragover:event=>event.preventDefault(),ondrop:event=>{event.preventDefault();const receipt=event.dataTransfer.getData('text/plain');if(receipt)void act({type:'present',statementId:row.id,receiptId:receipt});}},h('span',{class:'typed'}));
    typeOut(button.firstChild,row.line);const changed=s.caught.find(item=>item.statementId===row.id);
    return changed?[button,h('p',{class:'statement retraction',role:'note','aria-label':`${member.name} changes its story`},h('span',{class:'typed'},changed.retraction))]:button;}),
   hasFollow?null:h('button',{class:'press','data-press':member.tokenId,onclick:()=>act({type:'press',witness:member.tokenId})},known.has(member.tokenId)?'Press (free)':'Press · 1 question'));
 }));
 const receipts=h('div',{class:'receipts'},s.receipts.map(row=>row.sealed?
  h('div',{class:'receipt-card sealed','data-receipt':row.id},h('span',{},'Sealed receipt'),h('button',{'data-open':row.id,onclick:()=>act({type:'open',receiptId:row.id})},'Open (2 questions)'),['XRAY','LEGEND'].includes(view.detective?.skill??view.badge?.skill)&&s.skillUses>0?h('button',{onclick:()=>act({type:'skill',receiptId:row.id})},'Use skill on this'):null):
  h('button',{class:'receipt-card'+(s.highlighted.includes(row.id)?' highlight':''),'data-receipt':row.id,draggable:'true','aria-pressed':String(state.selected.receipt===row.id),ondragstart:event=>event.dataTransfer.setData('text/plain',row.id),
   onclick:()=>{state.selected.receipt=state.selected.receipt===row.id?null:row.id;if(state.selected.statement&&state.selected.receipt){void act({type:'present',statementId:state.selected.statement,receiptId:state.selected.receipt});return;}drawRoom();}},
   row.text,h('br'),...sourceLinks(row.sources))));
 const skill=view.detective?.skill??view.badge?.skill,skillName=view.detective?.skillName??view.badge?.skillName;
 const useSkill=()=>{if(skill==='ANALYST'){if(!state.selected.statement){notify('Select a statement first, then use Analyst.');return;}void act({type:'skill',statementId:state.selected.statement});return;}if(skill==='XRAY'){notify('Choose “Use skill on this” on a sealed receipt.');return;}void act({type:'skill'});};
 const unlocked=s.caught.map(row=>h('p',{class:'truth-line'},row.unlockedTruth));
 fill(app,h('section',{class:'room'},
  view.mode==='ROOKIE'?h('span',{class:'stamp-label rookie-stamp rookie-desk'},'ROOKIE'):null,
  s.ownChogMessage?h('p',{class:'banner'},s.ownChogMessage):null,
  view.mode==='ROOKIE'?h('p',{class:'type muted'},view.badge.label):null,
  h('div',{class:'room-head'},h('p',{class:'rule'},s.case.ruleLine),h('p',{class:'questions'},h('span',{class:'pips','aria-hidden':'true'},Array.from({length:Math.min(s.questions,12)},()=>h('i'))),`Questions left: ${s.questions}`)),
  h('p',{class:'type'},s.case.setup),...unlocked,witnesses,
  h('div',{class:'tray'},h('h3',{},'Receipts',h('span',{class:'muted type',style:'font-size:13px;text-transform:none'},'Select a statement, then a receipt. Or drag a receipt onto a statement.')),receipts),
  h('div',{class:'room-actions'},
   h('button',{class:'primary',disabled:!(state.selected.statement&&state.selected.receipt),onclick:()=>act({type:'present',statementId:state.selected.statement,receiptId:state.selected.receipt})},'Present receipt'),
   skill==='EMPATH'?h('span',{class:'muted'},'Empath: +2 questions already added.'):h('button',{disabled:s.skillUses<1,onclick:useSkill},`Skill: ${skillName} (${s.skillUses} left)`),
   view.mode==='HOLDER'&&s.burnsLeft>0?h('button',{onclick:bribe},'Bribe the informant: burn 100 $CHOG for +1 question'):null,
   h('button',{onclick:()=>drawSolve()},'Solve the case'))));
}
/** Sends the exact burn transaction from the player's wallet, then waits for the chain to show it before crediting. */
async function bribe(){
 const view=state.view,tokenId=view.detective.tokenId;
 if(!window.ethereum){notify('A wallet is needed to burn $CHOG.','alarm');return;}
 try{
  const intent=await api('/case/burn?tokenId='+tokenId),[from]=await window.ethereum.request({method:'eth_requestAccounts'});
  const tx=await window.ethereum.request({method:'eth_sendTransaction',params:[{from,to:intent.to,data:intent.data}]});
  notify('Burn sent. It counts as soon as the chain shows it.');
  for(let attempt=0;attempt<40;attempt++){
   try{state.view=await api('/case/burn',{method:'POST',body:{tokenId,tx,revision:state.view.state.revision}});notify(state.view.state.notice??'+1 question.','clue');drawRoom();return;}
   catch(error){if(error.code!=='BURN_NOT_FOUND')throw error;await new Promise(resolve=>setTimeout(resolve,5000));}
  }
  notify("We can't see that burn yet. It counts as soon as the chain shows it.",'alarm');
 }catch(error){fail(error);}
}
function drawSolve(){
 const view=state.view,s=view.state;
 const blanks=s.case.blanks,tiles=s.case.tiles,label=id=>tiles.find(row=>row.id===state.tiles[id])?.label;
 const sentence=h('p',{class:'sentence'},blanks.map((blank,index)=>[index?` ${blank.label} `:'',h('button',{class:'blank','data-blank':blank.id,'aria-pressed':String(state.selected.blank===blank.id),'aria-label':`Blank ${index+1}: ${label(blank.id)??'empty'}`,onclick:()=>{state.selected.blank=blank.id;drawSolve();}},label(blank.id)??(index?'…':'Which Chog'))]),'.');
 const tray=h('div',{class:'tiles',role:'group','aria-label':'Phrase tiles'},tiles.map(tile=>h('button',{class:'tile','data-tile':tile.id,onclick:()=>{const target=state.selected.blank??blanks.find(row=>!state.tiles[row.id])?.id;if(!target)return;state.tiles[target]=tile.id;state.selected.blank=blanks.find(row=>!state.tiles[row.id])?.id??null;drawSolve();}},tile.label)));
 fill(app,h('section',{class:'room'},h('h2',{},'Solve the case'),h('p',{class:'type'},'Fill the sentence with the tiles. You have two submissions; the second ends the case.'),
  s.feedback?h('p',{class:'banner'},`Last try: ${s.feedback}`):null,sentence,tray,
  h('div',{class:'room-actions'},h('button',{class:'primary',disabled:blanks.some(row=>!state.tiles[row.id]),onclick:()=>act({type:'solve',tiles:state.tiles})},'Submit solution'),h('button',{onclick:()=>{state.tiles={};drawSolve();}},'Clear'),h('button',{onclick:()=>drawRoom()},'Back to the room'))));
}
function shareGrid(view,record){
 const s=view.state,result=s.result,lieCount=result.panels.length,caught=s.caught.length,summary=view.case;
 const lines=[`CHOG NOIR #${summary.number} · ${summary.weekday}`,view.mode==='ROOKIE'?'ROOKIE DESK':`🕵️ ${view.detective.name}${view.detective.founder?' · Founder':''}${record?' · '+record.rank:''}`,
  `Lies ${'🟥'.repeat(caught)}${'⬛'.repeat(Math.max(0,lieCount-caught))}  Solution ${result.solved?'✅':'❌'}  Questions left ${s.questions}`];
 if(record&&view.mode==='HOLDER')lines.push(`Streak ${record.streak} 🔥`);
 return lines.join('\n');
}
/** Shows the reveal at once. A holder's record line and streak arrive afterwards, so a slow record never holds back the reveal. */
function drawReveal(){
 sound.rainStop();
 const view=state.view,s=view.state,result=s.result,url=location.origin+'/';
 let grid=shareGrid(view,null);
 const recordLine=h('p',{class:'record-line'}),share=h('pre',{class:'share'},grid),post=h('a',{href:'https://x.com/intent/post?text='+encodeURIComponent(grid+'\n'+url),target:'_blank',rel:'noopener'},'Post on X');
 fill(app,h('section',{class:'reveal'},
  h('div',{class:'closed-stamp '+(result.solved?'solved':'cold'),'aria-hidden':'true'},result.solved?'CASE CLOSED':'CASE COLD'),
  view.mode==='ROOKIE'?h('span',{class:'stamp-label rookie-stamp'},'ROOKIE DESK'):null,
  h('h2',{},'What really happened'),
  h('div',{},result.panels.map(panel=>h('article',{class:'panel'},h('p',{class:'false'},panel.statement),h('p',{class:'label'},panel.label),h('p',{class:'type'},panel.receipt.text,' ',...sourceLinks(panel.receipt.sources)),h('p',{class:'muted'},panel.inference)))),
  h('h3',{},'The true story'),result.truth.map(row=>h('p',{class:'truth-line'},row.text,' ',...sourceLinks(row.sources))),
  view.hook?h('p',{class:'type'},view.hook.text,' ',...sourceLinks([view.hook.source]),' · ',link('/arc','Follow the story')):null,
  h('p',{class:'grade','aria-label':`Grade ${result.grade}`},result.grade),h('p',{},`Score ${result.score} of ${result.max} · ${result.solved?'Solved':'Not solved'}${s.solutionAttempt===1?' on the first try':''}`),
  view.mode==='HOLDER'?recordLine:null,
  view.mode==='HOLDER'&&view.transferredMidCase?h('p',{class:'muted'},'This Chog left the wallet during the case. The result stays on the token, marked “transferred mid-case”.'):null,
  view.mode==='ROOKIE'?h('p',{class:'banner'},view.invitation,' ',h('a',{href:OPENSEA,target:'_blank',rel:'noopener'},'See Chogs on OpenSea')):null,
  h('h3',{},'Share'),share,
  h('div',{class:'actions'},h('button',{onclick:async()=>{try{await navigator.clipboard.writeText(grid+'\n'+url);notify('Copied.','clue');}catch{notify('Copy is blocked in this browser. Select the text instead.');}}},'Copy'),
   post,' · ',
   h('a',{href:'/api/case/share-image'+(view.mode==='HOLDER'?'?tokenId='+view.detective.tokenId:''),download:'chog-noir-result.png'},'Download share image'),' · ',link(`/case/${encodeURIComponent(view.case.id)}/stats`,'Global results',{onclick:async event=>{event.preventDefault();event.stopPropagation();await showStats();}}))));
 if(view.mode!=='HOLDER')return;
 const id=view.detective.tokenId;recordLine.textContent='Updating the detective record…';
 void api('/chog/'+id).then(data=>data.career).catch(()=>null).then(record=>{
  if(state.view!==view)return;
  if(!record){fill(recordLine,'The detective record is updating. ',link('/chog/'+id,'Open the record'));return;}
  if(state.detective)state.detective={...state.detective,streak:record.streak};renderBadge();
  fill(recordLine,`${view.detective.name}: ${record.rank} · ${record.solves} solved · streak ${record.streak} · `,link('/chog/'+id,'Detective record'));
  grid=shareGrid(view,record);share.textContent=grid;post.href='https://x.com/intent/post?text='+encodeURIComponent(grid+'\n'+url);
 });
}
async function showStats(){
 const view=state.view;
 try{const stats=await api(`/case/${view.case.id}/stats${view.mode==='HOLDER'?'?tokenId='+view.detective.tokenId:''}`);
  notify(stats.detectives?`${stats.detectives} detective${stats.detectives===1?'':'s'} so far: `+stats.lies.map(row=>`lie ${row.id} caught by ${row.caughtPercent}%`).join(', ')+`; ${stats.firstTryPercent}% solved on the first try.`:'You are the first detective to finish this case.','clue');
 }catch(error){fail(error);}
}

/* Training case: a real archived case reduced to two witnesses and one lie. It counts for nothing. */
async function training(){
 let session=await api('/training/start',{method:'POST',body:{}}).catch(error=>{fail(error);return null;});if(!session)return;
 const draw=()=>{
  const t=session.view;
  if(t.done){fill(app,h('span',{class:'stamp-label replay-label'},'TRAINING · REPLAY'),h('h2',{},t.feedback==='All correct'?'Case #0 closed.':'Case #0 closed.'),h('p',{},t.feedback==='All correct'?'That is the whole game: break the lie with a receipt, then say what really happened.':'Close. In the real case you get a second try.'),h('div',{class:'actions'},h('button',{class:'primary',onclick:()=>history.length>1?history.back():go('/')},'Take today’s case')));return;}
  fill(app,h('section',{class:'room'},h('span',{class:'stamp-label replay-label'},'TRAINING · REPLAY'),h('p',{class:'rule'},t.ruleLine),h('p',{class:'type'},t.setup),
   h('div',{class:'witnesses'},t.cast.map(member=>h('section',{class:'witness','data-witness':member.tokenId},h('header',{},h('img',{src:art(member.tokenId),alt:member.name}),h('div',{},h('div',{class:'name'},member.name),h('div',{class:'nick'},member.nickname))),
    t.statements.filter(row=>row.witness===member.tokenId).map(row=>h('button',{class:'statement'+(t.caught?' caught':''),'data-statement':row.id,'aria-pressed':String(state.selected.statement===row.id),onclick:()=>{state.selected.statement=row.id;draw();}},row.line))))),
   h('div',{class:'tray'},h('h3',{},'Receipts'),h('div',{class:'receipts'},t.receipts.map(row=>h('button',{class:'receipt-card','data-receipt':row.id,'aria-pressed':String(state.selected.receipt===row.id),onclick:async()=>{state.selected.receipt=row.id;if(state.selected.statement){await send({type:'present',statementId:state.selected.statement,receiptId:row.id});}else draw();}},row.text)))),
   t.caught?h('div',{},h('p',{class:'truth-line'},t.unlockedTruth),h('p',{class:'sentence'},t.blanks.map((blank,index)=>[index?` ${blank.label} `:'',h('button',{class:'blank','data-blank':blank.id,'aria-pressed':String(state.selected.blank===blank.id),onclick:()=>{state.selected.blank=blank.id;draw();}},t.tiles.find(tile=>tile.id===state.tiles[blank.id])?.label??'…')]),'.'),
    h('div',{class:'tiles'},t.tiles.map(tile=>h('button',{class:'tile','data-tile':tile.id,onclick:()=>{const target=state.selected.blank??t.blanks.find(row=>!state.tiles[row.id])?.id;if(target){state.tiles[target]=tile.id;state.selected.blank=null;draw();}}},tile.label))),
    h('button',{class:'primary',disabled:t.blanks.some(row=>!state.tiles[row.id]),onclick:()=>send({type:'solve',tiles:state.tiles})},'Submit')):null,
   h('div',{class:'room-actions'},h('button',{onclick:()=>history.length>1?history.back():go('/')},'Skip training'))));
 };
 const send=async action=>{try{session=await api('/training/action',{method:'POST',body:{token:session.token,action}});state.selected={statement:null,receipt:null,blank:null};if(session.view.notice?.startsWith('CAUGHT')){sound.thud();notify(session.view.notice,'clue');}else if(session.view.notice)notify(session.view.notice,'alarm');draw();}catch(error){fail(error);}};
 state.selected={statement:null,receipt:null,blank:null};state.tiles={};draw();
}

/* The ongoing story: a Chog that keeps moving, with a free hunch about tonight. */
async function arcPage(){
 const node=h('div',{});
 const draw=data=>{
  if(!data.arc){fill(node,h('h2',{},'The story board'),h('p',{class:'type'},data.empty));return;}
  const {arc,hunch,yesterday}=data,vote=answer=>async()=>{try{draw(await api('/arc/hunch',{method:'POST',body:{answer}}));notify('Hunch noted. The chain will answer.','clue');}catch(error){fail(error);}};
  fill(node,h('section',{class:'hero'},h('div',{},h('h2',{},`${arc.name} keeps moving`),h('p',{},`${arc.moves.length} real moves this week. `,link('/chog/'+arc.tokenId,'Its record')),
    h('h3',{},'Hunch'),h('p',{class:'type'},hunch.question+' No stake; just a hunch.'),
    hunch.mine?h('p',{class:'banner'},`Your hunch: ${hunch.mine}. So far ${hunch.yes} yes, ${hunch.no} no.`):h('div',{class:'actions'},h('button',{class:'primary',onclick:vote('yes')},'Yes'),h('button',{onclick:vote('no')},'No')),
    h('p',{class:'muted'},`Yesterday (${yesterday.day}): it ${yesterday.answer==='yes'?'did':'did not'} move. ${yesterday.yes} said yes, ${yesterday.no} said no.`)),
   h('figure',{class:'dossier'},portrait(arc.tokenId,{alt:arc.name??'The Chog on the move',eager:true,sizes:'(max-width:860px) 100vw, 420px'}),h('div',{class:'blinds','aria-hidden':'true'}))),
   h('h3',{},'Timeline'),h('ol',{reversed:true},arc.moves.map(row=>h('li',{class:'type'},`${new Date(row.at*1000).toUTCString().slice(0,22)} UTC · ${row.text} `,...sourceLinks([row.source])))));
 };
 draw(await api('/arc/current'));fill(app,node);
 // New real moves arrive through the live feed; the timeline reloads within seconds of one.
 try{const source=new EventSource('/api/events');state.streams.push(source);let seen='';source.addEventListener('feed',async event=>{const feed=JSON.parse(event.data),first=feed.events?.[0]?.id??'';if(seen&&first!==seen)draw(await api('/arc/current'));seen=first;});}catch{}
}

/* Alerts: opt-in only. The browser asks for permission; a refusal is respected and explained. */
async function alertMe(tokenId){
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){notify('This browser cannot receive alerts.','alarm');return;}
  if(await Notification.requestPermission()!=='granted'){notify('Alerts are off in your browser settings.','alarm');return;}
  const registration=await navigator.serviceWorker.register('/sw.js'),{publicKey}=await api('/push/key');
  const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-publicKey.length%4)%4)),char=>char.charCodeAt(0));
  const subscription=(await registration.pushManager.getSubscription())??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await api('/push/subscribe',{method:'POST',body:{subscription:subscription.toJSON(),...(tokenId?{tokenId}:{})}});
  notify(tokenId?'You will hear when this Chog is in a case, and when each new case opens.':'You will hear when each new case opens.','clue');
 }catch(error){fail(error);}
}

/* Public pages */
async function precinct(){
 const node=h('div',{});
 const draw=board=>{
  fill(node,h('h2',{},'Precinct board'),board.case?caseCard(board.case):null,board.rookieLine?h('p',{class:'type'},board.rookieLine):null,
   board.empty?h('p',{class:'type'},board.empty):h('div',{class:'board'},board.tiles.map(tile=>h('a',{class:'tile-card',href:'/chog/'+tile.tokenId,'data-link':true},h('img',{src:art(tile.tokenId,'thumbs'),alt:''}),h('div',{},h('strong',{},tile.name)),h('div',{class:'muted'},`${tile.rank} · streak ${tile.streak}`),h('div',{'aria-label':`${tile.liesCaught} lies caught`},'🟥'.repeat(tile.liesCaught)||'—'),tile.grade?h('div',{class:'grade',style:'font-size:28px'},tile.grade):null))),
   board.catches.length?h('ul',{class:'type'},board.catches.map(row=>h('li',{},row.text))):null);
 };
 draw(await api('/precinct'));fill(app,node,...ticker());
 try{const source=new EventSource('/api/precinct/stream');state.streams.push(source);source.addEventListener('precinct',event=>draw(JSON.parse(event.data)));}catch{}
}
async function issues(){
 const list=(await api('/issues')).issues;
 fill(app,h('h2',{},'Chog Noir issues'),list.length?h('ol',{reversed:true,class:'issue-list'},list.map(row=>h('li',{},h('img',{src:art(row.subject.tokenId,'thumbs'),alt:'',width:72,height:72,loading:'lazy'}),h('div',{},link('/issues/'+row.number,`Issue #${row.number} · ${row.title} · ${row.subject.name}`),' · ',h('a',{href:explorer(row.openTx),target:'_blank',rel:'noopener'},'locked'),' · ',h('a',{href:explorer(row.closeTx),target:'_blank',rel:'noopener'},'revealed'))))):h('p',{class:'type'},'The first issue appears when the first case closes.'));
}
async function issue(number){
 const data=await api('/issues/'+number),reveal=data.reveal;
 fill(app,h('h2',{},`Issue #${data.number} · ${data.case.title}`),caseCard(data.case),
  reveal.panels.map(panel=>h('article',{class:'panel'},h('p',{class:'false'},panel.statement),h('p',{class:'label'},panel.label),h('p',{class:'type'},panel.receipt.text,' ',...sourceLinks(panel.receipt.sources)),h('p',{class:'muted'},panel.inference))),
  h('h3',{},'The true story'),reveal.truth.map(row=>h('p',{class:'truth-line'},row.text,' ',...sourceLinks(row.sources))),
  data.hook?h('p',{class:'type'},data.hook.text,' ',...sourceLinks([data.hook.source]),' · ',link('/arc','Follow the story')):null,
  h('figure',{},h('img',{src:`/api/issues/${data.number}/image`,alt:`Chog Noir Issue #${data.number}: four panels from real Chog art, ending with what really happened.`,style:'width:100%;max-width:540px;border-radius:8px'}),h('figcaption',{},h('a',{href:`/api/issues/${data.number}/image`,download:`chog-noir-issue-${data.number}.png`},'Portrait'),' · ',h('a',{href:`/api/issues/${data.number}/image?format=landscape`,download:`chog-noir-issue-${data.number}-landscape.png`},'Landscape'))),
  h('p',{},h('a',{href:explorer(data.openTx),target:'_blank',rel:'noopener'},'Answer locked on chain'),' · ',h('a',{href:explorer(data.closeTx),target:'_blank',rel:'noopener'},'Answer revealed on chain'),' · ',link('/verify/'+data.case.id,'Verify')),
  h('p',{},'Witnesses: ',data.case.cast.map((row,index)=>[index?', ':'',link('/chog/'+row.tokenId,row.name)])));
}
async function profile(id){
 const data=await api('/chog/'+id),c=data.career;
 fill(app,h('section',{class:'hero'},h('div',{},h('h2',{},data.name),h('p',{class:'type'},`${data.skill.name}: ${data.skill.line}`),data.founder?h('p',{class:'tag'},'Founder: never moved since mint'):null,
   h('table',{},h('tbody',{},[['Rank',c.rank],['Cases solved',c.solves],['Lies caught',c.liesCaught],['Perfect cases',c.perfectCases],['Streak',`${c.streak} (best ${c.bestStreak}, freezes ${c.freezes})`],['Called as witness',data.witness.called],['Caught lying as a witness',data.witness.lied]].map(([key,value])=>h('tr',{},h('th',{},key),h('td',{},String(value))))))),
  h('figure',{class:'dossier'},portrait(id,{alt:`${data.name}. ${data.traits.map(row=>row.display).join(', ')}`,eager:true,sizes:'(max-width:860px) 100vw, 420px'}),h('div',{class:'blinds','aria-hidden':'true'}))),
  state.roster?.chogs?.some(row=>row.tokenId===Number(id))?h('button',{onclick:()=>alertMe(Number(id))},'Alert me when this Chog is in a case'):null,
  data.chogStamp?h('p',{class:'tag'},'$CHOG holder'):null,
  h('h3',{},'Traits'),h('p',{},data.traits.map(row=>row.display).join(' · ')),
  h('h3',{},'Rogues’ gallery'),data.gallery.length?h('p',{},data.gallery.map((row,index)=>[index?', ':'',link('/chog/'+row.tokenId,row.name??'Chog')])):h('p',{class:'muted'},'No liars caught yet.'),
  h('h3',{},'Issues'),data.issues.length?h('p',{},'Appeared in ',data.issues.map((row,index)=>[index?', ':'',link('/issues/'+row.number,'Issue #'+row.number)])):h('p',{class:'muted'},'Not in a closed case yet.'),
  h('h3',{},'Case record on chain'),data.results.length?h('ul',{},data.results.map(row=>h('li',{},`${row.day}: grade ${row.grade}${row.transferredMidCase?' (transferred mid-case)':''} `,row.recordTx?row.recordTx.map(tx=>h('a',{href:explorer(tx),target:'_blank',rel:'noopener'},'on-chain record')):h('span',{class:'muted'},'recorded on chain after the case closes')))):h('p',{class:'muted'},'No cases yet.'));
}
async function verify(caseId){
 const input=h('input',{'aria-label':'Case id',placeholder:'case-…',value:caseId??''}),out=h('div',{'aria-live':'polite'});
 const run=async()=>{out.textContent='Checking the chain…';try{const data=await api('/verify/'+encodeURIComponent(input.value.trim()));const result=data.result;fill(out,h('p',{class:'grade',style:'font-size:40px'},result.status==='PASS'?'PASS':result.status.replaceAll('_',' ')),h('p',{},result.message),result.openTx?h('a',{href:explorer(result.openTx),target:'_blank',rel:'noopener'},'Lock transaction'):null,result.closeTx?[' · ',h('a',{href:explorer(result.closeTx),target:'_blank',rel:'noopener'},'Reveal transaction')]:null);}catch(error){fill(out,h('p',{},'FAIL or unavailable: '+error.message));}};
 fill(app,h('h2',{},'Verify a case'),h('p',{},'Every answer is locked on chain before you play. Paste a case id to check the lock and, after close, the revealed key.'),input,h('div',{class:'actions'},h('button',{class:'primary',onclick:run},'Verify')),out,h('p',{class:'muted type'},'Command line: corepack pnpm verify <case id>'));
 if(caseId)await run();
}
async function report(){
 const data=await api('/report');
 fill(app,h('h2',{},'Precinct Report'),h('p',{class:'type'},data.day),h('pre',{class:'share'},JSON.stringify(data.summary??data,null,1).slice(0,4000)));
}
async function scamDesk(){
 const input=h('input',{'aria-label':'Wallet address',placeholder:'0x…'}),out=h('div',{'aria-live':'polite'});
 fill(app,h('h2',{},'Scam Desk'),h('p',{},'Paste a wallet. See forged transfer records that name it, each with its proof.'),input,h('div',{class:'actions'},h('button',{class:'primary',onclick:async()=>{out.textContent='Checking…';try{const data=await api('/scam-desk?wallet='+encodeURIComponent(input.value.trim()));fill(out,h('pre',{class:'share'},JSON.stringify(data,null,1).slice(0,6000)));}catch(error){out.textContent=error.message;}}},'Check')),out);
}
function about(){
 const rows=[['Cases','Real Chog transfers and sales on Monad mainnet, read from the chain.','Nothing invented'],['Statements','Witness lines in character. Lies happen only inside statements during play.','Lies are planned by code and broken by a real receipt'],['Receipts','One true fact from a real transaction each, with an explorer link.','Never edited'],['Answers','Locked on chain before the case opens, revealed after it closes.','Anyone can verify'],['Rookie desk','Today’s real case, played with a borrowed bureau badge.','Nothing is kept'],['Training case','A real archived case reduced to one lie.','Marked REPLAY; counts for nothing']];
 fill(app,h('h2',{},'What’s real'),h('p',{class:'line'},'Every case is a real event on Monad. Every answer is locked on chain before you play.'),
  h('table',{},h('thead',{},h('tr',{},h('th',{},'Part'),h('th',{},'What it is'),h('th',{},'Rule'))),h('tbody',{},rows.map(row=>h('tr',{},row.map(cell=>h('td',{},cell)))))),
  h('h3',{id:'sources'},'Sources'),h('p',{},'Chog Genesis transfers and Seaport sales on Monad mainnet (chain 143), collection metadata, and the CaseBook contract that locks each answer.'),
  h('h3',{id:'opt-out'},'Opt-out'),h('p',{},'Wallets appear only as noir nicknames. To have a wallet left out of future cases, sign an opt-out from that wallet; it is honoured within 24 hours.'),
  h('p',{},'Chog Genesis by CHOGLABS. Unofficial Chogathon entry.'));
}

void render();
