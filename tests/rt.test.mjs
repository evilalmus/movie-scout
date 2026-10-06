import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'scout-rt-'));process.env.DATA_DIR=dir;
const {parseRT,searchCandidates,enrichRT}=await import('../dist-server/server/rotten-tomatoes.js');
const {closeDatabase}=await import('../dist-server/server/db.js');
const url='https://www.rottentomatoes.com/m/seven';
const html=(critics='0',audience='95',hidden=false)=>`<script type="application/ld+json">${JSON.stringify({'@type':'Movie',name:'Seven',dateCreated:'1995-09-22',url})}</script><script id="media-scorecard-json" type="application/json">${JSON.stringify({criticsScore:{score:critics},audienceScore:{score:audience,scoreType:'ALL'},hideAudienceScore:hidden})}</script>`;
const row=(title,year,path)=>`<search-page-media-row release-year="${year}"><a href="${path}" slot="title">${title}</a></search-page-media-row>`;
test('RT parser verifies identity and handles zero, missing, hidden and invalid scores',()=>{
 const expected={title:'Se7en',year:1995};assert.equal(parseRT(html(),expected,url).critics,0);assert.equal(parseRT(html(null,null),expected,url).audience,null);assert.equal(parseRT(html('84','95',true),expected,url).audience,null);
 assert.throws(()=>parseRT(html(),{...expected,year:2026},url),/mismatch/);assert.throws(()=>parseRT(html('101'),expected,url),/Invalid/);assert.throws(()=>parseRT('<html>blocked</html>',expected,url),/format/);
 assert.deepEqual(searchCandidates(row('Seven',1995,url)+row('Seven',1995,'https://evil.example/m/seven')), [{title:'Seven',year:1995,url}]);
});
test('RT lookup skips wrong years, caches success and deduplicates concurrent imports',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async u=>{requests++;return new Response(String(u).includes('/search?')?row('Seven',2026,'/m/seven_2026')+row('Seven',1995,url):html('84','95'));};
 try{
 const movie={id:807,title:'Se7en',year:1995,scores:{critics:null,audience:null,imdb:8},scoreEvidence:{}};const other=structuredClone(movie);
 await Promise.all([enrichRT(movie),enrichRT(other)]);assert.equal(requests,2);assert.equal(movie.scores.critics,84);assert.equal(movie.scores.audience,95);assert.equal(movie.scores.imdb,8);assert.match(movie.scoreEvidence.audience.note,/ALL/);await enrichRT(movie);assert.equal(requests,2);
 }finally{globalThis.fetch=original;closeDatabase();rmSync(dir,{recursive:true,force:true});}
});
