import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';

type Contact={contact_type:'email'|'phone';value_normalized:string;verified_at:string};
async function getUser(request:Request){
  const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_ANON_KEY');const authorization=request.headers.get('Authorization');
  if(!url||!key||!authorization)return null;
  const client=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user}}=await client.auth.getUser();return user??null;
}
function normalizedContacts(user:{email?:string;phone?:string;email_confirmed_at?:string|null;phone_confirmed_at?:string|null}):Contact[]{
  const values:Contact[]=[];const now=new Date().toISOString();
  if(user.email&&user.email_confirmed_at)values.push({contact_type:'email',value_normalized:user.email.trim().toLowerCase(),verified_at:now});
  if(user.phone&&user.phone_confirmed_at){const digits=user.phone.replace(/\D/g,'');values.push({contact_type:'phone',value_normalized:digits.length===10?`1${digits}`:digits,verified_at:now});}
  return values;
}
async function provision(db:ReturnType<typeof serviceClient>,user:{id:string;email?:string;phone?:string;email_confirmed_at?:string|null;phone_confirmed_at?:string|null;user_metadata?:Record<string,unknown>}){
  const contacts=normalizedContacts(user);if(!contacts.length)throw new Error('VERIFIED_CONTACT_REQUIRED');
  let {data:account,error}=await db.from('mova_customer_accounts').select('id,display_name,preferred_locale,status').eq('user_id',user.id).maybeSingle();
  if(error)throw new Error('CUSTOMER_ACCOUNT_LOOKUP_FAILED');
  if(account?.status==='deleted')throw new Error('CUSTOMER_ACCOUNT_DELETED');
  if(!account){
    const metadata=user.user_metadata??{};const displayName=typeof metadata.full_name==='string'?metadata.full_name.trim().slice(0,160):'';
    const {data:created,error:createError}=await db.from('mova_customer_accounts').insert({user_id:user.id,display_name:displayName}).select('id,display_name,preferred_locale,status').single();
    if(createError||!created)throw new Error('CUSTOMER_ACCOUNT_CREATE_FAILED');account=created;
  }
  for(const contact of contacts){
    const {data:existing}=await db.from('mova_customer_contact_methods').select('id').eq('customer_account_id',account.id).eq('contact_type',contact.contact_type).eq('value_normalized',contact.value_normalized).maybeSingle();
    if(existing)continue;
    const {error:contactError}=await db.from('mova_customer_contact_methods').insert({customer_account_id:account.id,...contact});
    if(contactError&&contactError.code!=='23505')throw new Error('CUSTOMER_CONTACT_SAVE_FAILED');
  }
  return account;
}
type ExportPage<T>={data:T[]|null;error:{message:string}|null};
async function allExportPages<T=Record<string,unknown>>(load:(from:number,to:number)=>PromiseLike<ExportPage<T>>){
  const result:T[]=[];const pageSize=1000;const maxRows=100_000;
  for(let offset=0;offset<maxRows;offset+=pageSize){const page=await load(offset,offset+pageSize-1);if(page.error)throw new Error('CLIENT_EXPORT_FAILED');const rows=page.data??[];result.push(...rows);if(rows.length<pageSize)return result;}
  throw new Error('CLIENT_EXPORT_LIMIT_REACHED');
}
Deno.serve(withSystemRequestLogging('customer-profile', async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  if(Deno.env.get('MOVA_CLIENT_PROFILES_ENABLED')!=='true')return respond({code:'CLIENT_PROFILES_DISABLED'},403);
  const user=await getUser(request);if(!user)return respond({code:'UNAUTHENTICATED'},401);const body=await request.json().catch(()=>({}));const db=serviceClient();
  try{
    if(body.action==='bootstrap'){
      const account=await provision(db,user);return respond({profile:{display_name:account.display_name,preferred_locale:account.preferred_locale}});
    }
    const {data:account,error:accountError}=await db.from('mova_customer_accounts').select('id,display_name,preferred_locale,status').eq('user_id',user.id).maybeSingle();
    if(accountError)return respond({code:'CUSTOMER_ACCOUNT_LOOKUP_FAILED'},500);
    if(!account||account.status!=='active')return respond({code:'CLIENT_PROFILE_NOT_FOUND'},404);
    if(body.action==='link-booking'){
      if(typeof body.appointment_id!=='string'||typeof body.manage_token!=='string'||body.manage_token.length<40||body.manage_token.length>100)return respond({code:'INVALID_BOOKING'},422);
      const {data,error}=await db.rpc('mova_link_signed_in_booking',{p_appointment_id:body.appointment_id,p_customer_account_id:account.id,p_manage_token_hash:await tokenHash(body.manage_token)});
      if(error)return respond({code:error.message==='VERIFIED_CONTACT_MISMATCH'?'VERIFIED_CONTACT_MISMATCH':'BOOKING_LINK_FAILED'},error.message==='VERIFIED_CONTACT_MISMATCH'?403:500);
      return respond({linked:Boolean(data?.linked)});
    }
    if(body.action==='claim-options'){
      const contacts=normalizedContacts(user);
      const emailValues=contacts.filter((item)=>item.contact_type==='email').map((item)=>item.value_normalized);
      const phoneValues=contacts.filter((item)=>item.contact_type==='phone').map((item)=>item.value_normalized);
      const queries=[];
      if(emailValues.length)queries.push(db.from('mova_appointments').select('id,artist_business_id,client_id,customer_account_id,service_name_snapshot,starts_at,status,location_id').in('client_email_normalized',emailValues).lt('starts_at',new Date().toISOString()).order('starts_at',{ascending:false}).limit(100));
      if(phoneValues.length)queries.push(db.from('mova_appointments').select('id,artist_business_id,client_id,customer_account_id,service_name_snapshot,starts_at,status,location_id').in('client_phone_normalized',phoneValues).lt('starts_at',new Date().toISOString()).order('starts_at',{ascending:false}).limit(100));
      const results=await Promise.all(queries);if(results.some((result)=>result.error))return respond({code:'CLAIM_LOOKUP_FAILED'},500);
      const candidates=new Map<string,Record<string,unknown>>();for(const result of results)for(const appointment of result.data??[])candidates.set(appointment.id,appointment as unknown as Record<string,unknown>);
      const rows=[...candidates.values()];const businessIds=[...new Set(rows.map((row)=>row.artist_business_id as string))];const locationIds=[...new Set(rows.map((row)=>row.location_id as string))];
      const appointmentIds=rows.map((row)=>row.id as string);
      const [profilesResult,locationsResult,linksResult]=await Promise.all([
        businessIds.length?db.from('mova_artist_profiles').select('artist_business_id,display_name,handle').in('artist_business_id',businessIds):Promise.resolve({data:[],error:null}),
        locationIds.length?db.from('mova_locations').select('id,name').in('id',locationIds):Promise.resolve({data:[],error:null}),
        businessIds.length?db.from('mova_client_customer_links').select('artist_business_id,client_id').eq('customer_account_id',account.id).is('unlinked_at',null).in('artist_business_id',businessIds):Promise.resolve({data:[],error:null}),
      ]);
      const {data:serviceRows,error:serviceError}=appointmentIds.length?await db.from('mova_appointment_services').select('appointment_id,position,service_name_snapshot').in('appointment_id',appointmentIds).order('position'):{data:[] as Array<{appointment_id:string;position:number;service_name_snapshot:string}>};
      if(profilesResult.error||locationsResult.error||linksResult.error||serviceError)return respond({code:'CLAIM_LOOKUP_FAILED'},500);
      const profiles=new Map((profilesResult.data??[]).map((item)=>[item.artist_business_id,{name:item.display_name,handle:item.handle}]));
      const locations=new Map((locationsResult.data??[]).map((item)=>[item.id,item.name]));const linkedClients=new Set((linksResult.data??[]).map((item)=>`${item.artist_business_id}:${item.client_id}`));
      const serviceNames=new Map<string,string[]>();for(const item of serviceRows??[])serviceNames.set(item.appointment_id,[...(serviceNames.get(item.appointment_id)??[]),item.service_name_snapshot]);
      const options=rows.filter((row)=>row.customer_account_id!==account.id&&!linkedClients.has(`${row.artist_business_id}:${row.client_id}`)).slice(0,50).map((row)=>({
        appointment_id:row.id,artist_business_id:row.artist_business_id,artist:profiles.get(row.artist_business_id as string)?.name??'',handle:profiles.get(row.artist_business_id as string)?.handle??'',
        service:row.service_name_snapshot,service_names:serviceNames.get(row.id as string)??[row.service_name_snapshot as string],starts_at:row.starts_at,status:row.status,location:locations.get(row.location_id as string)??'',
      }));
      return respond({options});
    }
    if(body.action==='claim-booking'){
      if(typeof body.appointment_id!=='string')return respond({code:'INVALID_BOOKING'},422);
      const {data,error}=await db.rpc('mova_link_signed_in_booking',{p_appointment_id:body.appointment_id,p_customer_account_id:account.id,p_manage_token_hash:null});
      if(error)return respond({code:error.message==='VERIFIED_CONTACT_MISMATCH'?'VERIFIED_CONTACT_MISMATCH':'CLAIM_FAILED'},error.message==='VERIFIED_CONTACT_MISMATCH'?403:400);
      return respond({linked:Boolean(data?.linked)});
    }
    if(body.action==='delete-profile'){
      // Task 5.10: withdraw marketing consents, audit, remove the account (0050), then the sign-in.
      const {error:deleteError}=await db.rpc('mova_delete_customer_profile',{p_user_id:user.id});
      if(deleteError)return respond({code:'CLIENT_PROFILE_DELETE_FAILED'},500);
      const {error}=await db.auth.admin.deleteUser(user.id);
      return error?respond({code:'CLIENT_PROFILE_DELETE_FAILED'},500):respond({deleted:true});
    }
    if(body.action==='profile'){
      const {data:links,error:linksError}=await db.from('mova_client_customer_links').select('artist_business_id,client_id').eq('customer_account_id',account.id).is('unlinked_at',null);
      if(linksError)return respond({code:'CLIENT_PROFILE_READ_FAILED'},500);
      const businessIds=[...new Set((links??[]).map((link)=>link.artist_business_id))];
      const [businessesResult,profilesResult]=await Promise.all([
        businessIds.length?db.from('mova_artist_businesses').select('id,name').in('id',businessIds):Promise.resolve({data:[],error:null}),
        businessIds.length?db.from('mova_artist_profiles').select('artist_business_id,display_name,handle,profile_photo_path').in('artist_business_id',businessIds):Promise.resolve({data:[],error:null}),
      ]);
      if(businessesResult.error||profilesResult.error)return respond({code:'CLIENT_PROFILE_READ_FAILED'},500);
      const businessNames=new Map((businessesResult.data??[]).map((business)=>[business.id,business.name]));
      const profiles=new Map((profilesResult.data??[]).map((profile)=>[profile.artist_business_id,profile]));
      const stylists:Array<{business_id:string;name:string;handle:string;photo_path:string|null;consents:{appointment_updates:boolean;reminders:boolean;offers:boolean;email_reminders:boolean;email_offers:boolean;push_reminders:boolean;push_offers:boolean}}>=[];
      const upcoming:Array<{id:string;service:string;starts_at:string;status:string;artist:string;handle:string;location:string}>=[];
      for(const link of links??[]){
        const profile=profiles.get(link.artist_business_id);
        const businessName=profile?.display_name??businessNames.get(link.artist_business_id)??'';
        const {data:consents}=await db.from('mova_client_consents').select('purpose,channel,granted,changed_at').eq('artist_business_id',link.artist_business_id).eq('client_id',link.client_id).order('changed_at',{ascending:false});
        const latest=new Map<string,boolean>();for(const consent of consents??[]){const key=`${consent.purpose}:${consent.channel}`;if(!latest.has(key))latest.set(key,consent.granted);}
        stylists.push({business_id:link.artist_business_id,name:businessName,handle:profile?.handle??'',photo_path:profile?.profile_photo_path??null,consents:{appointment_updates:latest.get('appointment_updates:sms')??false,reminders:latest.get('rebooking_reminders:sms')??false,offers:latest.get('offers:sms')??false,email_reminders:latest.get('rebooking_reminders:email')??false,email_offers:latest.get('offers:email')??false,push_reminders:latest.get('rebooking_reminders:push')??false,push_offers:latest.get('offers:push')??false}});
        const {data:appointments}=await db.from('mova_appointments').select('id,service_name_snapshot,starts_at,status,location_id,mova_locations(name)').eq('artist_business_id',link.artist_business_id).eq('client_id',link.client_id).in('status',['confirmed','pending_artist','pending_payment']).gt('starts_at',new Date().toISOString()).order('starts_at').limit(10);
        const appointmentIds=(appointments??[]).map((item)=>item.id);
        const {data:serviceRows}=appointmentIds.length?await db.from('mova_appointment_services').select('appointment_id,position,service_name_snapshot').in('appointment_id',appointmentIds).order('position'):{data:[] as Array<{appointment_id:string;position:number;service_name_snapshot:string}>};
        const serviceNames=new Map<string,string[]>();for(const item of serviceRows??[])serviceNames.set(item.appointment_id,[...(serviceNames.get(item.appointment_id)??[]),item.service_name_snapshot]);
        for(const item of appointments??[]){const joinedAppointment=item as unknown as {id:string;service_name_snapshot:string;starts_at:string;status:string;mova_locations:{name:string}|null};const names=serviceNames.get(joinedAppointment.id)??[joinedAppointment.service_name_snapshot];upcoming.push({id:joinedAppointment.id,service:names.join(' + '),starts_at:joinedAppointment.starts_at,status:joinedAppointment.status,artist:businessName,handle:profile?.handle??'',location:joinedAppointment.mova_locations?.name??''});}
      }
      upcoming.sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
      return respond({profile:{display_name:account.display_name,preferred_locale:account.preferred_locale,email:user.email??null,phone:user.phone??null,verified_contacts:normalizedContacts(user).map((contact)=>({type:contact.contact_type,value:contact.value_normalized}))},stylists,upcoming:upcoming.slice(0,20)});
    }
    if(body.action==='export'){
      const [{data:contacts,error:contactError},{data:links,error:linkError}]=await Promise.all([
        db.from('mova_customer_contact_methods').select('contact_type,value_normalized,verified_at,created_at').eq('customer_account_id',account.id),
        db.from('mova_client_customer_links').select('artist_business_id,client_id,linked_at').eq('customer_account_id',account.id).is('unlinked_at',null),
      ]);
      if(contactError||linkError)return respond({code:'CLIENT_EXPORT_FAILED'},500);
      const appointments:Record<string,unknown>[]=[];const consents:Record<string,unknown>[]=[];const reviews:Record<string,unknown>[]=[];
      for(const link of links??[]){
        const [appointmentRows,consentRows]=await Promise.all([
          allExportPages((from,to)=>db.from('mova_appointments').select('id,appointment_number,starts_at,ends_at,status,service_name_snapshot,service_price_minor,currency,location_id,artist_business_id,client_id').eq('artist_business_id',link.artist_business_id).eq('client_id',link.client_id).order('starts_at',{ascending:false}).range(from,to)),
          allExportPages((from,to)=>db.from('mova_client_consents').select('purpose,channel,granted,locale,changed_at').eq('artist_business_id',link.artist_business_id).eq('client_id',link.client_id).order('changed_at',{ascending:false}).range(from,to)),
        ]);
        appointments.push(...appointmentRows);consents.push(...consentRows);
        const ids=appointmentRows.map((row)=>String(row.id));
        for(let index=0;index<ids.length;index+=100){const chunk=ids.slice(index,index+100);const reviewRows=await allExportPages((from,to)=>db.from('mova_reviews').select('rating,tags,body,locale,moderation_status,artist_reply,created_at,appointment_id').eq('artist_business_id',link.artist_business_id).in('appointment_id',chunk).range(from,to));reviews.push(...reviewRows);}
      }
      const {error:auditError}=await db.from('mova_security_audit_events').insert({actor_user_id:user.id,event_type:'privacy.client_profile_exported',object_type:'customer_account',object_id:account.id});
      if(auditError)return respond({code:'CLIENT_EXPORT_AUDIT_FAILED'},500);
      return respond({exported_at:new Date().toISOString(),profile:{id:account.id,display_name:account.display_name,preferred_locale:account.preferred_locale,status:account.status},contacts:contacts??[],bookings:appointments,consents,reviews});
    }
    if(body.action==='update-profile'){
      const name=typeof body.display_name==='string'?body.display_name.trim():'';const locale=body.preferred_locale;
      if(name.length<1||name.length>160||!['en-US','es-US'].includes(locale))return respond({code:'INVALID_PROFILE'},422);
      const {error}=await db.from('mova_customer_accounts').update({display_name:name,preferred_locale:locale}).eq('id',account.id);
      if(!error){const {error:auditError}=await db.from('mova_security_audit_events').insert({actor_user_id:user.id,event_type:'privacy.client_profile_updated',object_type:'customer_account',object_id:account.id,metadata:{fields:['display_name','preferred_locale']}});if(auditError)return respond({code:'CLIENT_PROFILE_AUDIT_FAILED'},500);}
      return error?respond({code:'CUSTOMER_PROFILE_SAVE_FAILED'},500):respond({profile:{display_name:name,preferred_locale:locale}});
    }
    if(body.action==='consent'||body.action==='consent-by-handle'){
      let {business_id:businessId,purpose,channel,granted}=body;
      if(body.action==='consent-by-handle'){
        if(typeof body.artist_handle!=='string'||!['sms','email'].includes(channel)||granted!==true)return respond({code:'INVALID_CONSENT'},422);
        const {data:artist}=await db.from('mova_artist_profiles').select('artist_business_id').eq('handle',body.artist_handle.toLowerCase()).eq('is_published',true).maybeSingle();if(!artist)return respond({code:'ARTIST_NOT_AVAILABLE'},404);
        businessId=artist.artist_business_id;purpose='rebooking_reminders';
      }
      if(typeof businessId!=='string'||!['appointment_updates','rebooking_reminders','offers'].includes(purpose)||!['sms','email','push'].includes(channel)||typeof granted!=='boolean')return respond({code:'INVALID_CONSENT'},422);
      const {data:link}=await db.from('mova_client_customer_links').select('client_id').eq('customer_account_id',account.id).eq('artist_business_id',businessId).is('unlinked_at',null).maybeSingle();if(!link)return respond({code:'CLIENT_LINK_NOT_FOUND'},404);
      const purposes=body.action==='consent-by-handle'?['rebooking_reminders','offers']:[purpose];const rows=purposes.map((consentPurpose:string)=>({artist_business_id:businessId,client_id:link.client_id,purpose:consentPurpose,channel,granted,locale:account.preferred_locale,changed_by:user.id,evidence:{source:'client_profile',verified_contact:true}}));
      const {error}=await db.from('mova_client_consents').insert(rows);
      if(!error){const {error:auditError}=await db.from('mova_security_audit_events').insert({artist_business_id:businessId,actor_user_id:user.id,event_type:'privacy.client_consent_changed',object_type:'client',object_id:link.client_id,metadata:{purposes,channel,granted}});if(auditError)return respond({code:'CONSENT_AUDIT_FAILED'},500);}
      return error?respond({code:'CONSENT_SAVE_FAILED'},500):respond({saved:true});
    }
    return respond({code:'INVALID_ACTION'},422);
  }catch(error){const code=error instanceof Error?error.message:'CUSTOMER_PROFILE_FAILED';return respond({code},code==='VERIFIED_CONTACT_REQUIRED'?403:code==='CUSTOMER_ACCOUNT_DELETED'?410:500);}
}));
