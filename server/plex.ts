import {createHash} from 'node:crypto';
import {database} from './db.js';
import {tmdb,collectMovie} from './providers.js';
import type {Movie} from '../lib/movies.js';
const day=86400000;
export function plexEnabled(){return process.env.PLEX_ENABLED?.trim().toLowerCase()==='true';}
function dailyLimit(){const n=Number(process.env.PLEX_IMPORT_DAILY_LIMIT||250);return Number.isInteger(n)&&n>0?Math.min(n,500):250;}
function configuration(){
 let base:URL;try{base=new URL(process.env.PLEX_URL||'');}catch{throw new Error('Set PLEX_URL to your Plex server address.');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('PLEX_URL must be an HTTP(S) server origin without credentials or a path.');
 if(!process.env.PLEX_TOKEN?.trim())throw new Error('PLEX_TOKEN is missing.');
 const libraries=(process.env.PLEX_LIBRARY_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(libraries.some(s=>!/^\d+$/.test(s)))throw new Error('PLEX_LIBRARY_IDS must contain comma-separated numeric section IDs.');
 const source=createHash('sha256').update(base.origin).digest('hex').slice(0,24);
 return {base,source,libraries,token:process.env.PLEX_TOKEN.trim()};
}
async function plexGet(path:string,params:Record<string,string>={}){
 const cfg=configuration(),url=new URL(path,cfg.base);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
 let response:Response;try{response=await fetch(url,{method:'GET',headers:{Accept:'application/json','X-Plex-Token':cfg.token,'X-Plex-Product':'Movie Scout','X-Plex-Version':'1.0','X-Plex-Client-Identifier':'movie-scout-importer'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Plex connection failed. Check server address, Docker network and TLS certificate.');}
 if(!response.ok){try{await response.body?.cancel();}catch{}throw new Error(`Plex HTTP ${response.status}${response.status===401||response.status===403?': token does not grant access to this server.':'.'}`);}
 let body='';let size=0;const reader=response.body?.getReader(),decoder=new TextDecoder();
 try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)throw new Error('Plex response too large.');body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{try{await reader?.cancel();}catch{}}
 let json:any;try{json=JSON.parse(body);}catch{throw new Error('Plex did not return JSON. Check PLEX_URL points to the server, not Plex Web.');}
 if(!json?.MediaContainer||typeof json.MediaContainer!=='object')throw new Error('Unexpected Plex response structure.');return json.MediaContainer;
}
export async function plexLibraries(){const mc=await plexGet('/library/sections');if(mc.Directory!==undefined&&!Array.isArray(mc.Directory))throw new Error('Unexpected Plex library list.');return (mc.Directory||[]).filter((s:any)=>s.type==='movie').map((s:any)=>({id:String(s.key),title:String(s.title),type:'movie'}));}
export type PlexItem={ratingKey:string;libraryId:string;title:string;year:number|null;tmdbIds:number[];imdbIds:string[]};
export function parsePlexItem(raw:any,libraryId:string):PlexItem|null{
 if(raw?.type!=='movie'||!/^\d+$/.test(String(raw.ratingKey))||typeof raw.title!=='string'||!raw.title.trim())return null;
 const guids=[raw.guid,...(Array.isArray(raw.Guid)?raw.Guid.map((g:any)=>g?.id):[])].filter((s):s is string=>typeof s==='string');
 const t=new Set<number>(),i=new Set<string>();
 for(const guid of guids){const tm=guid.match(/^(?:(?:com\.plexapp\.agents\.)?(?:themoviedb|tmdb)):\/\/(\d+)(?:[/?]|$)/i),im=guid.match(/^(?:com\.plexapp\.agents\.)?imdb:\/\/(tt\d+)(?:[/?]|$)/i);if(tm&&Number.isSafeInteger(Number(tm[1]))&&Number(tm[1])>0)t.add(Number(tm[1]));if(im)i.add(im[1].toLowerCase());}
 const year=Number(raw.year);return {ratingKey:String(raw.ratingKey),libraryId,title:raw.title.trim(),year:Number.isInteger(year)&&year>=1888&&year<=2200?year:null,tmdbIds:[...t].sort((a,b)=>a-b),imdbIds:[...i].sort()};
}
const normalize=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/se7en/g,'seven').replace(/[^\p{L}\p{N}]/gu,'');
function log(event:string,details:Record<string,unknown>={}){console.log('[Plex]',JSON.stringify({event,...details}));}
type ScanState={sections:{id:string;title:string}[];index:number;offset:number;selection:string;firstKey?:string};
async function scanStep(source:string,libraries:string[]){
 const db=database();await db.prepare('INSERT INTO plex_scan(source) VALUES(?) ON CONFLICT(source) DO NOTHING').bind(source).run();
 const now=Date.now();const claim=await db.prepare('UPDATE plex_scan SET lease_until=? WHERE source=? AND lease_until<=? AND next_scan<=? RETURNING state').bind(now+60000,source,now,now).first<{state:string}>();if(!claim)return;
 try{
 let state=JSON.parse(claim.state) as ScanState;
 if(!state.sections||state.selection!==libraries.join(',')){
 const available=await plexLibraries();const selected=libraries.length?available.filter((s:any)=>libraries.includes(s.id)):available;
 if(libraries.some(id=>!selected.some((s:any)=>s.id===id)))throw new Error('A selected library is missing or is not a movie library. Run --libraries to check IDs.');
 state={sections:selected,index:0,offset:0,selection:libraries.join(',')};log('scan_started',{libraries:selected});
 }
 if(state.index<state.sections.length){
 const section=state.sections[state.index];const mc=await plexGet(`/library/sections/${encodeURIComponent(section.id)}/all`,{type:'1',includeGuids:'1','X-Plex-Container-Start':String(state.offset),'X-Plex-Container-Size':'100'});
 if(mc.Metadata!==undefined&&!Array.isArray(mc.Metadata))throw new Error('Unexpected Plex movie list.');const rows=mc.Metadata||[];
 if(mc.offset!==undefined&&Number(mc.offset)!==state.offset)throw new Error('Plex pagination offset did not advance.');
 if(state.offset&&rows.length&&String(rows[0].ratingKey)===state.firstKey)throw new Error('Plex returned a repeated page. Scan stopped to avoid looping.');
 if(rows.length)state.firstKey=String(rows[0].ratingKey);
 let count=0;const statements=[];
 for(const raw of rows){const item=parsePlexItem(raw,section.id);if(!item)continue;count++;statements.push(db.prepare(`INSERT INTO plex_items(source,rating_key,library_id,data,seen_at) VALUES(?,?,?,?,?)
 ON CONFLICT(source,rating_key) DO UPDATE SET library_id=excluded.library_id,seen_at=excluded.seen_at,
 status=CASE WHEN plex_items.data!=excluded.data THEN 'queued' ELSE plex_items.status END,
 retry_at=CASE WHEN plex_items.data!=excluded.data THEN 0 ELSE plex_items.retry_at END,
 error=CASE WHEN plex_items.data!=excluded.data THEN NULL ELSE plex_items.error END,data=excluded.data`).bind(source,item.ratingKey,section.id,JSON.stringify(item),now));}
 if(statements.length)await db.batch(statements);
 state.offset+=rows.length;
 const total=mc.totalSize===undefined?null:Number(mc.totalSize);
 if(total!==null&&(!Number.isSafeInteger(total)||total<0))throw new Error('Invalid Plex pagination total.');
 if(!rows.length&&total!==null&&state.offset<total)throw new Error('Plex returned an empty page before the end of the library.');
 if(!rows.length||(total!==null?state.offset>=total:rows.length<100)){state.index++;state.offset=0;delete state.firstKey;}
 if(state.offset>1000000)throw new Error('Plex scan size limit reached.');log('scan_page',{libraryId:section.id,movies:count});
 }
 if(state.index>=state.sections.length){await db.prepare("UPDATE plex_scan SET state='{}',next_scan=?,lease_until=0,last_complete=?,error=NULL WHERE source=?").bind(Date.now()+day,new Date().toISOString(),source).run();log('scan_complete');}
 else await db.prepare('UPDATE plex_scan SET state=?,next_scan=?,lease_until=0,error=NULL WHERE source=?').bind(JSON.stringify(state),Date.now()+15000,source).run();
 }catch(e){const message=e instanceof Error?e.message:'Plex scan failed';await db.prepare('UPDATE plex_scan SET error=?,next_scan=?,lease_until=0 WHERE source=?').bind(message,Date.now()+3600000,source).run();log('scan_failed',{error:message});}
}
export async function resolvePlexMovie(item:PlexItem):Promise<{id:number;method:'tmdb'|'imdb'|'title'}>{
 if(item.tmdbIds.length>1||item.imdbIds.length>1)throw new Error('Conflicting identifiers in Plex metadata.');
 if(item.tmdbIds.length===1)return {id:item.tmdbIds[0],method:'tmdb'};
 if(item.imdbIds.length===1){const result=await tmdb('find/'+item.imdbIds[0],{external_source:'imdb_id'});const ids=[...new Set<number>((result.movie_results||[]).map((m:any)=>m.id).filter((id:any)=>Number.isSafeInteger(id)&&id>0))];if(ids.length!==1)throw new Error('IMDb identifier did not resolve to one TMDB movie.');return {id:ids[0],method:'imdb'};}
 if(!item.year)throw new Error('Plex has no external identifier or release year for a safe match.');
 const result=await tmdb('search/movie',{query:item.title,year:String(item.year),include_adult:'true'});
 const ids=[...new Set<number>((result.results||[]).filter((m:any)=>Number.isSafeInteger(m.id)&&m.id>0&&Number(String(m.release_date||'').slice(0,4))===item.year&&[m.title,m.original_title].some(t=>typeof t==='string'&&normalize(t)===normalize(item.title))).map((m:any)=>m.id))];
 if(ids.length!==1||Number(result.total_pages||1)>1)throw new Error('No unique exact title/year match.');return {id:ids[0],method:'title'};
}
async function importStep(source:string,libraries:string[]){
 if(!process.env.TMDB_TOKEN)return;const db=database(),today=new Date().toISOString().slice(0,10);
 const used=await db.prepare("SELECT requests FROM provider_usage WHERE day=? AND provider='PLEX_IMPORT'").bind(today).first<{requests:number}>();if((used?.requests||0)>=dailyLimit())return;
 const selection=libraries.length?' AND library_id IN ('+libraries.map(()=>'?').join(',')+')':'';
 const row=await db.prepare("SELECT rating_key,data FROM plex_items WHERE source=? AND status IN ('queued','pending') AND retry_at<=?"+selection+' ORDER BY seen_at,rating_key LIMIT 1').bind(source,Date.now(),...libraries).first<{rating_key:string;data:string}>();if(!row)return;
 const claim=await db.prepare('UPDATE plex_items SET retry_at=? WHERE source=? AND rating_key=? AND retry_at<=? RETURNING rating_key').bind(Date.now()+120000,source,row.rating_key,Date.now()).first();if(!claim)return;
 const granted=await db.prepare("INSERT INTO provider_usage(day,provider,requests) VALUES(?,'PLEX_IMPORT',1) ON CONFLICT(day,provider) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests").bind(today,dailyLimit()).first();if(!granted)return;
 const item=JSON.parse(row.data) as PlexItem;
 try{
 const resolved=await resolvePlexMovie(item);const current=await db.prepare('SELECT data FROM movies WHERE id=?').bind(resolved.id).first<{data:string}>();
 let movie:Movie=current?JSON.parse(current.data):(await collectMovie(resolved.id,null,true,true)).movie;
 if(!movie.title||movie.id!==resolved.id)throw new Error('TMDB returned incomplete metadata.');
 if(item.imdbIds.length&&movie.imdbId!==item.imdbIds[0])throw new Error('Plex IMDb identifier disagrees with TMDB details.');
 if(resolved.method==='title'&&(movie.year!==item.year||normalize(movie.title)!==normalize(item.title)))throw new Error('TMDB detail title/year does not match Plex.');
 const inserted=await db.prepare('INSERT INTO movies(id,title,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(movie.id,movie.title,JSON.stringify(movie),Date.now()).run();
 await db.prepare("UPDATE plex_items SET status=?,movie_id=?,retry_at=0,error=NULL WHERE source=? AND rating_key=?").bind(Number(inserted.changes)?'imported':'existing',movie.id,source,row.rating_key).run();
 log(Number(inserted.changes)?'movie_imported':'movie_existing',{movieId:movie.id,title:movie.title,method:resolved.method});
 }catch(e){const error=e instanceof Error?e.message:'Movie import failed';await db.prepare("UPDATE plex_items SET status='pending',error=?,retry_at=? WHERE source=? AND rating_key=?").bind(error,Date.now()+day,source,row.rating_key).run();log('movie_pending',{title:item.title,error});}
}
let busy=false;
export async function plexTick(){if(busy||!plexEnabled())return;busy=true;try{const cfg=configuration();await scanStep(cfg.source,cfg.libraries);await importStep(cfg.source,cfg.libraries);}catch(e){log('configuration_error',{error:e instanceof Error?e.message:'Plex configuration invalid'});}finally{busy=false;}}
export async function plexStatus(){
 let cfg:ReturnType<typeof configuration>;try{cfg=configuration();}catch(e){return {enabled:plexEnabled(),configured:false,error:e instanceof Error?e.message:'Invalid configuration'};}
 const db=database(),scan=await db.prepare('SELECT last_complete,next_scan,error FROM plex_scan WHERE source=?').bind(cfg.source).first();
 const counts=await db.prepare('SELECT status,COUNT(*) AS count FROM plex_items WHERE source=? GROUP BY status').bind(cfg.source).all();
 const used=await db.prepare("SELECT requests FROM provider_usage WHERE day=? AND provider='PLEX_IMPORT'").bind(new Date().toISOString().slice(0,10)).first<{requests:number}>();
 return {enabled:plexEnabled(),configured:true,tmdbConfigured:!!process.env.TMDB_TOKEN,libraryIds:cfg.libraries,importsToday:used?.requests||0,dailyLimit:dailyLimit(),scan,counts:counts.results};
}
export async function requestPlexScan(){const {source}=configuration();await database().prepare('INSERT INTO plex_scan(source) VALUES(?) ON CONFLICT(source) DO UPDATE SET next_scan=0').bind(source).run();}
export async function plexPending(){const {source}=configuration();return (await database().prepare("SELECT json_extract(data,'$.title') AS title,json_extract(data,'$.year') AS year,error,retry_at FROM plex_items WHERE source=? AND status='pending' ORDER BY seen_at LIMIT 20").bind(source).all()).results;}
