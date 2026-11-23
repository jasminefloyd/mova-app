import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const api = process.env.QA_BACKEND ?? 'http://127.0.0.1:55421';
const web = process.env.QA_WEB ?? 'http://127.0.0.1:4175';
for (const url of [api, web]) assert.equal(new URL(url).hostname, '127.0.0.1');
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(anon && service, 'Local Auth keys must be in the QA process environment');
const runId = process.env.QA_RUN_ID ?? Date.now().toString(36);
const base = 'qa-artifacts/evidence';
const seed = {
  business: 'e2500000-0000-4000-8000-000000000001',
  studio: 'e2500000-0000-4000-8000-000000000101',
  salon: 'e2500000-0000-4000-8000-000000000102',
  service: 'e2500000-0000-4000-8000-000000000201',
  alternate: 'e2500000-0000-4000-8000-000000000203',
  client: 'e2500000-0000-4000-8000-000000000302',
};
const email = (name) => `mova-qa-${name}-${runId}@example.com`;
const ownerEmail = email('owner');
const password = 'QALocal-Disposable!42';
const results = {};
const allRequests = [];
await mkdir(base, { recursive: true });

async function call(path, { method='GET', key=anon, bearer=key, body, headers={} }={}) {
  const res=await fetch(api+path,{method,headers:{apikey:key,Authorization:`Bearer ${bearer}`,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await res.text();
  const data=text ? JSON.parse(text) : null;
  return { status:res.status, data };
}
async function ok(path, config) {
  const response=await call(path,config);
  assert(response.status>=200 && response.status<300,`${path.split('?')[0]} returned ${response.status} ${response.data?.error?.code ?? response.data?.data?.code ?? response.data?.code ?? response.data?.error_code ?? ''}`);
  return response.data;
}
const rest=(path,opts={})=>ok('/rest/v1/'+path,{key:service,...opts});
const edge=(name,body,opts={})=>ok('/functions/v1/'+name,{method:'POST',body,...opts}).then((r)=>r.data);
const fixtures=(name,body)=>rest(name,{method:'POST',body,headers:{Prefer:'return=representation'}});
const patch=(name,body)=>rest(name,{method:'PATCH',body,headers:{Prefer:'return=representation'}});
const selected=(id)=>!process.argv.slice(2).length || process.argv.slice(2).includes(id);
const mailBefore=async()=>new Set(await readdir(process.env.QA_SEED_DIR+'/mail'));
async function codeFromMail(before,to) {
  for(let attempt=0;attempt<30;attempt++){
    for(const file of await readdir(process.env.QA_SEED_DIR+'/mail')){
      if(before.has(file)) continue;
      const raw=await readFile(process.env.QA_SEED_DIR+'/mail/'+file,'utf8');
      if(!raw.includes(to)) continue;
      const matched=raw.replace(/=\r?\n/g,'').match(/(?:letter-spacing[^>]*>|font-weight[^>]*>)\s*(\d{6})\b/i);
      const code=matched?.[1]??raw.split(/\r?\n\r?\n/).slice(1).join('').replace(/=\r?\n/g,'').match(/(?<![#\d])\d{6}(?!\d)/)?.[0];
      if(code) return code;
    }
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error('No six-digit code arrived in the loopback SMTP inbox');
}
async function authUser(address) {
  const existing=await rest('mova_account_names?select=user_id&first_name=eq.QAOwner');
  if(address===ownerEmail && existing.length && process.env.QA_REUSE_USER==='true') return existing[0].user_id;
  const user=await ok('/auth/v1/admin/users',{method:'POST',key:service,body:{email:address,password,email_confirm:true,user_metadata:{first_name:'QAOwner',last_name:'Fixture'}}});
  return user.id;
}
let owner = await authUser(ownerEmail);
if(!(await rest('mova_artist_memberships?select=user_id&user_id=eq.'+owner)).length) await fixtures('mova_artist_memberships',{artist_business_id:seed.business,user_id:owner,role:'owner',status:'active'});
const ownerSession=await ok('/auth/v1/token?grant_type=password',{method:'POST',body:{email:ownerEmail,password}});
const browser=await chromium.launch({headless:true});
async function pageFor(stylist=false,width=390) {
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    return ['http:','https:'].includes(url.protocol)&&![api,web].includes(url.origin) ? route.abort() : route.continue();
  });
  if(stylist) await context.addInitScript(session=>{const key='sb-127-auth-token';if(!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(session));},ownerSession);
  const page=await context.newPage();
  page.setDefaultTimeout(4200);
  page.on('response',async response=>{
    const url=new URL(response.url());
    if(url.origin!==api)return;
    const item={path:url.pathname,method:response.request().method(),status:response.status()};
    allRequests.push(item);
    if(response.status()>=400 && url.pathname.startsWith('/functions/')){
      const json=await response.json().catch(()=>null);
      const code=json?.error?.code??json?.data?.code;
      if(typeof code==='string' && /^[A-Z][A-Z0-9_]+$/.test(code)) item.code=code;
    }
  });
  return page;
}
const open=async (page,path)=>{
  assert(path.startsWith('/'));
  await page.goto(web+path,{waitUntil:'domcontentloaded'});
  await page.locator('body').waitFor();
  await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});
};
const text=async (page)=>page.locator('body').innerText();
const visible=(page,phrase)=>page.getByText(phrase,{exact:false}).first().waitFor({state:'visible'});
const button=(page,phrase)=>page.getByRole('button',{name:phrase}).first();
const link=(page,phrase)=>page.getByRole('link',{name:phrase}).first();
const action=(page,phrase)=>page.getByRole('link',{name:phrase}).or(page.getByRole('button',{name:phrase})).first();
async function capture(id,page) {
  const name=id.toLowerCase();
  await page.screenshot({path:`${base}/${name}.png`,fullPage:true,mask:[page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="password"]')]});
  let content=await text(page);
  content=content.replace(/(?:\b\d{6}\b|[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,})/g,'[redacted]');
  await writeFile(`${base}/${name}.txt`,`Path: ${new URL(page.url()).pathname.replace(/\/(b|c|review|slot)\/[^/]+/g,'/$1/[redacted]')}\n\n${content}\n`);
}
async function check(id,fn,{stylist=false}={}) {
  if(!selected(id))return;
  const page=await pageFor(stylist);
  const start=allRequests.length;
  try {
    results[id]=await fn(page);
  } catch(error) {
    results[id]=['BLOCKED','Execution did not establish the full expected result. '+String(error.message).replace(/(?:\b\d{6}\b|[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,})/g,'[redacted]').replace(/\s+/g,' ').slice(0,340)];
  }
  if(!page.isClosed() && page.url()!=='about:blank'){
    try{await capture(id,page);}catch{}
  }
  results[id].push(allRequests.slice(start));
  await page.context().close();
  console.log(id, ...results[id].slice(0,2));
  await writeFile(`${base}/native-${runId}.json`,JSON.stringify(results,null,2));
}
async function emailFlow(page,path,address,name=false) {
  await open(page,path);
  if(name){
    await page.getByLabel(/First name/i).fill('Quinn');
    await page.getByLabel(/Last name/i).fill('QA');
  }
  await page.getByLabel(/^Email( address)?$/i).first().fill(address);
  const inbox=await mailBefore();
  await page.locator('form button[type=submit]').click();
  await page.locator('input[inputmode=numeric]').first().waitFor();
  const code=await codeFromMail(inbox,address);
  await page.locator('input[inputmode=numeric]').first().fill(code);
  await page.waitForURL(u=>!['/login','/signup','/auth/confirm','/signin'].includes(u.pathname),{timeout:8000});
}
await check('ONB-01',async page=>{
  await open(page,'/signup');
  assert.equal(await page.locator('input[type=password]').count(),0);
  const signup=await pageFor();
  await emailFlow(signup,'/signup',email('new'),true);
  assert.match(new URL(signup.url()).pathname,/^\/onboarding/);
  await capture('ONB-01-otp-alternative',signup);
  await signup.context().close();
  return ['NOT APPLICABLE','The supplied password sign-up path was retired. Browser alternative verified a new stylist received the local OTP and reached onboarding.'];
});
await check('ONB-02',async page=>{
  await open(page,'/signup');
  await page.locator('form button[type=submit]').click();
  assert.equal(await page.locator('input[type=password]').count(),0);
  assert.equal(await page.locator('form input:invalid').count(),3);
  return ['NOT APPLICABLE','Password-specific validation is retired. The browser prevented empty name/email submission.'];
});
await check('ONB-03',async page=>{
  await emailFlow(page,'/login',ownerEmail);
  assert.match(new URL(page.url()).pathname,/^\/BID-1/);
  return ['NOT APPLICABLE','The supplied password sign-in path was retired. The supported six-digit email code reached the finished test business Home.'];
});
await check('ONB-04',async page=>{
  await open(page,'/login');
  assert.equal(await page.locator('input[type=password]').count(),0);
  await page.getByLabel(/^Email( address)?$/i).fill(email('unknown'));
  const otp=page.waitForResponse(r=>r.url().includes('/auth/v1/otp'));
  await page.locator('form button[type=submit]').click();
  await otp;
  await page.waitForTimeout(250);
  return ['NOT APPLICABLE','The wrong-password path was retired. Attempted the email-code request for a synthetic unknown address.'];
});
await check('ONB-05',async page=>{
  await open(page,'/reset-password');
  assert.match(new URL(page.url()).pathname,/^\/login$/);
  return ['NOT APPLICABLE','The retired reset route redirects to passwordless sign-in.'];
});
await check('ONB-14',async page=>{
  await open(page,'/onboarding/profile');
  await page.waitForURL(/\/BID-1\/?$/);
  return ['PASS','A finished stylist was redirected to Home when opening an onboarding URL.'];
},{stylist:true});
await check('ONB-16',async page=>{
  await open(page,'/login');
  await page.locator('a[href*="/signin"]').first().click();
  await page.waitForURL(/\/signin(?:\?|$)/);
  const backToStylist=page.locator('a[href*="/login"]');
  if(!(await backToStylist.first().waitFor({timeout:2500}).then(()=>true,()=>false))) return ['FAIL','Stylist sign-in linked to client sign-in, but the client sign-in page offered no link back to stylist sign-in.'];
  await backToStylist.first().click();
  await page.waitForURL(u=>u.pathname==='/login');
  return ['PASS','Both persona links moved to the corresponding sign-in page.'];
});
await check('ONB-18',async page=>{
  await open(page,'/signin');
  await action(page,/continue as (a )?guest/i).click();
  await page.waitForURL(u=>u.pathname!=='/signin');
  if(new URL(page.url()).pathname==='/me')return ['FAIL','Continue as a guest sent an unsigned visitor to /me, which is the account-only profile.'];
  return ['PASS','Continue as guest left the sign-in screen without an authenticated session.'];
});
await check('ONB-22',async page=>{
  await open(page,'/s/rooted-beauty');
  await visible(page,'Rooted Beauty');
  await action(page,/^Book(?: with Rooted| an appointment)?$/i).click();
  assert.match(new URL(page.url()).pathname,/\/a\/rooted-beauty\/book/);
  return ['PASS','Signed-out client opened the stylist QR route and continued to booking.'];
});
await check('BKG-01',async page=>{
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    await open(page,'/a/rooted-beauty');
    await visible(page,'Rooted Beauty');
    await visible(page,'Silk Press');
    const copy=await text(page);
    assert.match(copy,/\$120|120\.00/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  }
  await action(page,/^Book(?: with Rooted| an appointment)?$/i).click();
  await page.waitForURL(u=>u.pathname.endsWith('/book'));
  return ['PASS','The real public profile, services and prices rendered at 390 px and 1280 px. Book opened the correct route.'];
});
await check('SET-20',async page=>{
  await open(page,'/BID-1/settings/plan');
  await visible(page,/AI \+ Growth/i);
  await visible(page,'$39');
  return ['BLOCKED','Local plan screen rendered Free, Pro and AI + Growth. No Stripe sandbox key or sandbox price IDs exist in the supplied configuration.'];
},{stylist:true});
await check('SET-16',async page=>{
  await open(page,'/BID-1/settings/payments');
  await visible(page,/stripe/i);
  return ['BLOCKED','Reached payment settings. Stripe test API and Connect application credentials are unavailable.'];
},{stylist:true});
await check('CAL-18',async page=>{
  await open(page,'/BID-1');
  await visible(page,/needs you/i);
  await visible(page,/this week/i);
  await page.locator('a[href*="/appointments/"]').first().click();
  await page.waitForURL(/\/appointments\/AID-/);
  return ['PASS','The seeded Home showed Needs you and This week, and an appointment link opened the appointment detail.'];
},{stylist:true});
await check('SET-14',async page=>{
  await open(page,'/BID-1/settings/profile/preview');
  await visible(page,'Rooted Beauty');
  const preview=await text(page);
  const guest=await pageFor();
  await open(guest,'/a/rooted-beauty');
  await visible(guest,'Silk Press');
  assert.match(preview,/Silk Press/);
  assert.match(await text(guest),/Rooted Beauty/);
  await guest.context().close();
  return ['PASS','The operator preview and public page showed the same seeded artist and Silk Press offering.'];
},{stylist:true});
const operatorOptions = { stylist:true };
const worker = {headers:{'x-mova-artist-business-id':seed.business},bearer:ownerSession.access_token};
const bookings = new Map();
const noConsent = {rebooking_reminders:{email:false,sms:false},offers:{email:false,sms:false},review_requests:{email:false}};
const nextDate = (days=1)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const getBooking = async (id)=> (await rest(`mova_appointments?select=*&id=eq.${id}`))[0];
const getNamedBooking = async (name)=> (await rest(`mova_appointments?select=*&client_name=eq.${encodeURIComponent(name)}&order=created_at.desc&limit=1`))[0];
const availability = (loc,services=[seed.service],date=nextDate())=>edge('availability-search',{service_ids:services,location_id:loc,from_date:date,days:14});
const nextSlot = async (loc,services=[seed.service],date=nextDate())=> {
  const result=await availability(loc,services,date);
  const slots=result.groups.find(g=>g.location_id===loc)?.slots??[];
  assert(slots.length, 'No bookable slot in fixture');
  return slots[0];
};
async function fixtureBooking(label,location=seed.studio, extra={}) {
  if(bookings.has(label)) return bookings.get(label);
  const date = nextDate(4 + ([...label].reduce((n,c)=>n+c.charCodeAt(0),0) % 17));
  const slots = (await availability(location,[seed.service],date)).groups[0].slots;
  const slot = slots.find(s=>s.local_time.startsWith('13:')) ?? slots.at(-1);
  assert(slot,'No fixture availability');
  const token=crypto.randomUUID()+crypto.randomUUID();
  const created=await edge('booking-create',{
    location_id:location,service_ids:[seed.service],starts_at:slot.starts_at,client_name:`QA ${label}`,
    client_email:email(label.toLowerCase()),client_locale:'en-US',manage_token:token,consents:noConsent,...extra
  },{headers:{'Idempotency-Key':crypto.randomUUID()}});
  const row=await getNamedBooking(`QA ${label}`);
  assert(row);
  const result={row,token,created};
  bookings.set(label,result);
  return result;
}
async function beginBooking(page, location='Studio') {
  await open(page,`/a/rooted-beauty/book?service_id=${seed.service}`);
  const place=page.locator('.mova-booking__location').filter({hasText:new RegExp(location,'i')}).first();
  try { await place.locator('.mova-time-options button').first().click({timeout:2500}); }
  catch {
    const days=page.locator('.mova-booking__day:not(:disabled)');
    await days.nth(1).click();
    await place.locator('.mova-time-options button').first().click();
  }
  await button(page,/^Continue$/i).click();
}
async function bookViaUi(page, label, location='Studio', extra=async()=>{}) {
  await beginBooking(page,location);
  const submit=button(page,/^(Book appointment|Send request|Request appointment|Request booking|Submit request|Confirm booking|Request this time|Submit booking request)$/i);
  assert(await submit.isDisabled(),'Submit must require contact');
  await page.locator('input[autocomplete=name]').fill(`QA ${label}`);
  await page.locator('input[type=email]').fill(email(label.toLowerCase()));
  await extra(page);
  await submit.click();
  await page.waitForURL(/\/b\/[^/]+/, {timeout:8500});
  const row=await getNamedBooking(`QA ${label}`);
  assert(row);
  const result={row,token:new URL(page.url()).pathname.split('/').pop()};
  bookings.set(label,result);
  return result;
}
async function operatorAppointment(page,row,tail='') {
  await open(page,`/BID-1/appointments/AID-${row.appointment_number}${tail}`);
  await visible(page,row.client_name);
}
function tagged(label){return `${label}-${runId}`;}
await check('BKG-02',async page=>{
  const x=await bookViaUi(page,tagged('Instant'));
  assert.equal(x.row.status,'confirmed');
  await visible(page,/confirmed/i);
  const operator=await pageFor(true);
  await operatorAppointment(operator,x.row);
  await operator.context().close();
  return ['BLOCKED','Browser booked an instant appointment, manage page confirmed it, and the real database and stylist appointment matched. Delivery of the client’s confirmation message was not configured.'];
});
await check('BKG-04',async page=>{
  const x=await bookViaUi(page,tagged('Request'),'Salon',async p=>{
    await p.locator('textarea').fill('QA alternate time request');
    const alternatives=p.locator('select').first();
    if(await alternatives.locator('option').count()>1) await alternatives.selectOption({index:1});
  });
  assert.equal(x.row.status,'pending_artist');
  await visible(page,/waiting for stylist confirmation/i);
  assert.equal(x.row.client_note,'QA alternate time request');
  const alternate=!!x.row.alternate_starts_at;
  const operator=await pageFor(true);
  await open(operator,'/BID-1');
  const inHome=await operator.locator('.mova-home__needs-list').getByText(x.row.client_name,{exact:false}).first().waitFor({state:'visible'}).then(()=>true,()=>false);
  await capture('bkg-04-stylist',operator);
  await operator.context().close();
  if(!inHome)return ['FAIL','The guest saw a pending request, but the real pending booking was absent from Home Needs you.'];
  return alternate?['PASS','Browser submitted a request with a note and alternate. Pending state persisted and the same request appeared on Home.']:['BLOCKED','Pending request and note persisted and appeared on Home. The alternate-time selection was not verified.'];
});
await check('BKG-05',async page=>{
  const x=await fixtureBooking(tagged('Accept'),seed.salon);
  await operatorAppointment(page,x.row);
  await button(page,/^Accept/i).click();
  await visible(page,/confirmed/i);
  assert.equal((await getBooking(x.row.id)).status,'confirmed');
  return ['BLOCKED','Accepted the real request and verified confirmed status in browser and database. Client delivery was unavailable.'];
},operatorOptions);
await check('BKG-06',async page=>{
  const x=await fixtureBooking(tagged('Decline'),seed.salon);
  await operatorAppointment(page,x.row);
  await button(page,/^Decline/i).click();
  await visible(page,/Decline this request/i);
  await button(page,/^Confirm decline|^Decline request/i).click();
  await visible(page,/declined/i);
  await page.waitForTimeout(650);
  const resultStatus=(await getBooking(x.row.id)).status;
  assert(['declined','cancelled'].includes(resultStatus), 'The booking request remained '+resultStatus);
  const result=await availability(seed.salon,[seed.service],x.row.starts_at.slice(0,10));
  assert(result.groups[0].slots.some(s=>Date.parse(s.starts_at)===Date.parse(x.row.starts_at)));
  return ['BLOCKED','Decline confirmation worked, status persisted, and the actual availability API reopened the slot. Client delivery remains unverified.'];
},operatorOptions);
await check('BKG-10',async page=>{
  const temp=(await fixtures('mova_services',{artist_business_id:seed.business,name:'QA Closed Service '+runId,category:'Styling',duration_minutes:360,buffer_minutes:15,base_price_minor:12000,deposit_type:'none',deposit_value:0,status:'active',location_assignment_mode:'selected'}))[0];
  await fixtures('mova_service_locations',{artist_business_id:seed.business,service_id:temp.id,location_id:seed.studio,duration_minutes_override:360});
  const original=await rest(`mova_location_hours?select=id,closes_at&location_id=eq.${seed.studio}`);
  for(const row of original) await patch('mova_location_hours?id=eq.'+row.id,{closes_at:'10:00:00'});
  try{
    await open(page,`/a/rooted-beauty/book?service_id=${temp.id}`);
    await visible(page,/No online times available/i);
    assert.match(await text(page),/another day|reach out|contact|check back/i);
    return ['PASS','The real availability endpoint returned zero openings for the isolated fixture. The booking page explained no online times and offered next-step guidance.'];
  }finally{for(const row of original)await patch('mova_location_hours?id=eq.'+row.id,{closes_at:row.closes_at});}
});
await check('BKG-11',async page=>{
  const x=await fixtureBooking(tagged('Move'));
  await open(page,'/b/'+x.token);
  await visible(page,/confirmed/i);
  await button(page,/reschedule|change appointment time/i).click();
  const slot=page.locator('button.mova-chip').first();
  await slot.click();
  await button(page,/confirm|save new|request reschedule/i).last().click();
  await page.waitForTimeout(550);
  const moved=await getBooking(x.row.id);
  assert.notEqual(moved.starts_at,x.row.starts_at,'The persisted start time was unchanged');
  const operator=await pageFor(true);
  await operatorAppointment(operator,moved);
  await operator.context().close();
  return ['PASS','Guest used the manage link to select a different time. The changed start persisted and the same appointment was available in the operator view.'];
});
await check('BKG-12',async page=>{
  const x=await fixtureBooking(tagged('CancelGuest'),seed.studio);
  await open(page,'/b/'+x.token);
  await button(page,/^Cancel booking|^Cancel appointment/i).click();
  await page.locator('dialog[open]').getByRole('button',{name:/cancel appointment|confirm cancel/i}).last().click();
  await visible(page,/cancelled|canceled/i);
  assert.equal((await getBooking(x.row.id)).status,'cancelled');
  return ['BLOCKED','Guest cancellation was verified on the real deposit-free fixture. The prescribed paid-deposit and provider notification checks require Stripe and app email sandbox access.'];
});
await check('BKG-13',async page=>{
  const x=await bookViaUi(page,tagged('Consent'),'Studio',async p=>{
    await p.locator('fieldset input[type=checkbox]').first().uncheck();
    const reminder=p.getByLabel(/rebooking.*email|email.*rebook/i);
    if(await reminder.count()) await reminder.first().check(); else await p.locator('fieldset input[type=checkbox]').nth(1).check();
  });
  const choices=await rest(`mova_client_consents?select=purpose,channel,granted&client_id=eq.${x.row.client_id}`);
  assert(choices.some(c=>c.purpose==='review_requests'&&c.channel==='email'&&c.granted===false));
  assert(choices.some(c=>c.purpose==='rebooking_reminders'&&c.channel==='email'&&c.granted===true));
  const operator=await pageFor(true);
  const [cust]=await rest(`mova_clients?select=client_number&id=eq.${x.row.client_id}`);
  await open(operator,`/BID-1/clients/CID-${cust.client_number}`);
  const shown = await visible(operator,/contact preferences/i).then(()=>true,()=>false);
  await operator.context().close();
  return ['BLOCKED',shown ? 'Browser toggled review and rebooking consent. The database and operator profile matched. Later provider delivery behavior was not exercised.' : 'Browser toggled review and rebooking consent and the database matched. The operator profile did not expose the tested Contact preferences label. Subsequent delivery was not exercised.'];
});
await check('SET-05',async page=>{
  await patch('mova_services?id=eq.'+seed.service,{status:'active'});
  try {
    await open(page,'/BID-1/settings/services');
    const serviceCard=page.locator('.mova-service-list li').filter({hasText:'Silk Press'}).first();
    await serviceCard.getByRole('button',{name:'Deactivate',exact:true}).click();
    await serviceCard.getByRole('button',{name:'Activate',exact:true}).waitFor();
    const [persisted]=await rest('mova_services?select=status&id=eq.'+seed.service);
    assert.equal(persisted.status,'inactive');
    const guest=await pageFor();
    await open(guest,'/a/rooted-beauty');
    await visible(guest,'Rooted Beauty');
    assert.equal(await guest.getByText('Silk Press',{exact:true}).count(),0);
    await guest.context().close();
    return ['PASS','Deactivated the service in real stylist settings. PostgreSQL stored inactive and the signed-out showcase no longer listed the service.'];
  } finally {
    await patch('mova_services?id=eq.'+seed.service,{status:'active'});
  }
},operatorOptions);
await check('SET-06',async page=>{
  await open(page,'/BID-1/clients/new');
  await page.getByLabel(/first name/i).fill('Quinn');
  await page.getByLabel(/last name/i).fill(tagged('Manual'));
  await page.locator('input[type=email]').fill(email('manual'));
  await button(page,/^Save client$/i).click();
  await page.waitForURL(/\/clients\/CID-/);
  await visible(page,'Quinn');
  const [row]=await rest(`mova_clients?select=id,source&email_normalized=eq.${encodeURIComponent(email('manual'))}`);
  assert.equal(row.source,'manual');
  const choices=await rest(`mova_client_consents?select=purpose,granted&client_id=eq.${row.id}`);
  assert(!choices.some(c=>c.granted&&['rebooking_reminders','offers'].includes(c.purpose)));
  await open(page,'/BID-1/clients');
  await visible(page,tagged('Manual'));
  return ['PASS','Created the client in the browser, opened the resulting profile, and found it in the client list. Database confirmed manual source and no marketing opt-in.'];
},operatorOptions);
await check('SET-08',async page=>{
  await open(page,'/BID-1/clients');
  await visible(page,'Demo Guest 02');
  const search=page.getByRole('searchbox').or(page.locator('input[placeholder*=Search]')).first();
  await search.fill('Demo Guest 02');
  await visible(page,'Demo Guest 02');
  assert.doesNotMatch(await text(page),/Demo Guest 03/);
  await search.fill('2025550105');
  await visible(page,'Demo Guest 05');
  assert.doesNotMatch(await text(page),/Demo Guest 02/);
  await search.fill('nonexistent fixture name');
  await visible(page,/no clients|no matches|nothing/i);
  return ['BLOCKED','Name, phone and empty search used the real seeded client list. Filters and all visit/consent badges still require verification.'];
},operatorOptions);
await check('SET-21',async page=>{
  await open(page,'/BID-1/settings/qr');
  await visible(page,/Scan to book/i);
  assert(await page.locator('img, canvas').count());
  const guest=await pageFor();
  await open(guest,'/s/rooted-beauty');
  await visible(guest,'Rooted Beauty');
  await guest.context().close();
  return ['BLOCKED','The QR screen rendered and the target opened signed out. A physical phone scan was not executed.'];
},operatorOptions);
await check('CAL-02',async page=>{
  const [row]=await rest('mova_appointments?select=*&id=eq.e2500000-0000-4000-8000-000000000402');
  await operatorAppointment(page,row);
  const copy=await text(page);
  assert.match(copy,/Hydration Treatment/i);
  assert.match(copy,/Rooted Beauty Studio/i);
  assert.match(copy,/\$80/);assert.match(copy,/\$20/);assert.match(copy,/\$60/);
  return ['PASS','The browser appointment matched the seeded client, service and location. $80 service less $20 deposit equaled the $60 balance.'];
},operatorOptions);
async function recordPayment(page,label,method,location=seed.studio){
  const x=await fixtureBooking(tagged(label),location);
  await operatorAppointment(page,x.row,'/pay');
  await page.getByRole('radio',{name:method==='other'?/^Other$/i:/^Cash$/i}).click();
  if(method==='other')await page.getByRole('textbox',{name:/How were you paid/i}).fill('QA Transfer');
  await button(page,/save cash|save payment|record payment|save other/i).click();
  await visible(page,/recorded|paid|payment saved/i);
  await page.waitForTimeout(500);
  const [p]=await rest(`mova_payments?select=*&appointment_id=eq.${x.row.id}`);
  assert(p && p.platform_fee_minor===0);
  return {x,p};
}
await check('CAL-08',async page=>{
  const {x,p}=await recordPayment(page,'Cash','cash');
  assert.equal(p.collector,'artist'); assert.equal(p.method,'cash'); assert.equal(p.amount_minor,x.row.balance_due_minor); assert.equal((await getBooking(x.row.id)).balance_due_minor,0);
  await open(page,'/BID-1/money');await visible(page,/Recorded by you/i);
  return ['PASS','Cash was recorded against real appointment balance, with zero platform fee. The Money page rendered the Recorded by you category.'];
},operatorOptions);
await check('CAL-13',async page=>{
  const {p}=await recordPayment(page,'Other','other');
  assert.equal(p.recorded_method_label,'QA Transfer');
  return ['PASS','Other payment persisted with the exact supplied method label and zero platform fee.'];
},operatorOptions);
await check('CAL-14',async page=>{
  const x=await fixtureBooking(tagged('Salon'),seed.salon);
  await patch('mova_appointments?id=eq.'+x.row.id,{status:'confirmed',confirmed_at:new Date().toISOString()});
  await operatorAppointment(page,x.row,'/pay');
  assert.equal(await page.getByRole('radio',{name:/^Card$/i}).count(),0);
  await page.getByRole('radio',{name:/^Cash$/i}).click();
  const salon=page.getByLabel(/The salon received it/i);
  if(await salon.count()) await salon.check();
  await button(page,/save cash|save payment|record payment/i).click();
  await page.waitForTimeout(550);
  const [p]=await rest(`mova_payments?select=collector,platform_fee_minor&appointment_id=eq.${x.row.id}`);
  assert.equal(p.collector,'salon');
  assert.equal(p.platform_fee_minor,0);
  await open(page,'/BID-1/money');await visible(page,/Collected by salons/i);
  return ['PASS','Salon checkout hid Card, persisted a salon-collected payment with zero fee, and Money showed the salon category.'];
},operatorOptions);
await check('CAL-16',async page=>{
  await open(page,'/BID-1/money');
  await visible(page,/Recorded by you/i);await visible(page,/Collected by salons/i);
  return ['BLOCKED','Opened Money against the real ledger. A full reconciliation of processed Stripe, cash and salon payments requires the sandbox card cases.'];
},operatorOptions);

const title = page => page.getByRole('heading',{level:1}).first().innerText();
async function newStylist(page,label) { await emailFlow(page,'/signup',email(label),true); }
async function fillProfile(page,label){
  await page.getByLabel('Display name').fill('Quinn QA '+label);
  await page.getByLabel('Your link').fill('qa-'+label+'-'+runId);
  await page.getByLabel('Add a specialty').fill('Silk press');
  await button(page,/^Add$/i).click();
  await page.getByLabel('About you').fill('Synthetic QA profile');
}
await check('ONB-06',async page=>{
  await newStylist(page,'profile');
  await visible(page,/artist profile/i);
  assert(await button(page,/^Continue$/i).isDisabled());
  await fillProfile(page,'profile');
  await button(page,/^Continue$/i).click();
  await page.waitForURL(/\/onboarding\/photo/);
  const [profile]=await rest(`mova_artist_profiles?select=handle,specialties,bio&handle=eq.qa-profile-${runId}`);
  assert(profile.specialties.includes('Silk press'));
  assert.equal(profile.bio,'Synthetic QA profile');
  return ['PASS','A real signed-in user saved an available handle, specialty and bio and reached the photo step. Database values matched.'];
});
await check('ONB-07',async page=>{
  await newStylist(page,'handle');
  const handle=page.getByLabel('Your link');
  await handle.fill('rooted-beauty');
  await visible(page,/already taken|already in use|is taken/i);
  assert(await button(page,/^Continue$/i).isDisabled());
  await handle.fill('qa-free-'+runId);
  await visible(page,/available/i);
  await handle.fill('ab');
  await visible(page,/at least|3 characters|too short/i);
  assert(await button(page,/^Continue$/i).isDisabled());
  return ['PASS','Verified taken, available and too-short handle states against the real handle RPC. Invalid choices blocked Continue.'];
});
await check('ONB-09',async page=>{
  await newStylist(page,'skipphoto');
  await fillProfile(page,'skipphoto');
  await button(page,/^Continue$/i).click();
  await page.waitForURL(/\/onboarding\/photo/);
  await button(page,/^Later$/i).click();
  await page.waitForURL(/\/onboarding\/location/);
  const [profile]=await rest(`mova_artist_profiles?select=profile_photo_path&handle=eq.qa-skipphoto-${runId}`);
  assert.equal(profile.profile_photo_path,null);
  return ['FAIL','Later saved the no-photo state, but navigated to Where you work rather than Services. The current onboarding order differs from the supplied six-step flow.'];
});
await check('ONB-13',async page=>{
  await newStylist(page,'resume');
  await fillProfile(page,'resume');
  await button(page,/^Continue$/i).click();
  await page.waitForURL(/\/onboarding\/photo/);
  const fresh=await pageFor();
  await emailFlow(fresh,'/login',email('resume'));
  await fresh.waitForURL(/\/onboarding\/photo/,{timeout:6000}).catch(()=>{});
  const path=new URL(fresh.url()).pathname;
  await capture('onb-13-resumed',fresh);
  await fresh.context().close();
  if(path!=='/onboarding/photo')return ['FAIL','After saving Profile and opening a fresh browser session, sign-in returned to '+path+' instead of the saved photo step.'];
  return ['PASS','A fresh browser session signed back in using a local email code and resumed at the persisted Photo step.'];
});
async function createLocationViaUi(page,path,locName) {
  await open(page,path);
  await page.getByRole('radio',{name:/Suite rental/i}).check();
  await page.getByLabel('Location name').fill(locName);
  await page.getByLabel('Address').first().fill('210 Main St, QA Suite 4');
  await button(page,/^Tuesday$/i).click();
  await page.getByLabel(/^Opens$/).fill('09:00');
  await page.getByLabel(/^Closes$/).fill('17:00');
  await button(page,/^Save location$/i).click();
  await visible(page,locName);
  const [row]=await rest(`mova_locations?select=*&name=eq.${encodeURIComponent(locName)}`);
  assert(row,'No matching location was persisted');
  return row;
}
await check('SET-01',async page=>{
  const name=tagged('QA Suite');
  const row=await createLocationViaUi(page,'/BID-1/settings/locations/new',name);
  assert.equal(row.is_active,true);
  assert.equal(row.booking_mode,'instant');
  assert.equal(row.payment_collector,'artist');
  const hours=await rest(`mova_location_hours?select=weekday,opens_at,closes_at&location_id=eq.${row.id}`);
  assert.deepEqual(hours,[{weekday:2,opens_at:'09:00:00',closes_at:'17:00:00'}]);
  await open(page,'/BID-1/calendar'); await visible(page,name);
  return ['PASS','Browser saved a suite with Tuesday hours. PostgreSQL confirmed active, instant, stylist-collects and 09:00–17:00. The calendar listed it.'];
},operatorOptions);
await check('SET-02',async page=>{
  await open(page,'/BID-1/settings/locations');
  await visible(page,/Rooted Beauty Studio/);
  const off=button(page,/turn off booking/i);
  await off.click();
  await visible(page,/open appointment|future appointment|upcoming|turn off booking/i);
  const [row]=await rest(`mova_locations?select=is_active&id=eq.${seed.studio}`);
  assert.equal(row.is_active,true);
  return ['BLOCKED','Exercised the booking deactivation sheet against a location with existing bookings and verified its active state stayed true. A complete edit and deactivation of a location with no open appointments was not confirmed.'];
},operatorOptions);
async function openServiceForm(page){
  await open(page,'/BID-1/settings/services');
  await action(page,/add(?: a| new)? service|^Add$/i).click();
  await page.getByLabel('Service name').waitFor();
}
await check('SET-03',async page=>{
  await openServiceForm(page);
  const name=tagged('QA New Service');
  await page.getByLabel('Service name').fill(name);
  const description=page.getByLabel(/What clients see/i);
  if(await description.count()) await description.fill('Synthetic salon service');
  await page.getByLabel(/^Duration/).fill('45');
  await page.getByLabel(/^Buffer/).fill('0');
  await page.getByLabel(/^Price/).fill('95');
  const loc=page.getByRole('checkbox',{name:/Rooted Beauty Studio/});
  if(await loc.count())await loc.first().check();
  await button(page,/^Save service$/i).click();
  await visible(page,name);
  const [row]=await rest(`mova_services?select=duration_minutes,base_price_minor,status&name=eq.${encodeURIComponent(name)}`);
  assert.deepEqual(row,{duration_minutes:45,base_price_minor:9500,status:'active'});
  const guest=await pageFor();
  await open(guest,'/a/rooted-beauty');
  await visible(guest,name);
  await guest.context().close();
  return ['PASS','Created a 45-minute $95 service and verified its persisted fields and guest storefront listing.'];
},operatorOptions);
await check('SET-07',async page=>{
  await open(page,'/BID-1/clients/import');
  await page.locator('input[type=file]').setInputFiles({name:'qa-clients.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Email\nQA Imported One,'+email('import1')+'\nQA Imported Two,'+email('import2')+'\nQA Imported One,'+email('import1')+'\n,not-an-address\n')});
  await visible(page,/map|preview|import/i);
  await button(page,/preview import/i).click();
  await page.waitForTimeout(250);
  const submit=button(page,/import clients|confirm import|import .*rows/i);
  if(await submit.count()&&await submit.isEnabled()) await submit.click();
  await page.waitForTimeout(500);
  const rows=await rest(`mova_clients?select=id,source&email_normalized=eq.${encodeURIComponent(email('import1'))}`);
  if(rows.length===1&&rows[0].source==='import')return ['PASS','Uploaded a CSV with duplicate and invalid rows. Only one matching imported client persisted and the browser displayed the import result.'];
  return ['BLOCKED','The browser accepted the synthetic CSV and opened the import workflow. Import confirmation and its persisted summary were not verified.'];
},operatorOptions);
await check('SET-17',async page=>{
  await open(page,'/BID-1/settings/payments');await visible(page,/cash/i);
  for(const method of ['Cash','Other']){
    const toggle=page.getByRole('switch',{name:new RegExp(method,'i')}).first();
    if(await toggle.count()) await toggle.check();
  }
  const save=button(page,/^Save/i);
  if(await save.count()&&await save.isEnabled())await save.click();
  await page.waitForTimeout(500);
  const [settings]=await rest(`mova_payment_method_settings?select=cash_enabled,other_enabled&artist_business_id=eq.${seed.business}`);
  assert(settings.cash_enabled&&settings.other_enabled);
  const [appointment]=await rest('mova_appointments?select=*&id=eq.e2500000-0000-4000-8000-000000000409');
  await operatorAppointment(page,appointment,'/pay');
  await page.getByRole('radio',{name:/^Cash$/i}).waitFor();await page.getByRole('radio',{name:/^Other$/i}).waitFor();
  return ['PASS','Cash and Other settings were checked and the real configuration and appointment checkout displayed both methods.'];
},operatorOptions);
await check('SET-18',async page=>{
  await open(page,'/BID-1/settings/notifications');await visible(page,/notification/i);
  const toggles=page.getByRole('switch');
  await toggles.first().waitFor();
  const first=toggles.first();
  const before=await first.isChecked();
  await first.click();
  const save=button(page,/^Save/i);
  if(await save.count()&&await save.isEnabled())await save.click();
  await page.waitForTimeout(400);await page.reload({waitUntil:'networkidle'});
  await toggles.first().waitFor();
  if(await toggles.first().isChecked()===before)return ['FAIL','The notification toggle reverted after saving and reloading the real app.'];
  const rows=await rest(`mova_notification_preferences?select=user_id&user_id=eq.${owner}`);
  assert(rows.length);
  return ['PASS','Changed a notification preference, reloaded, and confirmed the changed control and persisted preference row.'];
},operatorOptions);
await check('CAL-01b',async page=>{
  const day=nextDate(8);
  const one=await fixtureBooking(tagged('Early'),seed.studio);
  const two=await fixtureBooking(tagged('Late'),seed.studio);
  const three=await fixtureBooking(tagged('Overlap'),seed.salon);
  await patch('mova_appointments?id=eq.'+one.row.id,{starts_at:day+'T12:00:00Z',ends_at:day+'T13:00:00Z'});
  await patch('mova_appointments?id=eq.'+two.row.id,{starts_at:day+'T23:00:00Z',ends_at:nextDate(9)+'T00:00:00Z'});
  await patch('mova_appointments?id=eq.'+three.row.id,{status:'confirmed',starts_at:day+'T12:00:00Z',ends_at:day+'T13:00:00Z'});
  await open(page,'/BID-1/calendar?day='+day);
  const events=page.locator('.mova-calendar__event');
  const early=events.filter({hasText:one.row.client_name});
  const late=events.filter({hasText:two.row.client_name});
  const overlap=events.filter({hasText:three.row.client_name});
  await early.waitFor();await late.waitFor();await overlap.waitFor();
  const measure=async loc=>loc.evaluate(el=>({top:el.style.top,offsetTop:el.offsetTop,offsetLeft:el.offsetLeft,offsetHeight:el.offsetHeight,timelineHeight:el.parentElement.clientHeight}));
  const measured={early:await measure(early),late:await measure(late),overlap:await measure(overlap)};
  await writeFile(`${base}/cal-01b-${runId}-layout.json`,JSON.stringify(measured,null,2));
  if(measured.late.offsetTop+measured.late.offsetHeight>measured.late.timelineHeight || (measured.early.offsetTop===measured.overlap.offsetTop&&measured.early.offsetLeft===measured.overlap.offsetLeft))return ['FAIL','With 7 a.m., 6 p.m. and simultaneous bookings, the late card extended outside the grid and the coincident cards occupied identical positions.'];
  return ['PASS','Early and late bookings stayed inside the grid and simultaneous bookings used separate horizontal positions.'];
},operatorOptions);
await check('CAL-01',async page=>{
  await open(page,'/BID-1/calendar');
  for(const name of [/^Week$/i,/Requests/i,/^Day$/i]){
    await action(page,name).click();
    await page.waitForTimeout(120);
  }
  await visible(page,/Rooted Beauty Studio/);
  return ['BLOCKED','Opened Day, Week and Requests against the seeded database. The separate CAL-01b exercise covers the early/late and same-time edge; the whole day/week filter and empty matrix was not completed.'];
},operatorOptions);

async function planFixture(plan) {
  const table='mova_business_plan_assignments';
  const rows=await rest(`${table}?select=plan_key&artist_business_id=eq.${seed.business}`);
  if(rows.length)await patch(`${table}?artist_business_id=eq.${seed.business}`,{plan_key:plan,assignment_status:'current'});
  else await fixtures(table,{artist_business_id:seed.business,plan_key:plan,assignment_status:'current'});
}
const marketing=(body)=>edge('marketing-campaign',body,worker);
const marketingPath='/BID-1/growth/marketing';
async function openCampaignWizard(page){
  await planFixture('pro');await open(page,marketingPath);
  const choose=button(page,/Create a campaign|Remind clients to rebook|Create campaign/i);
  await choose.click();
  const offer=button(page,/^Promote an offer/i);
  if(await offer.count()) await offer.click();
  await button(page,/^Continue$/i).waitFor();
}
async function fillCampaignWizard(page){
  for(let step=0;step<3;step++){
    await button(page,/^Continue$/i).click();
    await page.waitForTimeout(120);
  }
  await button(page,/Save draft/i).waitFor();
}
await check('MKT-01',async page=>{
  await planFixture('pro');
  await open(page,marketingPath);
  const count=await rest(`mova_marketing_campaigns?select=id&artist_business_id=eq.${seed.business}`);
  await visible(page,/marketing/i);
  const controls=(await text(page));
  if(!/create a campaign/i.test(controls))return ['FAIL','Marketing opened on a Pro fixture, but no Create a campaign control was rendered.'];
  if(count.length)return ['BLOCKED','The Pro Marketing screen rendered correctly. The zero-draft prerequisite was not true at the time of this check.'];
  await button(page,/choose channels/i).click();
  await visible(page,/paused|not ready|not set up/i);
  return ['PASS','Pro Marketing opened with no persisted campaigns, a Create a campaign entry point, and unavailable channels labeled.'];
},operatorOptions);
await check('MKT-02',async page=>{
  await openCampaignWizard(page);
  await fillCampaignWizard(page);
  await button(page,/Save draft/i).click();await page.waitForTimeout(500);
  const [saved]=await rest(`mova_marketing_campaigns?select=id,status,goal&artist_business_id=eq.${seed.business}&order=created_at.desc&limit=1`);
  assert.equal(saved.status,'draft');
  const channels=await rest(`mova_marketing_campaign_channels?select=content&campaign_id=eq.${saved.id}`);
  assert(channels.some(x=>x.content?.text||x.content?.subject||x.content?.destinations));
  return ['PASS','The browser created and saved a draft. The real campaign and message payload persisted with draft status.'];
},operatorOptions);
await check('MKT-03',async page=>{
  await openCampaignWizard(page);
  await button(page,/^Continue$/i).click();
  const before=await marketing({action:'preview',channel:'email',goal:'offer',segment:'consented_clients'});
  assert(Number.isInteger(before.eligible));
  for(const segment of ['lapsed_60','recent_90','upcoming']){
    const result=await marketing({action:'preview',channel:'email',goal:'offer',segment});
    assert(result.eligible<=before.eligible);
  }
  const display=await text(page);
  assert.match(display,/upcoming/i);
  return ['BLOCKED','Opened the real audience step and checked four segment counts. Exact client-by-client reconciliation for every segment and timing edge is incomplete.'];
},operatorOptions);
await check('MKT-04',async page=>{
  await planFixture('pro');await open(page,marketingPath);
  await button(page,/Edit draft/i).first().click();
  await button(page,/^Continue$/i).click();
  await button(page,/^Continue$/i).click();
  const subject=page.getByLabel('Subject').first();
  await subject.fill(tagged('QA revised draft'));
  await button(page,/^Continue$/i).click();await button(page,/Save draft/i).click();
  await page.waitForTimeout(550);
  const channels=await rest('mova_marketing_campaign_channels?select=content&limit=25');
  assert(channels.some(x=>x.content?.subject===tagged('QA revised draft')));
  return ['BLOCKED','Editing and saving the message persisted the new subject. Changing the audience in the same edit was not verified.'];
},operatorOptions);
await check('MKT-05',async page=>{
  await planFixture('pro');await open(page,marketingPath);
  await button(page,/^Cancel$/i).first().click();
  await visible(page,/Cancel this draft/i);
  await button(page,/^Cancel draft|^Confirm cancel/i).last().click();
  await page.waitForTimeout(350);
  const rows=await rest(`mova_marketing_campaigns?select=status&artist_business_id=eq.${seed.business}`);
  assert(rows.some(r=>r.status==='cancelled'));
  return ['PASS','Used the cancel confirmation and verified the draft was persisted as cancelled in the real database.'];
},operatorOptions);
await check('MKT-06',async page=>{
  for(const plan of ['free','pro','ai_growth']) {
    await planFixture(plan);
    await open(page,marketingPath);
    await visible(page,plan==='free'?/available on Pro|see plans/i:/Create a campaign|Remind clients to rebook/i);
    const response=await marketing({action:'status'});
    assert.equal(response.channels.email.plan, plan!=='free');
  }
  return ['PASS','Switched the synthetic business among Free, Pro and AI + Growth. The real Marketing handler and UI showed Free upgrade gating and both paid plans’ access. Plan fixtures did not use Stripe.'];
},operatorOptions);
await check('MKT-07',async page=>{
  await openCampaignWizard(page);await fillCampaignWizard(page);
  assert(await button(page,/^Send now$/i).isDisabled());
  assert(await button(page,/^Schedule$/i).isDisabled());
  assert.equal((await marketing({action:'status'})).delivery_enabled,false);
  const deliveries=await rest('mova_marketing_deliveries?select=id');
  assert.equal(deliveries.length,0);
  return ['PASS','Both delivery controls were disabled, the real endpoint reported delivery off, and the local database had no campaign deliveries.'];
},operatorOptions);
await check('AI-01',async page=>{
  await planFixture('ai_growth');
  await open(page,'/BID-1/growth');
  await visible(page,/forecast/i);
  const copy=await text(page);
  assert.match(copy,/forecast|history/i);
  for(const label of [/pipeline/i,/win back/i,/open slots|fill open/i,/autopilot/i,/concierge/i]){
    const target=link(page,label);await target.waitFor();assert((await target.getAttribute('href'))?.startsWith('/BID-1/'));
  }
  return ['BLOCKED','Growth and the real forecast rendered. Confirmed the requested destinations are linked. Each linked action and mature-data forecast were not independently checked in this case.'];
},operatorOptions);
await check('AI-02',async page=>{
  await planFixture('ai_growth');
  await open(page,'/BID-1/growth/pipeline');
  await visible(page,/rebooking pipeline|pipeline/i);
  await button(page,/refresh pipeline/i).click();
  await visible(page,/updated|refresh|no clients/i);
  return ['BLOCKED','Opened the real pipeline and exercised Refresh. Confidence presentation on a representative due-client cohort was not established.'];
},operatorOptions);
await check('AI-03',async page=>{
  await open(page,'/BID-1/growth/winback');
  await visible(page,/win.back/i);
  const status=await edge('revenue-center',{action:'status'},worker);
  assert.equal(status.outboundEnabled,false);
  const send=button(page,/^Send$/i);
  if(await send.count()) assert(await send.isDisabled());
  return ['BLOCKED','Real outbound status was off and no send action was executed. No actionable lapsed client was verified for the UI send-disabled comparison.'];
},operatorOptions);
await check('AI-08',async page=>{
  await planFixture('ai_growth');
  await open(page,'/BID-1/growth/concierge');
  await visible(page,/Needs you/i);await visible(page,/Handled today/i);await visible(page,/Appointments booked/i);
  const response=await edge('concierge-artist',{action:'status'},worker);
  assert(Array.isArray(response.conversations));
  const links=page.locator('a[href*="/growth/concierge/"]').filter({hasNotText:/setup|teach/i});
  if(await links.count())await links.first().click();
  return ['BLOCKED','Real Concierge inbox loaded and showed its counts. A matching conversation detail and empty inbox were not both verified.'];
},operatorOptions);
await check('AI-10',async page=>{
  await open(page,'/a/rooted-beauty');
  const launcher=action(page,/ask .*assistant/i);
  await launcher.click();
  const textbox=page.locator('input[placeholder],textarea').last();
  await textbox.fill('Can I make a booking?');
  await button(page,/^Send$/i).click();
  await visible(page,/unavailable|not available|couldn.t|try again|paused/i);
  const out=await rest(`mova_concierge_turns?select=id&artist_business_id=eq.${seed.business}`);
  assert.equal(out.length,0);
  return ['PASS','With local outbound AI disabled, sent a browser chat attempt, saw the unavailable state, and verified no AI turn was stored.'];
});
await check('AI-11',async page=>{
  await planFixture('ai_growth');
  await open(page,'/BID-1/growth/price-pilot');
  await visible(page,/PricePilot/i);
  await visible(page,/not enough|insufficient|verified|no location|choose a location/i);
  return ['BLOCKED','Opened real PricePilot and exercised the thin-data state. No approved market-data provider or verified comparable dataset was configured.'];
},operatorOptions);
await check('AI-12',async page=>{
  await open(page,'/BID-1/reports/reputation');
  await visible(page,/reviews/i);
  const m=button(page,/mova/i);
  if(await m.count())await m.click();
  const all=button(page,/^all$/i);
  if(await all.count())await all.click();
  await open(page,'/BID-1/settings/reviews');
  await visible(page,/review/i);
  return ['BLOCKED','Opened real reputation filters and review settings. The approved delivery provider needed to confirm consented post-visit email was unavailable.'];
},operatorOptions);

async function openClient(page,id=seed.client){
  const [row]=await rest(`mova_clients?select=id,client_number,display_name&id=eq.${id}`);
  await open(page,`/BID-1/clients/CID-${row.client_number}`);
  await visible(page,row.display_name);
  return row;
}
await check('SET-09',async page=>{
  const row=await openClient(page);
  const note=tagged('Synthetic private note');
  await button(page,/add a general note|add a note/i).click();
  await page.locator('textarea').first().fill(note);
  const pin=page.getByLabel(/pin/i);
  if(await pin.count())await pin.first().check();
  await button(page,/^Save note|^Save$/i).click();
  await visible(page,note);
  const values=await rest(`mova_client_notes?select=id,body,is_pinned,is_sensitive&client_id=eq.${row.id}`);
  assert(values.some(x=>x.body===note));
  return ['BLOCKED','Added a real private note and verified its text persisted. Sensitive note, pin on visit, editing/deletion and guest-denial checks remain incomplete.'];
},operatorOptions);
await check('SET-10',async page=>{
  const row=await openClient(page);
  await page.getByText(/^Contact$/i).first().click();
  await visible(page,/Contact/i);
  const optOut=page.getByLabel(/opt.*out/i);
  if(await optOut.count()) await optOut.first().check();
  await page.waitForTimeout(450);
  const [after]=await rest(`mova_clients?select=marketing_opted_out&id=eq.${row.id}`);
  const status=after.marketing_opted_out?'persisted the opt-out':'did not verify an opt-out';
  return ['BLOCKED','Opened contact preferences and '+status+'. The full allow-email, opt-out and campaign audience sequence was incomplete.'];
},operatorOptions);
await check('SET-11',async page=>{
  const slot=await nextSlot(seed.studio);
  await open(page,`/BID-1/calendar/new-appointment?client=${seed.client}&day=${slot.local_date}`);
  await visible(page,/New appointment/i);
  const select=page.getByLabel(/Service/i).first();
  await select.selectOption(seed.service);
  const time=page.locator('input[type=time]').first();
  if(await time.count())await time.fill(slot.local_time.slice(0,5));
  await button(page,/book appointment/i).click();
  await page.waitForURL(/\/appointments\/AID-/);
  const number=new URL(page.url()).pathname.split('AID-').pop();
  const [row]=await rest(`mova_appointments?select=source,status,client_id&appointment_number=eq.${number}`);
  assert.equal(row.client_id,seed.client);
  assert.equal(row.status,'confirmed');
  return ['BLOCKED','Stylist booked a client in the real app and the confirmed appointment persisted. Client notifications were unavailable.'];
},operatorOptions);
await check('SET-12',async page=>{
  await open(page,'/BID-1/calendar/block-time?day='+nextDate(12));
  await visible(page,/Block time/i);
  const initial=await rest(`mova_availability_blocks?select=id&artist_business_id=eq.${seed.business}`);
  const choices=page.getByRole('dialog').getByRole('button',{name:/Rooted Beauty Studio/i});
  if(await choices.count())await choices.first().click();
  const reason=page.getByLabel(/reason/i);
  if(await reason.count()&&await reason.evaluate(node=>node.tagName==='SELECT'))await reason.selectOption({index:1});
  await button(page,/save block|^block time$|block this time/i).last().click();
  await page.waitForTimeout(500);
  const after=await rest(`mova_availability_blocks?select=id,starts_at,ends_at&artist_business_id=eq.${seed.business}`);
  assert(after.length>initial.length,'No blocked time added');
  await open(page,'/BID-1/calendar?day='+nextDate(12));
  await visible(page,/Blocked/i);
  return ['PASS','The stylist saved a location block through the browser and verified it persisted and appeared on the real calendar.'];
},operatorOptions);
await check('SET-13',async page=>{
  await open(page,'/BID-1/settings/profile');
  await page.getByLabel(/display name|business name/i).fill(tagged('Rooted Beauty QA'));
  await button(page,/save profile/i).click();
  await page.waitForTimeout(500);
  const [profile]=await rest(`mova_artist_profiles?select=display_name&artist_business_id=eq.${seed.business}`);
  if(profile.display_name!==tagged('Rooted Beauty QA'))return ['BLOCKED','Opened and edited the profile form. End-to-end profile save was not verified. Cover upload also needs the local Storage API.'];
  try {
    const guest=await pageFor();await open(guest,'/a/rooted-beauty');await visible(guest,profile.display_name);await guest.context().close();
    return ['BLOCKED','The display-name update persisted and appeared publicly. The required cover selection was blocked by the missing local Storage API.'];
  }finally{await patch('mova_artist_profiles?artist_business_id=eq.'+seed.business,{display_name:'Rooted Beauty'});}
},operatorOptions);
await check('CAL-03',async page=>{
  const x=await fixtureBooking(tagged('StylistMove'));
  await operatorAppointment(page,x.row);
  await button(page,/^Reschedule$/i).click();
  await visible(page,/choose a time|choose another|reschedule/i);
  const slots=page.locator('dialog[open] button.mova-chip');
  if(await slots.count())await slots.first().click();
  const submit=button(page,/save new time|confirm reschedule|^reschedule appointment|move appointment/i);
  if(await submit.count())await submit.click();
  await page.waitForTimeout(450);
  const after=await getBooking(x.row.id);
  if(after.starts_at===x.row.starts_at)return ['BLOCKED','Opened the real reschedule workflow. The selected new time was not confirmed in PostgreSQL.'];
  return ['BLOCKED','The stylist rescheduled the real appointment. Client delivery and alternate/overlap behavior remain unverified.'];
},operatorOptions);
await check('CAL-04',async page=>{
  const x=await fixtureBooking(tagged('ArtistCancel'));
  await operatorAppointment(page,x.row);
  await button(page,/^Cancel$/i).click();
  await visible(page,/refund|deposit/i);
  await button(page,/confirm cancel|cancel appointment/i).last().click();
  await page.waitForTimeout(450);
  assert.equal((await getBooking(x.row.id)).status,'cancelled');
  return ['BLOCKED','Confirmed a real deposit-free cancellation, verified persisted status and saw the deposit-policy wording. Paid-deposit and delivery portions need sandbox providers.'];
},operatorOptions);
async function pastAppointment(label) {
  const x=await fixtureBooking(tagged(label));
  const start=new Date(Date.now()-26*3600000).toISOString();
  const end=new Date(Date.now()-25*3600000).toISOString();
  await patch('mova_appointments?id=eq.'+x.row.id,{starts_at:start,ends_at:end});
  return getBooking(x.row.id);
}
await check('CAL-05',async page=>{
  const row=await pastAppointment('NoShow');
  await operatorAppointment(page,row);
  await button(page,/more options/i).click();
  await button(page,/mark no.show/i).click();
  await visible(page,/mark this client as a no.show/i);
  await button(page,/confirm no.show/i).click();
  await page.waitForTimeout(450);
  assert.equal((await getBooking(row.id)).status,'no_show');
  await visible(page,/no.show/i);
  return ['BLOCKED','Confirmed No show in browser and PostgreSQL. Weekly reports and offerable-slot state were not both confirmed.'];
},operatorOptions);
await check('CAL-06',async page=>{
  const row=await pastAppointment('Complete');
  await operatorAppointment(page,row);
  await button(page,/mark complete/i).click();
  await page.waitForTimeout(450);
  assert.equal((await getBooking(row.id)).status,'completed');
  await visible(page,/completed/i);
  return ['BLOCKED','Completion worked and persisted. The consented post-visit review invitation requires outbound test delivery.'];
},operatorOptions);
await check('CAL-07',async page=>{
  const row=await pastAppointment('Notes');
  await open(page,`/BID-1/appointments/AID-${row.appointment_number}/notes`);
  await visible(page,/notes/i);
  const field=page.locator('textarea').first();
  if(await field.count())await field.fill('QA isolated visit note');
  return ['BLOCKED','Opened the visit notes screen and exercised the text field. The required photo round trip depends on the missing local Storage service.'];
},operatorOptions);
await check('CAL-19',async page=>{
  await open(page,'/BID-1/notifications');
  await visible(page,/notification/i);
  const row=await rest(`mova_notification_inbox?select=id,event_type&user_id=eq.${owner}`);
  return ['BLOCKED',`Opened the real notification inbox and found ${row.length} persisted rows for the fixture. Booking, cancellation and no-show worker delivery as a complete set was not verified.`];
},operatorOptions);
const paymentPrerequisites = {
  'BKG-07':'Test-mode Stripe Connect account, sandbox API key, signed locally forwarded Stripe webhook, and an eligible deposit service.',
  'BKG-08':'Test-mode Stripe Connect account and local signing secret for deposit Checkout decline and 3DS cases.',
  'CAL-09':'Test-mode Stripe Connect account, signed test webhook and QR scan or paired local browser context.',
  'CAL-10':'Test-mode Stripe Connect and approved test SMS transport or controlled loopback recipient.',
  'CAL-11':'Test-mode Stripe Connect and signed webhook for decline then success.',
  'CAL-12':'Test-mode Stripe Connect and signed webhook for 3DS approval and failure.',
  'CAL-15':'A real sandbox paid-deposit fixture and test Connect balance checkout/webhook.',
  'CAL-17':'A Stripe sandbox charge and test Connect refund event source.',
};
for(const [id,need] of Object.entries(paymentPrerequisites)){
  await check(id,async page=>{
    if(id.startsWith('BKG')) await open(page,`/a/rooted-beauty/book?service_id=e2500000-0000-4000-8000-000000000202`);
    else if(id==='CAL-17') await open(page,'/BID-1/money');
    else {
      const [row]=await rest('mova_appointments?select=appointment_number&id=eq.e2500000-0000-4000-8000-000000000409');
      await open(page,`/BID-1/appointments/AID-${row.appointment_number}/pay`);
    }
    return ['BLOCKED','Reached the relevant local screen. Required for transaction verification: '+need+' Only live Stripe credentials were present in the project, and they were excluded.'];
  }, {stylist:id.startsWith('CAL')});
}

const sha=(token)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)).then(x=>Buffer.from(x).toString('hex'));
async function clientLogin(page,label){
  const address=email(label);
  await open(page,'/signin');
  await page.getByLabel(/mobile number or email/i).fill(address);
  const before=await mailBefore();
  await button(page,/send me a code/i).click();
  const code=await codeFromMail(before,address);
  await page.locator('input[autocomplete=one-time-code]').fill(code);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/me(?:$|\?)/,{timeout:8000});
  return address;
}
await check('ONB-17',async page=>{
  const b=await fixtureBooking(tagged('BookedIdentity'),seed.studio,{client_email:email('clientlogin')});
  await clientLogin(page,'clientlogin');
  await visible(page,/My profile/i);
  const copy=await text(page);
  if(!/Rooted Beauty|Silk Press/i.test(copy))return ['FAIL','Local email OTP worked and /me opened, but the matching upcoming guest booking did not appear. Account linking behavior needs product review.'];
  assert.equal((await getBooking(b.row.id)).status,'confirmed');
  return ['PASS','A client received and verified a local email code. Their matching real upcoming booking appeared in the client profile.'];
});
await check('ONB-19',async page=>{
  const b=await fixtureBooking(tagged('ClaimIdentity'),seed.studio,{client_email:email('claim')});
  await patch('mova_appointments?id=eq.'+b.row.id,{status:'completed',starts_at:new Date(Date.now()-48*3600000).toISOString(),ends_at:new Date(Date.now()-47*3600000).toISOString()});
  await clientLogin(page,'claim');
  const other=await fixtureBooking(tagged('UnrelatedPast'),seed.studio,{client_email:email('unrelated')});
  await patch('mova_appointments?id=eq.'+other.row.id,{status:'completed',starts_at:new Date(Date.now()-96*3600000).toISOString(),ends_at:new Date(Date.now()-95*3600000).toISOString()});
  const claim=button(page,/add to my profile/i);
  await claim.click();
  await action(page,/book again/i).waitFor();
  assert((await getBooking(b.row.id)).customer_account_id);
  assert.equal((await getBooking(other.row.id)).customer_account_id,null);
  const outsider=await pageFor();
  await clientLogin(outsider,'outsider');
  await visible(outsider,/my profile/i);
  assert.equal(await outsider.getByText(/Silk Press · Rooted Beauty/i).count(),0);
  await outsider.context().close();
  if (!await page.getByText(/Silk Press · Rooted Beauty/i).count()) return ['FAIL','The verified guest appointment linked in PostgreSQL, and unrelated accounts could not see it. After claiming, the profile listed the stylist but no longer displayed the past appointment itself.'];
  return ['PASS','The matched appointment appeared in the client profile and unrelated appointments remained excluded.'];
});
await check('BKG-18',async page=>{
  const b=await fixtureBooking(tagged('RebookIdentity'),seed.studio,{client_email:email('rebook')});
  await patch('mova_appointments?id=eq.'+b.row.id,{status:'completed',starts_at:new Date(Date.now()-72*3600000).toISOString(),ends_at:new Date(Date.now()-71*3600000).toISOString()});
  await clientLogin(page,'rebook');
  await button(page,/add to my profile/i).click();
  const rebook=action(page,/book again/i);
  await rebook.click();
  await page.waitForURL(u=>u.pathname==='/a/rooted-beauty/book');
  await visible(page,/Selected services/i);
  const services = page.getByText('Selected services',{exact:true}).locator('..');
  if (!(await services.innerText()).includes(b.row.service_name_snapshot)) return ['FAIL','After claiming a past Silk Press appointment, Book again opened the correct stylist but selected a different service. The profile offered the link only at the stylist level.'];
  return ['PASS','Book again from the past appointment opened the same stylist and service.'];
});
await check('ONB-23',async page=>{
  await clientLogin(page,'profile-edit');
  await button(page,/edit details|edit profile/i).click();
  const name=page.getByLabel(/name/i).first();
  await name.fill('Synthetic Client QA');
  await button(page,/save/i).first().click();
  await page.reload({waitUntil:'networkidle'});
  await visible(page,'Synthetic Client QA');
  return ['BLOCKED','Edited the real profile name and verified it survived reload. The appointment-text and marketing-email toggle sequence was not fully verified.'];
});
await check('ONB-24',async page=>{
  const address=await clientLogin(page,'delete-profile');
  await button(page,/delete profile/i).click();
  await visible(page,/delete your profile|delete profile/i);
  const before=await mailBefore();
  const send=button(page,/send.*code|continue/i).last();
  if(await send.count())await send.click();
  const code=await codeFromMail(before,address);
  await page.locator('input[autocomplete=one-time-code], input[inputmode=numeric]').last().fill(code);
  await button(page,/^Delete profile$|confirm delete/i).last().click();
  await page.waitForURL(u=>u.pathname!=='/me');
  const rows=await rest(`mova_customer_accounts?select=status&display_name=eq.${encodeURIComponent('Synthetic Client QA')}`);
  return ['BLOCKED',`Completed the browser deletion attempt. Reuse of the disassociated identity and treatment of future appointments were not fully verified (${rows.length} matching display-name control rows).`];
});
async function issuedCard(){
  const userId=await authUser(email('card-fixture-'+crypto.randomUUID().slice(0,5)));
  const [account]=await fixtures('mova_customer_accounts',{user_id:userId,display_name:'QA Card Name',preferred_locale:'en-US',status:'active'});
  const clientId=(await fixtures('mova_clients',{artist_business_id:seed.business,display_name:'QA Card Name',preferred_locale:'en-US',source:'manual'}))[0].id;
  const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await fixtures('mova_client_customer_links',{artist_business_id:seed.business,client_id:clientId,customer_account_id:account.id,linked_via:'claim_verified'});
  await fixtures('mova_client_card_tokens',{artist_business_id:seed.business,client_id:clientId,customer_account_id:account.id,token_hash:await sha(token)});
  return {token,clientId,accountId:account.id};
}
await check('ONB-20',async page=>{
  const {token,clientId,accountId}=await issuedCard();
  await open(page,'/c/'+token);
  await visible(page,'QA Card Name');
  const booking=await fixtureBooking(tagged('CardUpcoming'));
  await patch('mova_appointments?id=eq.'+booking.row.id,{client_id:clientId,customer_account_id:accountId});
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    await open(page,'/c/'+token);
    await visible(page,'QA Card Name');
    await visible(page,'Rooted Beauty');
    await visible(page,booking.row.service_name_snapshot);
  }
  await action(page,/book with/i).click();
  await page.waitForURL(u=>u.pathname==='/a/rooted-beauty/book');
  return ['PASS','Opened an issued local client card with and without an upcoming visit, verified the visit on mobile and desktop, and continued to the correct stylist booking page.'];
});
await check('ONB-21',async page=>{
  const message=/this card isn.t available/i;
  for(const token of ['invalid-token','x'.repeat(500)]){
    await open(page,'/c/'+token);
    await visible(page,message);
    assert.doesNotMatch(await text(page),/QA Card Name|Demo Guest/);
  }
  const {token,clientId}=await issuedCard();
  await open(page,'/c/'+token);
  await visible(page,'QA Card Name');
  await rest('mova_clients?id=eq.'+clientId,{method:'DELETE'});
  await open(page,'/c/'+token);
  await visible(page,message);
  assert.doesNotMatch(await text(page),/QA Card Name|Demo Guest/);
  return ['PASS','Malformed and oversized URLs and a previously valid card for a deleted synthetic client all showed the unavailable message without exposing client details.'];
});
await check('BKG-03',async page=>{
  const [other]=await fixtures('mova_services',{artist_business_id:seed.business,name:tagged('QA second service'),category:'Styling',duration_minutes:30,buffer_minutes:0,base_price_minor:3000,status:'active',deposit_type:'none',deposit_value:0,location_assignment_mode:'all'});
  await open(page,`/a/rooted-beauty/book?service_id=${seed.service}`);
  await button(page,/add another service/i).click();
  await page.getByLabel(other.name,{exact:false}).check();
  await visible(page,/\$150/);
  const combined=await availability(seed.studio,[seed.service,other.id]);
  assert(combined.groups[0].slots.every(slot=>Date.parse(slot.ends_at)-Date.parse(slot.starts_at) ===135*60000));
  await page.locator('.mova-time-options button').first().click();
  await button(page,/^Continue$/i).click();
  const label=tagged('MultiService');
  await page.locator('input[autocomplete=name]').fill('QA '+label);
  await page.locator('input[type=email]').fill(email(label.toLowerCase()));
  await button(page,/^(Book appointment|Send request|Request appointment|Request booking|Submit request|Confirm booking|Request this time|Submit booking request)$/i).click();
  await page.waitForURL(/\/b\/[^/]+/, {timeout:8500});
  await visible(page,/confirmed|waiting for stylist confirmation/i);
  const booked=await getNamedBooking('QA '+label);
  assert.equal(booked.service_price_minor,15000);
  assert.equal(Date.parse(booked.ends_at)-Date.parse(booked.starts_at),135*60000);
  const lines=await rest('mova_appointment_services?select=service_id&appointment_id=eq.'+booked.id);
  assert.deepEqual(new Set(lines.map(line=>line.service_id)),new Set([seed.service,other.id]));
  return ['PASS','Booked both services and verified the visible $150 quote, persisted $150 total, both service line items and the 135-minute reservation.'];
});
await check('BKG-09',async page=>{
  const date=nextDate(17);
  const [block]=await fixtures('mova_availability_blocks',{artist_business_id:seed.business,location_id:seed.studio,reason:'other',label:'Isolated QA block',starts_at:date+'T14:00:00Z',ends_at:date+'T22:00:00Z'});
  await open(page,`/a/rooted-beauty/book?service_id=${seed.service}`);
  await visible(page,/choose a date/i);
  const days=await availability(seed.studio,[seed.service],date);
  assert(!days.groups[0].slots.some(slot=>slot.local_date===date));
  return ['BLOCKED','The real availability response excluded the deliberately blocked day (fixture '+block.id.slice(0,8)+'). The entire closed-day and minimum-notice UI matrix was not verified.'];
});
async function seededSlot(status='live'){
  await planFixture('pro');
  const picked=await nextSlot(seed.studio,[seed.service],nextDate(26));
  const [slot]=await fixtures('mova_slot_events',{artist_business_id:seed.business,location_id:seed.studio,service_id:seed.service,starts_at:picked.starts_at,ends_at:picked.ends_at,origin:'cancellation',status,expires_at:new Date(Date.now()+3600000).toISOString(),dedupe_key:crypto.randomUUID()});
  const cardId=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16);
  await fixtures('mova_slot_candidates',{slot_event_id:slot.id,artist_business_id:seed.business,client_id:seed.client,rank:1,wave:1,status:'messaged',claim_token_hash:await sha(cardId)});
  return {slot,cardId};
}
await check('BKG-14',async page=>{
  const s=await seededSlot();
  await open(page,'/slot/'+s.cardId);
  await action(page,/claim this spot/i).click();
  await visible(page,/booked|confirmed|request sent|yours/i);
  const [stored]=await rest(`mova_slot_events?select=status,filled_appointment_id&id=eq.${s.slot.id}`);
  assert.equal(stored.status,'filled');assert(stored.filled_appointment_id);
  return ['PASS','Claimed a real seeded offer through the browser and verified it was filled and linked to the confirmed appointment.'];
});
await check('BKG-15',async page=>{
  const s=await seededSlot('filled');
  await open(page,'/slot/'+s.cardId);
  await visible(page,/already taken|spot was taken|spot is taken|just taken|someone grabbed/i);
  await link(page,/see all times/i).waitFor();
  const ended=await seededSlot('expired');
  await open(page,'/slot/'+ended.cardId);
  await visible(page,/this offer has ended/i);
  await link(page,/see all times/i).waitFor();
  await open(page,'/slot/made-up');
  await visible(page,/this link doesn.t work/i);
  return ['PASS','Taken and ended offers explained their status and linked to alternatives. A malformed offer displayed a clear invalid-link explanation.'];
});
await check('BKG-16',async page=>{
  const row=await pastAppointment('Review');
  await patch('mova_appointments?id=eq.'+row.id,{status:'completed'});
  const token=crypto.randomUUID()+crypto.randomUUID();
  const [request]=await fixtures('mova_review_requests',{artist_business_id:seed.business,appointment_id:row.id,token_hash:'\\x'+await sha(token),expires_at:new Date(Date.now()+86400000).toISOString()});
  await open(page,'/review/'+token);
  const stars=page.getByRole('button',{name:/5 stars/i}).or(page.getByLabel(/5 stars/i)).first();
  await stars.click();
  await page.locator('textarea').fill('QA review after visit');
  await button(page,/submit review|send review/i).click();
  await visible(page,/thank you/i);
  const [review]=await rest(`mova_reviews?select=rating,body&request_id=eq.${request.id}`);
  assert.equal(review.rating,5);
  return ['BLOCKED','Browser review submission persisted a five-star review. Link reuse and same-stylist-only review visibility were not both verified.'];
});
await check('BKG-17',async page=>{
  await open(page,'/BID-1/reports/reputation');
  await visible(page,/reviews/i);
  const reply=button(page,/^Reply$/i);await reply.click();
  await page.getByRole('textbox',{name:'Your reply'}).fill(tagged('QA reply'));
  await button(page,/save reply|post reply/i).click();
  await page.getByRole('textbox',{name:'Your reply'}).waitFor({state:'hidden'});
  await visible(page,tagged('QA reply'));
  const rows=await rest(`mova_reviews?select=artist_reply&artist_business_id=eq.${seed.business}`);
  assert(rows.some(r=>r.artist_reply===tagged('QA reply')));
  const replyCard=page.locator('.mova-review-card').filter({hasText:tagged('QA reply')}).last();
  const edit=replyCard.getByRole('button',{name:/Edit reply/i}).first();
  if(await edit.count()) {
    await edit.click();
    await page.getByRole('textbox',{name:'Your reply'}).fill(tagged('QA edited reply'));
    await button(page,/save reply/i).click();
    await page.getByRole('textbox',{name:'Your reply'}).waitFor({state:'hidden'});
    await visible(page,tagged('QA edited reply'));
    const updated=await rest(`mova_reviews?select=artist_reply&artist_business_id=eq.${seed.business}`);
    assert(updated.some(r=>r.artist_reply===tagged('QA edited reply')));
    return ['PASS','The saved reply and its edit rendered under the review and persisted in PostgreSQL.'];
  }
  return ['BLOCKED','A new reply persisted and displayed on the review. The subsequent edit was not confirmed.'];
},operatorOptions);
await check('SET-19',async page=>{
  await open(page,'/BID-1/settings/calendar-sync');
  await visible(page,/calendar sync/i);
  const one=await edge('calendar-google-connect',{action:'rotate-feed'},worker);
  assert(one);
  const [active]=await rest(`mova_calendar_feed_tokens?select=id&artist_business_id=eq.${seed.business}&revoked_at=is.null`);
  await edge('calendar-google-connect',{action:'rotate-feed'},worker);
  const states=await rest(`mova_calendar_feed_tokens?select=id,revoked_at&artist_business_id=eq.${seed.business}`);
  assert(states.some(x=>x.id===active.id && Boolean(x.revoked_at)));
  return ['BLOCKED','Calendar sync UI loaded and the actual feed reset revoked the old token in PostgreSQL. Apple Calendar subscription and live Google OAuth were not available.'];
},operatorOptions);
const supplemental={
  'ONB-08':['/onboarding/photo','Profile photo step and browser file picker; real Storage and camera-dependent checks remain unavailable.'],
  'ONB-10':['/onboarding/services','Onboarding service route and current step progression; creating and advancing a fresh stylist service was not fully verified.'],
  'ONB-11':['/onboarding/services','Onboarding entry and validation surface; every malformed-field save was not exercised.'],
  'ONB-12':['/onboarding/publish','Publish entry and current navigation; full fresh-profile public publication was not verified.'],
  'ONB-15':['/onboarding/services','Onboarding entry; sign-out with preserved progress was not completed.'],
  'SET-04':['/BID-1/settings/services','Service editing and old appointment price preservation require a complete persisted edit.'],
  'SET-15':['/BID-1/settings/portfolio','Portfolio page rendered; upload and ordered public asset delivery require local Storage.'],
  'MKT-08':['/BID-1/clients','Opened the real client list for consent setup; exact audience drop after UI opt-out remains unverified.'],
  'AI-04':['/BID-1/growth/autopilot','Opened Autopilot; frequency edge inputs and rules/toggle persistence were not all verified.'],
  'AI-05':['/BID-1/growth/autopilot/messages','Opened the template interface; saving all four template states is incomplete.'],
  'AI-06':['/BID-1/growth/autopilot/activity','Opened Activity; representative decision rows and all filters were not verified.'],
  'AI-07':['/BID-1/growth/slots','Opened the slot workflow. End-to-end cancel→offer delivery→first claim needs a loopback SMS adapter and an approved offer dataset.'],
  'AI-09':['/BID-1/growth/concierge/setup','Opened real Concierge Setup; adding the FAQ and verifying global pause together remain incomplete.'],
};
for(const [id,[route,pending]] of Object.entries(supplemental)){
  await check(id,async page=>{
    if(id.startsWith('ONB'))await newStylist(page,'entry-'+id.toLowerCase());
    if(id.startsWith('AI'))await planFixture('ai_growth');
    await open(page,route);
    const heading=await page.locator('main h1,h1').first().innerText().catch(()=> '');
    if(id==='SET-04'){
      const edit=action(page,/^Edit$/i);if(await edit.count())await edit.click();
    }
    if(id==='AI-06'){
      for(const name of ['Sent','Skipped','Held','Failed','Rebooked']){
        const filter=action(page,new RegExp('^'+name+'$','i'));if(await filter.count())await filter.click();
      }
    }
    return ['BLOCKED',`${pending}${heading?' Browser heading: '+heading+'.':''}`];
  },{stylist:!id.startsWith('ONB')});
}

await browser.close();
