function integer(name:string,fallback:number,min:number,max:number){const value=Number(process.env[name]||fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be an integer from ${min} to ${max}`);return value;}
export const settings={
 port:integer('PORT',4174,0,65535),host:process.env.HOST||'0.0.0.0',
 origins:(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://localhost:8087').split(',').map(s=>s.trim()).filter(Boolean),
 publicImports:process.env.ENABLE_PUBLIC_IMPORTS!=='false',trustProxy:process.env.TRUST_PROXY==='true',
 dailyEnabled:process.env.DAILY_ENABLED!=='false',dailyTime:process.env.DAILY_TIME||'06:00',timeZone:process.env.TZ||'America/Los_Angeles',
 readLimit:integer('READS_PER_MINUTE',120,1,10000),writeLimit:integer('IMPORTS_PER_MINUTE',10,1,1000),
 globalLimit:integer('GLOBAL_REQUESTS_PER_MINUTE',300,1,100000)
};
for(const origin of settings.origins){if(new URL(origin).origin!==origin||origin==='null')throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins, without paths or trailing slashes.');if(!/^https?:\/\//.test(origin))throw new Error('ALLOWED_ORIGINS supports HTTP and HTTPS only.');}
if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.dailyTime))throw new Error('DAILY_TIME must be HH:MM in 24-hour time.');
new Intl.DateTimeFormat('en-US',{timeZone:settings.timeZone}).format();
