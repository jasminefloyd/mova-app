import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QRDisplay } from '../../components';

export function QrCode({ value, label, size=300, className='' }: {value:string;label:string;size?:number;className?:string}) {
  const [source,setSource]=useState('');const[failed,setFailed]=useState(false);
  useEffect(()=>{let live=true;setSource('');setFailed(false);const style=getComputedStyle(document.documentElement);const dark=style.getPropertyValue('--forest').trim();const light=style.getPropertyValue('--surface').trim();
    void QRCode.toDataURL(value,{errorCorrectionLevel:'M',margin:4,width:size,color:{dark,light}}).then((result)=>{if(live)setSource(result);}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};
  },[value,size]);
  return <QRDisplay label={label}><span className={`mova-generated-qr ${className}`}>{source?<img src={source} alt="" width={size} height={size}/>:failed?<span role="status">QR unavailable</span>:<span role="status" aria-label="Generating QR code"/>}</span></QRDisplay>;
}
