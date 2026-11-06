export type CalendarEvent={id:string;summary:string;startsAt:string;endsAt:string;updatedAt:string;status:string;sequence:number};
export function escapeIcsText(value:string){return value.replaceAll('\\','\\\\').replaceAll(';','\\;').replaceAll(',','\\,').replaceAll('\r\n','\\n').replaceAll('\n','\\n');}
export function toIcsUtc(value:string){return new Date(value).toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');}
export function foldIcsLine(line:string){
  const result:string[]=[];let current='';let bytes=0;
  for(const character of line){const size=new TextEncoder().encode(character).length;if(bytes+size>75){result.push(current);current=' ';bytes=1;}current+=character;bytes+=size;}
  result.push(current);return result.join('\r\n');
}
export function buildIcsFeed(events:CalendarEvent[],now:string){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Mova//Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Mova appointments'];
  for(const event of events){lines.push('BEGIN:VEVENT',`UID:${event.id}@mova-beauty.co`,`DTSTAMP:${toIcsUtc(now)}`,`SEQUENCE:${event.sequence}`,`DTSTART:${toIcsUtc(event.startsAt)}`,`DTEND:${toIcsUtc(event.endsAt)}`,`SUMMARY:${escapeIcsText(event.summary||'Appointment')}`,`STATUS:${event.status==='cancelled'?'CANCELLED':'CONFIRMED'}`,'END:VEVENT');}
  lines.push('END:VCALENDAR');return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
