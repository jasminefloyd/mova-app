import {useCallback,useEffect,useState} from 'react';
import {useNavigate} from 'react-router';
import {useTranslation} from 'react-i18next';
import {Card,EmptyState,ErrorState,ScreenHeader} from '../../components';
import {operatorUrl} from '../../app/operator-url';
import {useArtistBusiness} from '../settings/useArtistBusiness';
import type {createMovaSupabaseClient} from '../../lib/supabase';

type InboxItem={id:string;event_type:string;title_key:string;body_key:string;payload:Record<string,string>;read_at:string|null;created_at:string};
async function callFunction<T=Record<string,unknown>>(client:ReturnType<typeof createMovaSupabaseClient>|null,businessId:string,name:string,payload:Record<string,unknown>):Promise<T>{
 if(!client)throw new Error('SUPABASE_UNAVAILABLE');
 const {data:result,error}=await client.functions.invoke<{data:T;error?:{code?:string}|null}>(name,{body:payload,headers:{'x-mova-artist-business-id':businessId}});
 if(error||!result)throw new Error(result?.error?.code??'REQUEST_FAILED');return result.data;
}
export { NotificationSettingsPage } from './NotificationSettingsPage';
export function NotificationInboxPage(){
 const{t,i18n}=useTranslation();const navigate=useNavigate();const{client,businessId,loading:identityLoading}=useArtistBusiness();const[items,setItems]=useState<InboxItem[]>([]);const[loading,setLoading]=useState(true);const[error,setError]=useState(false);
 const load=useCallback(async()=>{if(!client||!businessId)return;setLoading(true);setError(false);try{const data=await callFunction<{items?:InboxItem[]}>(client,businessId,'notification-inbox',{action:'list'});setItems(data.items??[]);}catch{setError(true);}finally{setLoading(false);}},[client,businessId]);useEffect(()=>{void load();},[load]);
 const markRead=async(item:InboxItem)=>{try{await callFunction(client,businessId??'','notification-inbox',{action:'read',id:item.id});setItems(rows=>rows.map(row=>row.id===item.id?{...row,read_at:new Date().toISOString()}:row));}catch{setError(true);}};
 return <main className="mova-page mova-inbox-page"><ScreenHeader title={t('messaging.inbox')} onBack={()=>navigate(operatorUrl(businessId,''))} backLabel={t('messaging.back')}/><h1>{t('messaging.inbox')}</h1>
 {identityLoading||loading?<p role="status" aria-busy="true">{t('messaging.loading')}</p>:error?<ErrorState title={t('messaging.loadError')} retryLabel={t('messaging.retry')} onRetry={()=>void load()}/>:items.length===0?<EmptyState title={t('messaging.inboxEmpty')} detail={t('messaging.inboxEmptyDetail')}/>:<Card className="mova-inbox-list"><ul>{items.map(item=><li key={item.id} className={item.read_at?'is-read':'is-unread'}><button type="button" onClick={()=>void markRead(item)} aria-label={t('messaging.markRead')}><span><strong>{t(item.title_key,{defaultValue:item.title_key})}</strong><small>{t(item.body_key,{defaultValue:item.body_key})}</small><time dateTime={item.created_at}>{new Intl.DateTimeFormat(i18n.resolvedLanguage,{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.created_at))}</time></span>{!item.read_at&&<span className="mova-inbox-dot" aria-hidden="true"/>}</button></li>)}</ul></Card>}
 </main>;
}
