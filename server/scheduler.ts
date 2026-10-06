import {kimTick} from './kids-in-mind.js';
import {database,flushMovieAudit} from './db.js';
import {daily,processJob} from './catalog.js';
import {settings} from './config.js';
import {connections} from './providers.js';
export function clockParts(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {day:`${values.year}-${values.month}-${values.day}`,time:`${values.hour}:${values.minute}`};
}
export function startScheduler(){
 let stopped=false;let jobTask:Promise<void>|null=null;let dailyTask:Promise<void>|null=null;
 async function work(){
  if(stopped||jobTask||!connections().tmdb)return;
  jobTask=(async()=>{const db=database();const now=Date.now();await db.prepare("UPDATE jobs SET status='failed',error='Retry limit reached after an interrupted collection.',updated_at=? WHERE status='running' AND lease_until<? AND attempts>=4").bind(now,now).run();const rows=await db.prepare("SELECT movie_id FROM jobs WHERE attempts<4 AND ((status IN ('queued','failed') AND next_attempt<=?) OR (status='running' AND lease_until<?)) ORDER BY background ASC, updated_at LIMIT 2").bind(now,now).all<{movie_id:number}>();await Promise.all(rows.results.map(r=>processJob(r.movie_id)));})().catch(e=>console.error('Queue worker:',e.message)).finally(()=>{jobTask=null;});await jobTask;
 }
 async function tickDaily(){
  if(stopped||dailyTask||!settings.dailyEnabled||!connections().tmdb)return;
  const {day,time}=clockParts();if(time<settings.dailyTime)return;
  dailyTask=(async()=>{const last=await database().prepare('SELECT status,updated_at FROM runs WHERE day=?').bind(day).first<{status:string;updated_at:number}>();if(last?.status==='complete'||(last&&Date.now()-last.updated_at<15*60000))return;const result=await daily();console.log('Daily popularity:',JSON.stringify(result));})().catch(e=>console.error('Daily popularity:',e.message)).finally(()=>{dailyTask=null;});await dailyTask;
 }
 let kimTask:Promise<void>|null=null;
 function tickKIM(){if(stopped||kimTask)return;kimTask=kimTick().catch(e=>console.error('[KidsInMind]',e.message)).finally(()=>{kimTask=null;});}
 const auditTimer=setInterval(()=>{try{flushMovieAudit();}catch(e){console.error('[MovieAudit] Read failed');}},15000);
 const kimTimer=setInterval(tickKIM,15000);tickKIM();
 const jobs=setInterval(()=>void work(),15000);const timer=setInterval(()=>void tickDaily(),60000);
 void work();void tickDaily();
 return {wake:()=>void work(),async stop(){stopped=true;clearInterval(auditTimer);clearInterval(kimTimer);clearInterval(jobs);clearInterval(timer);await Promise.allSettled([jobTask,dailyTask,kimTask].filter(Boolean));}};
}
