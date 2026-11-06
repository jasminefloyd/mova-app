import {artistClient,corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
import {calculateForecast} from '../../../packages/domain/src/forecast.ts';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);
 const db=serviceClient();const {data,error}=await db.from('mova_forecasts').select('period_start,period_end,booked_minor,likely_minor,likely_low_minor,likely_high_minor,usual_minor,inputs,method_version,computed_at').eq('artist_business_id',actor.businessId).order('computed_at',{ascending:false}).limit(1).maybeSingle();
 if(error)return respond({code:'FORECAST_READ_FAILED'},500);if(!data)return respond({forecast:null,historySufficient:false,reason:'forecast_not_computed'});
 const recomputed=calculateForecast(data.inputs as Parameters<typeof calculateForecast>[0]);
 return respond({forecast:{...data,calculated:recomputed},historySufficient:Boolean(data.usual_minor),label:'estimate'});
});
