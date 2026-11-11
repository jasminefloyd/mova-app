import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, ScreenHeader, TextField, Toggle } from '../../components';
import { useNavigate } from 'react-router';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type ServiceRow = { id: string; name: string; category: string; duration_minutes: number; buffer_minutes: number; base_price_minor: number; status: 'draft' | 'active' | 'inactive'; deposit_type: 'none' | 'fixed' | 'percent'; deposit_value: number };
type LocationRow={id:string;name:string};
type LocationOverride={service_id:string;location_id:string;price_minor_override:number|null;duration_minutes_override:number|null};
type ServiceForm = Omit<ServiceRow, 'id'> & { id?: string; price: string; deposit: string; locationOverrides: Record<string,{enabled:boolean;price:string;duration:string}> };
const blank: ServiceForm = { name: '', category: '', duration_minutes: 60, buffer_minutes: 0, base_price_minor: 0, status: 'active', deposit_type: 'none', deposit_value: 0, price: '', deposit: '', locationOverrides:{} };

export function ServiceSettingsPage() {
  const navigate=useNavigate();
  const { t } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [locations,setLocations]=useState<LocationRow[]>([]);
  const [overrides,setOverrides]=useState<LocationOverride[]>([]);
  const [form, setForm] = useState<ServiceForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setError(false);
    const [{ data, error: queryError },{data:locationData,error:locationError}] = await Promise.all([client.from('mova_services')
      .select('id, name, category, duration_minutes, buffer_minutes, base_price_minor, status, deposit_type, deposit_value')
      .eq('artist_business_id', businessId).order('created_at'),client.from('mova_locations').select('id,name').eq('artist_business_id',businessId).eq('is_active',true).order('name')]);
    if (queryError||locationError) setError(true); else {
      const serviceRows=(data??[]) as ServiceRow[];setServices(serviceRows);setLocations((locationData??[]) as LocationRow[]);
      if(serviceRows.length){const {data:overrideData,error:overrideError}=await client.from('mova_service_locations').select('service_id,location_id,price_minor_override,duration_minutes_override').in('service_id',serviceRows.map((item)=>item.id));if(overrideError)setError(true);else setOverrides((overrideData??[]) as LocationOverride[]);}else setOverrides([]);
    }
  }, [businessId, client]);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !businessId || !form) return;
    const priceMinor = parseMoney(form.price);
    const depositValue = form.deposit_type === 'fixed' ? parseMoney(form.deposit) : form.deposit_type === 'percent' ? parseMoney(form.deposit) : 0;
    if (priceMinor === null || depositValue === null || (form.deposit_type === 'percent' && (depositValue < 1 || depositValue > 10_000))) {
      setError(true); return;
    }
    setLoading(true); setError(false);
    const data = {
      artist_business_id: businessId, name: form.name.trim(), category: form.category.trim(),
      duration_minutes: form.duration_minutes, buffer_minutes: form.buffer_minutes, base_price_minor: priceMinor,
      status: form.status, deposit_type: form.deposit_type, deposit_value: depositValue,
    };
    const result = form.id
      ? await client.from('mova_services').update(data).eq('id', form.id).select('id').single()
      : await client.from('mova_services').insert(data).select('id').single();
    if (result.error||!result.data) setError(true);
    else {
      const serviceId=result.data.id as string;
      const overrides=Object.entries(form.locationOverrides).filter(([,value])=>value.enabled).map(([locationId,value])=>({artist_business_id:businessId,service_id:serviceId,location_id:locationId,price_minor_override:value.price.trim()?parseMoney(value.price):null,duration_minutes_override:value.duration.trim()?Number(value.duration):null}));
      if(overrides.some((override)=>
        (override.price_minor_override===null&&Boolean(form.locationOverrides[override.location_id]?.price.trim()))||
        (override.duration_minutes_override!==null&&(!Number.isInteger(override.duration_minutes_override)||override.duration_minutes_override<5||override.duration_minutes_override>1440))
      )){setError(true);setLoading(false);return;}
      const deleted=await client.from('mova_service_locations').delete().eq('service_id',serviceId);
      const inserted=overrides.length?await client.from('mova_service_locations').insert(overrides):{error:null};
      if(deleted.error||inserted.error)setError(true);else{setForm(null);await load();}
    }
    setLoading(false);
  };

  const edit = async (service: ServiceRow) => {if(!client)return;const {data}=await client.from('mova_service_locations').select('location_id,price_minor_override,duration_minutes_override').eq('service_id',service.id);const locationOverrides=Object.fromEntries(locations.map((location)=>{const item=data?.find((entry)=>entry.location_id===location.id);return[location.id,{enabled:Boolean(item),price:item?.price_minor_override==null?'':formatMoneyInput(item.price_minor_override),duration:item?.duration_minutes_override==null?'':String(item.duration_minutes_override)}];}));setForm({ ...service, locationOverrides, price: formatMoneyInput(service.base_price_minor), deposit: service.deposit_type === 'fixed' ? formatMoneyInput(service.deposit_value) : service.deposit_type === 'percent' ? String(service.deposit_value / 100) : '' });};
  const setStatus = async (service: ServiceRow) => {
    if (!client) return;
    const { error: updateError } = await client.from('mova_services').update({ status: service.status === 'active' ? 'inactive' : 'active' }).eq('id', service.id);
    if (updateError) setError(true); else await load();
  };

  if (identityLoading) return <main className="mova-page"><p role="status">{t('settings.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page"><ErrorState title={t('settings.identityError')} retryLabel={t('settings.retry')} onRetry={() => void load()} /></main>;
  return <main className={`mova-page mova-settings-page mova-services-page${form ? ' is-editing' : ''}`}>
    <ScreenHeader {...(form ? {} : { title: t('navigation.settings') })} onBack={()=>form ? setForm(null) : navigate(operatorUrl(businessId,'settings'))}
      {...(form ? { trailing: <Button type="button" variant="secondary" onClick={()=>navigate(operatorUrl(businessId,'settings/profile/preview'))}>{t('settings.preview')}</Button> } : {})}/>
    <p className="mova-services-page__description">{t('settings.serviceSubtitle')}</p>
    {!form && <header className="mova-services-page__header"><h1>{t('settings.services')}</h1><Button leadingIcon="plus" onClick={()=>setForm(blank)}>{t('settings.addAction')}</Button></header>}
    {error && <ErrorState title={t('settings.saveError')} retryLabel={t('settings.retry')} onRetry={() => void load()} />}
    {services.length === 0 && !form && <EmptyState title={t('settings.noServices')} />}
    <ul className="mova-service-list">{services.map((service) => {
      const serviceOverrides=overrides.filter((entry)=>entry.service_id===service.id);
      const customOverrides=serviceOverrides.filter((entry)=>entry.price_minor_override!==null||entry.duration_minutes_override!==null);
      const overrideLocationNames=customOverrides.map((entry)=>locations.find((location)=>location.id===entry.location_id)?.name).filter((value):value is string=>Boolean(value));
      return <li key={service.id}>
      <div className="mova-service-list__top"><span><strong>{service.name}</strong><small>{service.category}</small></span><strong>{formatMoney(service.base_price_minor)}</strong></div>
      <span>{service.duration_minutes} {t('settings.minutes')} · {service.buffer_minutes} {t('settings.bufferShort')}</span>
      <div className="mova-service-list__deposit"><span>{t('settings.depositLabel')}</span><strong>{service.deposit_type === 'none' ? t('settings.noDeposit') : service.deposit_type === 'fixed' ? formatMoney(service.deposit_value) : `${service.deposit_value / 100}%`}</strong></div>
      {locations.length>0&&<div className="mova-service-list__pricing"><strong>{t('settings.locationPricing')}</strong><span>{overrideLocationNames.length?`${overrideLocationNames.join(', ')} · ${t('settings.overridesApplied')}`:t('settings.baseAtLocations',{count:locations.length})}</span></div>}
      <div className="mova-service-list__footer"><span>{t('settings.bookingPage')}</span><strong>{t(`settings.status.${service.status}`)}</strong></div>
      <div className="mova-photo-actions"><Button variant="secondary" onClick={() => edit(service)}>{t('settings.edit')}</Button><Button variant="ghost" onClick={() => void setStatus(service)}>{service.status === 'active' ? t('settings.deactivate') : t('settings.activate')}</Button></div>
    </li>;})}</ul>
    {form ? <Card className="mova-service-form"><form className="mova-form-stack" onSubmit={save}>
      <h1>{t(form.id ? 'settings.editService' : 'settings.addService')}</h1>
      <TextField label={t('settings.serviceName')} required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} />
      <TextField label={t('settings.category')} required maxLength={80} value={form.category} onChange={(event) => setForm({ ...form, category: event.currentTarget.value })} />
      <div className="mova-service-numbers mova-service-form__numbers"><TextField label={t('settings.duration')} type="number" min="5" max="1440" step="5" required value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: Number(event.currentTarget.value) })} /><TextField label={t('settings.buffer')} type="number" min="0" max="1440" step="5" required value={form.buffer_minutes} onChange={(event) => setForm({ ...form, buffer_minutes: Number(event.currentTarget.value) })} /><TextField label={t('settings.price')} required inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.currentTarget.value })} /></div>
      <section className="mova-service-form__deposit"><Toggle label={t('settings.deposit')} checked={form.deposit_type !== 'none'} onChange={(value)=>setForm({...form,deposit_type:value?'fixed':'none',deposit:value?form.deposit:''})}/>
        {form.deposit_type !== 'none' && <div className="mova-service-form__deposit-fields"><div role="group" aria-label={t('settings.deposit')} className="mova-service-form__deposit-kind"><button type="button" aria-pressed={form.deposit_type==='fixed'} onClick={()=>setForm({...form,deposit_type:'fixed'})}>$</button><button type="button" aria-pressed={form.deposit_type==='percent'} onClick={()=>setForm({...form,deposit_type:'percent'})}>%</button></div><TextField label={form.deposit_type === 'fixed' ? t('settings.depositAmount') : t('settings.depositPercent')} required inputMode="decimal" value={form.deposit} onChange={(event) => setForm({ ...form, deposit: event.currentTarget.value })} /></div>}
        <p>{t('settings.depositLocationNote')}</p>
      </section>
      <section className="mova-service-form__locations"><h2>{t('settings.locationOverrides')}</h2><div className="mova-service-form__location-list">{locations.map((location)=>{const value=form.locationOverrides[location.id]??{enabled:false,price:'',duration:''};return <div className="mova-service-form__location" key={location.id}><label><input type="checkbox" checked={value.enabled} onChange={(event)=>setForm({...form,locationOverrides:{...form.locationOverrides,[location.id]:{...value,enabled:event.target.checked}}})}/><span><strong>{location.name}</strong><small>{value.enabled?t('settings.locationPricing'):t('settings.baseAtLocations',{count:1})}</small></span></label>{value.enabled&&<div className="mova-form-grid"><TextField label={t('settings.overridePrice')} inputMode="decimal" value={value.price} onChange={(event)=>setForm({...form,locationOverrides:{...form.locationOverrides,[location.id]:{...value,price:event.target.value}}})}/><TextField label={t('settings.overrideDuration')} type="number" min="5" max="1440" value={value.duration} onChange={(event)=>setForm({...form,locationOverrides:{...form.locationOverrides,[location.id]:{...value,duration:event.target.value}}})}/></div>}</div>;})}</div>{locations.length===0&&<p>{t('settings.locationOverridesLater')}</p>}</section>
      <Toggle label={t('settings.bookable')} description={t('settings.bookableDescription')} checked={form.status==='active'} onChange={(value)=>setForm({...form,status:value?'active':'inactive'})}/>
      {error && <p role="alert">{t('settings.saveError')}</p>}
      <footer className="mova-service-form__actions"><Button type="button" variant="secondary" onClick={() => setForm(null)}>{t('settings.cancel')}</Button><Button type="submit" loading={loading}>{t('settings.saveService')}</Button></footer>
    </form></Card> : services.length===0 ? <Button onClick={() => setForm(blank)}>{t('settings.addService')}</Button> : null}
  </main>;
}

function parseMoney(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number(`${match[2] ?? ''}00`.slice(0, 2));
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}
function formatMoney(amount: number) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount / 100); }
function formatMoneyInput(amount: number) { return (amount / 100).toFixed(2); }
