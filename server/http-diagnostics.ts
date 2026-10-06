// Bounded diagnostics: never log cookies, authorization headers or raw HTML.
export function sanitizeExcerpt(raw:string){
 let text=raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 for(const [key,value] of Object.entries(process.env)){if(value&&value.length>=4&&/TOKEN|PASSWORD|SECRET|API_KEY|CONTACT|EMAIL/i.test(key))text=text.split(value).join('[redacted]');}
 return text.replace(/https?:\/\/\S+/gi,'[url]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[ip]').replace(/\b[0-9a-f]*:[0-9a-f:]+\b/gi,'[ip]').replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*\S+/gi,'[redacted]').replace(/[A-Za-z0-9_+/=-]{32,}/g,'[redacted]').slice(0,300);
}
export async function responseDiagnostic(response:Response){
 const headers:Record<string,string>={};for(const name of ['server','content-type','cf-mitigated','cf-ray','retry-after']){const value=response.headers.get(name);if(value)headers[name]=value.replace(/[\r\n]/g,' ').slice(0,160);}
 let sample='';const reader=response.body?.getReader();
 if(reader){try{const decoder=new TextDecoder();let bytes=0;while(bytes<8192){const {value,done}=await reader.read();if(done)break;const chunk=value.subarray(0,8192-bytes);sample+=decoder.decode(chunk,{stream:true});bytes+=chunk.length;}sample+=decoder.decode();}catch{}finally{try{await reader.cancel();}catch{}}}
 return {status:response.status,headers,excerpt:sanitizeExcerpt(sample)};
}
