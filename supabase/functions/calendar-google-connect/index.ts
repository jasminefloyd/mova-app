import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { encryptProviderSecret, sha256Hex } from '../_shared/provider-crypto.ts';

const randomToken = (size = 32) => { const bytes = crypto.getRandomValues(new Uint8Array(size)); return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); };
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request); if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({})); const db = serviceClient();
  if (body.action === 'status') {
    const [{data:connection,error},{data:settings},{data:locations}] = await Promise.all([
      db.from('mova_google_calendar_connections').select('google_account_email,status,connected_at').eq('artist_business_id',actor.businessId).maybeSingle(),
      db.from('mova_calendar_sync_settings').select('location_ids,apple_feed_enabled').eq('artist_business_id',actor.businessId).maybeSingle(),
      db.from('mova_locations').select('id,name').eq('artist_business_id',actor.businessId).eq('is_active',true).order('created_at'),
    ]);
    if(error)return respond({code:'CALENDAR_SETTINGS_FAILED'},500);
    const {data:feed}=await db.from('mova_calendar_feed_tokens').select('id,created_at').eq('artist_business_id',actor.businessId).is('revoked_at',null).maybeSingle();
    return respond({google:connection??null,settings:settings??{location_ids:[],apple_feed_enabled:true},locations:locations??[],feedConfigured:Boolean(feed)});
  }
  if(body.action==='save-settings'){
    if(!Array.isArray(body.location_ids)||body.location_ids.some((id:unknown)=>typeof id!=='string'))return respond({code:'INVALID_REQUEST'},422);
    const {data:locations,error:locationError}=await db.from('mova_locations').select('id').eq('artist_business_id',actor.businessId).eq('is_active',true).in('id',body.location_ids.length?body.location_ids:['00000000-0000-0000-0000-000000000000']);
    if(locationError||locations?.length!==body.location_ids.length)return respond({code:'INVALID_LOCATION_FILTER'},422);
    const {error}=await db.from('mova_calendar_sync_settings').upsert({artist_business_id:actor.businessId,location_ids:body.location_ids},{onConflict:'artist_business_id'});
    return error?respond({code:'CALENDAR_SETTINGS_SAVE_FAILED'},500):respond({location_ids:body.location_ids});
  }
  if (body.action === 'begin') {
    const clientId=Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');const redirectUri=Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI');
    if(!clientId||!redirectUri||!Deno.env.get('MOVA_PROVIDER_TOKENS_KEK_HEX'))return respond({code:'GOOGLE_CALENDAR_NOT_CONFIGURED'},503);
    const state=randomToken(32);const verifier=randomToken(48);const challenge=await sha256Hex(verifier);
    const {error}=await db.from('mova_google_oauth_states').insert({artist_business_id:actor.businessId,state_hash:await sha256Hex(state),verifier_encrypted:await encryptProviderSecret(verifier),expires_at:new Date(Date.now()+10*60_000).toISOString()});
    if(error)return respond({code:'GOOGLE_CONNECT_START_FAILED'},500);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/calendar.events',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
    return respond({authorizationUrl:url.toString()});
  }
  if(body.action==='disconnect'){
    const {error}=await db.from('mova_google_calendar_connections').update({status:'revoked',refresh_token_encrypted:'\\x'}).eq('artist_business_id',actor.businessId);
    await db.from('mova_calendar_sync_settings').upsert({artist_business_id:actor.businessId,google_enabled:false},{onConflict:'artist_business_id'});
    return error?respond({code:'GOOGLE_DISCONNECT_FAILED'},500):respond({disconnected:true});
  }
  if(body.action==='rotate-feed'){
    const token=randomToken(48);const {error}=await db.rpc('mova_rotate_calendar_feed_token',{p_artist_business_id:actor.businessId,p_token_hash:await sha256Hex(token)});
    if(error)return respond({code:'FEED_ROTATE_FAILED'},500);
    const publicBase=Deno.env.get('PUBLIC_BASE_URL')??'https://mova-beauty.co';
    return respond({feedUrl:`${publicBase.replace(/^https:/,'webcal:').replace(/^http:/,'webcal:').replace(/\/$/,'')}/feed/${token}`});
  }
  return respond({code:'INVALID_ACTION'},422);
});
