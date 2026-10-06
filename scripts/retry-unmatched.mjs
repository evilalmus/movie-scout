// Run inside the built API container. Dry run unless --apply is supplied.
import {database,closeDatabase} from '../dist-server/server/db.js';
import {safeStreamConfigured,safeStreamGuidance} from '../dist-server/server/safestream.js';
const db=database();
try {
 if(!safeStreamConfigured())throw new Error('Safe Stream credentials are not configured.');
 const rows=await db.prepare("SELECT m.id,m.data FROM movies m JOIN guidance_cache c ON c.movie_id=m.id WHERE c.data='{}' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.movie_id=m.id AND j.status IN ('queued','running')) ORDER BY m.id LIMIT 10").all();
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'retry':'dry_run',movies:rows.results.map(r=>({id:r.id,title:JSON.parse(r.data).title}))}));
 if(process.argv.includes('--apply'))for(const row of rows.results){
  try {
   await db.prepare("DELETE FROM guidance_cache WHERE movie_id=? AND data='{}'").bind(row.id).run();
   const movie=JSON.parse(row.data);const guidance=await safeStreamGuidance(movie,true);
   // Re-read metadata so another collector's changes are preserved.
   const latest=await db.prepare('SELECT data FROM movies WHERE id=?').bind(row.id).first();
   const updated=JSON.parse(latest.data);updated.guidance={...updated.guidance,...guidance};
   await db.prepare('UPDATE movies SET data=? WHERE id=?').bind(JSON.stringify(updated),row.id).run();
   console.log(JSON.stringify({movieId:row.id,result:Object.keys(guidance).length?'guidance_saved':'no_match'}));
  }catch(e){console.error(JSON.stringify({movieId:row.id,error:e.message}));break;}
 }
}finally{closeDatabase();}
