import {describe,it,expect} from 'vitest';
import {estimateCadence,rebookingWindow} from './rebooking';
const visits=(gaps:number[])=>{let day=Date.UTC(2025,0,1);const rows=[new Date(day).toISOString()];for(const gap of gaps){day+=gap*86400000;rows.push(new Date(day).toISOString());}return rows;};
describe('rebooking cadence',()=>{
 it('uses the new client default when there are no intervals',()=>expect(estimateCadence([]).typicalDays).toBe(42));
 it('uses interval ± seven days at low confidence for one interval',()=>expect(estimateCadence(visits([35]))).toMatchObject({lowerDays:28,typicalDays:35,upperDays:42,confidence:'low'}));
 it('calculates quartile window and high confidence for stable history',()=>expect(estimateCadence(visits([28,30,29,31])).confidence).toBe('high'));
 it('keeps a wide IQR at medium confidence',()=>expect(estimateCadence(visits([7,28,70,120])).confidence).toBe('medium'));
 it('returns the lower/upper due timestamps from the cadence window',()=>{const cadence=estimateCadence(visits([35]));expect(rebookingWindow('2025-01-01T00:00:00.000Z',cadence).dueAt).toBe('2025-01-29T00:00:00.000Z');});
});
