import type { TFunction } from 'i18next';
import type { PriceRow } from './api';
import './price-pilot.css';

export function money(minor: number, locale: string | undefined) {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(minor / 100);
}

export function duration(minutes: number, t: TFunction) {
  // Board style: "45 min", "90 min", "2 hr", "4 hr"; longer odd lengths as "2 hr 30 min".
  if (minutes % 60 === 0) return t('revenue.pricePilot.duration.hr', { count: minutes / 60 });
  if (minutes < 120) return t('revenue.pricePilot.duration.min', { count: minutes });
  return t('revenue.pricePilot.duration.hrMin', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function ago(iso: string | null, t: TFunction) {
  if (!iso) return t('revenue.pricePilot.ago.never');
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
  return days === 0 ? t('revenue.pricePilot.ago.today') : t('revenue.pricePilot.ago.days', { count: days });
}

const pos = (value: number, min: number, max: number) => (max <= min ? 50 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)));

/** PP1/PP2/PP5 bar: typical range band, your price (dot), suggested price (diamond), optional median line. */
export function PriceBar({ row, showMedian = false, showSuggested = true, label }: { row: PriceRow; showMedian?: boolean; showSuggested?: boolean; label: string }) {
  const e = row.evidence;
  const min = Math.min(e.min, row.current_minor, row.suggested_minor);
  const max = Math.max(e.max, row.current_minor, row.suggested_minor);
  const low = pos(e.range_low, min, max);
  const high = pos(e.range_high, min, max);
  return <div className="mova-pp-bar" role="img" aria-label={label}>
    <span className="mova-pp-bar__band" style={{ left: `${low}%`, width: `${Math.max(2, high - low)}%` }} />
    {showMedian && <span className="mova-pp-bar__median" style={{ left: `${pos(e.median, min, max)}%` }} />}
    {showSuggested && <span className="mova-pp-bar__suggested" style={{ left: `${pos(row.suggested_minor, min, max)}%` }} />}
    <span className="mova-pp-bar__you" style={{ left: `${pos(row.current_minor, min, max)}%` }} />
  </div>;
}

export function ActionChip({ action, t }: { action: PriceRow['action']; t: TFunction }) {
  const key = action === 'raise' ? 'raise' : action === 'hold' ? 'hold' : 'needsData';
  return <span className={`mova-pp-chip mova-pp-chip--${action}`}>{t(`revenue.pricePilot.chip.${key}`)}</span>;
}

export function Chevron() {
  return <svg className="mova-pp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
}

export function Tick() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;
}

export const confidenceKey = (level: PriceRow['evidence']['confidence']) => `revenue.pricePilot.confidence.${level}`;
