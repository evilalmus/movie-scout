import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const cwd=resolve(import.meta.dirname,'..');
async function start(directory,mock=true,extra={}){
 const args=[...(mock?['--import',resolve(import.meta.dirname,'mock-providers.mjs')]:[]),resolve(cwd,'dist-server/server/index.js')];
 const child=spawn(process.execPath,args,{cwd,env:{...process.env,PORT:'0',DATA_DIR:directory,HOST:'127.0.0.1',ALLOWED_ORIGINS:'https://example.github.io',DAILY_ENABLED:'false',TMDB_TOKEN:mock?'fixture':'',OMDB_API_KEY:mock?'fixture':'',GUIDANCE_FEED_URL:mock?'https://guidance.example/':'',GUIDANCE_FEED_TOKEN:'',JOB_TOKEN:'fixture-admin',GLOBAL_REQUESTS_PER_MINUTE:'10000',READS_PER_MINUTE:'10000',...extra},stdio:['ignore','pipe','pipe']});
 let output='';child.stderr.on('data',b=>{output+=b;});
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server start timeout: '+output)),15000);child.stdout.on('data',b=>{output+=b;const match=output.match(/listening on (\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server stopped: '+code+' '+output));});});
 return {child,base:`http://127.0.0.1:${port}`,async stop(){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}};
}
async function waitFor(fn){const end=Date.now()+10000;let last;while(Date.now()<end){last=await fn();if(last)return last;await new Promise(r=>setTimeout(r,70));}throw new Error('Condition timed out: '+last);}
const post=(base,path,data={},headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
test('Docker-compatible backend: CORS, collection, scheduler, filtering, and persistent restart',{timeout:40000},async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'movie-scout-test-'));let app;
 try{
  app=await start(directory,true,{DAILY_ENABLED:'true',DAILY_TIME:'00:00'});
  assert.equal((await fetch(app.base+'/api/health')).status,200);
  const preflight=await fetch(app.base+'/api/catalog',{method:'OPTIONS',headers:{Origin:'https://example.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://example.github.io');
  assert.equal((await post(app.base,'/api/import',{id:42},{Origin:'https://unapproved.example'})).status,403);
  assert.equal((await post(app.base,'/api/catalog',{critics:[90,10]})).status,400);
  assert.equal((await post(app.base,'/api/daily')).status,401);
  // The daily timer is internal. No page or daily endpoint request started this run.
  await waitFor(async()=>{const s=await (await fetch(app.base+'/api/status')).json();return s.lastRun?.status==='complete'&&s.count===10;});
  const repeat=await (await post(app.base,'/api/daily',{}, {Authorization:'Bearer fixture-admin'})).json();assert.equal(repeat.status,'already_complete');assert.equal(repeat.ids.length,10);
  let r=await (await post(app.base,'/api/catalog',{critics:[null,40],content:{violence:[3]},presence:{nudity:'present'}})).json();assert.equal(r.total,10);assert.equal(r.results[0].movie.guidance.nudity.source,'Test fixture');
  r=await (await post(app.base,'/api/catalog',{presence:{nudity:'absent'}})).json();assert.equal(r.total,0);
  r=await (await post(app.base,'/api/catalog',{audience:[80,null]})).json();assert.equal(r.total,1);
  r=await (await post(app.base,'/api/catalog',{audience:[80,null],includeUnknown:true})).json();assert.equal(r.total,10);assert.equal(r.results.filter(x=>x.missing.length).length,9);
  const imported=await (await post(app.base,'/api/import',{id:60})).json();assert.equal(imported.status,'queued');
  await waitFor(async()=>{const s=await (await fetch(app.base+'/api/status')).json();return s.count===11;});
  const cached=await (await post(app.base,'/api/import',{id:60})).json();assert.equal(cached.status,'cached');
  await app.stop();
  // A queued item survives a restart and runs without browser polling.
  const sqlite=new DatabaseSync(resolve(directory,'movie-scout.sqlite'));sqlite.prepare("INSERT INTO jobs(movie_id,status,updated_at) VALUES(61,'queued',?)").run(Date.now());sqlite.close();
  app=await start(directory);
  await waitFor(async()=>{const s=await (await fetch(app.base+'/api/status')).json();return s.count===12;});
  r=await (await post(app.base,'/api/catalog',{query:'Fixture 42'})).json();assert.equal(r.total,1);assert.equal(r.results[0].movie.scores.critics,30);
  const status=await (await fetch(app.base+'/api/status')).json();assert.equal(status.lastRun.status,'complete');assert.equal(JSON.stringify(status).includes('fixture-admin'),false);
 }finally{await app?.stop();await rm(directory,{recursive:true,force:true});}
});
test('Missing credentials and API route errors are explicit',{timeout:15000},async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'movie-scout-empty-'));let app;
 try{app=await start(directory,false);assert.equal((await post(app.base,'/api/import',{id:42})).status,503);assert.equal((await fetch(app.base+'/api/unknown')).status,404);const status=await (await fetch(app.base+'/api/status')).json();assert.equal(status.connections.tmdb,false);assert.equal(status.count,0);}finally{await app?.stop();await rm(directory,{recursive:true,force:true});}
});
test('Static frontend uses relative assets for GitHub repository subpaths',async()=>{
 const html=await readFile(resolve(cwd,'dist/index.html'),'utf8');assert.match(html,/\.\/assets\//);assert.doesNotMatch(html,/(?:src|href)="\/assets\//);assert.match(html,/\.\/config\.js/);assert.match(html,/\.\/favicon\.svg/);
 const config=await readFile(resolve(cwd,'dist/config.js'),'utf8');assert.match(config,/MOVIE_SCOUT_CONFIG/);assert.doesNotMatch(config,/fixture-admin|TMDB_TOKEN|OMDB_API_KEY/);
});
