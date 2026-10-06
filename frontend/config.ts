declare global {interface Window {MOVIE_SCOUT_CONFIG?:{apiBase?:string;demo?:boolean};}}
const supplied=window.MOVIE_SCOUT_CONFIG||{};
export const config={apiBase:(supplied.apiBase||'').replace(/\/$/,''),demo:supplied.demo??true};
export function apiUrl(path:string){return config.apiBase+path;}
