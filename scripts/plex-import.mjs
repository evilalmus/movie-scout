import {closeDatabase} from '../dist-server/server/db.js';
import {plexStatus,plexLibraries,plexPending,requestPlexScan} from '../dist-server/server/plex.js';
try {
 const args=process.argv.slice(2);
 if(args.length>1||args.some(a=>!['--libraries','--rescan'].includes(a)))throw new Error('Usage: node scripts/plex-import.mjs [--libraries | --rescan]');
 if(args.includes('--libraries'))console.table(await plexLibraries());
 else {
  if(args.includes('--rescan')){await requestPlexScan();console.log('Scan requested. The enabled API worker will pick it up on its next tick.');}
  const status=await plexStatus();console.log(JSON.stringify({...status,pending:status.configured?await plexPending():[]},null,2));
 }
} catch(e){console.error(e.message);process.exitCode=1;} finally {closeDatabase();}
