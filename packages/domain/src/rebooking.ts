export type Cadence = { lowerDays:number; typicalDays:number; upperDays:number; confidence:'low'|'medium'|'high'; modelVersion:'cadence-v1'; intervals:number[] };
const percentile=(values:number[],p:number)=>{
  if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const at=(sorted.length-1)*p;const lo=Math.floor(at),hi=Math.ceil(at);return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo);
};
export function estimateCadence(visitTimestamps:string[],newClientWeeks=6):Cadence {
  const dates=[...new Set(visitTimestamps.map(v=>Date.parse(v)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const intervals=dates.slice(1).map((date,i)=>Math.round((date-dates[i])/(24*60*60*1000)));
  if(!intervals.length){const days=Math.max(1,Math.round(newClientWeeks*7));return{lowerDays:days,typicalDays:days,upperDays:days,confidence:'low',modelVersion:'cadence-v1',intervals};}
  if(intervals.length===1){const typical=intervals[0];return{lowerDays:Math.max(1,typical-7),typicalDays:typical,upperDays:typical+7,confidence:'low',modelVersion:'cadence-v1',intervals};}
  const lowerDays=Math.round(percentile(intervals,.25));const typicalDays=Math.round(percentile(intervals,.5));const upperDays=Math.round(percentile(intervals,.75));
  return{lowerDays,typicalDays,upperDays,confidence:intervals.length>=4&&upperDays-lowerDays<=14?'high':'medium',modelVersion:'cadence-v1',intervals};
}
export function rebookingWindow(lastVisit:string,cadence:Cadence){const at=Date.parse(lastVisit);return{dueAt:new Date(at+cadence.lowerDays*86400000).toISOString(),lateAt:new Date(at+cadence.upperDays*86400000).toISOString()};}
