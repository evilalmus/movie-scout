import {database} from './db.js';
import type {Movie,Guidance,Category} from '../lib/movies.js';
const origin='https://kids-in-mind.com';
const day=86400000;
class Deferred extends Error {}
export function kimEnabled(){return process.env.KIM_ENABLED==='true';}
function limit(){return Math.max(1,Math.min(10,Number(process.env.KIM_DAILY_LIMIT)||10));}
function interval(){return Math.max(60000,(Number(process.env.KIM_INTERVAL_SECONDS)||120)*1000);}
export function decode(s:string){return s.replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,v)=>String.fromCodePoint(Math.min(0x10ffff,v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v)))).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,v=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '})[v]!).trim();}
export function normalized(s:string){return decode(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/se7en/g,'seven').replace(/[^\p{L}\p{N}]/gu,'');}
export function safeURL(raw:string){const u=new URL(decode(raw),origin);if(u.origin!==origin||u.username||u.password)throw new Error('Unexpected Kids-in-Mind URL');u.hash='';return u.toString();}
export function reviewLinks(html:string,title:string,year?:number|null){const found=new Set<string>();for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{const u=safeURL(m[1]),text=decode(m[2]),identity=text.match(/^(.*?)\s*\[(\d{4})\]/);if(identity&&year&&Number(identity[2])!==year)continue;if(new URL(u).pathname.endsWith('.htm')&&normalized(identity?identity[1]:text)===normalized(title))found.add(u);}catch{}}return found.size>5?[]:[...found];}
export function parseKIM(html:string,m:Pick<Movie,'title'|'year'>,url:string){
 const title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 const match=title.match(/^(.*?)\s*\[(\d{4})\]\s*\[[^\]]+\]\s*[-–—]\s*(\d+)\.(\d+)\.(\d+)/);
 if(!match||normalized(match[1])!==normalized(m.title)||Number(match[2])!==m.year)throw new Error('Movie title/year mismatch or unsupported page format');
 const canonical=html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
 if(!canonical||safeURL(canonical)!==safeURL(url))throw new Error('Review canonical URL mismatch');
 const values=match.slice(3).map(Number);if(values.some(n=>!Number.isInteger(n)||n<0||n>10))throw new Error('Invalid Kids-in-Mind score');
 const headings=[...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(x=>decode(x[1]));
 const labels=['SEX/NUDITY','VIOLENCE/GORE','LANGUAGE'];
 values.forEach((v,i)=>{if(!headings.some(h=>h.endsWith(labels[i]+' '+v)))throw new Error('Review score headings do not agree');});
 const guidance:Partial<Record<Category,Guidance>>={};
 (['sexNudity','violence','profanity'] as const).forEach((k,i)=>guidance[k]={level:values[i],scaleMax:10,present:null,source:'Kids-in-Mind',url:safeURL(url),checkedAt:new Date().toISOString(),note:k==='sexNudity'?'Combined sex/nudity intensity; does not establish visible nudity.':'Theatrical version. Read the linked review for context.'});
 return guidance;
}
// Conservative: honor disallows from every group and the longest stated delay.
// Allow exceptions are intentionally not used to weaken a restriction.
export function robotsPolicy(body:string,path:string){
 if(/<html|<!doctype/i.test(body))throw new Error('Invalid robots response');
 let delay=30;let allowed=true;
 for(const raw of body.split(/\r?\n/)){const line=raw.split('#')[0].trim();const at=line.indexOf(':');if(at<0)continue;const key=line.slice(0,at).toLowerCase(),v=line.slice(at+1).trim();
 if(key==='crawl-delay'){const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error('Invalid crawl delay');delay=Math.max(delay,n);}
 if(key==='disallow'&&v){const expr=v.split('*').map(s=>s.replace(/[.+?^{}()|[\]\\]/g,'\\$&')).join('.*');if(new RegExp('^'+expr).test(path))allowed=false;}}
 return {allowed,delay};
}
async function event(name:string,details:Record<string,unknown>={}){const value=JSON.stringify({event:name,...details});console.log('[KidsInMind]',value);await database().prepare('UPDATE kim_state SET last_event=? WHERE id=1').bind(value).run();}
async function reserve(extraDelay=0){
 const db=database(),now=Date.now(),today=new Date().toISOString().slice(0,10);
 const usage=await db.prepare("SELECT requests FROM provider_usage WHERE day=? AND provider='KIM'").bind(today).first<{requests:number}>();if((usage?.requests||0)>=limit())throw new Deferred();
 const claim=await db.prepare('UPDATE kim_state SET next_request=?,last_request=? WHERE id=1 AND paused IS NULL AND next_request<=? AND last_request<=? RETURNING id').bind(now+Math.max(interval(),extraDelay),now,now,now-Math.max(interval(),extraDelay)).first();if(!claim)throw new Deferred();
 const granted=await db.prepare("INSERT INTO provider_usage(day,provider,requests) VALUES(?,'KIM',1) ON CONFLICT(day,provider) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests").bind(today,limit()).first();if(!granted)throw new Deferred();
}
async function download(url:string,ttl:number,delay=0){
 await reserve(delay);const db=database();
 try{
 const contact=process.env.KIM_CONTACT?.trim();if(!contact)throw new Error('KIM_CONTACT is required');
 const response=await fetch(url,{headers:{'User-Agent':`MovieScout/1.0 (+${contact})`,Accept:url.endsWith('/robots.txt')?'text/plain':'text/html'},redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(response.status>=400&&response.headers.has('retry-after')){const r=response.headers.get('retry-after')!;const until=/^\d+$/.test(r)?Date.now()+Number(r)*1000:Date.parse(r);if(Number.isFinite(until))await db.prepare('UPDATE kim_state SET next_request=MAX(next_request,?) WHERE id=1').bind(until).run();}
 if(response.status===401||response.status===403){await db.prepare('UPDATE kim_state SET paused=? WHERE id=1').bind('Access denied; review before manually resuming.').run();throw new Error('Access denied');}
 if(response.status===429){const r=response.headers.get('retry-after')||'';const until=/^\d+$/.test(r)?Date.now()+Number(r)*1000:Date.parse(r);await db.prepare('UPDATE kim_state SET next_request=MAX(next_request,?) WHERE id=1').bind(Math.max(Date.now()+day,Number.isFinite(until)?until:0)).run();throw new Error('Rate limited; paused at least 24 hours');}
 if(response.status>=300&&response.status<400){
 if(url.endsWith('/robots.txt'))throw new Error('Robots redirect requires review');
 let target='';try{target=safeURL(new URL(response.headers.get('location')||'',url).toString());}catch{}
 const body=target&&target!==url?'KIM_REDIRECT:'+target:'';
 await db.prepare('INSERT INTO kim_pages(url,body,expires_at) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at').bind(url,body,Date.now()+ttl).run();
 await event('redirect',{url,target:target||'External redirect not followed'});return body;
 }
 if(!response.ok&&response.status!==404)throw new Error('HTTP '+response.status);
 if(response.status===404&&url.endsWith('/robots.txt'))throw new Error('Robots unavailable');
 let body='';let size=0;const decoder=new TextDecoder();if(response.body){for await(const chunk of response.body as any){size+=chunk.length;if(size>2*1024*1024)throw new Error('Page too large');body+=decoder.decode(chunk,{stream:true});}body+=decoder.decode();}
 if(/<title[^>]*>\s*(Just a moment|Attention Required)|cf-chl-|challenge-platform|captcha-container/i.test(body)){await db.prepare('UPDATE kim_state SET paused=? WHERE id=1').bind('Access challenge; no automated bypass.').run();throw new Error('Access challenge');}
 if(response.status===404)body='';
 if(url.endsWith('/robots.txt')){const policy=robotsPolicy(body,'/');await db.prepare('UPDATE kim_state SET next_request=MAX(next_request,?) WHERE id=1').bind(Date.now()+policy.delay*1000).run();}
 await db.prepare('INSERT INTO kim_pages(url,body,expires_at) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at').bind(url,body,Date.now()+ttl).run();
 await db.prepare('UPDATE kim_state SET failures=0 WHERE id=1').run();await event('http',{url,status:response.status});return body;
 }catch(e){await db.prepare('UPDATE kim_state SET failures=failures+1,next_request=MAX(next_request,? + MIN(86400000,3600000 * (1 << MIN(failures,5)))) WHERE id=1').bind(Date.now()).run();await event('backoff',{url,error:e instanceof Error?e.message:'Request failed'});throw new Deferred();}
}
async function cached(url:string){return database().prepare('SELECT body FROM kim_pages WHERE url=? AND expires_at>?').bind(url,Date.now()).first<{body:string}>();}
async function page(raw:string,ttl:number,depth=0):Promise<string>{
 const url=safeURL(raw);if(depth>=3){await event('redirect_limit',{url});return '';}
 let body=(await cached(url))?.body;
 if(body===undefined){
 const robotsURL=origin+'/robots.txt';const robots=await cached(robotsURL);if(!robots){await download(robotsURL,day);throw new Deferred();}
 const policy=robotsPolicy(robots.body,new URL(url).pathname+new URL(url).search);if(!policy.allowed){await database().prepare('UPDATE kim_state SET paused=? WHERE id=1').bind('Robots disallows '+new URL(url).pathname).run();await event('robots_disallowed',{url});throw new Deferred();}
 body=await download(url,ttl,policy.delay*1000);
 }
 return body.startsWith('KIM_REDIRECT:')?page(body.slice(13),ttl,depth+1):body;
}
export async function applyKIM(movie:Movie){const row=await database().prepare("SELECT data FROM kim_results WHERE movie_id=? AND status='matched'").bind(movie.id).first<{data:string}>();if(!row)return;const guidance=JSON.parse(row.data);movie.kidsInMind=guidance;for(const [k,v] of Object.entries(guidance)){const key=k as Category;if(movie.guidance[key]?.level==null||movie.guidance[key]?.source==='Kids-in-Mind')movie.guidance[key]=v as Guidance;}}
let busy=false;
export async function kimTick(){
 if(busy||!kimEnabled()||!process.env.KIM_CONTACT)return;busy=true;
 try{
 const db=database();const discovery=await import('./kim-discovery.js');await discovery.processDiscovery();await db.prepare('DELETE FROM kim_pages WHERE expires_at<=?').bind(Date.now()).run();const state=await db.prepare('SELECT paused,next_request FROM kim_state WHERE id=1').first<{paused:string|null;next_request:number}>();if(state?.paused||state&&state.next_request>Date.now())return;
 const row=await db.prepare("SELECT m.id,m.data FROM movies m LEFT JOIN kim_results k ON k.movie_id=m.id WHERE k.movie_id IS NULL OR k.retry_at<=? ORDER BY COALESCE(k.retry_at,0),m.id LIMIT 1").bind(Date.now()).first<{id:number;data:string}>();if(!row)return;
 const movie=JSON.parse(row.data) as Movie;
 let guidance:Partial<Record<Category,Guidance>>|null=null;
 if(movie.year){
 // One cached homepage discovers recent reviews without a search for each title.
 const home=await page(origin+'/',day);let links=reviewLinks(home,movie.title,movie.year);
 if(!links.length){
 const searchURL=origin+'/search-desktop.htm?fwp_keyword='+encodeURIComponent(movie.title.replace(/\bse7en\b/gi,'Seven'));
 const searchHTML=await page(searchURL,30*day);
 await discovery.harvestResults(searchHTML,searchURL);
 await discovery.attachExisting();
 const harvested=await db.prepare("SELECT status,retry_at FROM kim_results WHERE movie_id=?").bind(movie.id).first<{status:string;retry_at:number}>();
 if(harvested?.status==='matched'&&harvested.retry_at>Date.now())return;
 links=reviewLinks(searchHTML,movie.title,movie.year);
 }
 await event('candidates',{movieId:movie.id,title:movie.title,year:movie.year,urls:links});
 for(const url of links){const html=await page(url,90*day);try{const parsed=parseKIM(html,movie,url);if(guidance){guidance=null;await event('ambiguous',{movieId:movie.id});break;}guidance=parsed;}catch(e){await event('rejected',{movieId:movie.id,url,error:e instanceof Error?e.message:'Parse failed'});}}
 }
 const status=guidance?'matched':'unmatched';await db.prepare('INSERT INTO kim_results(movie_id,data,retry_at,status) VALUES(?,?,?,?) ON CONFLICT(movie_id) DO UPDATE SET data=excluded.data,retry_at=excluded.retry_at,status=excluded.status').bind(movie.id,JSON.stringify(guidance||{}),Date.now()+(guidance?90:30)*day,status).run();
 if(guidance){const latest=await db.prepare('SELECT data FROM movies WHERE id=?').bind(movie.id).first<{data:string}>();if(latest){const updated=JSON.parse(latest.data) as Movie;await applyKIM(updated);await db.prepare('UPDATE movies SET data=? WHERE id=? AND data=?').bind(JSON.stringify(updated),movie.id,latest.data).run();}}
 await event(status,{movieId:movie.id,title:movie.title});
 }catch(e){if(!(e instanceof Deferred)){await database().prepare('UPDATE kim_state SET next_request=MAX(next_request,?) WHERE id=1').bind(Date.now()+day).run();await event('error',{error:e instanceof Error?e.message:'Collection failed'});}}finally{busy=false;}
}
export async function kimStatus(){const state=await database().prepare('SELECT next_request,paused,failures,last_event FROM kim_state WHERE id=1').first();const usage=await database().prepare("SELECT requests FROM provider_usage WHERE day=? AND provider='KIM'").bind(new Date().toISOString().slice(0,10)).first<{requests:number}>();const discoveries=await database().prepare('SELECT status,COUNT(*) AS count FROM kim_discoveries GROUP BY status').all();return {discoveries:discoveries.results,enabled:kimEnabled(),contactConfigured:!!process.env.KIM_CONTACT,requestsToday:usage?.requests||0,dailyLimit:limit(),intervalSeconds:interval()/1000,...state};}
