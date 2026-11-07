import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { QrCode } from './QrCode';

type Profile={display_name:string;handle:string;is_published:boolean;photo_variants:Record<string,Record<string,string>>;photoUrl?:string};
export function ShowMyQrPage(){
  const navigate=useNavigate();const{t}=useTranslation();const{client,businessId,loading:identityLoading}=useArtistBusiness();const[profile,setProfile]=useState<Profile|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState(false);const[notice,setNotice]=useState('');
  const load=useCallback(async()=>{if(!client||!businessId){setError(true);setLoading(false);return;}setLoading(true);setError(false);const{data,error:queryError}=await client.from('mova_artist_profiles').select('display_name,handle,is_published,photo_variants').eq('artist_business_id',businessId).maybeSingle();if(queryError){setError(true);}else if(data){const variants=(data.photo_variants??{}) as Record<string,Record<string,string>>;const path=variants.profile?.['512']??variants.profile?.['256']??variants.profile?.['128'];const signed=path?await client.storage.from('mova_profile_photos').createSignedUrl(path,300):null;const photoUrl=signed?.data?.signedUrl;setProfile({...data,photo_variants:variants,...(photoUrl?{photoUrl}:{})});}setLoading(false);},[client,businessId]);
  useEffect(()=>{if(!identityLoading)void load();},[identityLoading,load]);
  const base=typeof window==='undefined'?'https://mova-beauty.co':window.location.hostname==='localhost'?window.location.origin:'https://mova-beauty.co';const profileUrl=profile?`${base}/s/${encodeURIComponent(profile.handle)}`:'';
  const shareLink=async()=>{try{if(navigator.share)await navigator.share({title:profile?.display_name??'mova.',url:profileUrl});else{await navigator.clipboard.writeText(profileUrl);setNotice(t('identity.linkCopied'));}}catch{setNotice(t('identity.shareUnavailable'));}};
  const shareImage=async()=>{const qr=document.querySelector<HTMLImageElement>('.mova-show-qr .mova-generated-qr img');if(!qr||!profile)return;try{
    const canvas=document.createElement('canvas');canvas.width=900;canvas.height=1200;const context=canvas.getContext('2d');if(!context)throw new Error();const css=getComputedStyle(document.documentElement);context.fillStyle=css.getPropertyValue('--forest').trim();context.fillRect(0,0,900,1200);context.fillStyle=css.getPropertyValue('--surface').trim();context.textAlign='center';context.font='800 72px Manrope';context.fillText('mova.',450,100);context.fillText(profile.display_name,450,220);context.drawImage(qr,180,270,540,540);context.fillStyle=css.getPropertyValue('--mint').trim();context.font='500 28px "DM Sans"';context.fillText(profileUrl,450,880);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob((value)=>value?resolve(value):reject(new Error()),'image/png'));const file=new File([blob],'mova-qr.png',{type:'image/png'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:profile.display_name});}else{const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='mova-qr.png';link.click();URL.revokeObjectURL(link.href);}
  }catch{setNotice(t('identity.shareUnavailable'));}};
  return <main className="mova-show-qr">
    <IconButton label={t('identity.close')} icon="close" onClick={()=>navigate(operatorUrl(businessId,'settings'))}/><p className="mova-wordmark">mova.</p>
    {loading?<p role="status" aria-busy="true">{t('identity.loading')}</p>:error?<section role="alert"><p>{t('identity.profileLoadError')}</p><Button variant="on-dark" onClick={()=>void load()}>{t('identity.retry')}</Button></section>:!profile?.is_published?<section><h1>{t('identity.publishFirst')}</h1><p>{t('identity.publishFirstDetail')}</p></section>:<>
      <div className="mova-show-qr__profile">{profile.photoUrl?<img className="mova-show-qr__avatar" src={profile.photoUrl} alt=""/>:<span className="mova-show-qr__avatar" aria-hidden="true">{profile.display_name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span>}<h1>{profile.display_name}</h1><p>{t('identity.scanToBook')}</p></div>
      <QrCode value={profileUrl} label={t('identity.artistQr')} size={420} className="mova-show-qr__code"/><p className="mova-show-qr__url">{base}/s/{profile.handle}</p>
      <footer className="mova-show-qr__actions"><Button variant="on-dark" onClick={()=>void shareLink()}>{t('identity.shareLink')}</Button><Button variant="on-dark" onClick={()=>void shareImage()}>{t('identity.shareImage')}</Button></footer>
    </>}{notice&&<p role="status" className="mova-show-qr__notice">{notice}</p>}
  </main>;
}
export default ShowMyQrPage;
