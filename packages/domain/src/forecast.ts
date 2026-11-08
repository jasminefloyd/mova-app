export type ForecastInputs={bookedMinor:number;remainingHours:number[];fillRates:number[];avgTicketPerHourMinor:number[];openLowMinor:number;openHighMinor:number;dueClients:number;rebookConversion:number;averageTicketMinor:number;rebookLowMinor:number;rebookHighMinor:number;usualMonthsMinor:number[]};
export type Forecast={bookedMinor:number;likelyMinor:number;likelyLowMinor:number;likelyHighMinor:number;usualMinor:number|null;historySufficient:boolean;methodVersion:'forecast-v1'};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function calculateForecast(input:ForecastInputs):Forecast{
 const n=Math.min(input.remainingHours.length,input.fillRates.length,input.avgTicketPerHourMinor.length);
 const openCapacity=Array.from({length:n},(_,i)=>Math.max(0,input.remainingHours[i]??0)*clamp(input.fillRates[i]??0,0,1)*Math.max(0,input.avgTicketPerHourMinor[i]??0)).reduce((a,b)=>a+b,0);
 const rebooks=Math.max(0,input.dueClients)*clamp(input.rebookConversion,0,1)*Math.max(0,input.averageTicketMinor);
 const booked=Math.max(0,input.bookedMinor);const likely=booked+openCapacity+rebooks;
 const usual=input.usualMonthsMinor.length>=3?Math.round(input.usualMonthsMinor.slice(-3).reduce((a,b)=>a+b,0)/3):null;
 return{bookedMinor:Math.round(booked),likelyMinor:Math.round(likely),likelyLowMinor:Math.round(booked+Math.max(0,input.openLowMinor)+Math.max(0,input.rebookLowMinor)),likelyHighMinor:Math.round(booked+Math.max(0,input.openHighMinor)+Math.max(0,input.rebookHighMinor)),usualMinor:usual,historySufficient:input.usualMonthsMinor.length>=3,methodVersion:'forecast-v1'};
}

/** Task 5.6: every forecast figure broken into the inputs and arithmetic that produced it. */
export type ForecastExplanation={
 bookedMinor:number;
 openTime:{buckets:Array<{hours:number;fillRate:number;ticketPerHourMinor:number;minor:number}>;minor:number};
 rebooks:{dueClients:number;conversion:number;averageTicketMinor:number;minor:number};
 likelyMinor:number;
 range:{lowMinor:number;highMinor:number;openLowMinor:number;openHighMinor:number;rebookLowMinor:number;rebookHighMinor:number};
 usual:{monthsMinor:number[];minor:number|null};
};
export function explainForecast(input:ForecastInputs):ForecastExplanation{
 const n=Math.min(input.remainingHours.length,input.fillRates.length,input.avgTicketPerHourMinor.length);
 const buckets=Array.from({length:n},(_,i)=>{const hours=Math.max(0,input.remainingHours[i]??0);const fillRate=clamp(input.fillRates[i]??0,0,1);const ticketPerHourMinor=Math.max(0,input.avgTicketPerHourMinor[i]??0);return{hours,fillRate,ticketPerHourMinor,minor:Math.round(hours*fillRate*ticketPerHourMinor)};});
 const dueClients=Math.max(0,input.dueClients);const conversion=clamp(input.rebookConversion,0,1);const averageTicketMinor=Math.max(0,input.averageTicketMinor);
 const forecast=calculateForecast(input);
 const openMinor=buckets.reduce((sum,bucket)=>sum+bucket.minor,0);
 const rebookMinor=Math.round(dueClients*conversion*averageTicketMinor);
 return{
  bookedMinor:forecast.bookedMinor,
  openTime:{buckets,minor:openMinor},
  rebooks:{dueClients,conversion,averageTicketMinor,minor:rebookMinor},
  likelyMinor:forecast.likelyMinor,
  range:{lowMinor:forecast.likelyLowMinor,highMinor:forecast.likelyHighMinor,openLowMinor:Math.max(0,input.openLowMinor),openHighMinor:Math.max(0,input.openHighMinor),rebookLowMinor:Math.max(0,input.rebookLowMinor),rebookHighMinor:Math.max(0,input.rebookHighMinor)},
  usual:{monthsMinor:input.usualMonthsMinor.slice(-3),minor:forecast.usualMinor},
 };
}
