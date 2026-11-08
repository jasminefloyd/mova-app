import {describe,expect,it} from 'vitest';
import {displayId,displayIdLabel,displayIdOrNull,parseDisplayId} from './display-ids';

describe('display IDs',()=>{
 it('formats URL codes and readable labels',()=>{expect(displayId('BID',1)).toBe('BID-1');expect(displayIdLabel('CID',2)).toBe('CID 2');});
 it('parses only positive integer codes of the requested kind',()=>{expect(parseDisplayId('AID','AID-21')).toBe(21);expect(parseDisplayId('AID','CID-21')).toBeNull();expect(parseDisplayId('AID','AID-0')).toBeNull();expect(parseDisplayId('BID','e2500000-0000-4000-8000-000000000001')).toBeNull();});
 it('rejects invalid numbers when formatting',()=>{expect(()=>displayId('BID',0)).toThrow(RangeError);});
});

describe('displayIdOrNull (TC-H04-DISPLAYID-01)', () => {
  it('formats a valid number', () => expect(displayIdOrNull('AID', 16)).toBe('AID-16'));
  it('returns null for missing or invalid numbers instead of throwing', () => {
    expect(displayIdOrNull('AID', undefined)).toBeNull();
    expect(displayIdOrNull('AID', null)).toBeNull();
    expect(displayIdOrNull('AID', 0)).toBeNull();
    expect(displayIdOrNull('AID', 1.5)).toBeNull();
    expect(displayIdOrNull('AID', '16')).toBeNull();
  });
});
