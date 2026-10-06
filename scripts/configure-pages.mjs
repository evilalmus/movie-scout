import fs from 'node:fs';
const api=process.env.MOVIE_SCOUT_API_BASE?.trim().replace(/\/$/,'');
if(api){const u=new URL(api);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw new Error('MOVIE_SCOUT_API_BASE must be an HTTPS origin with no /api path or credentials.');fs.writeFileSync('public/config.js','window.MOVIE_SCOUT_CONFIG = '+JSON.stringify({apiBase:api,demo:false},null,2)+';\n');}
const domain=process.env.MOVIE_SCOUT_CUSTOM_DOMAIN?.trim();
if(domain){if(!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain)||!domain.includes('.'))throw new Error('MOVIE_SCOUT_CUSTOM_DOMAIN must be a hostname only.');fs.writeFileSync('public/CNAME',domain+'\n');}
