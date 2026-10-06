import {database} from './db.js';
import type {Movie} from '../lib/movies.js';
const origin='https://www.rottentomatoes.com';
export const rtEnabled=()=>process.env.RT_ENABLED==='true';
function log(event:string,data:unknown){if(process.env.RT_DEBUG==='true')console.log('[RottenTomatoes]',JSON.stringify({event,data}));}
const decode=(s:string)=>s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const normal=(s:string)=>decode(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^se7en$/,'seven');
const attr=(s:string,k:string)=>{const m=s.match(new RegExp('(?:^|\\s)'+k+'\\s*=\\s*(["\'])(.*?)\\1','is'));return m?decode(m[2]):undefined;};
function movieURL(value:string){const u=new URL(value,origin);if(u.origin!==origin||!/^\/m\/[a-z0-9_]+\/?$/i.test(u.pathname)||u.search||u.hash)throw new Error('Invalid RT movie URL');return u.href;}
export function searchCandidates(html:string){
 const out:{title:string;year:number;url:string}[]=[];
 for(const m of html.matchAll(/<search-page-media-row\b([^>]*)>([\s\S]*?)<\/search-page-media-row>/gi)){
  for(const a of m[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi))if(attr(a[1],'slot')==='title'){
   const href=attr(a[1],'href');if(!href)continue;try{out.push({title:decode(a[2].replace(/<[^>]*>/g,'')).trim(),year:Number(attr(m[1],'release-year')),url:movieURL(href)});}catch{/* Ignore TV and external links. */}
  }
 }
 return out;
}
export function parseRT(html:string,expected:Pick<Movie,'title'|'year'>,url:string){
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 const scoreScript=scripts.find(s=>attr(s[1],'id')==='media-scorecard-json');
 const schemas=scripts.filter(s=>attr(s[1],'type')==='application/ld+json').flatMap(s=>{try{const d=JSON.parse(s[2]);return Array.isArray(d)?d:[d,...(d['@graph']||[])];}catch{return [];}});
 const movie=schemas.find(d=>d['@type']==='Movie');
 if(!movie||!scoreScript)throw new Error('RT page format not recognized');
 const year=Number(String(movie.dateCreated||movie.datePublished||'').slice(0,4));
 if(typeof movie.name!=='string'||normal(movie.name)!==normal(expected.title)||year!==expected.year){const detail={expected:{title:expected.title,year:expected.year},returned:{title:movie.name,year,dateCreated:movie.dateCreated,datePublished:movie.datePublished},url};log('identity_mismatch',detail);throw new Error('RT movie title/year mismatch: '+JSON.stringify(detail));}
 if(movie.url&&movieURL(movie.url)!==movieURL(url))throw new Error('RT canonical URL mismatch');
 const data=JSON.parse(scoreScript[2]);
 const score=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;if(!/^(?:\d{1,2}|100)$/.test(String(v)))throw new Error('Invalid RT score');return Number(v);};
 return {title:movie.name as string,year,url:movieURL(url),critics:score(data.criticsScore?.score),audience:data.hideAudienceScore===true?null:score(data.audienceScore?.score),audienceType:typeof data.audienceScore?.scoreType==='string'?data.audienceScore.scoreType:'UNSPECIFIED',checkedAt:new Date().toISOString()};
}
type Result=ReturnType<typeof parseRT>;
async function page(url:string){
 const u=new URL(url);if(u.origin!==origin)throw new Error('Invalid RT request origin');
 const limit=Number(process.env.RT_DAILY_LIMIT||100);if(!Number.isInteger(limit)||limit<1)throw new Error('Invalid RT daily limit');
 const granted=await database().prepare('INSERT INTO provider_usage(day,provider,requests) VALUES(?,?,1) ON CONFLICT(day,provider) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests').bind(new Date().toISOString().slice(0,10),'RT',limit).first();if(!granted)throw new Error('RT daily request budget reached');
 const r=await fetch(url,{headers:{Accept:'text/html','User-Agent':'MovieScout/1.0'},redirect:'error',signal:AbortSignal.timeout(12000)});
 log('http',{path:u.pathname,status:r.status});if(!r.ok)throw new Error(`RT HTTP ${r.status}`);
 const reader=r.body?.getReader();if(!reader)throw new Error('Empty RT response');const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>3000000){await reader.cancel();throw new Error('RT response exceeds size limit');}chunks.push(value);}
 return Buffer.concat(chunks).toString('utf8');
}
const pending=new Map<number,Promise<Result|null>>();
async function collect(m:Movie):Promise<Result|null>{
 const db=database();const cached=await db.prepare('SELECT data,expires_at FROM rt_cache WHERE movie_id=?').bind(m.id).first<{data:string;expires_at:number}>();
 if(cached&&cached.expires_at>Date.now()){log('cache_hit',{id:m.id});return JSON.parse(cached.data);}
 if(!m.year)return null;
 let result:Result|null=null;
 const old:Result|null=cached?JSON.parse(cached.data):null;
 if(old)result=parseRT(await page(movieURL(old.url)),m,old.url);
 else{
  const query=normal(m.title)==='seven'?'Seven':m.title;
  const candidates=searchCandidates(await page(origin+'/search?search='+encodeURIComponent(query)));
  log('candidates',{movieId:m.id,title:m.title,year:m.year,candidates});
  const matches=[...new Map(candidates.filter(c=>normal(c.title)===normal(m.title)&&c.year===m.year).map(c=>[c.url,c])).values()];
  if(matches.length===1)result=parseRT(await page(matches[0].url),m,matches[0].url);
  else log('unmatched',{movieId:m.id,reason:matches.length?'ambiguous':'no_exact_title_year_match'});
 }
 const ttl=result&&(result.critics!==null||result.audience!==null)?7*86400000:86400000;
 await db.prepare('INSERT INTO rt_cache(movie_id,data,expires_at) VALUES(?,?,?) ON CONFLICT(movie_id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at').bind(m.id,JSON.stringify(result),Date.now()+ttl).run();
 log('result',{movieId:m.id,result});return result;
}
export async function enrichRT(m:Movie){
 let task=pending.get(m.id);if(!task){task=collect(m).finally(()=>pending.delete(m.id));pending.set(m.id,task);}
 const result=await task;if(!result)return;
 for(const key of ['critics','audience'] as const)if(result[key]!==null){m.scores[key]=result[key];m.scoreEvidence[key]={source:'Rotten Tomatoes',url:result.url,checkedAt:result.checkedAt,note:key==='audience'?`Displayed Popcornmeter (${result.audienceType} ratings).`:'Displayed Tomatometer.'};}
}
