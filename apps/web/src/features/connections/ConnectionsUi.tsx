import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Sheet } from '../../components';
import { CONNECTION_LOGOS, type ConnectionKey, type ConnectionPill } from './connections-api';
import './connections.css';

// Shared pieces of the Connections screens (CN2–CN8). Status is always written out, never colour alone.

export function ConnectionLogo({ name }: { name: ConnectionKey }) {
  return <span className={`mova-conn-logo mova-conn-logo--${name}`} aria-hidden="true"><img src={CONNECTION_LOGOS[name]} alt="" width={name === 'stripe' ? 44 : 26} height={name === 'stripe' ? 44 : 26} /></span>;
}

export function StatusPill({ pill }: { pill: ConnectionPill }) {
  const { t } = useTranslation();
  return <span className={`mova-conn-pill is-${pill.tone}`}>{pill.tone === 'on' && <Icon name="check" size={12} />}{t(pill.labelKey)}</span>;
}

export function ConnectionRow({ name, title, pill, to }: { name: ConnectionKey; title: string; pill: ConnectionPill; to: string }) {
  const { t } = useTranslation();
  return <Link className="mova-conn-row" to={to} aria-label={`${title}, ${t(pill.labelKey)}`}>
    <ConnectionLogo name={name} />
    <strong className="mova-conn-row__name">{title}</strong>
    <StatusPill pill={pill} />
    <Icon name="chevron" size={18} />
  </Link>;
}

/** The dark card at the top of a connected page: which account Mova is using. */
export function AccountCard({ name, title, detail, pill, label }: { name: ConnectionKey; title: string; detail: string; pill?: ConnectionPill; label: string }) {
  return <section className="mova-conn-account" aria-label={label}>
    <ConnectionLogo name={name} />
    <span className="mova-conn-account__who"><strong>{title}</strong><span>{detail}</span></span>
    {pill && <StatusPill pill={pill} />}
  </section>;
}

export function UsesCard({ title, items, children }: { title: string; items: ReactNode[]; children?: ReactNode }) {
  return <section className="mova-conn-card" aria-label={title}>
    <h2>{title}</h2>
    <ul className="mova-conn-uses">{items.map((item, index) => <li key={index}><Icon name="check" size={18} /><span>{item}</span></li>)}</ul>
    {children}
  </section>;
}

export function LinkRow({ title, detail, to }: { title: string; detail: string; to: string }) {
  return <Link to={to} className="mova-conn-linkrow"><span><strong>{title}</strong><span>{detail}</span></span><Icon name="chevron" size={18} /></Link>;
}

/** Confirms a disconnect and says what stops working before anything happens. */
export function DisconnectSheet({ open, title, body, confirm, busy, onClose, onConfirm }: { open: boolean; title: string; body: string; confirm: string; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return <Sheet open={open} title={title} closeLabel={t('connections.cancel')} onClose={onClose}>
    <div className="mova-conn-sheet">
      <p>{body}</p>
      <Button variant="secondary" className="mova-conn-danger" loading={busy} onClick={onConfirm}>{confirm}</Button>
      <Button variant="ghost" onClick={onClose} disabled={busy}>{t('connections.cancel')}</Button>
    </div>
  </Sheet>;
}
