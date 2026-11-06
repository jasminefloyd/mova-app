import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent, type InputHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';
import './components.css';

export type IconName = 'home' | 'calendar' | 'clients' | 'growth' | 'reports' | 'back' | 'close' | 'check' | 'clock' | 'plus' | 'chevron' | 'info' | 'sparkle' | 'message' | 'lock' | 'refresh' | 'location' | 'send' | 'user' | 'preview' | 'more' | 'photo' | 'search' | 'globe' | 'qr';
const iconIds: Record<Exclude<IconName, 'qr'>, string> = {
  home: '13', calendar: '14', clients: '15', growth: '16', reports: '17', back: '01', close: '06',
  check: '03', clock: '07', plus: '12', chevron: '04', info: '11', sparkle: '16', message: '21',
  lock: '10', refresh: '23', location: '30', send: '05', user: '28', preview: '31', more: '02', photo: '19', search: '20', globe: '25',
};

export function Icon({ name, label, size = 22 }: { name: IconName; label?: string; size?: number }) {
  if (name === 'qr') return <svg className="mova-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z"/><path d="M6 6h1v1H6zM17 6h1v1h-1zM6 17h1v1H6zM14 14h3v3h-3zM20 14v2M20 19v2M17 20h-3"/></svg>;
  return <img className="mova-icon" src={`/design-icons/icon-${iconIds[name]}.svg`} width={size} height={size} alt={label ?? ''} aria-hidden={label ? undefined : true} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'compact' | 'on-dark';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; leadingIcon?: IconName };
export function Button({ variant = 'primary', loading = false, disabled, children, leadingIcon, className = '', ...props }: ButtonProps) {
  return <button className={`mova-button mova-button--${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading ? <><span className="mova-button__loading-label" aria-hidden="true">{children}</span><span className="mova-spinner" role="status" aria-label="Loading" /></> : <>{leadingIcon && <Icon name={leadingIcon} size={18} />}{children}</>}
  </button>;
}

export function IconButton({ label, icon = 'close', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon?: IconName }) {
  return <button className={`mova-icon-button ${className}`} aria-label={label} {...props}><Icon name={icon} /></button>;
}

export function TextLink({ href, children }: PropsWithChildren<{ href: string }>) {
  return <a className="mova-text-link" href={href}>{children}</a>;
}

export function TextField({ label, hint, error, id, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return <label className="mova-field" htmlFor={fieldId}><span className="mova-field__label">{label}</span><input id={fieldId} className={`mova-input${className ? ` ${className}` : ''}${error ? ' is-invalid' : ''}`} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined} {...props} />
    {error ? <span className="mova-field__error" id={`${fieldId}-error`}><Icon name="info" size={16} />{error}</span> : hint && <span className="mova-field__hint" id={`${fieldId}-hint`}>{hint}</span>}
  </label>;
}

export function TextArea({ label, hint, error, maxLength, id, value, defaultValue, onChange, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [length, setLength] = useState(String(value ?? defaultValue ?? '').length);
  useEffect(() => { if (value !== undefined) setLength(String(value).length); }, [value]);
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (value === undefined) setLength(event.currentTarget.value.length);
    onChange?.(event);
  };
  return <label className="mova-field" htmlFor={fieldId}><span className="mova-field__label">{label}</span><textarea id={fieldId} className={`mova-input mova-textarea${error ? ' is-invalid' : ''}`} maxLength={maxLength} value={value} defaultValue={defaultValue} onChange={handleChange} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined} {...props} />
    {maxLength != null && <span className="mova-field__hint" aria-live="polite">{length}/{maxLength}</span>}{error ? <span className="mova-field__error" id={`${fieldId}-error`}>{error}</span> : hint && <span className="mova-field__hint" id={`${fieldId}-hint`}>{hint}</span>}
  </label>;
}

export function Toggle({ label, description, checked, onChange, disabled, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> & { label: string; description?: string; checked?: boolean; onChange?: (checked: boolean) => void }) {
  return <label className={`mova-toggle${disabled ? ' is-disabled' : ''}`}><span>{label}{description && <small>{description}</small>}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange?.(event.currentTarget.checked)} {...props} /><span className="mova-toggle__track" aria-hidden="true"><span /></span></label>;
}

export function Checkbox({ label, disabled = false, className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  return <label className={`mova-checkbox${disabled ? ' is-disabled' : ''} ${className}`}><input type="checkbox" disabled={disabled} {...props} /><span aria-hidden="true" />{label}</label>;
}

export function RadioCard({ name, value, label, description, checked, disabled = false, variant = 'outlined', onChange }: { name: string; value: string; label: string; description?: string; checked?: boolean; disabled?: boolean; variant?: 'outlined' | 'filled'; onChange?: (value: string) => void }) {
  return <label className={`mova-radio-card mova-radio-card--${variant}${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}><input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange?.(value)} /><span><strong>{label}</strong>{description && <small>{description}</small>}</span><span className="mova-radio-card__dot" aria-hidden="true" /></label>;
}

