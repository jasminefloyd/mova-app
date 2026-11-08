import {describe,it,expect} from 'vitest';
import {calculateForecast,explainForecast} from './forecast';
const inputs={bookedMinor:10000,remainingHours:[10,5],fillRates:[.5,.4],avgTicketPerHourMinor:[3000,4000],openLowMinor:12000,openHighMinor:24000,dueClients:4,rebookConversion:.25,averageTicketMinor:8000,rebookLowMinor:4000,rebookHighMinor:12000,usualMonthsMinor:[12000,14000,16000]};
describe('forecast',()=>{it('is reproducible from saved deterministic inputs',()=>expect(calculateForecast(inputs)).toEqual(calculateForecast(inputs)));it('uses supplied P10/P90 projections and keeps booked exact',()=>expect(calculateForecast(inputs)).toMatchObject({bookedMinor:10000,likelyMinor:41000,likelyLowMinor:26000,likelyHighMinor:46000}));it('hides usual baseline until three complete months exist',()=>expect(calculateForecast({...inputs,usualMonthsMinor:[12000,14000]})).toMatchObject({usualMinor:null,historySufficient:false}));});

describe('explainForecast (task 5.6)',()=>{
 const fixture={bookedMinor:486000,remainingHours:[12,6],fillRates:[.5,.25],avgTicketPerHourMinor:[9000,8000],openLowMinor:30000,openHighMinor:90000,dueClients:6,rebookConversion:.33,averageTicketMinor:15000,rebookLowMinor:15000,rebookHighMinor:45000,usualMonthsMinor:[650000,700000,720000,670000]};
 it('breaks open time into hours × fill rate × ticket per hour',()=>expect(explainForecast(fixture).openTime).toEqual({buckets:[{hours:12,fillRate:.5,ticketPerHourMinor:9000,minor:54000},{hours:6,fillRate:.25,ticketPerHourMinor:8000,minor:12000}],minor:66000}));
 it('shows rebooks as due clients × conversion × average ticket',()=>expect(explainForecast(fixture).rebooks).toEqual({dueClients:6,conversion:.33,averageTicketMinor:15000,minor:29700}));
 it('adds up to the forecast it explains',()=>{const e=explainForecast(fixture);const f=calculateForecast(fixture);expect(e.bookedMinor+e.openTime.minor+e.rebooks.minor).toBe(f.likelyMinor);expect(e.likelyMinor).toBe(f.likelyMinor);expect(e.range.lowMinor).toBe(e.bookedMinor+e.range.openLowMinor+e.range.rebookLowMinor);expect(e.range.highMinor).toBe(f.likelyHighMinor);});
 it('uses the last three complete months for the usual month',()=>expect(explainForecast(fixture).usual).toEqual({monthsMinor:[700000,720000,670000],minor:696667}));
 it('clamps bad inputs instead of inventing revenue',()=>expect(explainForecast({...fixture,remainingHours:[-3],fillRates:[1.4],avgTicketPerHourMinor:[9000],dueClients:-1}).openTime.minor+explainForecast({...fixture,dueClients:-1}).rebooks.minor).toBe(0));
});
