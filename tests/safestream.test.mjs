import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'scout-safe-'));process.env.DATA_DIR=dir;process.env.SAFESTREAM_EMAIL='test@example.test';process.env.SAFESTREAM_PASSWORD='test';
const {safeStreamGuidance,parseGuidance,safeStreamUsage}=await import('../dist-server/server/safestream.js');
const {database,closeDatabase}=await import('../dist-server/server/db.js');
const original=globalThis.fetch;let calls=0;
globalThis.fetch=async(url,init)=>{calls++;if(url.endsWith('/token')){assert.equal(JSON.parse(init.body).password,'test');return Response.json({data:{api_bearer_token:'fixture-token'}});}assert.equal(init.headers.Authorization,'Bearer fixture-token');if(url.includes('?'))return Response.json({data:[{id:13097,name:'Seven',year:1995,content_type:{slug:'movie'}}]});return Response.json({data:{id:13097,name:'Seven',year:1995,nudity:5,violence:9,language:7,content_comments:[{type:'nudity',content:'Fixture description'}]}});};
test('Safe Stream authentication, current schema, caching, matching and budgets',async()=>{try{
 const movie={id:807,title:'Se7en',year:1995};const [a,b]=await Promise.all([safeStreamGuidance(movie),safeStreamGuidance(movie)]);assert.deepEqual(a,b);assert.equal(calls,3);assert.equal(a.violence.level,9);assert.equal(a.nudity.present,null);assert.equal(a.profanity.level,7);assert.equal(a.nudity.providerId,13097);assert.equal(a.sex,undefined);await safeStreamGuidance(movie);assert.equal(calls,3);
 await safeStreamGuidance({id:8,title:'Wrong title',year:1995});await safeStreamGuidance({id:8,title:'Wrong title',year:1995});assert.equal(calls,4);
 assert.equal(parseGuidance({data:{id:1,content_rating:{violence:0,nudity:10,language:null}}}).violence.level,0);assert.equal(parseGuidance({data:{id:1}}).nudity.level,null);assert.throws(()=>parseGuidance({data:{id:1,violence:11}}));
 process.env.SAFESTREAM_MONTHLY_LIMIT='5';process.env.SAFESTREAM_USER_RESERVE='1';await assert.rejects(safeStreamGuidance({...movie,id:9},true),/budget/);assert.equal(calls,4);
 await assert.rejects(safeStreamGuidance({...movie,id:10}),/budget/);assert.equal(calls,5);assert.equal((await safeStreamUsage()).requests,5);
 const row=await database().prepare("SELECT requests FROM provider_usage WHERE provider='SAFESTREAM'").first();assert.equal(row.requests,5);
 }finally{globalThis.fetch=original;closeDatabase();rmSync(dir,{recursive:true,force:true});}});
