import type { LoaderFunctionArgs } from 'react-router';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token=params.token??'';
  if(!/^[A-Za-z0-9_-]{64}$/.test(token))return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
  const env=typeof process!=='undefined'?process.env:undefined;const supabaseUrl=env?.SUPABASE_URL;const serviceKey=env?.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabaseUrl||!serviceKey)return new Response('Calendar temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  const upstream=await fetch(`${supabaseUrl.replace(/\/$/,'')}/functions/v1/calendar-ics-feed/${encodeURIComponent(token)}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},signal:request.signal,cache:'no-store'}).catch(()=>null);
  if(!upstream)return new Response('Calendar temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':upstream.headers.get('Content-Type')??'text/calendar; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
