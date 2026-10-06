import {database,closeDatabase} from '../dist-server/server/db.js';
import {enrichRT,rtEnabled} from '../dist-server/server/rotten-tomatoes.js';
const db=database();
try{
 if(!rtEnabled())throw new Error('Set RT_ENABLED=true on the backend container.');
 const rows=await db.prepare(`SELECT id,data FROM movies WHERE (json_extract(data,'$.scores.critics') IS NULL OR json_extract(data,'$.scores.audience') IS NULL) AND NOT EXISTS (SELECT 1 FROM jobs WHERE movie_id=movies.id AND status IN ('queued','running')) AND NOT EXISTS (SELECT 1 FROM rt_cache r WHERE r.movie_id=movies.id AND r.expires_at>${Date.now()}) ORDER BY id LIMIT 10`).all();
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'preview',movies:rows.results.map(r=>({id:r.id,title:JSON.parse(r.data).title}))}));
 if(process.argv.includes('--apply'))for(const row of rows.results){
  const m=JSON.parse(row.data);
  try{
   await enrichRT(m);
   const current=JSON.parse((await db.prepare('SELECT data FROM movies WHERE id=?').bind(row.id).first()).data);
   for(const key of ['critics','audience'])if(m.scoreEvidence[key]?.source==='Rotten Tomatoes'){current.scores[key]=m.scores[key];current.scoreEvidence[key]=m.scoreEvidence[key];}
   await db.prepare('UPDATE movies SET data=? WHERE id=?').bind(JSON.stringify(current),row.id).run();
   console.log(JSON.stringify({id:row.id,title:m.title,scores:current.scores}));
  }catch(e){
   const mismatch=/^RT (movie title\/year|canonical URL) mismatch/.test(e.message);
   console.error(JSON.stringify({id:row.id,title:m.title,error:e.message,action:mismatch?'skip_movie':'stop_batch'}));
   if(!mismatch)break;
   // Cool down this miss for one day without changing saved movie scores.
   await db.prepare('INSERT INTO rt_cache(movie_id,data,expires_at) VALUES(?,?,?) ON CONFLICT(movie_id) DO UPDATE SET expires_at=excluded.expires_at').bind(row.id,'null',Date.now()+86400000).run();
   continue;
  }
 }
}finally{closeDatabase();}
