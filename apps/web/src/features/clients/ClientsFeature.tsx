import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, Chip, EmptyState, ErrorState, Icon, IconButton, ScreenHeader, TextField } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { displayId, displayIdLabel } from '../../lib/display-ids';

type Client={id:string;client_number:number;display_name:string;email:string|null;phone:string|null;preferred_locale:string;source:string;marketing_opted_out:boolean;last_visit_at:string|null;visit_count:number;last_service_name?:string|null};
type ImportMatch={id:string;display_name:string};
type ImportPreview={name:string;match_count:number;matches:ImportMatch[];decision:string|null;target_client_id?:string};
function parseCsv(text:string):string[][]{const table:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell.replace(/\r$/,''));table.push(row);row=[];cell='';}else cell+=ch;}if(cell||row.length){row.push(cell.replace(/\r$/,''));table.push(row);}return table;}
export function ClientsDirectory() {
  const { t, i18n } = useTranslation();
  const { client, businessId, loading } = useArtistBusiness();
  const [rows, setRows] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'due' | 'new'>('all');
  const [error, setError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dataLoading, setDataLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    if (!client || !businessId) return;
    setDataLoading(true);
    const { data: { session } } = await client.auth.getSession();
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-crud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, 'x-mova-artist-business-id': businessId },
        body: JSON.stringify({ action: 'list' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error('CLIENT_LIST_FAILED');
      const clients = (payload.data ?? []) as Client[];
      const { data: appointments, error: visitsError } = await client.from('mova_appointments')
        .select('client_id,service_name_snapshot,starts_at').eq('artist_business_id', businessId).eq('status', 'completed')
        .order('starts_at', { ascending: false }).limit(500);
      const lastServiceByClient = new Map<string, string>();
      if (!visitsError) for (const appointment of appointments ?? []) {
        if (appointment.client_id && !lastServiceByClient.has(appointment.client_id)) lastServiceByClient.set(appointment.client_id, appointment.service_name_snapshot);
      }
      setRows(clients.map((row) => ({ ...row, last_service_name: lastServiceByClient.get(row.id) ?? null })));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => { void load(); }, [client, businessId]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !businessId) return;
    const { data: { session } } = await client.auth.getSession();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-crud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, 'x-mova-artist-business-id': businessId },
      body: JSON.stringify({ action: 'create', display_name: name, email, phone }),
    });
    if (response.ok) {
      const payload = await response.json();
      setAddOpen(false);
      navigate(operatorUrl(businessId, `clients/${displayId('CID',payload.data.client_number)}`));
    } else setError(true);
  };

  const searched = rows.filter((row) => !search.trim() || [row.display_name, row.email, row.phone].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const due = (row: Client) => Boolean(row.last_visit_at && Date.now() - Date.parse(row.last_visit_at) >= 42 * 86_400_000);
  const filtered = searched.filter((row) => filter === 'all' || (filter === 'due' ? due(row) : row.visit_count === 0));
  const allCount = searched.length;
  const dueCount = searched.filter(due).length;
  const newCount = searched.filter((row) => row.visit_count === 0).length;

  if (loading || dataLoading) return <main className="mova-page mova-clients" aria-busy="true"><p role="status">{t('clients.loading')}</p></main>;
  if (error) return <main className="mova-page mova-clients"><ErrorState title={t('clients.error')} retryLabel={t('clients.retry')} onRetry={() => void load()} /></main>;

  return <main className="mova-page mova-clients">
    <header className="mova-clients__header">
      <h1>{t('clients.title')}</h1>
      <div className="mova-clients__actions">
        <Button variant="secondary" type="button" onClick={() => navigate(operatorUrl(businessId, 'clients/import'))}>{t('clients.import')}</Button>
        <IconButton label={t('clients.add')} icon="plus" onClick={() => setAddOpen((open) => !open)} />
      </div>
    </header>
    <div className="mova-clients__search-wrap"><Icon name="search" size={20}/><TextField className="mova-clients__search" type="search" label={t('clients.search')} placeholder={t('clients.search')} aria-label={t('clients.search')} value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></div>
    <div className="mova-clients__filters" role="group" aria-label={t('clients.filters')}>
      <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>{t('clients.filterAll', { count: allCount })}</Chip>
      <Chip selected={filter === 'due'} onClick={() => setFilter('due')}>{t('clients.filterDue', { count: dueCount })}</Chip>
      <Chip selected={filter === 'new'} onClick={() => setFilter('new')}>{t('clients.filterNew', { count: newCount })}</Chip>
    </div>
    {addOpen && <Card className="mova-clients__add"><form className="mova-form-stack" onSubmit={(event) => void add(event)}>
      <TextField label={t('clients.name')} required value={name} onChange={(event) => setName(event.currentTarget.value)} />
      <TextField label={t('clients.email')} type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
      <TextField label={t('clients.phone')} value={phone} onChange={(event) => setPhone(event.currentTarget.value)} />
      <Button type="submit">{t('clients.save')}</Button>
    </form></Card>}
    {!filtered.length ? <EmptyState title={t('clients.empty')} /> : <Card className="mova-clients__list">
      <ul>{filtered.map((row) => <li key={row.id}>
        <Link to={operatorUrl(businessId, `clients/${displayId('CID',row.client_number)}`)} className={`mova-client-row${row.marketing_opted_out ? ' mova-client-row--opted-out' : ''}`}>
          <Avatar label={row.display_name} initials={row.display_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()} size={56} />
          <span className="mova-client-row__copy"><strong>{row.display_name}</strong><small>{displayIdLabel('CID',row.client_number)} · {row.last_service_name ?? (row.visit_count ? `${row.visit_count} ${t('clients.visits')}` : t('clients.noVisits'))}{row.last_visit_at ? ` · ${new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(new Date(row.last_visit_at))}` : ''}{row.marketing_opted_out ? ` · ${t('clients.optedOut')}` : ''}</small></span>
          {due(row) ? <span className="mova-client-row__badge">{t('clients.rebookDue')}</span> : row.visit_count === 0 ? <span className="mova-client-row__badge mova-client-row__badge--new">{t('clients.filterNewLabel')}</span> : row.last_visit_at && new Date(row.last_visit_at).toDateString() === new Date().toDateString() ? <span className="mova-client-row__trailing">{t('clients.todayLabel')}</span> : null}
        </Link>
      </li>)}</ul>
    </Card>}
  </main>;
}

