import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { searchAvailability } from '../../../packages/domain/src/availability.ts';
import { corsHeaders, respond } from '../_shared/booking.ts';
import { combinedDurationMinutes, requiresCardDeposit, type ServiceRule } from './rules.ts';

type Row={id:string;name:string;time_zone:string;booking_mode:'instant'|'request';is_active:boolean;artist_business_id:string;payment_collector:string|null};
const plusDays=(date:string,days:number)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};

Deno.serve(withSystemRequestLogging('availability-search', async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const input=await request.json().catch(()=>null);
  const serviceIds=Array.isArray(input?.service_ids)?input.service_ids:typeof input?.service_id==='string'?[input.service_id]:[];
  if(!input||serviceIds.length<1||serviceIds.length>8||serviceIds.some((id:unknown)=>typeof id!=='string')||new Set(serviceIds).size!==serviceIds.length||!/^\d{4}-\d{2}-\d{2}$/.test(input.from_date??'')||!Number.isInteger(input.days)||input.days<1||input.days>90||(input.location_id!==undefined&&typeof input.location_id!=='string'))return respond({code:'INVALID_REQUEST'},422);
  const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return respond({code:'SERVER_CONFIGURATION_MISSING'},500);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:services,error:serviceError}=await db.from('mova_services').select('id,artist_business_id,duration_minutes,buffer_minutes,status,deposit_type,deposit_value,location_assignment_mode').in('id',serviceIds).eq('status','active');
  if(serviceError||!services||services.length!==serviceIds.length||new Set(services.map((service)=>service.artist_business_id)).size!==1)return respond({code:'SERVICE_NOT_BOOKABLE'},404);
  const artistBusinessId=services[0]!.artist_business_id;
  const {data:business,error:businessError}=await db.from('mova_artist_businesses').select('status').eq('id',artistBusinessId).maybeSingle();
  if(businessError)return respond({code:'AVAILABILITY_UNAVAILABLE'},503);
  if(business?.status!=='active')return respond({code:'SERVICE_NOT_BOOKABLE'},404);
  let locationQuery=db.from('mova_locations').select('id,name,time_zone,booking_mode,is_active,artist_business_id,payment_collector').eq('artist_business_id',artistBusinessId).eq('is_active',true);
  if(input.location_id)locationQuery=locationQuery.eq('id',input.location_id);
  const {data:locations,error:locationError}=await locationQuery.order('name');
  if(locationError)return respond({code:'AVAILABILITY_UNAVAILABLE'},503);
  if(!locations?.length)return respond({code:'LOCATION_NOT_BOOKABLE'},404);
  // Deposit bookings stay closed until card checkout is enabled in the database (same switch mova_booking_create checks).
  const {data:depositsEnabled,error:depositFlagError}=await db.rpc('mova_deposit_bookings_enabled');
  if(depositFlagError)return respond({code:'AVAILABILITY_UNAVAILABLE'},503);
  const endDate=plusDays(input.from_date,input.days-1);
  const groups=await Promise.all((locations as Row[]).map(async(location)=>{
    if(depositsEnabled!==true&&requiresCardDeposit(location.payment_collector,services as ServiceRule[]))return {location_id:location.id,location_name:location.name,booking_mode:location.booking_mode,unavailable_reason:'requires_card_deposit',slots:[] as Array<{local_date:string}>};
    const [hours,policies,exceptions,appointments,holds,blocks,override]=await Promise.all([
      db.from('mova_location_hours').select('weekday,opens_at,closes_at').eq('location_id',location.id),
      db.from('mova_location_policies').select('*').eq('location_id',location.id).maybeSingle(),
      db.from('mova_location_exceptions').select('exception_date,is_closed,hours').eq('location_id',location.id).gte('exception_date',input.from_date).lte('exception_date',endDate),
      db.from('mova_appointments').select('starts_at,ends_at').eq('location_id',location.id).in('status',['pending_payment','pending_artist','confirmed','completed']).lt('starts_at',`${endDate}T23:59:59.999Z`).gt('ends_at',`${input.from_date}T00:00:00.000Z`),
      db.from('mova_booking_holds').select('starts_at,ends_at').eq('location_id',location.id).eq('status','active').gt('expires_at',new Date().toISOString()),
      db.from('mova_availability_blocks').select('starts_at,ends_at').eq('location_id',location.id).lt('starts_at',`${endDate}T23:59:59.999Z`).gt('ends_at',`${input.from_date}T00:00:00.000Z`),
      db.from('mova_service_locations').select('service_id,price_minor_override,duration_minutes_override').in('service_id',serviceIds).eq('location_id',location.id),
    ]);
    if([hours,policies,exceptions,appointments,holds,blocks,override].some((result)=>result.error))throw new Error('AVAILABILITY_QUERY_FAILED');
    const assignedServiceIds=new Set((override.data??[]).map((row)=>row.service_id));
    if((services as Array<{id:string;location_assignment_mode:string}>).some((service)=>service.location_assignment_mode==='selected'&&!assignedServiceIds.has(service.id)))return {location_id:location.id,location_name:location.name,booking_mode:location.booking_mode,unavailable_reason:'service_not_offered',slots:[] as Array<{local_date:string}>};
    const exceptionHours=Object.fromEntries((exceptions.data??[]).map((row)=>[row.exception_date,row.is_closed?null:(row.hours as Array<{opens_at:string;closes_at:string}>).map((item)=>({opensAt:item.opens_at,closesAt:item.closes_at}))]));
    const totalDuration=combinedDurationMinutes(serviceIds as string[],services as ServiceRule[],(override.data??[]) as Array<{service_id:string;duration_minutes_override:number|null}>);
    const slots=searchAvailability({location:{id:location.id,timeZone:location.time_zone,bookingMode:location.booking_mode,active:location.is_active,leadMinutes:policies.data?.lead_time_minutes??60,horizonDays:policies.data?.booking_horizon_days??60,bufferBeforeMinutes:policies.data?.buffer_before_minutes??0,bufferAfterMinutes:policies.data?.buffer_after_minutes??0},service:{active:true,durationMinutes:totalDuration,bufferMinutes:0},hours:(hours.data??[]).map((row)=>({weekday:row.weekday,opensAt:row.opens_at,closesAt:row.closes_at})),exceptions:exceptionHours,busy:(appointments.data??[]).map((row)=>({startsAt:row.starts_at,endsAt:row.ends_at})),holds:(holds.data??[]).map((row)=>({startsAt:row.starts_at,endsAt:row.ends_at})),blocked:(blocks.data??[]).map((row)=>({startsAt:row.starts_at,endsAt:row.ends_at})),now:new Date().toISOString(),fromDate:input.from_date,days:input.days});
    return {location_id:location.id,location_name:location.name,booking_mode:location.booking_mode,slots:slots.map((slot)=>({starts_at:slot.startsAt,ends_at:slot.endsAt,local_date:slot.localDate,local_time:slot.localTime,time_zone:slot.timeZone,utc_offset:slot.utcOffset,booking_mode:slot.bookingMode}))};
  })).catch(()=>null);
  if(!groups)return respond({code:'AVAILABILITY_UNAVAILABLE'},503);
  const days=Array.from({length:input.days},(_,index)=>{const date=plusDays(input.from_date,index);return {date,open_count:groups.reduce((sum,group)=>sum+group.slots.filter((slot)=>slot.local_date===date).length,0)};});
  return respond({days,groups});
}));
