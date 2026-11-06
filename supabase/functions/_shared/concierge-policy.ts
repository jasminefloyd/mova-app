export type ToolName='get_services'|'get_location_info'|'search_availability'|'create_booking'|'create_request'|'reschedule'|'create_handoff'|'create_quote_request';
export type ConciergePolicyContext={bookingMode?:'instant'|'request';paymentCollector?:'artist'|'salon';allowedCatalogPricesMinor:number[];permissions:Record<string,boolean>};
export function authorizeConciergeTool(tool:ToolName,context:ConciergePolicyContext){
 if(tool==='create_booking'&&(context.bookingMode!=='instant'||context.permissions.book_instant!==true))return{allowed:false,reason:'instant_booking_not_permitted'};
 if(tool==='create_request'&&(context.bookingMode!=='request'||context.permissions.request_salon!==true))return{allowed:false,reason:'salon_request_not_permitted'};
 if(tool==='reschedule'&&context.permissions.reschedule!==true)return{allowed:false,reason:'reschedule_not_permitted'};
 if(context.paymentCollector==='salon'&&['create_booking','create_request'].includes(tool))return{allowed:false,reason:'salon_collects_payment'};
 return{allowed:true,reason:'permitted'};
}
export function validateConciergeOutput(reply:string,context:{bookingMode?:'instant'|'request';allowedCatalogPricesMinor:number[]}){
 if(context.bookingMode==='request'&&/\bconfirm(?:ed|ation)?\b/i.test(reply))return{allowed:false,reason:'request_must_not_be_confirmed'};
 const matches=[...reply.matchAll(/\$\s?(\d{1,5}(?:\.\d{1,2})?)/g)].map(match=>Math.round(Number(match[1])*100));
 if(matches.some(value=>!context.allowedCatalogPricesMinor.includes(value)))return{allowed:false,reason:'price_not_in_catalog'};
 return{allowed:true,reason:'policy_pass'};
}
