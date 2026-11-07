import { publicEnv } from '../../lib/env';
export type ProfileEvent='page_view'|'qr_scan'|'booking_started'|'booking_completed';
export function profileSource(){
 if(typeof window==='undefined')return'direct';
 const source=new URLSearchParams(window.location.search).get('utm_source')?.toLowerCase();
 const referrer=(document.referrer||'').toLowerCase();
 if(source==='instagram'||referrer.includes('instagram.com'))return'instagram';
 if(source==='google'||referrer.includes('google.'))return'google';
 if(source==='qr')return'qr';
 return referrer?'other':'direct';
}
export function trackProfileEvent(handle:string,event:ProfileEvent,eventKey=crypto.randomUUID()){
 if(!/^[a-z0-9-]{2,40}$/.test(handle)||!publicEnv.VITE_SUPABASE_URL||!publicEnv.VITE_SUPABASE_ANON_KEY)return;
 const source=event==='qr_scan'?'qr':profileSource();
 void fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/reports-track`,{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY},body:JSON.stringify({handle,event,source,event_key:eventKey})}).catch(()=>undefined);
}
