import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, LocationTag } from '../../components';
import { publicEnv } from '../../lib/env';
import type { PublicArtist } from '../showcase/PublicArtistPage';

const endpoint=(name:string)=>`${publicEnv.VITE_SUPABASE_URL}/functions/v1/${name}`;
export function ScanLandingPage(){
  const{handle=''}=useParams();const{t,i18n}=useTranslation();const[artist,setArtist]=useState<PublicArtist|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState(false);
  useEffect(()=>{let active=true;const locale=i18n.resolvedLanguage==='es-US'?'es-US':'en-US';void(async()=>{try{
    const response=await fetch(endpoint('public-artist'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({handle,tab:'looks',locale})});const envelope=await response.json();if(!response.ok||!envelope.data)throw new Error();if(active)setArtist(envelope.data as PublicArtist);
    const session=[...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');await fetch(endpoint('scan-landing'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({handle,scan_session:session})});
  }catch{if(active)setError(true);}finally{if(active)setLoading(false);}})();return()=>{active=false;};},[handle,i18n.resolvedLanguage]);
  if(loading)return <main className="mova-page mova-scan-landing" aria-busy="true"><p role="status">{t('identity.loading')}</p></main>;
  if(error||!artist)return <main className="mova-page mova-scan-landing"><EmptyState title={t('identity.artistUnavailable')} detail={t('identity.artistUnavailableDetail')}/></main>;
  const photo=artist.profile.photo_urls.profile?.['512'];const bookUrl=`/a/${encodeURIComponent(artist.profile.handle)}/book`;const signInUrl=`/signin?artist=${encodeURIComponent(artist.profile.handle)}&returnTo=${encodeURIComponent(`/a/${artist.profile.handle}`)}`;
  return <main className="mova-page mova-scan-landing">
    <p className="mova-wordmark">mova.</p><section className="mova-scan-landing__hero">
      {photo?<img src={photo} alt=""/>:<span className="mova-scan-landing__avatar" aria-hidden="true">{artist.profile.display_name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span>}
      <h1>{artist.profile.display_name}</h1><p>@{artist.profile.handle}</p>
    </section>
    {artist.profile.specialties.length>0&&<div className="mova-chip-list" aria-label={t('showcase.specialties')}>{artist.profile.specialties.map(item=><span className="mova-chip mova-chip--static" key={item}>{item}</span>)}</div>}
    <Button type="button" onClick={()=>window.location.assign(bookUrl)}>{t('identity.bookWith',{name:artist.profile.display_name.split(' ')[0]})}</Button>
    <section className="mova-scan-landing__card"><h2>{t('identity.saveArtistCard',{name:artist.profile.display_name.split(' ')[0]})}</h2><p>{t('identity.saveArtistCardDetail',{name:artist.profile.display_name.split(' ')[0]})}</p><p>{t('identity.walletHomeScreenFallback')}</p></section>
    <Button type="button" variant="secondary" onClick={()=>window.location.assign(signInUrl)}>{t('identity.addToStylists')}</Button>
    <Card className="mova-scan-landing__locations"><h2>{t('identity.locations')}</h2>{artist.locations.length?artist.locations.map((location,index)=><LocationTag key={location.id} name={location.name} index={index%2===0?1:2}/>):<p>{t('identity.noLocations')}</p>}</Card>
    <div className="mova-scan-landing__links"><Link to={`/a/${encodeURIComponent(artist.profile.handle)}?tab=looks`}>{t('showcase.looks')}</Link><Link to={`/a/${encodeURIComponent(artist.profile.handle)}?tab=services`}>{t('showcase.services')}</Link></div>
  </main>;
}
export default ScanLandingPage;
