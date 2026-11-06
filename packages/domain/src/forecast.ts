export type ForecastInputs={bookedMinor:number;remainingHours:number[];fillRates:number[];avgTicketPerHourMinor:number[];openLowMinor:number;openHighMinor:number;dueClients:number;rebookConversion:number;averageTicketMinor:number;rebookLowMinor:number;rebookHighMinor:number;usualMonthsMinor:number[]};
export type Forecast={bookedMinor:number;likelyMinor:number;likelyLowMinor:number;likelyHighMinor:number;usualMinor:number|null;historySufficient:boolean;methodVersion:'forecast-v1'};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function calculateForecast(input:ForecastInputs):Forecast{
 const n=Math.min(input.remainingHours.length,input.fillRates.length,input.avgTicketPerHourMinor.length);
 const openCapacity=Array.from({length:n},(_,i)=>Math.max(0,input.remainingHours[i])*clamp(input.fillRates[i],0,1)*Math.max(0,input.avgTicketPerHourMinor[i])).reduce((a,b)=>a+b,0);
 const rebooks=Math.max(0,input.dueClients)*clamp(input.rebookConversion,0,1)*Math.max(0,input.averageTicketMinor);
 const booked=Math.max(0,input.bookedMinor);const likely=booked+openCapacity+rebooks;
 const usual=input.usualMonthsMinor.length>=3?Math.round(input.usualMonthsMinor.slice(-3).reduce((a,b)=>a+b,0)/3):null;
 return{bookedMinor:Math.round(booked),likelyMinor:Math.round(likely),likelyLowMinor:Math.round(booked+Math.max(0,input.openLowMinor)+Math.max(0,input.rebookLowMinor)),likelyHighMinor:Math.round(booked+Math.max(0,input.openHighMinor)+Math.max(0,input.rebookHighMinor)),usualMinor:usual,historySufficient:input.usualMonthsMinor.length>=3,methodVersion:'forecast-v1'};
}
