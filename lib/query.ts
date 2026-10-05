import { categories, Category, Filters } from './movies.js';
export function catalogQuery(f:Filters){
 const clauses:string[]=[];const values:(string|number)[]=[];
 const field=(p:string)=>`json_extract(data, '$.${p}')`;
 const condition=(expression:string,predicate:string,args:(string|number)[])=>{clauses.push(f.includeUnknown?`(${expression} IS NULL OR ${predicate})`:predicate);values.push(...args);};
 if(f.query){clauses.push('instr(lower(title),lower(?)) > 0');values.push(f.query);}
 if(f.actors.length){clauses.push('('+f.actors.map(()=>`EXISTS (SELECT 1 FROM json_each(data,'$.cast') p WHERE json_extract(p.value,'$.id')=?)`).join(f.actorMode==='all'?' AND ':' OR ')+')');values.push(...f.actors.map(p=>p.id));}
 if(f.directors.length){clauses.push(`EXISTS (SELECT 1 FROM json_each(data,'$.directors') p WHERE json_extract(p.value,'$.id') IN (${f.directors.map(()=>'?')}))`);values.push(...f.directors.map(p=>p.id));}
 if(f.genres.length){clauses.push(`EXISTS (SELECT 1 FROM json_each(data,'$.genres') g WHERE g.value IN (${f.genres.map(()=>'?')}))`);values.push(...f.genres);}
 if(f.language){clauses.push(`${field('language')}=?`);values.push(f.language);}
 if(f.certifications.length)condition(field('certification'),`${field('certification')} IN (${f.certifications.map(()=>'?')})`,f.certifications);
 for(const key of ['critics','audience','imdb','year','runtime'] as const){const [lo,hi]=f[key];const expr=field(key==='year'||key==='runtime'?key:`scores.${key}`);if(lo!==null)condition(expr,`${expr}>=?`,[lo]);if(hi!==null)condition(expr,`${expr}<=?`,[hi]);}
 for(const key of Object.keys(categories) as Category[]){const v=f.content[key];if(v?.length){const expr=field(`guidance.${key}.level`);condition(expr,`${expr} IN (${v.map(()=>'?')})`,v);}if(f.presence[key]){const expr=field(`guidance.${key}.present`);condition(expr,`${expr}=?`,[f.presence[key]==='present'?1:0]);}}
 const sorts:Record<string,string>={popular:'popularity',newest:'year',oldest:'year',runtime:'runtime','critics-high':'scores.critics','critics-low':'scores.critics','audience-high':'scores.audience','audience-low':'scores.audience','imdb-high':'scores.imdb','imdb-low':'scores.imdb'};
 const sort=field(sorts[f.sort]);const direction=f.sort.endsWith('low')||['oldest','runtime'].includes(f.sort)?'ASC':'DESC';
 return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',values,order:` ORDER BY ${sort} IS NULL, ${sort} ${direction}, title ASC`};
}
