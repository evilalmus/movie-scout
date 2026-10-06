import {database,closeDatabase} from '../dist-server/server/db.js';
import {kimStatus} from '../dist-server/server/kids-in-mind.js';
const args=process.argv.slice(2);
if(args.some(a=>a!=='--resume'))throw new Error('Usage: node scripts/kids-in-mind.mjs [--resume]');
if(args.includes('--resume'))await database().prepare('UPDATE kim_state SET paused=NULL WHERE id=1').run();
console.log(JSON.stringify({...await kimStatus(),pendingDiscoveries:(await database().prepare("SELECT json_extract(data,'$.title') AS title,json_extract(data,'$.year') AS year,status,error,retry_at FROM kim_discoveries WHERE status!='imported' ORDER BY observed_at LIMIT 20").all()).results},null,2));
closeDatabase();