export { ClientDetail, VisitNotesEditor } from './ClientScreens';

export function ClientImport(){const{t}=useTranslation();const{client,businessId}=useArtistBusiness();const[rows,setRows]=useState<Record<string,string>[]>([]);const[preview,setPreview]=useState<ImportPreview[]>([]);const[error,setError]=useState(false);const[done,setDone]=useState(false);const[idempotencyKey,setIdempotencyKey]=useState('');const read=async(file:File)=>{const parsed=parseCsv(await file.text());const header=parsed[0]??[];const dataRows=parsed.slice(1);const keys=header.map(x=>x.trim().toLowerCase());setRows(dataRows.filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(row.map((value,i)=>[keys[i]??`column_${i}`,value.trim()]))));setPreview([]);setDone(false);setIdempotencyKey(crypto.randomUUID());};
 const call=async(action:string)=>{if(!client||!businessId)return;const{data:{session}}=await client.auth.getSession();const r=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-import`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token}`,'x-mova-artist-business-id':businessId,'Idempotency-Key':idempotencyKey},body:JSON.stringify({action,rows:rows.map((r,i)=>({...r,decision:preview[i]?.decision,target_client_id:preview[i]?.decision==='merge'?(preview[i]?.target_client_id??preview[i]?.matches?.[0]?.id):undefined}))})});const j=await r.json();if(!r.ok){setError(true);return;}if(action==='preview')setPreview(j.data.preview);else setDone(true);};
 return <main className="mova-page"><ScreenHeader title={t('clients.import')} onBack={()=>history.back()}/><h1>{t('clients.import')}</h1><Card><p>{t('clients.importDescription')}</p><TextField label={t('clients.csvFile')} type="file" accept=".csv,text/csv" onChange={e=>{const f=e.target.files?.[0];if(f)void read(f);}}/><p>{rows.length} {t('clients.rows')}</p><Button type="button" disabled={!rows.length} onClick={()=>void call('preview')}>{t('clients.previewImport')}</Button></Card>{error&&<p role="alert">{t('clients.error')}</p>}{preview.length>0&&<><p>{t('clients.importedNoConsent')}</p><p>{t('clients.importCounts',{newCount:preview.filter(p=>p.match_count===0).length,exactCount:preview.filter(p=>p.match_count===1).length,reviewCount:preview.filter(p=>p.match_count>1).length})}</p>{preview.map((p,i)=><Card key={i}><strong>{p.name}</strong><p>{p.match_count===0?t('clients.newClient'):p.match_count===1?t('clients.exactDuplicate'):t('clients.ambiguousDuplicate')}</p>{p.match_count>1&&<><label className="mova-field"><span>{t('clients.decision')}</span><select onChange={e=>{setPreview(old=>old.map((x,j)=>j===i?{...x,decision:e.target.value}:x));setIdempotencyKey(crypto.randomUUID());}}><option value="">{t('clients.choose')}</option><option value="merge">{t('clients.merge')}</option><option value="keep_both">{t('clients.keepBoth')}</option></select></label>{p.decision==='merge'&&<label className="mova-field"><span>{t('clients.mergeTarget')}</span><select required value={p.target_client_id??''} onChange={e=>{setPreview(old=>old.map((x,j)=>j===i?{...x,target_client_id:e.target.value}:x));setIdempotencyKey(crypto.randomUUID());}}><option value="">{t('clients.choose')}</option>{p.matches.map(match=><option key={match.id} value={match.id}>{match.display_name}</option>)}</select></label>}</>}</Card>)}<Button type="button" disabled={preview.some(p=>p.match_count>1&&(!p.decision||(p.decision==='merge'&&!p.target_client_id)))} onClick={()=>void call('commit')}>{t('clients.commitImport')}</Button></>}{done&&<p role="status">{t('clients.importComplete')}</p>}</main>;
}

