import { z } from 'zod';
export const categories = { violence:'Violence & gore', nudity:'Nudity', sex:'Sexual content', profanity:'Profanity', substances:'Alcohol, drugs & smoking', frightening:'Frightening & intense scenes' } as const;
export type Category = keyof typeof categories;
export const levels = Array.from({length:11},(_,i)=>`${i}/10`);
export const certifications = ['G','PG','PG-13','R','NC-17','Unrated'];
export type Evidence = { source:string; url:string; checkedAt:string; note?:string };
export type Guidance = Evidence & { level:number|null; scaleMax?:10; providerId?:number; providerTitle?:string; providerYear?:number; present:boolean|null; description?:string };
export type Person = { id:number; name:string };
export type Movie = { id:number; title:string; year:number|null; runtime:number|null; certification:string|null; poster:string|null; overview:string; genres:string[]; language:string; cast:Person[]; directors:Person[]; popularity:number; imdbId:string|null; scores:{critics:number|null;audience:number|null;imdb:number|null}; scoreEvidence:Partial<Record<'critics'|'audience'|'imdb',Evidence>>; guidance:Partial<Record<Category,Guidance>>; source:Evidence; updatedAt:string; sample?:boolean };
const range=(max:number)=>z.tuple([z.number().min(0).max(max).nullable(),z.number().min(0).max(max).nullable()]).refine(([a,b])=>a===null||b===null||a<=b,'Minimum must not exceed maximum');
export const filtersSchema=z.object({
  query:z.string().max(120).default(''), actors:z.array(z.object({id:z.number().int().positive(),name:z.string().max(100)})).max(10).default([]), actorMode:z.enum(['any','all']).default('any'), directors:z.array(z.object({id:z.number().int().positive(),name:z.string().max(100)})).max(10).default([]),
  certifications:z.array(z.enum(['G','PG','PG-13','R','NC-17','Unrated'])).max(6).default([]), genres:z.array(z.string().max(60)).max(20).default([]),
  critics:range(100).default([null,null]),audience:range(100).default([null,null]),imdb:range(10).default([null,null]),year:range(2200).default([null,null]),runtime:range(1000).default([null,null]),language:z.string().max(10).default(''),
  content:z.record(z.enum(['violence','nudity','sex','profanity','substances','frightening']),z.array(z.number().int().min(0).max(10)).max(11)).default({}),
  presence:z.record(z.enum(['nudity','sex','violence','profanity','substances','frightening']),z.enum(['present','absent'])).default({}),
  includeUnknown:z.boolean().default(false),sort:z.enum(['popular','newest','oldest','critics-high','critics-low','audience-high','audience-low','imdb-high','imdb-low','runtime']).default('popular'),page:z.number().int().min(1).max(1000).default(1)
});
export type Filters=z.infer<typeof filtersSchema>;
export const defaultFilters=():Filters=>filtersSchema.parse({});
export function evaluateMovie(m:Movie,f:Filters){
 const missing:string[]=[];const reasons:string[]=[];
 if(f.query&&!m.title.toLocaleLowerCase().includes(f.query.toLocaleLowerCase()))return null;
 if(f.actors.length){const results=f.actors.map(p=>m.cast.some(c=>c.id===p.id));if(!(f.actorMode==='all'?results.every(Boolean):results.some(Boolean)))return null;reasons.push('Cast matches');}
 if(f.directors.length&&!f.directors.some(p=>m.directors.some(c=>c.id===p.id)))return null;
 if(f.genres.length&&!f.genres.some(g=>m.genres.includes(g)))return null;
 if(f.language&&m.language!==f.language)return null;
 if(f.certifications.length){if(m.certification===null)missing.push('US rating');else if(!f.certifications.includes(m.certification as typeof f.certifications[number]))return null;else reasons.push(m.certification);}
 for(const key of ['critics','audience','imdb','year','runtime'] as const){const [lo,hi]=f[key];if(lo===null&&hi===null)continue;const v=key==='year'||key==='runtime'?m[key]:m.scores[key];if(v===null)missing.push(key);else if((lo!==null&&v<lo)||(hi!==null&&v>hi))return null;else reasons.push(`${key==='imdb'?'IMDb':key.charAt(0).toUpperCase()+key.slice(1)} ${v}${key==='critics'||key==='audience'?'%':''}`);}
 for(const key of Object.keys(categories) as Category[]){const wanted=f.content[key];const actual=m.guidance[key];if(wanted?.length){if(actual?.level==null)missing.push(categories[key]);else if(!wanted.includes(actual.level))return null;else reasons.push(`${categories[key]}: ${levels[actual.level]}`);}const presence=f.presence[key];if(presence){if(actual?.present==null)missing.push(`${categories[key]} presence`);else if(actual.present!==(presence==='present'))return null;else reasons.push(`${categories[key]} ${presence}`);}}
 if(missing.length&&!f.includeUnknown)return null;
 return {movie:m,missing,reasons};
}
export function sortMovies(a:Movie,b:Movie,sort:Filters['sort']){let av:number|null,bv:number|null;let asc=false;
 if(sort==='popular'){av=a.popularity;bv=b.popularity;}else if(sort==='newest'||sort==='oldest'){av=a.year;bv=b.year;asc=sort==='oldest';}else if(sort==='runtime'){av=a.runtime;bv=b.runtime;asc=true;}else{const [key,dir]=sort.split('-') as ['critics'|'audience'|'imdb',string];av=a.scores[key];bv=b.scores[key];asc=dir==='low';}return av===null?(bv===null?0:1):bv===null?-1:(asc?av-bv:bv-av)||a.title.localeCompare(b.title);
}
export function activeCount(f:Filters){return f.actors.length+f.directors.length+f.certifications.length+f.genres.length+Number(!!f.query)+Number(!!f.language)+Object.values(f.content).filter(x=>x.length).length+Object.keys(f.presence).length+['critics','audience','imdb','year','runtime'].filter(k=>f[k as 'critics'].some(v=>v!==null)).length;}
