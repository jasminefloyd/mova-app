import { corsHeaders, serviceClient } from '../_shared/booking.ts';
import { decryptProviderSecret, encryptProviderSecret, sha256Hex } from '../_shared/provider-crypto.ts';

const redirect = (path: string) => Response.redirect(`${Deno.env.get('OPERATOR_BASE_URL')??'https://ops.mova-beauty.co'}${path}`,303);
Deno.serve(async(request)=>{
  const url=new URL(request.url);const code=url.searchParams.get('code');const state=url.searchParams.get('state');
  if(!code||!state)return redirect('/auth?calendar=connect_error');
  const db=serviceClient();const {data:stateRow}=await db.from('mova_google_oauth_states').select('id,artist_business_id,verifier_encrypted,expires_at,consumed_at').eq('state_hash',await sha256Hex(state)).maybeSingle();
  if(!stateRow||stateRow.consumed_at||new Date(stateRow.expires_at).getTime()<Date.now())return redirect('/auth?calendar=connect_error');
  await db.from('mova_google_oauth_states').update({consumed_at:new Date().toISOString()}).eq('id',stateRow.id).is('consumed_at',null);
  try{
    const clientId=Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!;const clientSecret=Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;const redirectUri=Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')!;
    const verifier=await decryptProviderSecret(stateRow.verifier_encrypted);
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code',code_verifier:verifier})});
    const token=await response.json();if(!response.ok||typeof token.refresh_token!=='string')throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
    const profileResponse=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`}});const profile=profileResponse.ok?await profileResponse.json():{};
    const {error}=await db.from('mova_google_calendar_connections').upsert({artist_business_id:stateRow.artist_business_id,google_account_email:profile.email??null,calendar_id:'primary',refresh_token_encrypted:await encryptProviderSecret(token.refresh_token),status:'active'},{onConflict:'artist_business_id'});
    if(error)throw new Error('GOOGLE_CONNECTION_SAVE_FAILED');
    await db.from('mova_calendar_sync_settings').upsert({artist_business_id:stateRow.artist_business_id,google_enabled:true},{onConflict:'artist_business_id'});
    return redirect(`/${encodeURIComponent(stateRow.artist_business_id)}/settings/calendar-sync?calendar=connected`);
  }catch{return redirect(`/${encodeURIComponent(stateRow.artist_business_id)}/settings/calendar-sync?calendar=connect_error`);}
});
