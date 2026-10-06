import {database} from './db.js';
import type {Movie, Category, Guidance} from '../lib/movies.js';
function log(event:string,fields:Record<string,unknown>={}){if(process.env.SAFESTREAM_DEBUG==='true')console.log('[SafeStream] '+JSON.stringify({event,...fields}));}
const base='https://app.safestream.info/api/v1/';
function setting(name:string,fallback:number){const n=Number(process.env[name]||fallback);if(!Number.isInteger(n)||n<0)throw new Error(`Invalid ${name}`);return n;}
export const safeStreamConfigured=()=>!!(process.env.SAFESTREAM_TOKEN||(process.env.SAFESTREAM_EMAIL&&process.env.SAFESTREAM_PASSWORD));
export async function safeStreamUsage(){const month=new Date().toISOString().slice(0,7);const row=await database().prepare('SELECT requests FROM provider_usage WHERE day=? AND provider=?').bind(month,'SAFESTREAM').first<{requests:number}>();return {month,requests:row?.requests||0,limit:setting('SAFESTREAM_MONTHLY_LIMIT',1000),reserve:setting('SAFESTREAM_USER_RESERVE',300)};}
async function request(path:string,background:boolean,init:RequestInit={}){
 const {month,limit,reserve}=await safeStreamUsage();const cap=background?Math.max(0,limit-reserve):limit;
 if(cap<1)throw new Error('Safe Stream request budget reached.');
 const grant=await database().prepare('INSERT INTO provider_usage(day,provider,requests) VALUES(?,?,1) ON CONFLICT(day,provider) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests').bind(month,'SAFESTREAM',cap).first();
 if(!grant)throw new Error('Safe Stream request budget reached.');
 const started=Date.now();
 let r:Response;try{r=await fetch(base+path,{...init,redirect:'error',signal:AbortSignal.timeout(6500)});}catch(e){log('request_failed',{endpoint:path.split('?')[0],kind:e instanceof Error?e.name:'Error'});throw e;}
 log('http',{endpoint:path.split('?')[0],status:r.status,contentType:r.headers.get('content-type'),elapsedMs:Date.now()-started});
 if(!r.ok)throw new Error(`Safe Stream returned ${r.status}.`);
 return r.json();
}
let token=process.env.SAFESTREAM_TOKEN||'';
let authentication:Promise<string>|undefined;
async function getToken(background:boolean){
 if(token)return token;
 if(!authentication)authentication=(async()=>{const result=await request('token',background,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.SAFESTREAM_EMAIL,password:process.env.SAFESTREAM_PASSWORD})});const value=result?.data?.api_bearer_token;if(typeof value!=='string'||!value)throw new Error('Safe Stream authentication response was invalid.');return token=value;})().finally(()=>{authentication=undefined;});
 return authentication;
}
async function get(path:string,background:boolean){let t=await getToken(background);try{return await request(path,background,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}});}catch(e){if(e instanceof Error&&e.message==='Safe Stream returned 401.'&&!process.env.SAFESTREAM_TOKEN){token='';t=await getToken(background);return request(path,background,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}});}throw e;}}
const normalize=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^se7en$/,'seven');
export function parseGuidance(raw:any){
 const d=raw?.data;if(!d||!Number.isInteger(d.id))throw new Error('Invalid Safe Stream details.');
 const guidance:Partial<Record<Category,Guidance>>={};
 for(const [key,field] of [['violence','violence'],['nudity','nudity'],['profanity','language']] as const){const v=d[field]??d.content_rating?.[field];if(v!==undefined&&v!==null&&(!Number.isInteger(v)||v<0||v>10))throw new Error('Invalid Safe Stream score.');guidance[key]={level:v??null,scaleMax:10,present:null,source:'Safe Stream',url:'https://safestream.info/',checkedAt:new Date().toISOString(),description:Array.isArray(d.content_comments)?d.content_comments.filter((c:any)=>c.type===field&&typeof c.content==='string').map((c:any)=>c.content).join('\n\n'):undefined,providerId:d.id,providerTitle:d.name,providerYear:Number(d.year),note:key==='nudity'?'Provider category can include sexual references; the score does not establish visible nudity.':undefined};}
 return guidance;
}
const pending=new Map<number,Promise<Partial<Record<Category,Guidance>>>>();
export async function safeStreamGuidance(m:Movie,background=false):Promise<Partial<Record<Category,Guidance>>>{
 const existing=pending.get(m.id);if(existing)return existing;
 const task=(async()=>{
 const db=database();const cache=await db.prepare('SELECT data,expires_at FROM guidance_cache WHERE movie_id=?').bind(m.id).first<{data:string;expires_at:number}>();
 if(cache&&(cache.expires_at===0||cache.expires_at>Date.now())){log('cache_hit',{movieId:m.id,title:m.title,result:cache.data==='{}'?'cached_no_match':'cached_guidance',expiresAt:cache.expires_at});return JSON.parse(cache.data);}
 const save=async(data:unknown,expires:number)=>{await db.prepare('INSERT INTO guidance_cache(movie_id,data,expires_at) VALUES(?,?,?) ON CONFLICT(movie_id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at').bind(m.id,JSON.stringify(data),expires).run();};
 if(!m.year||m.title.length<3){log('search_skipped',{movieId:m.id,title:m.title,year:m.year,reason:!m.year?'missing_year':'title_too_short'});await save({},Date.now()+7*86400000);return {};}
 const params=new URLSearchParams({name:normalize(m.title)==='seven'?'Seven':m.title,year:String(m.year),content_type:'movie'});
 log('search',{movieId:m.id,title:m.title,year:m.year,searchName:params.get('name'),contentType:'movie'});
 const result=await get('content?'+params,background);if(!Array.isArray(result?.data))throw new Error('Invalid Safe Stream search response.');
 log('search_results',{movieId:m.id,returned:result.data.length,total:result.total,currentPage:result.current_page,lastPage:result.last_page,morePages:!!result.next_page_url,candidates:result.data.slice(0,50).map((d:any)=>({id:d.id,title:d.name,year:d.year,type:d.content_type?.slug,rejections:[...(typeof d.name!=='string'||normalize(d.name)!==normalize(m.title)?['title_mismatch']:[]),...(Number(d.year)!==m.year?['year_mismatch']:[]),...(d.content_type&&d.content_type.slug!=='movie'?['type_mismatch']:[])]}))});
 const matches=result.data.filter((d:any)=>typeof d.name==='string'&&normalize(d.name)===normalize(m.title)&&Number(d.year)===m.year&&(!d.content_type||d.content_type.slug==='movie'));
 if(matches.length!==1){log('unmatched',{movieId:m.id,title:m.title,reason:result.data.length===0?'empty_search':matches.length>1?'ambiguous_matches':'all_candidates_rejected',matchingCandidates:matches.length,morePages:!!result.next_page_url});await save({},Date.now()+7*86400000);return {};}
 const id=matches[0].id;if(!Number.isInteger(id)||id<1)throw new Error('Invalid Safe Stream identity.');
 log('matched',{movieId:m.id,providerId:id});
 const raw=await get('content/'+id,background);
 if(raw?.data?.id!==id||Number(raw.data.year)!==m.year||typeof raw.data.name!=='string'||normalize(raw.data.name)!==normalize(m.title))throw new Error('Safe Stream movie identity mismatch.');
 const guidance=parseGuidance(raw);log('guidance_saved',{movieId:m.id,providerId:id,scores:Object.fromEntries(Object.entries(guidance).map(([k,v])=>[k,v.level]))});await save(guidance,0);return guidance;
 })().finally(()=>pending.delete(m.id));pending.set(m.id,task);return task;
}
