import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'kim-discovery-'));
process.env.TMDB_TOKEN='test';process.env.SAFESTREAM_TOKEN='must-not-use';process.env.OMDB_API_KEY='must-not-use';process.env.RT_ENABLED='true';
const {parseSearchScores,harvestResults,attachExisting,processDiscovery,uniqueTMDB}=await import('../dist-server/server/kim-discovery.js');
const {database,closeDatabase}=await import('../dist-server/server/db.js');
const db=database();
after(()=>{closeDatabase();rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
const link=(title,year=2026,scores='1.6.4',path='greenland-2')=>`<a href="https://kids-in-mind.com/g/${path}.htm">${title} [${year}] [PG-13] - ${scores}</a>`;
const page=link('Greenland 2: Migration')+link('Other Movie',2025,'0.10.0','other')+link('Greenland 2: Migration');
test('captures every valid listing, including zero/ten, deduplicates and rejects bad scores/foreign URLs',()=>{
 const rows=parseSearchScores(page+link('Bad',2026,'11.0.0','bad')+link('External').replace('https://kids-in-mind.com','https://evil.example'));
 assert.equal(rows.length,2);assert.deepEqual(rows[0].scores,[1,6,4]);assert.equal(rows[0].certification,'PG-13');assert.deepEqual(rows[1].scores,[0,10,0]);
 assert.equal(parseSearchScores(link('Conflict')+link('Conflict',2026,'2.6.4')).length,0);
 assert.equal(uniqueTMDB([{id:1,title:'Greenland 2: Migration',release_date:'2020-01-01'}],rows[0]),null);
 assert.equal(uniqueTMDB([{id:1,title:rows[0].title,release_date:'2026-01-01'},{id:2,title:rows[0].title,release_date:'2026-01-01'}],rows[0]),null);
});
test('extra scores attach to existing movies, new movies import using only TMDB, and repeated searches do not requeue',async()=>{
 const m={id:42,title:'Other Movie',year:2025,guidance:{violence:{level:8,source:'Safe Stream'}}};
 await db.prepare('INSERT INTO movies(id,title,data,updated_at) VALUES(?,?,?,?)').bind(m.id,m.title,JSON.stringify(m),Date.now()).run();
 await harvestResults(page,'https://kids-in-mind.com/search-desktop.htm?fwp_keyword=Greenland');await attachExisting();
 let updated=JSON.parse((await db.prepare('SELECT data FROM movies WHERE id=42').first()).data);assert.equal(updated.guidance.violence.level,8);assert.equal(updated.kidsInMind.violence.level,10);assert.equal(updated.guidance.sexNudity.level,0);assert.match(updated.guidance.sexNudity.note,/search-result/);
 const old=globalThis.fetch;const urls=[];
 globalThis.fetch=async u=>{urls.push(String(u));assert.equal(new URL(u).hostname,'api.themoviedb.org');return Response.json(String(u).includes('/search/movie')?{results:[{id:999,title:'Greenland 2: Migration',release_date:'2026-01-01'}],total_pages:1}:{id:999,title:'Greenland 2: Migration',release_date:'2026-01-01',credits:{cast:[],crew:[]}});};
 try{await processDiscovery();assert.equal(urls.length,2);updated=JSON.parse((await db.prepare('SELECT data FROM movies WHERE id=999').first()).data);assert.equal(updated.guidance.violence.level,6);assert.equal(updated.scores.critics,null);assert.equal(updated.certification,'PG-13');assert.equal(updated.certificationEvidence.source,'Kids-in-Mind');
 await harvestResults(page,'same');await processDiscovery();assert.equal(urls.length,2);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM movies').first()).n,2);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM kim_discoveries WHERE status='imported'").first()).n,2);
 }finally{globalThis.fetch=old;}
});
test('ambiguous metadata stays pending, and full review scores are not downgraded',async()=>{
 await harvestResults(link('Ambiguous',2026,'1.2.3','ambiguous'),'test');const old=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({results:[{id:1001,title:'Ambiguous',release_date:'2026-01-01'},{id:1002,title:'Ambiguous',release_date:'2026-01-01'}],total_pages:1});
 try{await processDiscovery();assert.equal((await db.prepare("SELECT status FROM kim_discoveries WHERE url LIKE '%ambiguous.htm'").first()).status,'pending');assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM movies').first()).n,2);}finally{globalThis.fetch=old;}
 const full={violence:{level:9,present:null,source:'Kids-in-Mind',note:'Theatrical version.'}};
 await db.prepare('UPDATE kim_results SET data=?,retry_at=? WHERE movie_id=999').bind(JSON.stringify(full),Date.now()+86400000).run();await harvestResults(link('Greenland 2: Migration',2026,'1.5.4'),'test');await attachExisting();assert.equal(JSON.parse((await db.prepare('SELECT data FROM kim_results WHERE movie_id=999').first()).data).violence.level,9);
});
