import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'scout-plex-'));
process.env.PLEX_ENABLED='True';process.env.PLEX_URL='http://plex:32400';process.env.PLEX_TOKEN='private-plex-token';process.env.TMDB_TOKEN='test';
process.env.SAFESTREAM_TOKEN='do-not-call';process.env.OMDB_API_KEY='do-not-call';process.env.RT_ENABLED='true';
const {parsePlexItem,plexTick,plexStatus,resolvePlexMovie,requestPlexScan}=await import('../dist-server/server/plex.js');
const {database,closeDatabase}=await import('../dist-server/server/db.js');const db=database();
after(()=>{closeDatabase();rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
const raw=(key,title,guids,year=2020)=>({ratingKey:String(key),type:'movie',title,year,Guid:guids.map(id=>({id}))});
test('modern and legacy identifiers parse without treating Plex IDs as TMDB IDs',()=>{
 assert.deepEqual(parsePlexItem(raw(1,'A',['plex://movie/abc','tmdb://11','imdb://tt111']),'1').tmdbIds,[11]);
 assert.deepEqual(parsePlexItem({...raw(1,'A',[]),guid:'com.plexapp.agents.imdb://tt111?lang=en'},'1').imdbIds,['tt111']);
 assert.equal(parsePlexItem({...raw(1,'A',[]),type:'episode'},'2'),null);
 assert.deepEqual(parsePlexItem(raw(1,'A',['tmdb://11','tmdb://11']),'1').tmdbIds,[11]);
});
test('paginated movie-only scan resumes, preserves existing data, and deduplicates editions using only Plex/TMDB',async()=>{
 const log=console.log,fetch=globalThis.fetch,nowFn=Date.now;let now=nowFn(),urls=[];Date.now=()=>now;const logs=[];console.log=(...v)=>logs.push(v);
 const known={id:11,title:'Alpha',year:2020,imdbId:'tt111',scores:{critics:88,audience:90,imdb:8},guidance:{},scoreEvidence:{}};
 await db.prepare('INSERT INTO movies VALUES(?,?,?,?)').bind(11,'Alpha',JSON.stringify(known),now).run();
 globalThis.fetch=async (u,options)=>{const url=new URL(u);urls.push(url.toString());
 if(url.hostname==='plex'){
 assert.equal(options.method,'GET');assert.equal(options.headers['X-Plex-Token'],'private-plex-token');assert.equal(options.redirect,'error');assert.ok(!url.toString().includes('private-plex-token'));
 if(url.pathname==='/library/sections')return Response.json({MediaContainer:{Directory:[{key:'1',title:'Movies',type:'movie'},{key:'2',title:'TV',type:'show'}]}});
 assert.equal(url.pathname,'/library/sections/1/all');assert.equal(url.searchParams.get('includeGuids'),'1');const offset=Number(url.searchParams.get('X-Plex-Container-Start'));
 return Response.json({MediaContainer:{offset,totalSize:3,Metadata:offset===0?[raw(101,'Alpha',['tmdb://11','imdb://tt111']),raw(102,'Alpha',['tmdb://11','imdb://tt111'])]:[raw(103,'Beta',['imdb://tt222'])]}});
 }
 assert.equal(url.hostname,'api.themoviedb.org');
 if(url.pathname==='/3/find/tt222')return Response.json({movie_results:[{id:22}]});
 assert.equal(url.pathname,'/3/movie/22');return Response.json({id:22,title:'Beta',release_date:'2020-01-01',imdb_id:'tt222',credits:{cast:[],crew:[]}});
 };
 try{
 await plexTick();const partial=await db.prepare('SELECT state FROM plex_scan').first();assert.equal(JSON.parse(partial.state).offset,2);
 now+=15001;await plexTick();now+=15001;await plexTick();
 const status=await plexStatus();assert.equal(status.enabled,true);assert.ok(status.scan.last_complete);assert.equal(status.counts.find(x=>x.status==='existing').count,2);assert.equal(status.counts.find(x=>x.status==='imported').count,1);
 assert.deepEqual(JSON.parse((await db.prepare('SELECT data FROM movies WHERE id=11').first()).data),known);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM movies').first()).n,2);
 assert.equal(urls.filter(u=>u.includes('api.themoviedb.org')).length,2);assert.ok(logs.some(v=>String(v[1]).includes('movie_imported')));assert.ok(!JSON.stringify(logs).includes('private-plex-token'));
 now+=86400001;await plexTick();now+=15001;await plexTick();assert.equal(urls.filter(u=>u.includes('api.themoviedb.org')).length,2,'unchanged rescan does not reimport');
 }finally{globalThis.fetch=fetch;console.log=log;Date.now=nowFn;}
});
test('strict fallback rejects remakes/ambiguous titles and conflicting identifiers',async()=>{
 const fetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({results:[{id:50,title:'Same',release_date:'2020-01-01'},{id:51,title:'Same',release_date:'2020-02-01'}],total_pages:1});};
 try{await assert.rejects(resolvePlexMovie(parsePlexItem(raw(9,'Same',[]),'1')),/unique/);await assert.rejects(resolvePlexMovie(parsePlexItem(raw(9,'Same',['tmdb://50','tmdb://51']),'1')),/Conflicting/);assert.equal(calls,1);
 globalThis.fetch=async()=>Response.json({results:[{id:50,title:'Same',release_date:'2002-01-01'}],total_pages:1});await assert.rejects(resolvePlexMovie(parsePlexItem(raw(9,'Same',[]),'1')),/unique/);
 }finally{globalThis.fetch=fetch;}
});
test('unauthorized scan backs off and status never includes the Plex token',async()=>{
 const fetch=globalThis.fetch;let calls=0;await requestPlexScan();globalThis.fetch=async()=>{calls++;return new Response('',{status:401});};
 try{await plexTick();await plexTick();assert.equal(calls,1);const status=await plexStatus();assert.match(status.scan.error,/401/);assert.ok(status.scan.next_scan>Date.now());assert.ok(!JSON.stringify(status).includes('private-plex-token'));}finally{globalThis.fetch=fetch;}
});
