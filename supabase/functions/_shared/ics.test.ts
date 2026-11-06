import { describe, expect, it } from 'vitest';
import { buildIcsFeed, escapeIcsText, foldIcsLine, toIcsUtc } from './ics.ts';

describe('ICS feed formatting',()=>{
  it('escapes RFC 5545 text values',()=>expect(escapeIcsText('Cut, color; care\\line\nnext')).toBe('Cut\\, color\\; care\\\\line\\nnext'));
  it('writes stable UTC timestamps and cancelled event status',()=>{
    const feed=buildIcsFeed([{id:'appointment-1',summary:'Color service',startsAt:'2026-11-06T15:00:00.000Z',endsAt:'2026-11-06T16:00:00.000Z',updatedAt:'2026-11-05T10:00:00.000Z',status:'cancelled',sequence:123}], '2026-11-05T10:00:00.000Z');
    expect(feed).toContain('UID:appointment-1@mova-beauty.co');expect(feed).toContain('DTSTART:20261106T150000Z');expect(feed).toContain('STATUS:CANCELLED');expect(feed.endsWith('\r\n')).toBe(true);
    expect(toIcsUtc('2026-11-06T15:00:00.000Z')).toBe('20261106T150000Z');
  });
  it('folds long UTF-8 content lines at no more than 75 octets',()=>{
    const folded=foldIcsLine(`SUMMARY:${'É'.repeat(50)}`);
    expect(folded.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75)).toBe(true);
    expect(folded.split('\r\n').slice(1).every(line=>line.startsWith(' '))).toBe(true);
  });
});
