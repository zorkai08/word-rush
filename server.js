'use strict';
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'index.html'));
const source=html.toString();
const words=source.match(/const DICTIONARY = new Set\("([a-z ]+)"\.split\(' '\)\)/); if(!words) throw Error('Dictionary missing');
const dict=new Set(words[1].split(' '));
const pools=['AR ER AN IN AT ON OR ST TH EN RE OO EA CH HE AL ES ET IT LE TE OU HA SE IS UN NE RO','ING STR OUS ION ENT TER EST ANT TCH ELL ACK OCK ORE OAD EAD ARE ART AIR IDE OOL EEP OOM ALL IVE UND OUN OVE ATE BLE ICK SH QU PH WH LY ND MP RK LT NT SK','SCR SPL SQU THR SHR NCH RCH TCH OUGH EIGH AUGH EPT UST RST LTH ELM OTH YST OID OX UMP RPH CLY ESK ECT UCT URE ORE IAL EAU AX OZZ OPP XTR'].map(s=>s.split(' '));
const chunks=[...new Set(pools.flat())], index=new Map(chunks.map(c=>[c,[]])); for(const w of dict)for(const c of chunks)if(w.includes(c.toLowerCase()))index.get(c).push(w);
// Topic Rush: curated answer pools, aliases resolve to a single canonical answer.
const topicJSON=source.match(/^const TOPIC_DATA = (.*);$/m); if(!topicJSON)throw Error('Topic data missing');
const topicData=JSON.parse(topicJSON[1]);
function topicKey(v){return String(v??'').normalize('NFKD').toLowerCase().replace(/♀/g,'female').replace(/♂/g,'male').replace(/\p{M}/gu,'').replace(/[^a-z0-9]/g,'')}
const topics=Object.entries(topicData).map(([title,entries])=>{const answers=new Map();for(const [canonical,...aliases] of entries)for(const a of [canonical,...aliases])answers.set(topicKey(a),canonical);return {title,answers}});
function rotateTopic(r){if(!r.topicBag?.length)r.topicBag=topics.filter(t=>t!==r.topic);const i=crypto.randomInt(r.topicBag.length);r.topic=r.topicBag.splice(i,1)[0];r.topicUsed=new Set();r.topicRound=(r.topicRound||0)+1;r.chunk=r.topic.title;}
const rooms=new Map(), sessions=new Map(), kicked=new Map();
const now=()=>Date.now(), rand=()=>crypto.randomBytes(24).toString('hex');
function fail(msg,status=400){throw Object.assign(new Error(msg),{status})}
// Player-name moderation (shared with the multiplayer server).
const NAME_ERROR='Not appropriate. Please choose a different name.';
const NAME_BLOCK_SUB=['nigger','nigga','niglet','faggot','fagot','fagget','tranny','chink','wetback','raghead','towelhead','sandnigger','beaner','darkie','darky','porchmonkey','jigaboo','jiggaboo','jungle bunny','retard','mongoloid','dyke','whore','bitch','fuck','motherfucker','cunt','shit','dickhead','asshole','heilhitler','killalljews','whitepower','hitlerwasright'].map(x=>x.replace(/ /g,''));
const NAME_BLOCK_WORD=new Set(['fag','spic','coon','paki','gook','kike','negro','nazi','kkk','tard','slut','dick','cock','pussy','twat','wank','ass','hoe','zipperhead','cracker','queer']);
// Avoid a few common innocent substring collisions.
const NAME_SAFE_PARTS=['scunthorpe','spice','spicy','spicer','raccoon','cocoon','tycoon','homonym','homophone','homogeneous','shiitake','shitake','chinkapin','kikewise'];
function inappropriateName(value){
 let raw=String(value??'').normalize('NFKD').toLowerCase().replace(/\p{M}|\p{Cf}/gu,'');
 raw=raw.replace(/[аɑеεοоρрсѕіјхυ]/g,c=>({'а':'a','ɑ':'a','е':'e','ε':'e','ο':'o','о':'o','ρ':'p','р':'p','с':'c','ѕ':'s','і':'i','ј':'j','х':'x','υ':'u'}[c]));
 const mapped=raw.replace(/[01345789@$!]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','9':'g','@':'a','$':'s','!':'i'}[c]));
 for(const variant of [raw,mapped]){
  const tokens=variant.split(/[^a-z]+/).filter(Boolean);
  if(tokens.some(t=>NAME_BLOCK_WORD.has(t)))return true;
  let compact=variant.replace(/[^a-z]/g,'');
  for(const part of NAME_SAFE_PARTS)compact=compact.replaceAll(part,' ');
  if(NAME_BLOCK_SUB.some(t=>compact.includes(t)))return true;
  const joined=variant.replace(/[^a-z]/g,'');
  if(NAME_BLOCK_WORD.has(joined))return true;
  if(NAME_BLOCK_SUB.some(t=>compact.replace(/(.)\1{2,}/g,'$1$1').includes(t)))return true;
 }
 return false;
}

function chatMessage(v){
 if(typeof v!=='string')fail('Type a message.');
 const m=v.normalize('NFKC').replace(/[\p{Cf}\p{Cc}]/gu,' ').replace(/\s+/g,' ').trim();
 if(!m||m.length>160)fail('Use 1–160 characters.');
 if(inappropriateName(m)||/\b(?:kill yourself|kys|go die|send nudes)\b/i.test(m))fail('Not appropriate. Keep chat friendly.');
 if(/(?:https?:|www\.|[\w.+-]+@[\w.-]+|\b(?:discord\.gg|t\.me|snapchat|whatsapp)\b|(?:\d[\s().+-]*){7,})/i.test(m))fail('Do not share links or personal contact details.');
 return m;
}
function name(v){const raw=String(v||'Player').trim();if(inappropriateName(raw))fail(NAME_ERROR);return raw.slice(0,22)||'Player'}
function option(v,allowed,d){return allowed.includes(v)?v:d}
function settings(x={}){return {gamemode:option(x.gamemode,['lives','topic'],'lives'),time:option(Number(x.time),[5,8,10,15,20,30],10),min:option(Number(x.min),[3,4,5,6,7,8,9,10],3),lives:option(Number(x.lives),[1,2,3,4,5],3),difficulty:option(x.difficulty,['easy','normal','hard','adaptive'],'adaptive'),max:option(Number(x.max),[2,3,4,5,6,7,8],8)}}
const avatarIds=new Set(["fox", "cat", "dog", "panda", "rabbit", "frog", "bear", "penguin", "koala", "owl", "pig", "tiger"]);
function avatar(v){return avatarIds.has(v)?v:'fox'}
function avatarBg(v){return typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v)?v.toLowerCase():''}
function add(r,n,a,bg){const id=crypto.randomBytes(8).toString('hex'), token=rand(); const p={id,name:name(n),avatar:avatar(a),avatarBg:avatarBg(bg),i:r.players.length,lives:r.config.lives,score:0,outAt:0,last:now(),connected:true};r.players.push(p);sessions.set(token,{r,p});return {token,id}}
function roomCode(){let c;do{c=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('')}while(rooms.has(c));return c}
function alive(r){return r.players.filter(p=>p.connected&&p.lives>0)}
function finish(r){r.draft='';r.phase='done';r.deadline=0;r.ended=now();r.rev++}
function next(r){if(alive(r).length<=1){finish(r);return}for(let j=1;j<=r.players.length;j++){const k=(r.active+j)%r.players.length;if(r.players[k].connected&&r.players[k].lives>0){r.active=k;begin(r);return}}}
function begin(r){r.draft='';r.draftSeq=0;r.turn++;if(r.config.gamemode==='topic'){if(!r.topic||r.changeTopic){rotateTopic(r);r.changeTopic=false;}r.duration=1000*r.config.time;r.deadline=now()+r.duration;r.phase='active';r.rev++;return}let d=r.config.difficulty;if(d==='adaptive')d=r.turn<=5?'easy':r.turn<=14?'normal':'hard';let pool=pools[['easy','normal','hard'].indexOf(d)];const available=c=>index.get(c).some(w=>w.length>=r.config.min&&!r.used.has(w));let p=pool.filter(c=>c!==r.chunk&&available(c));if(!p.length)p=chunks.filter(c=>c!==r.chunk&&available(c));if(!p.length)p=chunks.filter(available);if(!p.length){finish(r);return}r.chunk=p[crypto.randomInt(p.length)];r.duration=1000*(r.config.difficulty==='adaptive'?Math.max(Math.min(r.config.time,4),r.config.time-Math.floor((r.turn-1)/4)):r.config.time);r.deadline=now()+r.duration;r.phase='active';r.rev++}
function settle(r,ok,w){if(r.phase!=='active')return;r.draft='';const p=r.players[r.active];if(ok){r.used.add(w);if(r.config.gamemode==='topic')r.topicUsed.add(w);p.score++;r.log.push({word:w,chunk:r.chunk,player:p.name,topicRound:r.topicRound||0});r.event={ok:true,text:`${p.name}: ${w.toUpperCase()} — nice word!`}}else{if(r.config.gamemode==='topic')r.changeTopic=true;p.lives=Math.max(0,p.lives-1);if(!p.lives)p.outAt=r.turn;r.event={ok:false,text:`Time’s up! ${p.name} ${p.lives?'has '+p.lives+' lives left.':'is out!'}`}}r.phase='transition';r.deadline=0;r.nextAt=now()+(ok?650:1150);r.rev++}
function advance(r){if(r.phase==='active'&&now()>=r.deadline)settle(r,false);if(r.phase==='transition'&&now()>=r.nextAt)next(r)}
function start(r){r.players=r.players.filter(p=>p.connected);r.players.forEach((p,i)=>Object.assign(p,{i,lives:r.config.lives,score:0,outAt:0}));r.used=new Set();r.topic=null;r.topicBag=[];r.topicUsed=new Set();r.topicRound=0;r.changeTopic=false;r.log=[];r.chat=[];r.draft='';r.active=0;r.turn=0;r.chunk='';r.event=null;r.started=now();r.ended=0;begin(r)}
function remove(r,p){if(!p.connected)return;p.connected=false;p.lives=0;p.outAt=r.turn;for(const [t,s] of sessions)if(s.p===p)sessions.delete(t);if(r.host===p.id)r.host=r.players.find(q=>q.connected)?.id;if(!r.host){rooms.delete(r.code);return}if(r.phase==='lobby'){r.players=r.players.filter(q=>q.connected);r.players.forEach((q,i)=>q.i=i)}else if(r.phase==='active'&&r.players[r.active]===p){r.draft='';r.event={ok:false,text:`${p.name} left the match.`};r.phase='transition';r.nextAt=now()+600;r.deadline=0}else if(r.phase!=='done'&&alive(r).length<=1)finish(r);r.rev++}
function snapshot(r,p){return {id:p.id,host:r.host,code:r.code,visibility:r.visibility,config:r.config,phase:r.phase,players:r.players.map(({id,name,avatar,avatarBg,i,lives,score,outAt,connected})=>({id,name,avatar,avatarBg,i,lives,score,outAt,connected})),active:r.active,turn:r.turn,chunk:r.chunk,topicRound:r.topicRound||0,topicUsed:r.topicUsed?.size||0,duration:r.duration,deadline:r.deadline,log:r.log,chat:r.chat||[],draft:r.phase==='active'?r.draft||'':'',event:r.event,rev:r.rev,elapsed:r.started?(r.ended||now())-r.started:0,serverNow:now()}}
setInterval(()=>{for(const r of rooms.values()){for(const p of [...r.players])if(p.connected&&now()-p.last>45000)remove(r,p);if(rooms.has(r.code))advance(r)}},100).unref();
const rate=new Map();setInterval(()=>{rate.clear();for(const [token,until] of kicked)if(now()>=until)kicked.delete(token)},60000).unref();
async function body(req){let buf='';for await(const x of req){buf+=x;if(buf.length>4096)fail('Request too large.',413)}try{return JSON.parse(buf||'{}')}catch{fail('Invalid request')}}
const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(v))};try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html)}if(!url.pathname.startsWith('/api/'))return send({error:'Not found'},404);if(req.method==='GET'&&url.pathname==='/api/rooms'){return send({rooms:[...rooms.values()].filter(r=>r.visibility==='public'&&r.phase==='lobby'&&r.players.length<r.config.max).map(r=>({code:r.code,host:r.players.find(p=>p.id===r.host)?.name,avatar:r.players.find(p=>p.id===r.host)?.avatar,avatarBg:r.players.find(p=>p.id===r.host)?.avatarBg,count:r.players.length,config:r.config}))})}if(req.method!=='POST')return send({error:'Not found'},404);const b=await body(req);const action=url.pathname.slice(5);
if(action==='create'||action==='join'){b.name=name(b.name);const ip=req.socket.remoteAddress,k=ip+action,n=(rate.get(k)||0)+1;rate.set(k,n);if(n>40)fail('Too many attempts. Try again in a minute.',429);let r;if(action==='create'){if(rooms.size>=300)fail('Server is full. Try again later.',503);r={code:roomCode(),visibility:b.visibility==='private'?'private':'public',config:settings(b.config),phase:'lobby',players:[],active:0,turn:0,chunk:'',duration:0,deadline:0,log:[],chat:[],chatSeq:0,draft:'',draftSeq:0,rev:0,event:null};rooms.set(r.code,r)}else{r=rooms.get(String(b.code||'').trim().toUpperCase());if(!r)fail('Room not found. Check the code.',404);if(r.phase!=='lobby')fail('This match has already started.');if(r.players.length>=r.config.max)fail('Room is full.') }const a=add(r,b.name,b.avatar,b.avatarBg);if(!r.host)r.host=a.id;r.rev++;return send({...a,state:snapshot(r,r.players.find(p=>p.id===a.id))})}
const s=sessions.get(b.token);if(!s||!s.p.connected||!rooms.has(s.r.code))fail(kicked.has(b.token)?'You were kicked from the room by the host.':'You are no longer in this room.',401);const {r,p}=s;p.last=now();advance(r);if(action==='leave'){remove(r,p);return send({ok:true})}if(action==='kick'){if(r.host!==p.id)fail('Only the host can kick players.',403);if(r.phase!=='lobby')fail('Players can only be kicked in the lobby.');const target=r.players.find(q=>q.id===b.playerId&&q.connected);if(!target)fail('Player is no longer in this room.',404);if(target===p)fail('The host cannot kick themselves.');for(const [token,session] of sessions)if(session.p===target)kicked.set(token,now()+120000);remove(r,target)}else if(action==='start'){if(r.host!==p.id)fail('Only the host can start.');if(r.phase!=='lobby')fail('Match already started.');if(r.players.length<2)fail('At least two players are needed.');start(r)}else if(action==='rematch'){if(r.host!==p.id||r.phase!=='done')fail('Only the host can reopen a finished lobby.');r.players=r.players.filter(p=>p.connected);r.players.forEach((p,i)=>Object.assign(p,{i,lives:r.config.lives,score:0,outAt:0}));Object.assign(r,{phase:'lobby',turn:0,active:0,chunk:'',log:[],chat:[],draft:'',event:null,deadline:0,started:0,ended:0});r.rev++}else if(action==='chat'){
 if(!['active','transition'].includes(r.phase))fail('Chat is available during matches.');
 if(now()-(p.lastChat||0)<750)fail('Slow down a little.',429);
 p.lastChat=now();const message=chatMessage(b.message);
 r.chat.push({id:++r.chatSeq,playerId:p.id,name:p.name,message});if(r.chat.length>60)r.chat.shift();r.rev++;
}else if(action==='draft'){
 if(r.phase!=='active'||r.players[r.active]!==p||b.turn!==r.turn)return send({state:snapshot(r,p)});
 if(!Number.isSafeInteger(b.seq)||b.seq<=r.draftSeq)return send({state:snapshot(r,p)});
 if(now()-(p.lastDraft||0)<70)return send({state:snapshot(r,p)});
 p.lastDraft=now();r.draftSeq=b.seq;
 const draft=typeof b.text==='string'?b.text.toLowerCase().trim():'';
 const safe=(r.config.gamemode==='topic'?/^[a-z0-9 .,’'!:?&()\[\]\-♀♂]{0,80}$/i.test(draft.normalize('NFKD').replace(/\p{M}/gu,'')):/^[a-z]{0,40}$/.test(draft))&&!inappropriateName(draft)?draft:'';
 if(r.draft!==safe){r.draft=safe;r.rev++}
}else if(action==='word'){if(r.phase!=='active'||r.players[r.active]!==p||b.turn!==r.turn)fail('It is not your turn anymore.');if(r.draft){r.draft='';r.rev++}let w=String(b.word||'').trim().toLowerCase();if(r.config.gamemode==='topic'){if(w.length>80||!w||! /^[\p{L}\p{M}0-9 .,’'!:?&()\[\]\-♀♂]+$/u.test(w))fail('Type a valid topic answer.');const canonical=r.topic.answers.get(topicKey(w));if(!canonical)fail('That answer is not in our '+r.topic.title+' list.');if(r.topicUsed.has(canonical))fail('Already used in this topic!');settle(r,true,canonical);return send({state:snapshot(r,p)})}if(inappropriateName(w))fail('Not appropriate. Try another word.');if(!/^[a-z]{1,40}$/.test(w))fail('Type a single word with letters only.');if(w.length<r.config.min)fail(`Use at least ${r.config.min} letters.`);if(!w.includes(r.chunk.toLowerCase()))fail(`That word doesn’t contain ${r.chunk}.`);if(r.used.has(w))fail('Already used!');if(!dict.has(w))fail('Not in our dictionary.');settle(r,true,w)}else if(action!=='state')fail('Unknown action.',404);send({state:snapshot(r,p)})}catch(e){if(!e.status)console.error(e);send({error:e.status?e.message:'Server error.'},e.status||500)}});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Word Rush listening'));
