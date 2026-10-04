const EVENTS=new Set(['page_open','room_ready','first_placement','share_created','share_opened','share_failed','room_failed','client_error','export_saved']);
// Load stage where the room failed; an enum, never an error message.
export const FAIL_REASONS=['device','material','meta','model','scene'];
// first: this browser has not opened the room before; return: it has; unknown: storage unavailable. A local flag only, no identifier is sent.
export const VISITS=['first','return','unknown'];
// Public demo: telemetry is off unless this browser explicitly opts in, and events only go to the same-origin local server.
export const TELEMETRY_OPT_IN_KEY='move-demo:telemetry-opt-in';
export function detectVisit(storage=localStorage,key='move-demo:visited'){try{const seen=storage.getItem(key)==='1';if(!seen)storage.setItem(key,'1');return seen?'return':'first';}catch{return 'unknown';}}
export function createTelemetry({send,allowed,locale,device,entry=()=>'direct',visit=()=>'unknown'}){const seen=new Set();return(event,duration=0,reason)=>{if(!EVENTS.has(event)||seen.has(event)||!allowed())return;seen.add(event);try{const v=visit();const body={event,locale:locale(),device:device(),duration:Math.round(Math.max(0,Math.min(60000,Number(duration)||0))),entry:entry()==='share'?'share':'direct',visit:VISITS.includes(v)?v:'unknown'};if(event==='room_failed'&&FAIL_REASONS.includes(reason))body.reason=reason;send(body);}catch{/* No retry: analytics cannot delay interaction. */}};}
export function privacySignalsAllow(){return navigator.doNotTrack!=='1'&&window.doNotTrack!=='1'&&navigator.globalPrivacyControl!==true;}
export function telemetryOptedIn(storage=localStorage){try{return storage.getItem(TELEMETRY_OPT_IN_KEY)==='1';}catch{return false;}}
export function browserAllowsTelemetry(){try{return telemetryOptedIn()&&privacySignalsAllow();}catch{return false;}}
