import {applyKIM,kimEnabled} from './kids-in-mind.js';
import {rtEnabled,enrichRT} from './rotten-tomatoes.js';
import {safeStreamConfigured,safeStreamGuidance} from './safestream.js';
import {database} from './db.js';
const env=process.env;
import { z } from 'zod';
import { Movie, categories, Category, Evidence, certifications } from '../lib/movies.js';
const httpUrl=z.string().url().refine(s=>s.startsWith('https://'),'HTTPS source URL required');
const evidenceSchema=z.object({source:z.string().min(1).max(150),url:httpUrl,checkedAt:z.string().datetime(),note:z.string().max(1000).optional()});
const guidanceSchema=evidenceSchema.extend({level:z.number().int().min(0).max(10).nullable(),scaleMax:z.literal(10),present:z.boolean().nullable(),description:z.string().max(5000).optional()}).refine(x=>x.level===null||x.present===null||x.present===(x.level>0),'Presence and intensity contradict each other');
const feedSchema=z.object({tmdbId:z.number().int(),guidance:z.record(z.enum(Object.keys(categories) as [Category,...Category[]]),guidanceSchema).default({}),scores:z.object({critics:z.number().min(0).max(100).optional(),audience:z.number().min(0).max(100).optional(),imdb:z.number().min(0).max(10).optional()}).optional(),scoreEvidence:z.record(z.enum(['critics','audience','imdb']),evidenceSchema).optional()});
async function json(url:string,headers:Record<string,string>={}){
 const host=new URL(url).hostname;
 const provider=host==='api.themoviedb.org'?'TMDB':host==='www.omdbapi.com'?'OMDB':'GUIDANCE';
 const limit=Number(env[provider+'_DAILY_LIMIT']||(provider==='OMDB'?900:2000));
 if(!Number.isInteger(limit)||limit<1)throw new Error('Invalid provider daily request limit.');
 const day=new Date().toISOString().slice(0,10);
 const granted=await database().prepare('INSERT INTO provider_usage(day,provider,requests) VALUES(?,?,1) ON CONFLICT(day,provider) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests').bind(day,provider,limit).first();
 if(!granted)throw new Error(provider+' daily request budget reached. Try again tomorrow.');
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(6500),redirect:'error'});if(!r.ok)throw new Error(`Data provider returned ${r.status}. Please retry later.`);return r.json() as Promise<any>;}
export function connections(){return {rt:rtEnabled(),tmdb:!!env.TMDB_TOKEN,omdb:!!env.OMDB_API_KEY,safeStream:safeStreamConfigured(),kidsInMind:kimEnabled(),guidance:kimEnabled()||safeStreamConfigured()||!!env.GUIDANCE_FEED_URL};}
export async function tmdb(path:string,params:Record<string,string>={}){if(!env.TMDB_TOKEN)throw new Error('Movie lookup needs a TMDB connection. You can explore the preview catalog meanwhile.');const url=new URL('https://api.themoviedb.org/3/'+path);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return json(url.toString(),{Authorization:`Bearer ${env.TMDB_TOKEN}`});}
export async function collectMovie(id:number,previous:Movie|null,background=false,metadataOnly=false){
 const d=await tmdb(`movie/${id}`,{append_to_response:'credits,release_dates,external_ids'});const now=new Date().toISOString();const url=`https://www.themoviedb.org/movie/${id}`;
 const release=d.release_dates?.results?.find((r:any)=>r.iso_3166_1==='US')?.release_dates||[];
 const cert=release.find((r:any)=>r.type===3&&r.certification)?.certification||release.find((r:any)=>r.certification)?.certification||null;
 const m:Movie={id,title:d.title,year:d.release_date?Number(d.release_date.slice(0,4)):null,runtime:d.runtime>0?d.runtime:null,certification:certifications.includes(cert)?cert:(previous?.certificationEvidence?.source==='Kids-in-Mind'?previous.certification:null),certificationEvidence:certifications.includes(cert)?undefined:previous?.certificationEvidence,poster:d.poster_path?`https://image.tmdb.org/t/p/w500${d.poster_path}`:null,overview:d.overview||'',genres:(d.genres||[]).map((g:any)=>g.name),language:d.original_language||'',cast:(d.credits?.cast||[]).map((p:any)=>({id:p.id,name:p.name})),directors:(d.credits?.crew||[]).filter((p:any)=>p.job==='Director').map((p:any)=>({id:p.id,name:p.name})),popularity:d.popularity||0,imdbId:d.imdb_id||d.external_ids?.imdb_id||null,scores:previous?.scores||{critics:null,audience:null,imdb:null},scoreEvidence:previous?.scoreEvidence||{},guidance:previous?.guidance||{},kidsInMind:previous?.kidsInMind,source:{source:'TMDB',url,checkedAt:now},updatedAt:now};
 const issues:string[]=[];
 if(metadataOnly){await applyKIM(m);return {movie:m,issues};}
 if(env.OMDB_API_KEY&&m.imdbId){try{const u=new URL('https://www.omdbapi.com/');u.searchParams.set('apikey',env.OMDB_API_KEY);u.searchParams.set('i',m.imdbId);const o=await json(u.toString());if(o.Response==='False')throw new Error('OMDb could not retrieve this movie.');const ev:Evidence={source:'OMDb',url:`https://www.imdb.com/title/${m.imdbId}/`,checkedAt:now,note:'Score supplied by OMDb. May differ from the original provider’s latest score.'};if(o.imdbRating&&o.imdbRating!=='N/A'){const v=Number(o.imdbRating);if(v>=0&&v<=10){m.scores.imdb=v;m.scoreEvidence.imdb=ev;}}const rt=o.Ratings?.find((r:any)=>r.Source==='Rotten Tomatoes');if(rt&&/^\d+(\.\d+)?%$/.test(rt.Value)){const v=parseFloat(rt.Value);if(v>=0&&v<=100&&m.scoreEvidence.critics?.source!=='Rotten Tomatoes'){m.scores.critics=v;m.scoreEvidence.critics={...ev,url:'https://www.rottentomatoes.com/search?search='+encodeURIComponent(m.title)};}}if(!m.certification&&certifications.includes(o.Rated))m.certification=o.Rated;
 }catch{issues.push('Review scores could not be refreshed.');}}
 if(env.GUIDANCE_FEED_URL){try{const u=new URL(env.GUIDANCE_FEED_URL);if(u.protocol!=='https:')throw new Error('HTTPS required');u.searchParams.set('tmdb_id',String(id));if(m.imdbId)u.searchParams.set('imdb_id',m.imdbId);const raw=await json(u.toString(),env.GUIDANCE_FEED_TOKEN?{Authorization:`Bearer ${env.GUIDANCE_FEED_TOKEN}`} :{});const g=feedSchema.parse(raw);if(g.tmdbId!==id)throw new Error('Movie identity mismatch');m.guidance={...m.guidance,...g.guidance};for(const key of ['critics','audience','imdb'] as const){if(g.scores?.[key]!==undefined){if(!g.scoreEvidence?.[key])throw new Error('Score evidence missing');m.scores[key]=g.scores[key]!;m.scoreEvidence[key]=g.scoreEvidence[key];}}}catch{issues.push('Content guidance could not be refreshed.');}}
 if(safeStreamConfigured()){try{m.guidance={...m.guidance,...await safeStreamGuidance(m,background)};}catch(e){issues.push(e instanceof Error?e.message:'Safe Stream guidance unavailable.');}}
 if(rtEnabled()){try{await enrichRT(m);}catch(e){console.error('[RottenTomatoes]',id,e instanceof Error?e.message:'Collection failed');issues.push('Rotten Tomatoes scores could not be refreshed.');}}
 await applyKIM(m);
 return {movie:m,issues};
}
