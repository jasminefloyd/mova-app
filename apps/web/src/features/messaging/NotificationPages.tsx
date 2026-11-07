import {useCallback,useEffect,useState} from 'react';
import {useNavigate} from 'react-router';
import {useTranslation} from 'react-i18next';
import {Button,Card,EmptyState,ErrorState,ScreenHeader,Toggle} from '../../components';
import {operatorUrl} from '../../app/operator-url';
import {useArtistBusiness} from '../settings/useArtistBusiness';
import type {createMovaSupabaseClient} from '../../lib/supabase';

type Preferences={in_app:boolean;email:boolean;push:boolean};
type InboxItem={id:string;event_type:string;title_key:string;body_key:string;payload:Record<string,string>;read_at:string|null;created_at:string};
async function callFunction<T=Record<string,unknown>>(client:ReturnType<typeof createMovaSupabaseClient>|null,businessId:string,name:string,payload:Record<string,unknown>):Promise<T>{
 if(!client)throw new Error('SUPABASE_UNAVAILABLE');
 const {data:result,error}=await client.functions.invoke<{data:T;error?:{code?:string}|null}>(name,{body:payload,headers:{'x-mova-artist-business-id':businessId}});
 if(error||!result)throw new Error(result?.error?.code??'REQUEST_FAILED');return result.data;
}
export function NotificationSettingsPage(){
 const{t}=useTranslation();const navigate=useNavigate();const{client,businessId,loading:identityLoading}=useArtistBusiness();const[prefs,setPrefs]=useState<Preferences>({in_app:true,email:true,push:false});const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');
 const load=useCallback(async()=>{if(!client||!businessId)return;setLoading(true);setError('');try{const data=await callFunction<{preferences?:Partial<Preferences>}>(client,businessId,'messaging-settings',{action:'status'});setPrefs({...prefs,...data.preferences});}catch{setError(t('messaging.loadError'));}finally{setLoading(false);}},[client,businessId,t]);
 useEffect(()=>{void load();},[load]);
 const save=async(next:Preferences)=>{setPrefs(next);setBusy(true);setError('');setNotice('');try{await callFunction(client,businessId??'','messaging-settings',{action:'preferences',preferences:next});setNotice(t('messaging.saved'));}catch{setError(t('messaging.saveError'));await load();}finally{setBusy(false);}};
 return <main className="mova-page mova-messaging-page"><ScreenHeader title={t('messaging.settingsTitle')} onBack={()=>navigate(operatorUrl(businessId,'settings'))} backLabel={t('settings.close')}/><h1>{t('messaging.settingsTitle')}</h1>
 {identityLoading||loading?<p role="status" aria-busy="true">{t('messaging.loading')}</p>:error?<ErrorState title={error} retryLabel={t('messaging.retry')} onRetry={()=>void load()}/>:<>
  <p className="mova-messaging-page__intro">{t('messaging.settingsIntro')}</p><Card className="mova-messaging-settings"><Toggle label={t('messaging.inApp')} description={t('messaging.inAppDescription')} checked={prefs.in_app} disabled={busy} onChange={value=>void save({...prefs,in_app:value})}/><Toggle label={t('messaging.email')} description={t('messaging.emailDescription')} checked={prefs.email} disabled={busy} onChange={value=>void save({...prefs,email:value})}/><Toggle label={t('messaging.push')} description={t('messaging.pushDescription')} checked={false} disabled onChange={()=>undefined}/></Card>
  <Card className="mova-messaging-settings"><h2>{t('messaging.deliveryStatus')}</h2><p>{t('messaging.providersOff')}</p><Button variant="secondary" onClick={()=>navigate(operatorUrl(businessId,'notifications'))}>{t('messaging.openInbox')}</Button></Card>
  {notice&&<p role="status">{notice}</p>}
 </>}
 </main>;
}
export function NotificationInboxPage(){
 const{t,i18n}=useTranslation();const navigate=useNavigate();const{client,businessId,loading:identityLoading}=useArtistBusiness();const[items,setItems]=useState<InboxItem[]>([]);const[loading,setLoading]=useState(true);const[error,setError]=useState(false);
 const load=useCallback(async()=>{if(!client||!businessId)return;setLoading(true);setError(false);try{const data=await callFunction<{items?:InboxItem[]}>(client,businessId,'notification-inbox',{action:'list'});setItems(data.items??[]);}catch{setError(true);}finally{setLoading(false);}},[client,businessId]);useEffect(()=>{void load();},[load]);
 const markRead=async(item:InboxItem)=>{try{await callFunction(client,businessId??'','notification-inbox',{action:'read',id:item.id});setItems(rows=>rows.map(row=>row.id===item.id?{...row,read_at:new Date().toISOString()}:row));}catch{setError(true);}};
 return <main className="mova-page mova-inbox-page"><ScreenHeader title={t('messaging.inbox')} onBack={()=>navigate(operatorUrl(businessId,''))} backLabel={t('messaging.back')}/><h1>{t('messaging.inbox')}</h1>
 {identityLoading||loading?<p role="status" aria-busy="true">{t('messaging.loading')}</p>:error?<ErrorState title={t('messaging.loadError')} retryLabel={t('messaging.retry')} onRetry={()=>void load()}/>:items.length===0?<EmptyState title={t('messaging.inboxEmpty')} detail={t('messaging.inboxEmptyDetail')}/>:<Card className="mova-inbox-list"><ul>{items.map(item=><li key={item.id} className={item.read_at?'is-read':'is-unread'}><button type="button" onClick={()=>void markRead(item)} aria-label={t('messaging.markRead')}><span><strong>{t(item.title_key,{defaultValue:item.title_key})}</strong><small>{t(item.body_key,{defaultValue:item.body_key})}</small><time dateTime={item.created_at}>{new Intl.DateTimeFormat(i18n.resolvedLanguage,{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.created_at))}</time></span>{!item.read_at&&<span className="mova-inbox-dot" aria-hidden="true"/>}</button></li>)}</ul></Card>}
 </main>;
}