export function OptionGroup({ label, children }: PropsWithChildren<{ label: string }>) {
  return <div className="mova-option-group" role="radiogroup" aria-label={label}>{children}</div>;
}

export function Segmented({ label, options, value, onChange, disabled = false }: { label: string; options: string[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="mova-segmented" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option} disabled={disabled} aria-pressed={value === option} className={value === option ? 'is-selected' : ''} onClick={() => onChange(option)}>{option}</button>)}</div>;
}

export function Chip({ children, selected = false, onClick, disabled = false }: PropsWithChildren<{ selected?: boolean; onClick?: () => void; disabled?: boolean }>) {
  return <button className={`mova-chip${selected ? ' is-selected' : ''}`} type="button" aria-pressed={selected} disabled={disabled} onClick={onClick}>{children}</button>;
}

type StatusKind = 'confirmed' | 'pending' | 'request' | 'live' | 'needs-approval' | 'filled' | 'expired' | 'cancelled' | 'info';
export function StatusChip({ status, children }: PropsWithChildren<{ status: StatusKind }>) {
  const icon: IconName = status === 'confirmed' ? 'check' : status === 'pending' || status === 'request' ? 'clock' : status === 'filled' || status === 'expired' || status === 'cancelled' ? 'close' : 'info';
  return <span className={`mova-status mova-status--${status}`}>{status === 'live' ? <span className="mova-status__dot" aria-hidden="true" /> : <Icon name={icon} size={14} />}{children}</span>;
}

export function Badge({ children, label }: PropsWithChildren<{ label?: string }>) {
  return <span className="mova-badge" aria-label={label}>{children}</span>;
}

export function UnreadDot({ label }: { label: string }) {
  return <span className="mova-unread-dot" role="img" aria-label={label} />;
}

export function Card({ children, tone = 'default', className = '' }: PropsWithChildren<{ tone?: 'default' | 'inverse' | 'warm'; className?: string }>) {
  return <section className={`mova-card mova-card--${tone} ${className}`}>{children}</section>;
}

export function ListRow({ leading, title, subtitle, trailing, href }: { leading?: ReactNode; title: string; subtitle?: string; trailing?: ReactNode; href?: string }) {
  const content = <>{leading && <span className="mova-list-row__leading">{leading}</span>}<span className="mova-list-row__copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>{trailing && <span className="mova-list-row__trailing">{trailing}</span>}</>;
  return href ? <a className="mova-list-row" href={href}>{content}</a> : <div className="mova-list-row">{content}</div>;
}

export function DefinitionList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="mova-definition-list">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}

