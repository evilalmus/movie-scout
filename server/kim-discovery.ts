import {database} from './db.js';
import {decode,normalized,safeURL,applyKIM} from './kids-in-mind.js';
import type {Movie,Guidance,Category} from '../lib/movies.js';
const day=86400000;
export type SearchScore={title:string;year:number;certification:string;url:string;scores:[number,number,number]};
export function parseSearchScores(html:string):SearchScore[]{
 const rows=new Map<string,SearchScore>(),conflicts=new Set<string>();
 for(const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
 try{
 const m=decode(a[2]).match(/^(.*?)\s*\[(\d{4})\]\s*\[(G|PG|PG-13|R|NC-17|NR|Unrated)\]\s*[-–—]\s*(\d+)\.(\d+)\.(\d+)\s*$/i);
 if(!m||!m[1].trim()||Number(m[2])<1888||Number(m[2])>2200)continue;
 const url=safeURL(a[1]);if(!/^\/[a-z]\/[^/?]+\.htm$/i.test(new URL(url).pathname))continue;
 const scores=m.slice(4).map(Number) as [number,number,number];if(scores.some(x=>!Number.isInteger(x)||x<0||x>10))continue;
 const row={title:m[1].trim(),year:Number(m[2]),certification:/^(NR|Unrated)$/i.test(m[3])?'Unrated':m[3].toUpperCase(),url,scores};
 if(rows.has(url)&&JSON.stringify(rows.get(url))!==JSON.stringify(row))conflicts.add(url);else rows.set(url,row);
 }catch{}}
 return [...rows.values()].filter(r=>!conflicts.has(r.url));
}
export async function harvestResults(html:string,searchURL:string){
 const db=database(),rows=parseSearchScores(html);let queued=0;
 for(const row of rows){const result=await db.prepare(`INSERT INTO kim_discoveries(url,identity,data,observed_at) VALUES(?,?,?,?)
 ON CONFLICT(url) DO UPDATE SET identity=excluded.identity,data=excluded.data,status='queued',error=NULL,retry_at=0,observed_at=excluded.observed_at
 WHERE kim_discoveries.data!=excluded.data`).bind(row.url,normalized(row.title)+':'+row.year,JSON.stringify(row),Date.now()).run();queued+=Number(result.changes);}
 if(queued)console.log('[KidsInMind]',JSON.stringify({event:'search_harvest',url:searchURL,results:rows.length,queued}));
 return rows;
}
function guidance(row:SearchScore,observed:number){const data:Partial<Record<Category,Guidance>>={};(['sexNudity','violence','profanity'] as const).forEach((key,i)=>data[key]={level:row.scores[i],scaleMax:10,present:null,source:'Kids-in-Mind',url:row.url,checkedAt:new Date(observed).toISOString(),providerTitle:row.title,providerYear:row.year,note:'Scores from a search-result listing; full review not fetched.'+(key==='sexNudity'?' Combined sex/nudity; does not establish visible nudity.':'')});return data;}
type Discovery={url:string;data:string;identity:string;observed_at:number};
async function existing(row:SearchScore){const rows=await database().prepare("SELECT data FROM movies WHERE json_extract(data,'$.year')=?").bind(row.year).all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data) as Movie).filter(m=>normalized(m.title)===normalized(row.title));}
async function finish(d:Discovery,m:Movie){
 const db=database(),row=JSON.parse(d.data) as SearchScore;
 const others=await db.prepare('SELECT COUNT(*) AS count FROM kim_discoveries WHERE identity=? AND url!=?').bind(d.identity,d.url).first<{count:number}>();
 if(others?.count){await defer(d,'Multiple source reviews share this title/year');return;}
 const previous=await db.prepare('SELECT data,retry_at,status FROM kim_results WHERE movie_id=?').bind(m.id).first<{data:string;retry_at:number;status:string}>();
 // A fresh full-review result takes precedence over a search listing.
 const full=previous?.status==='matched'&&previous.retry_at>Date.now()&&Object.values(JSON.parse(previous.data)).some((g:any)=>!g.note?.includes('search-result listing'));
 if(!full)await db.prepare("INSERT INTO kim_results(movie_id,data,retry_at,status) VALUES(?,?,?,'matched') ON CONFLICT(movie_id) DO UPDATE SET data=excluded.data,retry_at=excluded.retry_at,status='matched'").bind(m.id,JSON.stringify(guidance(row,d.observed_at)),d.observed_at+90*day).run();
 const latest=await db.prepare('SELECT data FROM movies WHERE id=?').bind(m.id).first<{data:string}>();
 if(latest){const movie=JSON.parse(latest.data) as Movie;if(!movie.certification){movie.certification=row.certification;movie.certificationEvidence={source:'Kids-in-Mind',url:row.url,checkedAt:new Date(d.observed_at).toISOString(),note:'Content rating from search-result listing.'};}await applyKIM(movie);await db.prepare('UPDATE movies SET data=? WHERE id=? AND data=?').bind(JSON.stringify(movie),m.id,latest.data).run();}
 await db.prepare("UPDATE kim_discoveries SET status='imported',movie_id=?,error=NULL WHERE url=?").bind(m.id,d.url).run();
 console.log('[KidsInMind]',JSON.stringify({event:'search_scores_attached',movieId:m.id,title:m.title,url:d.url}));
}
async function defer(d:Discovery,error:string,delay=30*day){await database().prepare("UPDATE kim_discoveries SET status='pending',error=?,retry_at=? WHERE url=?").bind(error,Date.now()+delay,d.url).run();console.log('[KidsInMind]',JSON.stringify({event:'discovery_pending',url:d.url,reason:error}));}
export async function attachExisting(){const rows=await database().prepare("SELECT * FROM kim_discoveries WHERE status='queued'").all<Discovery>();for(const d of rows.results){const found=await existing(JSON.parse(d.data));if(found.length===1)await finish(d,found[0]);else if(found.length>1)await defer(d,'Ambiguous local title/year');}}
export function uniqueTMDB(results:any[],row:SearchScore){const ids=new Set<number>();for(const m of results){if(Number.isInteger(m.id)&&m.id>0&&Number(String(m.release_date||'').slice(0,4))===row.year&&[m.title,m.original_title].some(t=>typeof t==='string'&&normalized(t)===normalized(row.title)))ids.add(m.id);}return ids.size===1?[...ids][0]:null;}
export async function processDiscovery(){
 const db=database();await attachExisting();if(!process.env.TMDB_TOKEN)return;
 const d=await db.prepare("SELECT * FROM kim_discoveries WHERE status IN ('queued','pending') AND retry_at<=? ORDER BY observed_at,url LIMIT 1").bind(Date.now()).first<Discovery>();if(!d)return;
 // Persisted lease prevents rapid retries after a process restart.
 const claim=await db.prepare("UPDATE kim_discoveries SET retry_at=? WHERE url=? AND retry_at<=? RETURNING url").bind(Date.now()+120000,d.url,Date.now()).first();if(!claim)return;
 const granted=await db.prepare("INSERT INTO provider_usage(day,provider,requests) VALUES(?,'KIM_DISCOVERY',1) ON CONFLICT(day,provider) DO UPDATE SET requests=requests+1 WHERE requests<20 RETURNING requests").bind(new Date().toISOString().slice(0,10)).first();if(!granted)return;
 const row=JSON.parse(d.data) as SearchScore;
 try{
 const {tmdb,collectMovie}=await import('./providers.js');
 const search=await tmdb('search/movie',{query:row.title,year:String(row.year),include_adult:'true',page:'1'});
 const id=uniqueTMDB(search.results||[],row);
 if(!id||Number(search.total_pages||1)>1){await defer(d,'No unique title/year match on the first TMDB results page');return;}
 let latest=await db.prepare('SELECT data FROM movies WHERE id=?').bind(id).first<{data:string}>();
 if(!latest){const result=await collectMovie(id,null,true,true);const m=result.movie;
 if(normalized(m.title)!==normalized(row.title)||m.year!==row.year){await defer(d,'TMDB detail title/year mismatch');return;}
 await db.prepare('INSERT INTO movies(id,title,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,m.title,JSON.stringify(m),Date.now()).run();latest=await db.prepare('SELECT data FROM movies WHERE id=?').bind(id).first<{data:string}>();}
 if(latest){const m=JSON.parse(latest.data) as Movie;if(normalized(m.title)!==normalized(row.title)||m.year!==row.year){await defer(d,'Existing TMDB identity mismatch');return;}await finish(d,m);}
 }catch(e){await defer(d,e instanceof Error?e.message:'Metadata import failed',day);}
}
