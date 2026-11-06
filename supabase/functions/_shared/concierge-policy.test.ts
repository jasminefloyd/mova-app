import {describe,expect,it} from 'vitest';
import {authorizeConciergeTool,validateConciergeOutput} from './concierge-policy.ts';
describe('concierge policy',()=>{
 it('never creates a confirmed booking at a request location',()=>expect(authorizeConciergeTool('create_booking',{bookingMode:'request',paymentCollector:'artist',allowedCatalogPricesMinor:[],permissions:{book_instant:true}})).toEqual({allowed:false,reason:'instant_booking_not_permitted'}));
 it('never initiates salon-collected checkout',()=>expect(authorizeConciergeTool('create_request',{bookingMode:'request',paymentCollector:'salon',allowedCatalogPricesMinor:[],permissions:{request_salon:true}})).toEqual({allowed:false,reason:'salon_collects_payment'}));
 it('does not invent an amount',()=>expect(validateConciergeOutput('It costs $150.',{allowedCatalogPricesMinor:[12000]})).toEqual({allowed:false,reason:'price_not_in_catalog'}));
 it('does not claim confirmation for request-mode copy',()=>expect(validateConciergeOutput('Your request is confirmed.',{bookingMode:'request',allowedCatalogPricesMinor:[]})).toEqual({allowed:false,reason:'request_must_not_be_confirmed'}));
});
