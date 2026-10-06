import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'scout-kim-'));
process.env.KIM_ENABLED='true';process.env.KIM_CONTACT='test@example.test';
const {parseKIM,reviewLinks,robotsPolicy,kimTick,applyKIM,kimStatus}=await import('../dist-server/server/kids-in-mind.js');
const {database,closeDatabase}=await import('../dist-server/server/db.js');
const db=database(),url='https://kids-in-mind.com/r/resident-evil-2026-parents-guide-movie-review-rating.htm';
const html=`<title>Resident Evil [2026] [R] - 2.9.10 | Parents Guide</title><link rel="canonical" href="${url}"><h2>Resident Evil SEX/NUDITY 2</h2><h2>Resident Evil VIOLENCE/GORE 9</h2><h2>Resident Evil LANGUAGE 10</h2>`;
const movie={id:1423191,title:'Resident Evil',year:2026,guidance:{violence:{level:8,source:'Safe Stream'}}};
after(()=>{closeDatabase();rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
test('scores preserve native categories and require year, canonical URL and corroboration',()=>{
 const g=parseKIM(html,movie,url);assert.equal(g.sexNudity.level,2);assert.equal(g.violence.level,9);assert.equal(g.profanity.level,10);assert.equal(g.nudity,undefined);assert.equal(g.sexNudity.present,null);
 assert.throws(()=>parseKIM(html,{...movie,year:2002},url),/mismatch/);
 assert.throws(()=>parseKIM(html.replace('GORE 9','GORE 8'),movie,url),/agree/);
 assert.throws(()=>parseKIM(html,movie,'https://kids-in-mind.com/other.htm'),/canonical/);
 const zero=html.replace('2.9.10','0.9.10').replace('NUDITY 2','NUDITY 0');assert.equal(parseKIM(zero,movie,url).sexNudity.level,0);
 assert.deepEqual(reviewLinks(`<a href="${url}">Resident Evil</a><a href="https://evil.example/a.htm">Resident Evil</a>`,movie.title),[url]);
});
test('search titles include year/rating suffixes; different remakes are ignored',()=>{assert.deepEqual(reviewLinks('<a href="/s/seven_1995__498.htm">Seven [1995] [R] - 4.9.8</a><a href="/s/seven_2026.htm">Seven [2026] [R] - 4.9.8</a>','Se7en',1995),['https://kids-in-mind.com/s/seven_1995__498.htm']);});
test('robots disallow, wildcards and longest delay are respected conservatively',()=>{
 assert.deepEqual(robotsPolicy('User-agent: *\nCrawl-delay: 30','/r/a.htm'),{allowed:true,delay:30});
 assert.equal(robotsPolicy('User-agent: *\nDisallow: /','/anything').allowed,false);
 assert.equal(robotsPolicy('Disallow: /*?s=\nCrawl-delay: 300','/?s=test').allowed,false);
 assert.equal(robotsPolicy('Crawl-delay: 300','/').delay,300);
 assert.throws(()=>robotsPolicy('<html>challenge</html>','/'),/Invalid/);
});
test('worker persists pacing, caches, fills only missing shared scores and stops on challenge',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;let now=originalNow(),calls=[];Date.now=()=>now;
 globalThis.fetch=async (u,options)=>{calls.push(String(u));assert.match(options.headers['User-Agent'],/MovieScout/);assert.equal(options.redirect,'manual');return new Response(String(u).endsWith('robots.txt')?'User-agent: *\nCrawl-delay: 300':String(u)===url?html:`<a href="${url}">Resident Evil</a>`);};
 try{
 await db.prepare('INSERT INTO movies(id,title,data,updated_at) VALUES(?,?,?,?)').bind(movie.id,movie.title,JSON.stringify(movie),now).run();
 await Promise.all([kimTick(),kimTick()]);assert.equal(calls.length,1);
 now+=120000;await kimTick();assert.equal(calls.length,1,'longer robots wait survives later ticks');
 now+=180001;await kimTick();assert.equal(calls.length,2);
 now+=300001;await kimTick();assert.equal(calls.length,3);
 const updated=JSON.parse((await db.prepare('SELECT data FROM movies WHERE id=?').bind(movie.id).first()).data);
 assert.equal(updated.guidance.violence.level,8);assert.equal(updated.guidance.profanity.level,10);assert.equal(updated.guidance.sexNudity.level,2);assert.equal(updated.kidsInMind.violence.level,9);
 now+=300001;await kimTick();assert.equal(calls.length,3,'matched movie does not fetch again');
 const fresh={...movie,guidance:{}};await applyKIM(fresh);assert.equal(fresh.guidance.violence.level,9);
 await db.prepare('DELETE FROM kim_results').run();await db.prepare('DELETE FROM kim_pages').run();
 globalThis.fetch=async()=>{calls.push('challenge');return new Response('<title>Just a moment...</title>');};
 await kimTick();assert.ok((await kimStatus()).paused);now+=2*86400000;await kimTick();assert.equal(calls.length,4,'challenge pause survives passing time');
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
test('daily budget includes failures; 429 honors Retry-After; no parallel bursts',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
 await db.prepare('UPDATE kim_state SET paused=NULL,next_request=0,last_request=0,failures=0').run();
 await db.prepare('DELETE FROM provider_usage').run();process.env.KIM_DAILY_LIMIT='1';
 globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'172800'}});};
 await kimTick();assert.equal(calls,1);assert.ok((await kimStatus()).next_request>=Date.now()+172799000);
 await db.prepare('UPDATE kim_state SET next_request=0,last_request=0').run();await kimTick();assert.equal(calls,1);assert.equal((await kimStatus()).requestsToday,1);
 }finally{globalThis.fetch=original;delete process.env.KIM_DAILY_LIMIT;}
});
test('robots refusal stops the worker before any page request',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
 await db.prepare('UPDATE kim_state SET paused=NULL,next_request=0,last_request=0,failures=0').run();await db.prepare('DELETE FROM provider_usage').run();await db.prepare('DELETE FROM kim_pages').run();
 globalThis.fetch=async()=>{calls++;return new Response('User-agent: *\nDisallow: /');};
 await kimTick();assert.equal(calls,1);
 await db.prepare('UPDATE kim_state SET next_request=0,last_request=0').run();await kimTick();assert.equal(calls,1);assert.match((await kimStatus()).paused,/Robots disallows/);
 }finally{globalThis.fetch=original;}
});
test('redirect hops are paced separately and unmatched titles receive a cooldown',async()=>{
 const original=globalThis.fetch,originalNow=Date.now;let now=originalNow(),calls=[];Date.now=()=>now;
 try{
 await db.prepare('UPDATE kim_state SET paused=NULL,next_request=0,last_request=0,failures=0').run();await db.prepare('DELETE FROM provider_usage').run();await db.prepare('DELETE FROM kim_pages').run();await db.prepare('DELETE FROM kim_results').run();
 globalThis.fetch=async u=>{const url=String(u);calls.push(url);if(url.endsWith('robots.txt'))return new Response('User-agent: *\nCrawl-delay: 30');if(url.includes('?fwp_keyword='))return new Response('',{status:302,headers:{location:'/search-desktop.htm'}});return new Response('<title>Search</title>');};
 await kimTick();assert.equal(calls.length,1);now+=120001;await kimTick();assert.equal(calls.length,2);now+=120001;await kimTick();assert.equal(calls.length,3);assert.ok(!calls.some(u=>u.endsWith('search-desktop.htm')));
 now+=120001;await kimTick();assert.equal(calls.length,4);assert.ok(calls[3].endsWith('search-desktop.htm'));
 const result=await db.prepare('SELECT status,retry_at FROM kim_results WHERE movie_id=?').bind(movie.id).first();assert.equal(result.status,'unmatched');assert.equal(result.retry_at,now+30*86400000);
 now+=120001;await kimTick();assert.equal(calls.length,4);
 }finally{globalThis.fetch=original;Date.now=originalNow;}
});
