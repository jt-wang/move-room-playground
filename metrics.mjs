// Fixed schema: no user strings, request URLs, IPs, layouts or exception messages.
export const CLIENT_EVENTS=['page_open','room_ready','first_placement','share_created','share_opened','share_failed','room_failed','client_error','export_saved'];
export const LOCALES=['zh-Hans','zh-Hant','ja','ko','en','es'];
export const ENTRIES=['direct','share'];
// entry is optional so browsers holding the previous cached app.mjs keep working.
export const FAIL_REASONS=['device','material','meta','model','scene'];
export const VISITS=['first','return','unknown'];
// reason is allowed only on room_failed and only as one of FAIL_REASONS.
export function validEvent(x){if(!x||typeof x!=='object'||Array.isArray(x))return false;const extra=Object.keys(x).filter(k=>!['event','locale','device','duration'].includes(k));return Object.keys(x).length===4+extra.length&&extra.every(k=>k==='entry'||k==='reason'||k==='visit')&&(!('entry' in x)||ENTRIES.includes(x.entry))&&(!('visit' in x)||VISITS.includes(x.visit))&&(!('reason' in x)||x.event==='room_failed'&&FAIL_REASONS.includes(x.reason))&&CLIENT_EVENTS.includes(x.event)&&LOCALES.includes(x.locale)&&['mobile','desktop'].includes(x.device)&&Number.isFinite(x.duration)&&x.duration>=0&&x.duration<=60000;}
const geoField=v=>typeof v==='string'&&/^[\w .'-]{1,40}$/.test(v)?v:'none';
// Coarse location from Cloudflare's request.cf (country, region, city). Client events only; no IP, no colo.
export function geoOf(request){const cf=request?.cf||{};return {country:geoField(cf.country),region:geoField(cf.region),city:geoField(cf.city)};}
export function record(env,event,{locale='none',device='none',duration=0,source='server',country='none',region='none',city='none',entry='none',reason='none',visit='none'}={}){if(env.TELEMETRY_ENABLED!=='true')return;try{env.METRICS?.writeDataPoint({blobs:[event,locale,device,duration<2000?'under2s':duration<5000?'2to5s':duration<10000?'5to10s':'over10s',source,country,region,city,entry,reason,visit],doubles:[Math.max(0,Math.min(60000,duration))]});}catch{/* Analytics must never break furniture or sharing. */}}
