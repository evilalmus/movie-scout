import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=resolve(process.env.DATA_DIR||'./data');
mkdirSync(directory,{recursive:true,mode:0o770});
const sqlite=new DatabaseSync(resolve(directory,'movie-scout.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
const migrations=fileURLToPath(new URL('../../migrations/',import.meta.url));
for(const name of readdirSync(migrations).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
 if(sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name))continue;
 sqlite.exec('BEGIN IMMEDIATE');
 try{sqlite.exec(readFileSync(resolve(migrations,name),'utf8'));sqlite.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES(?,?)').run(name,Date.now());sqlite.exec('COMMIT');}
 catch(error){sqlite.exec('ROLLBACK');throw error;}
}
let auditCursor=Number((sqlite.prepare('SELECT COALESCE(MAX(id),0) AS id FROM movie_audit').get() as {id:number}).id);
export function flushMovieAudit(){
 const rows=sqlite.prepare('SELECT * FROM movie_audit WHERE id>? ORDER BY id LIMIT 500').all(auditCursor) as {id:number;occurred_at:string;event:string;movie_id:number;title:string;changed_fields:string}[];
 for(const row of rows){console.log('[MovieAudit]',JSON.stringify({auditId:row.id,at:row.occurred_at,event:row.event,movieId:row.movie_id,title:row.title,changedFields:JSON.parse(row.changed_fields)}));auditCursor=row.id;}
}
type Value=string|number|null;
class Statement {
 private values:Value[]=[];
 constructor(private sql:string){}
 bind(...values:Value[]){this.values=values;return this;}
 async first<T=Record<string,unknown>>():Promise<T|null>{return (sqlite.prepare(this.sql).get(...this.values) as T)||null;}
 async all<T=Record<string,unknown>>():Promise<{results:T[]}>{return {results:sqlite.prepare(this.sql).all(...this.values) as T[]};}
 runSync(){return sqlite.prepare(this.sql).run(...this.values);}
 async run(){const result=this.runSync();flushMovieAudit();return result;}
}
export function database(){return {prepare:(sql:string)=>new Statement(sql),async batch(statements:Statement[]){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.runSync());sqlite.exec('COMMIT');flushMovieAudit();return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};}
export function closeDatabase(){sqlite.close();}
