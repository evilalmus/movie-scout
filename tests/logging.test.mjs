import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'scout-log-'));
const {database,flushMovieAudit,closeDatabase}=await import('../dist-server/server/db.js');
const {responseDiagnostic}=await import('../dist-server/server/http-diagnostics.js');
const db=database();
after(()=>{closeDatabase();rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
test('audit records committed changes, deletions and external edits but not rollbacks or no-ops',async()=>{
 const logs=[],log=console.log;console.log=(...args)=>logs.push(args);
 try{
 await db.prepare('INSERT INTO movies VALUES(?,?,?,?)').bind(1,'Test',JSON.stringify({title:'Test',scores:{critics:50}}),1).run();
 await db.prepare('UPDATE movies SET data=data WHERE id=1').run();assert.equal(logs.length,1);
 await db.prepare('UPDATE movies SET data=? WHERE id=1').bind(JSON.stringify({title:'Test',scores:{critics:75}})).run();assert.deepEqual(JSON.parse(logs[1][1]).changedFields,['scores']);
 await assert.rejects(db.batch([db.prepare('UPDATE movies SET title=? WHERE id=1').bind('Rolled back'),db.prepare('INSERT INTO nonexistent VALUES(1)')]));assert.equal(logs.length,2);
 const external=new DatabaseSync(join(process.env.DATA_DIR,'movie-scout.sqlite'));external.prepare('UPDATE movies SET title=? WHERE id=1').run('External');external.close();flushMovieAudit();assert.equal(JSON.parse(logs[2][1]).title,'External');
 await db.prepare('DELETE FROM movies WHERE id=1').run();assert.equal(JSON.parse(logs[3][1]).event,'movie_deleted');assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM movie_audit').first()).n,4);
 }finally{console.log=log;}
});
test('denial diagnostics show status and challenge headers with bounded, redacted text',async()=>{
 process.env.KIM_CONTACT='private@example.com';
 const r=new Response('<title>Access denied</title><script>SECRET JS</script><p>private@example.com 192.0.2.1 token=abcdef https://example.com/?key=secret</p>'+ 'x'.repeat(20000),{status:403,headers:{'cf-mitigated':'challenge','cf-ray':'example-ray','set-cookie':'secret-session','authorization':'secret'}});
 const d=await responseDiagnostic(r);assert.equal(d.status,403);assert.equal(d.headers['cf-mitigated'],'challenge');assert.equal(d.headers['set-cookie'],undefined);assert.ok(d.excerpt.length<=300);assert.match(d.excerpt,/Access denied/);assert.doesNotMatch(d.excerpt,/private@|192\.0|abcdef|SECRET JS|key=secret/);
});
