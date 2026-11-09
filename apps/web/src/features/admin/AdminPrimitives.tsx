import type { ReactNode } from 'react';

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="head">
      <div>
        <h1 className="h1">{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title || aside ? (
        <div className="card-h">
          {title ? <h2 className="h2">{title}</h2> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="lbl">{label}</span>
      <span className="big">{value}</span>
      {note ? <span className="small muted">{note}</span> : null}
    </div>
  );
}

export type PillTone = 'ok' | 'warn' | 'bad' | 'new' | 'off';
export function Pill({ tone = 'off', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill p-${tone}`}>{children}</span>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <p className="muted" role="status">{label}…</p>;
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="error-text" role="alert">{message}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted pad0">{children}</p>;
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string; count?: number | undefined }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} className={option.value === value ? 'on' : ''} onClick={() => onChange(option.value)}>
          {option.label}{option.count !== undefined ? <span className="count"> {option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Confirmation dialog. When `reasonRequired` is set the action sends the reason the staff member wrote. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, reasonRequired, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; reasonRequired?: boolean;
  busy?: boolean; error?: string | null; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
      <form
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
          onConfirm(reason);
        }}
      >
        <h2 id="dialog-title" className="h2">{title}</h2>
        <div className="small">{body}</div>
        {reasonRequired ? (
          <label className="field">
            <span className="lbl">Reason (kept in the admin log)</span>
            <textarea name="reason" className="input" rows={3} minLength={5} maxLength={500} required />
          </label>
        ) : null}
        <ErrorNote message={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={`btn ${danger ? 'danger' : 'pri'}`} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