export function Avatar({ label, initials, size = 40, placeholder = false }: { label: string; initials?: string; size?: number; placeholder?: boolean }) {
  return <span className={`mova-avatar mova-avatar--${size}${placeholder ? ' mova-avatar--placeholder' : ''}`} role="img" aria-label={label}>{initials ?? (placeholder ? <span className="mova-avatar__silhouette" aria-hidden="true" /> : <Icon name="user" size={Math.round(size * 0.5)} />)}</span>;
}

export function SectionOverline({ children }: PropsWithChildren) { return <h2 className="mova-overline">{children}</h2>; }

export function KPITile({ label, value, delta, tone = 'default', onClick }: { label: string; value: string; delta?: string; tone?: 'default' | 'inverse'; onClick?: () => void }) {
  const content = <><span className="mova-kpi__label">{label}</span><strong>{value}</strong>{delta && <span className="mova-kpi__delta">{delta}</span>}</>;
  return onClick ? <button className={`mova-kpi mova-kpi--${tone}`} type="button" onClick={onClick}>{content}</button> : <div className={`mova-kpi mova-kpi--${tone}`}>{content}</div>;
}

export function MiniBarChart({ label, values, tableLabel = 'View data as a table', initialShowTable = false }: { label: string; values: Array<{ name: string; value: number }>; tableLabel?: string; initialShowTable?: boolean }) {
  const [showTable, setShowTable] = useState(initialShowTable);
  const max = Math.max(1, ...values.map((item) => item.value));
  return <figure className="mova-chart"><figcaption>{label}</figcaption><div className="mova-chart__bars" role="img" aria-label={`${label}. ${values.map((item) => `${item.name}: ${item.value}`).join(', ')}`}>
    {values.map((item, index) => <div className="mova-chart__column" key={item.name}><span className="mova-chart__bar" style={{ height: `${Math.max(4, (item.value / max) * 100)}%` }} data-current={index === values.length - 1 || undefined} /><small>{item.name}</small></div>)}
  </div><button type="button" className="mova-link-button" aria-expanded={showTable} onClick={() => setShowTable((shown) => !shown)}>{tableLabel}</button>
    {showTable && <table className="mova-data-table"><caption>{label}</caption><thead><tr><th scope="col">Period</th><th scope="col">Value</th></tr></thead><tbody>{values.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.value}</td></tr>)}</tbody></table>}
  </figure>;
}

export function Timeline({ entries }: { entries: Array<{ title: string; detail?: string; icon?: IconName }> }) {
  return <ol className="mova-timeline">{entries.map((entry, index) => <li key={`${entry.title}-${index}`}><span className="mova-timeline__icon"><Icon name={entry.icon ?? 'check'} size={16} /></span><span><strong>{entry.title}</strong>{entry.detail && <small>{entry.detail}</small>}</span></li>)}</ol>;
}

export function MessageBubble({ variant, children, label }: PropsWithChildren<{ variant: 'client' | 'ai' | 'artist' | 'system'; label?: string }>) {
  return <div className={`mova-message mova-message--${variant}`}>{label && <span className="mova-message__label">{label}</span>}<p>{children}</p></div>;
}

export function QRDisplay({ label = 'QR code', children }: PropsWithChildren<{ label?: string }>) {
  return <div className="mova-qr" role="img" aria-label={label}>{children ?? <span>QR artwork provided by the active feature</span>}</div>;
}

export function ClientCard({ name, artist, nextAppointment, children }: PropsWithChildren<{ name: string; artist: string; nextAppointment: string }>) {
  return <Card tone="inverse" className="mova-client-card"><span className="mova-wordmark">mova.</span><small>CLIENT CARD</small><strong>{name}</strong><span>With {artist}</span><span>{nextAppointment}</span><div>{children}</div></Card>;
}

export function StepperProgress({ current, total = 6, label }: { current: number; total?: number; label: string }) {
  return <div className="mova-stepper" aria-label={`${label} ${current} of ${total}`}><div aria-hidden="true">{Array.from({ length: total }, (_, index) => <span key={index} className={index < current ? 'is-done' : ''} />)}</div><small>{label} {current} of {total}</small></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="mova-state mova-empty-state"><span aria-hidden="true"><Icon name="sparkle" size={24} /></span><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}

