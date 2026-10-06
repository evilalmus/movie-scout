import {kimStatus} from './kids-in-mind.js';
import {safeStreamUsage} from './safestream.js';
import {createServer,IncomingMessage,ServerResponse} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {database,closeDatabase} from './db.js';
import {settings} from './config.js';
import {connections,tmdb} from './providers.js';
import {enqueue,findMovies,getMovie,daily} from './catalog.js';
import {filtersSchema} from '../lib/movies.js';
import {startScheduler} from './scheduler.js';
class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
const buckets=new Map<string,{count:number;expires:number}>();
function permit(key:string,limit:number){const now=Date.now();let item=buckets.get(key);if(!item||item.expires<=now){item={count:0,expires:now+60000};buckets.set(key,item);}item.count++;return item.count<=limit;}
const cleanup=setInterval(()=>{for(const [key,bucket] of buckets)if(bucket.expires<Date.now())buckets.delete(key);},60000);cleanup.unref();
function authorized(req:IncomingMessage){const supplied=req.headers.authorization||'';const expected=process.env.JOB_TOKEN?'Bearer '+process.env.JOB_TOKEN:'';if(!expected||Buffer.byteLength(supplied)!==Buffer.byteLength(expected))return false;return timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));}
async function body(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const c of req){size+=c.length;if(size>20000)throw new HttpError(413,'Request is too large.');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new HttpError(400,'Invalid JSON request.');}}
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
const scheduler=startScheduler();
const server=createServer(async(req,res)=>{
 const origin=req.headers.origin;
 res.setHeader('Vary','Origin');
 if(origin&&!settings.origins.includes(origin)){send(res,403,{error:'This frontend origin is not allowed. Check ALLOWED_ORIGINS on the backend.'});return;}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Max-Age','600');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{
  if((req.url||'').length>4096)throw new HttpError(414,'Request URL is too long.');
  const url=new URL(req.url||'/','http://localhost');const path=url.pathname;
  if(path==='/api/health'&&req.method==='GET'){await database().prepare('SELECT 1 AS ready').first();send(res,200,{status:'ok'});return;}
  const proxyHeader=String(req.headers['x-forwarded-for']||'');const ip=settings.trustProxy&&proxyHeader?proxyHeader.split(',').at(-1)!.trim():(req.socket.remoteAddress||'unknown');
  if(buckets.size>20000||!permit('global',settings.globalLimit)||!permit('read:'+ip,settings.readLimit))throw new HttpError(429,'Too many requests. Please try again in a minute.');
  if(req.method==='POST'&&['/api/import','/api/expand'].includes(path)){
   if(!settings.publicImports&&!authorized(req))throw new HttpError(403,'Public movie imports are disabled.');
   if(!permit('write:'+ip,settings.writeLimit))throw new HttpError(429,'Movie collection limit reached. Please try again in a minute.');
  }
  if(path==='/api/status'&&req.method==='GET'){
   const db=database();const count=await db.prepare('SELECT COUNT(*) AS count FROM movies').first<{count:number}>();const lastRun=await db.prepare('SELECT day,status,updated_at FROM runs ORDER BY updated_at DESC LIMIT 1').first();
   send(res,200,{connections:connections(),safeStream:await safeStreamUsage(),kidsInMind:await kimStatus(),count:count?.count||0,lastRun,scheduler:{enabled:settings.dailyEnabled,time:settings.dailyTime,timeZone:settings.timeZone,ready:connections().tmdb},publicImports:settings.publicImports});return;
  }
  if(path==='/api/catalog'&&req.method==='POST'){send(res,200,await findMovies(filtersSchema.parse(await body(req))));return;}
  if(path==='/api/lookup'&&req.method==='GET'){
   const q=z.string().min(2).max(120).parse(url.searchParams.get('q'));const data=await tmdb('search/movie',{query:q,include_adult:'false',language:'en-US'});
   send(res,200,{results:data.results.slice(0,12).map((m:any)=>({id:m.id,title:m.title,year:m.release_date?.slice(0,4)||'Unknown year',poster:m.poster_path?`https://image.tmdb.org/t/p/w185${m.poster_path}`:null,overview:m.overview}))});return;
  }
  if(path==='/api/people'&&req.method==='GET'){const q=z.string().min(2).max(100).parse(url.searchParams.get('q'));const d=await tmdb('search/person',{query:q,include_adult:'false'});send(res,200,{results:d.results.slice(0,10).map((p:any)=>({id:p.id,name:p.name}))});return;}
  if(path==='/api/import'&&req.method==='POST'){
   if(!connections().tmdb)throw new HttpError(503,'Connect TMDB on the backend before adding movies.');
   const {id}=z.object({id:z.number().int().positive()}).parse(await body(req));const job=await enqueue(id);scheduler.wake();send(res,job.status==='cached'?200:202,job);return;
  }
  if(path==='/api/jobs'&&req.method==='POST'){
   const {id}=z.object({id:z.number().int().positive()}).parse(await body(req));const job=await database().prepare('SELECT status,error,next_attempt,attempts FROM jobs WHERE movie_id=?').bind(id).first();if(!job)throw new HttpError(404,'Movie job not found.');send(res,200,{job,movie:await getMovie(id)});return;
  }
  if(path==='/api/expand'&&req.method==='POST'){
   const f=filtersSchema.parse(await body(req));const params:Record<string,string>={include_adult:'false',sort_by:'popularity.desc',page:String(Math.min(500,f.page))};if(f.actors.length)params.with_cast=f.actors.map(p=>p.id).join(f.actorMode==='all'?',':'|');if(f.year[0]!==null)params['primary_release_date.gte']=`${f.year[0]}-01-01`;if(f.year[1]!==null)params['primary_release_date.lte']=`${f.year[1]}-12-31`;if(f.language)params.with_original_language=f.language;
   const d=await tmdb(f.query?'search/movie':'discover/movie',f.query?{query:f.query,include_adult:'false',page:params.page}:params);const ids:number[]=d.results.slice(0,3).map((m:any)=>m.id);for(const id of ids)await enqueue(id);scheduler.wake();send(res,202,{ids,message:'Checking three candidate movies. They will appear only if they match your filters.'});return;
  }
  if(path==='/api/daily'&&req.method==='POST'){if(!authorized(req))throw new HttpError(401,'Scheduler authorization required.');send(res,200,await daily());return;}
  throw new HttpError(404,'API route not found.');
 }catch(error){
  if(error instanceof z.ZodError){send(res,400,{error:error.issues.map(i=>i.message).join('; ')});return;}
  if(error instanceof HttpError){if(error.status===429)res.setHeader('Retry-After','60');send(res,error.status,{error:error.message});return;}
  console.error('Request failed:',error instanceof Error?error.message:'Unknown error');
  send(res,503,{error:error instanceof Error&&/TMDB|Data provider|daily request budget/.test(error.message)?error.message:'Unable to complete this request. Please try again.'});
 }
});
server.requestTimeout=30000;server.headersTimeout=10000;
server.listen(settings.port,settings.host,()=>{const address=server.address();console.log(`Movie Scout API listening on ${typeof address==='object'&&address?address.port:settings.port}`);});
let shuttingDown=false;
async function shutdown(){if(shuttingDown)return;shuttingDown=true;clearInterval(cleanup);const closed=new Promise<void>(resolve=>server.close(()=>resolve()));await scheduler.stop();await closed;closeDatabase();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