export function ErrorState({ title, retryLabel, onRetry }: { title: string; retryLabel: string; onRetry: () => void }) {
  return <div className="mova-state mova-error-state" role="alert"><span aria-hidden="true"><Icon name="info" size={24} /></span><strong>{title}</strong><Button variant="secondary" onClick={onRetry}>{retryLabel}</Button></div>;
}

export function PermissionDeniedState({ title, detail }: { title: string; detail: string }) {
  return <div className="mova-state" role="status"><span aria-hidden="true"><Icon name="lock" size={24} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

export function OfflineBanner({ children }: PropsWithChildren) {
  return <div className="mova-offline" role="status"><Icon name="info" size={18} />{children}</div>;
}

export function Skeleton({ width = '100%', height = 16, rounded = false }: { width?: string; height?: number; rounded?: boolean }) {
  return <span className={`mova-skeleton${rounded ? ' is-rounded' : ''}`} style={{ width, height }} aria-hidden="true" />;
}

export function Toast({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="mova-toast" role="status" aria-live="polite"><span>{message}</span>{action && <button type="button" onClick={onAction}>{action}</button>}</div>;
}

export function LocationTag({ name, index = 1 }: { name: string; index?: 1 | 2 }) {
  return <span className={`mova-location mova-location--${index}`}><span aria-hidden="true" />{name}</span>;
}

export function HonestyBanner({ children, tone = 'inverse' }: PropsWithChildren<{ tone?: 'inverse' | 'warm' | 'soft' }>) {
  return <aside className={`mova-honesty mova-honesty--${tone}`}><Icon name="info" size={18} /><p>{children}</p></aside>;
}

export function ScreenHeader({ title, onBack, backLabel = 'Back', leadingIcon = 'back', trailing }: { title?: string; onBack?: () => void; backLabel?: string; leadingIcon?: IconName; trailing?: ReactNode }) {
  return <header className="mova-screen-header">{onBack ? <IconButton label={backLabel} icon={leadingIcon} onClick={onBack} /> : <span className="mova-screen-header__spacer" />}{title && <strong>{title}</strong>}<span className="mova-screen-header__trailing">{trailing}</span></header>;
}

export function Sheet({ open, title, closeLabel = 'Close', onClose, children }: PropsWithChildren<{ open: boolean; title: string; closeLabel?: string; onClose: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragStart = useRef<number | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const handleClose = () => { onClose(); };
  return <dialog ref={dialogRef} className="mova-sheet" aria-modal="true" aria-labelledby="mova-sheet-title" onCancel={(event) => { event.preventDefault(); handleClose(); }} onPointerDown={(event) => { dragStart.current = event.clientY; }} onPointerUp={(event) => { if (dragStart.current != null && event.clientY - dragStart.current > 80) handleClose(); dragStart.current = null; }}>
    <div className="mova-sheet__panel"><div className="mova-sheet__handle" aria-hidden="true"><span /></div><header><h2 id="mova-sheet-title">{title}</h2><IconButton label={closeLabel} onClick={handleClose} /></header><div className="mova-sheet__body">{children}</div></div>
  </dialog>;
}

export function DayStrip({ days, selected, onSelect, variant = 'booking', label = 'Choose a day' }: { days: Array<{ id: string; weekday: string; date: string; availability?: string; indicator?: boolean; disabled?: boolean }>; selected: string; onSelect: (id: string) => void; variant?: 'booking' | 'calendar'; label?: string }) {
  return <div className={`mova-day-strip${variant === 'calendar' ? ' mova-day-strip--calendar' : ''}`} role="group" aria-label={label}>{days.map((day) => <button type="button" key={day.id} disabled={day.disabled} aria-pressed={day.id === selected} className={day.id === selected ? 'is-selected' : ''} onClick={() => onSelect(day.id)}><span>{day.weekday}</span><strong>{day.date}</strong>{variant === 'calendar' ? day.indicator && <small className="mova-day-strip__indicator" aria-hidden="true" /> : <small>{day.disabled ? 'Full' : day.availability}</small>}</button>)}</div>;
}

export function TimeSlot({ label, selected, requestMode, disabled = false, onClick }: { label: string; selected?: boolean; requestMode?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className={`mova-time-slot${selected ? ' is-selected' : ''}${requestMode ? ' is-request' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>{label}{requestMode && <span className="mova-visually-hidden">Request</span>}</button>;
}

export function PhotoCrop({ preview = false, tips = [], children }: PropsWithChildren<{ preview?: boolean; tips?: string[] }>) {
  return <div className="mova-photo-crop">
    <div className={`mova-photo-crop__circle${preview ? ' has-preview' : ''}`} role="img" aria-label={preview ? 'Photo preview' : 'Empty photo crop area'}>
      {preview ? <Icon name="user" size={112} /> : <span className="mova-photo-crop__face-guide" aria-hidden="true"><span /><span /></span>}
    </div>
    <label>Zoom <input aria-label="Zoom photo" type="range" min="1" max="3" defaultValue="1" /></label>
    {preview && <div className="mova-photo-crop__small-preview"><Avatar label="Small-size photo preview" size={56} initials="AB" /><span><strong>Small-size preview</strong><small>How your photo looks at small sizes</small></span></div>}
    {tips.length > 0 && <ul className="mova-photo-crop__tips">{tips.map((tip) => <li key={tip}><Icon name="check" size={16} />{tip}</li>)}</ul>}
    {children && <div className="mova-photo-crop__actions">{children}</div>}
  </div>;
}

export function TabBar({ active, onNavigate, labels, ariaLabel = 'Main navigation', basePath = '', homePath = `${basePath}/` }: { active: string; onNavigate: (path: string) => void; labels: { home: string; calendar: string; clients: string; growth: string; reports: string }; ariaLabel?: string; basePath?: string; homePath?: string }) {
  const at = (segment: string) => `${basePath}/${segment}`;
  const tabs: Array<{ path: string; key: keyof typeof labels; icon: IconName }> = [
    { path: homePath, key: 'home', icon: 'home' }, { path: at('calendar'), key: 'calendar', icon: 'calendar' },
    { path: at('clients'), key: 'clients', icon: 'clients' }, { path: at('growth'), key: 'growth', icon: 'growth' },
    { path: at('reports'), key: 'reports', icon: 'reports' },
  ];
  return <nav className="mova-tab-bar" aria-label={ariaLabel}>{tabs.map((tab) => <button type="button" key={tab.path} className={`mova-tab${active === tab.path ? ' is-active' : ''}`} aria-current={active === tab.path ? 'page' : undefined} onClick={() => onNavigate(tab.path)}><span className="mova-tab__icon"><Icon name={tab.icon} size={22} /></span><span>{labels[tab.key]}</span></button>)}</nav>;
}

export function ComponentGallery() {
  const [chip, setChip] = useState(false);
  const [segment, setSegment] = useState('First');
  const [toggle, setToggle] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [day, setDay] = useState('second');
  const [slot, setSlot] = useState('second');
  const [radio, setRadio] = useState('a');
  const [showToast, setShowToast] = useState(false);
  const [galleryTab, setGalleryTab] = useState('/home');
  return <main className="mova-gallery">
    <ScreenHeader title="Design system" />
    <h1>Component gallery</h1><p>Interactive examples of the approved Mova design components.</p>
    <section aria-label="Design tokens"><SectionOverline>Design tokens</SectionOverline>
      <div className="mova-token-group"><h3>Color palette</h3>{[
        { label: 'Brand', tokens: ['forest', 'botanical', 'sage', 'mint', 'peach', 'ivory'] },
        { label: 'Ink', tokens: ['ink-primary', 'ink-secondary', 'ink-muted', 'ink-tab-inactive', 'ink-inverse', 'danger'] },
        { label: 'Surfaces', tokens: ['surface-page', 'surface', 'surface-alt', 'surface-inverse', 'surface-warm', 'scrim'] },
        { label: 'Lines', tokens: ['line', 'line-subtle', 'line-control', 'line-bar', 'line-step-off'] },
        { label: 'Accent and status', tokens: ['accent-warm', 'accent-warm-strong', 'status-confirmed-bg', 'status-confirmed-fg', 'status-pending-bg', 'status-pending-border', 'status-pending-fg'] },
        { label: 'Locations', tokens: ['location-1', 'location-2'] },
        { label: 'Provider artwork placeholder', tokens: ['wallet-button'] },
      ].map((group) => <div className="mova-token-group__section" key={group.label}><h4>{group.label}</h4><div className="mova-token-colors">{group.tokens.map((token) => <div className="mova-token-color" key={token}><span style={{ background: `var(--${token})` }} aria-hidden="true" /><code>--{token}</code></div>)}</div></div>)}</div>
      <div className="mova-token-group"><h3>Typography</h3><div className="mova-type-specimens">{([
        ['display-xl', 'Screen title'], ['display-l', 'Display large'], ['display-m', 'Display medium'], ['display-s', 'Display small'], ['body-l', 'Body large'], ['body', 'Body'], ['body-s', 'Body small'], ['caption', 'Caption'], ['micro', 'Micro'], ['tab', 'Tab label'],
      ] as const).map(([token, sample]) => <div className="mova-type-specimen" key={token}><span className="mova-type-specimen__sample" style={{ fontSize: `var(--fs-${token})`, fontFamily: token.startsWith('display') ? 'var(--font-display)' : 'var(--font-ui)' }}>{sample}</span><code>--fs-{token}</code></div>)}</div><p><strong>Manrope</strong> display · weights 600, 700, 800</p><p><strong>DM Sans</strong> interface · weights 400, 500, 600, 700</p></div>
      <div className="mova-token-columns"><div className="mova-token-group"><h3>Spacing</h3><div className="mova-token-rulers">{['1', '2', '3', '4', '5', '6', '8'].map((step) => <div key={step}><code>space-{step}</code><span style={{ width: `var(--space-${step})` }} /><small>var(--space-{step})</small></div>)}</div></div>
        <div className="mova-token-group"><h3>Corner radius</h3><div className="mova-token-radii">{['xs', 's', 'm', 'l', 'xl', '2xl', '3xl', 'pill'].map((radius) => <div key={radius}><span style={{ borderRadius: `var(--radius-${radius})` }} /><code>radius-{radius}</code></div>)}</div></div></div>
      <div className="mova-token-columns"><div className="mova-token-group"><h3>Component sizing</h3><div className="mova-token-sizes">{[['tap-min', 'Minimum touch target'], ['btn-primary-h', 'Primary button'], ['btn-secondary-h', 'Secondary button'], ['btn-compact-h', 'Compact button'], ['chip-h', 'Chip'], ['input-h', 'Text field'], ['option-h', 'Option'], ['tab-bar-h', 'Tab bar']].map(([token, label]) => <div key={token}><span>{label}</span><code>var(--{token})</code></div>)}</div></div>
        <div className="mova-token-group"><h3>Shadows and motion</h3><div className="mova-token-effects"><div style={{ boxShadow: 'var(--shadow-raised)' }}>shadow-raised</div><div style={{ boxShadow: 'var(--shadow-sheet)' }}>shadow-sheet</div></div><p><code>motion-fast</code> · <code>motion-base</code> · <code>easing</code></p><p>Reduced-motion preference is honored.</p></div></div>
      <div className="mova-token-group"><h3>Supplied icon set</h3><div className="mova-icon-gallery">{Array.from({ length: 30 }, (_, index) => { const id = String(index + 1).padStart(2, '0'); return <div key={id}><img src={`/design-icons/icon-${id}.svg`} alt={`Icon ${id}`} width="28" height="28" /><code>icon-{id}</code></div>; })}</div></div>
    </section>
    <section><SectionOverline>Actions</SectionOverline><div className="mova-gallery__row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="destructive">Destructive</Button><Button variant="ghost">Ghost</Button><Button variant="compact">Compact</Button><Button variant="on-dark">On dark</Button><Button loading>Loading</Button><Button disabled>Disabled</Button><IconButton label="Add item" icon="plus" /><IconButton label="Unavailable action" disabled /><TextLink href="/auth">Text link</TextLink></div></section>
    <section><SectionOverline>Inputs</SectionOverline><div className="mova-gallery__grid"><TextField label="Default field" placeholder="Enter a value" hint="Helper text" /><TextField label="Error field" defaultValue="Invalid" error="Check this value" /><TextField label="Disabled field" defaultValue="Unavailable" disabled /><TextArea label="Text area" placeholder="Write a note" maxLength={1000} /><Toggle label="Toggle on" checked={toggle} onChange={setToggle} /><Toggle label="Toggle off" checked={false} onChange={() => undefined} /><Toggle label="Toggle disabled" checked disabled /><Checkbox label="Unchecked example choice" /><Checkbox label="Selected example choice" checked readOnly /><Checkbox label="Disabled example choice" disabled /><OptionGroup label="Example options"><RadioCard name="sample" value="a" label="Selected option" description="Supporting detail" checked={radio === 'a'} onChange={setRadio} /><RadioCard name="sample" value="b" label="Unselected option" checked={radio === 'b'} onChange={setRadio} /><RadioCard name="sample" value="disabled" label="Disabled option" disabled /></OptionGroup><RadioCard name="filled-sample" value="selected" label="Filled selected option" variant="filled" checked onChange={() => undefined} /><Segmented label="Example options" options={['First', 'Second']} value={segment} onChange={setSegment} /><Segmented label="Disabled example options" options={['Unavailable', 'Disabled']} value="Unavailable" onChange={() => undefined} disabled /><div className="mova-gallery__row"><Chip selected={chip} onClick={() => setChip(!chip)}>Filter chip</Chip><Chip>Unselected chip</Chip><Chip disabled>Disabled chip</Chip></div></div></section>
    <section><SectionOverline>Display</SectionOverline><div className="mova-gallery__grid"><div className="mova-gallery__row"><StatusChip status="confirmed">Confirmed</StatusChip><StatusChip status="pending">Pending</StatusChip><StatusChip status="request">Request</StatusChip><StatusChip status="live">Live</StatusChip><StatusChip status="needs-approval">Needs approval</StatusChip><StatusChip status="filled">Filled</StatusChip><StatusChip status="expired">Expired</StatusChip><StatusChip status="cancelled">Cancelled</StatusChip><StatusChip status="info">Info</StatusChip><Badge label="Unread count">3</Badge><UnreadDot label="Unread message" /></div>
      <Card><strong>Default card</strong><p>Card content uses the shared spacing and type tokens.</p><ListRow leading={<Avatar label="Sample profile" initials="AB" />} title="List row" subtitle="Supporting detail" trailing={<Icon name="chevron" />} /><ListRow title="Navigating list row" subtitle="Link target example" trailing={<Icon name="chevron" />} href="/auth" /></Card><Card tone="inverse">Inverse card</Card><Card tone="warm">Warm card</Card>
      <DefinitionList rows={[{ label: 'First detail', value: 'Value' }, { label: 'Second detail', value: 'Another value' }]} /><div className="mova-gallery__row">{[32, 40, 56, 104, 120].map((size) => <Avatar key={size} label={`Profile placeholder ${size}px`} size={size} initials="AB" />)}</div><div className="mova-gallery__row"><KPITile label="Light metric" value="—" delta="Unavailable" /><KPITile tone="inverse" label="Inverse metric" value="—" delta="Unavailable" /></div><MiniBarChart label="Sample chart" values={[{ name: 'A', value: 3 }, { name: 'B', value: 5 }, { name: 'C', value: 2 }]} initialShowTable />
      <Timeline entries={[{ title: 'Activity item', detail: 'Status and context', icon: 'check' }, { title: 'Another activity', detail: 'Distinct icon shape', icon: 'clock' }]} />
      <MessageBubble variant="client">Client message example</MessageBubble><MessageBubble variant="ai" label="Assistant · AI">Assistant message example</MessageBubble><MessageBubble variant="artist" label="Artist">Artist message example</MessageBubble><MessageBubble variant="system">System event example</MessageBubble>
      <QRDisplay /><ClientCard name="Client name" artist="Artist name" nextAppointment="Next appointment"><QRDisplay label="Client card QR" /></ClientCard><StepperProgress current={3} label="Step" />
      <EmptyState title="Nothing here yet" detail="An empty state with a primary action." action={<Button variant="secondary">Add item</Button>} /><ErrorState title="Unable to load this section" retryLabel="Try again" onRetry={() => setShowToast(true)} /><PermissionDeniedState title="Permission required" detail="Allow access in your device settings to continue." /><OfflineBanner>You're offline. Changes need a connection.</OfflineBanner><div className="mova-gallery__skeleton"><Skeleton width="40%" height={20} /><Skeleton height={72} rounded /></div>
      <LocationTag name="First location" /><LocationTag name="Second location" index={2} /><HonestyBanner>Supporting information appears here.</HonestyBanner><HonestyBanner tone="warm">Warm supporting information.</HonestyBanner><DayStrip days={[{ id: 'first', weekday: 'Mon', date: '1', availability: '2 open' }, { id: 'second', weekday: 'Tue', date: '2', availability: 'Full', disabled: true }, { id: 'third', weekday: 'Wed', date: '3', availability: '1 open' }]} selected={day} onSelect={setDay} /><div className="mova-gallery__row"><TimeSlot label="9:00 AM" selected={slot === 'first'} onClick={() => setSlot('first')} /><TimeSlot label="10:00 AM" selected={slot === 'second'} requestMode onClick={() => setSlot('second')} /><TimeSlot label="11:00 AM" disabled /></div>
      <PhotoCrop tips={['Face the light, shoulders up, face centered', 'Just you: no group shots or heavy filters', 'Save your work photos for your portfolio']}><Button>Take a photo</Button><Button variant="secondary">Choose photo</Button></PhotoCrop>
      <PhotoCrop preview><Button>Use this photo</Button><Button variant="ghost">Retake</Button></PhotoCrop>
      <div className="mova-gallery__row"><Button variant="secondary" onClick={() => setSheetOpen(true)}>Open accessible sheet</Button><Button variant="secondary" onClick={() => setToastVisible(true)}>Show toast</Button></div>
      <div className="mova-gallery__tabbar"><TabBar active={galleryTab} onNavigate={setGalleryTab} labels={{ home: 'Home', calendar: 'Calendar', clients: 'Clients', growth: 'AI Revenue', reports: 'Reports' }} /></div>
    </div></section>
    <Sheet open={sheetOpen} title="Example sheet" onClose={() => setSheetOpen(false)}><p>This sheet traps focus, closes with Escape, and restores focus to its trigger.</p><Button onClick={() => setSheetOpen(false)}>Close sheet</Button></Sheet>
    {toastVisible && <Toast message="Action completed" action="Undo" onAction={() => setToastVisible(false)} />}
    {showToast && <Toast message="Retry requested" />}
  </main>;
}

export type { ButtonVariant };
