import { useTranslation } from 'react-i18next';
import { Card } from '../../components';
import { explainForecast, type ForecastInputs } from '../../../../../packages/domain/src/forecast';

/** Task 5.6: "How Mova estimates this" — every figure on the forecast card, with its arithmetic. */
export function ForecastMethod({ inputs }: { inputs: unknown }) {
  const { t, i18n } = useTranslation();
  const valid = isForecastInputs(inputs);
  const money = (minor: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(minor / 100);
  const percent = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 0 }).format(value);
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  if (!valid) return <Card className="mova-forecast-method" ><h2 id="forecast-method">{t('revenue.method.title')}</h2><p>{t('revenue.method.notComputed')}</p></Card>;
  const e = explainForecast(inputs);
  return <Card className="mova-forecast-method">
    <h2 id="forecast-method">{t('revenue.method.title')}</h2>
    <p>{t('revenue.method.intro')}</p>
    <dl>
      <div><dt>{t('revenue.booked')}</dt><dd>{money(e.bookedMinor)}</dd><small>{t('revenue.method.booked')}</small></div>
      <div><dt>{t('revenue.method.openTime')}</dt><dd>{money(e.openTime.minor)}</dd>
        <ul>{e.openTime.buckets.map((bucket, index) => <li key={index}>{t('revenue.method.openBucket', { hours: number(bucket.hours), fill: percent(bucket.fillRate), ticket: money(bucket.ticketPerHourMinor), total: money(bucket.minor) })}</li>)}</ul></div>
      <div><dt>{t('revenue.method.rebooks')}</dt><dd>{money(e.rebooks.minor)}</dd><small>{t('revenue.method.rebookLine', { due: e.rebooks.dueClients, conversion: percent(e.rebooks.conversion), ticket: money(e.rebooks.averageTicketMinor) })}</small></div>
      <div className="is-total"><dt>{t('revenue.likely')}</dt><dd>{money(e.likelyMinor)}</dd><small>{t('revenue.method.likelyLine')}</small></div>
      <div><dt>{t('revenue.method.range')}</dt><dd>{money(e.range.lowMinor)}–{money(e.range.highMinor)}</dd><small>{t('revenue.method.rangeLine', { openLow: money(e.range.openLowMinor), openHigh: money(e.range.openHighMinor), rebookLow: money(e.range.rebookLowMinor), rebookHigh: money(e.range.rebookHighMinor) })}</small></div>
      <div><dt>{t('revenue.usual')}</dt><dd>{e.usual.minor === null ? '—' : money(e.usual.minor)}</dd><small>{e.usual.minor === null ? t('revenue.insufficient') : t('revenue.method.usualLine', { months: e.usual.monthsMinor.map(money).join(', ') })}</small></div>
    </dl>
  </Card>;
}

export function isForecastInputs(value: unknown): value is ForecastInputs {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const nums = ['bookedMinor', 'openLowMinor', 'openHighMinor', 'dueClients', 'rebookConversion', 'averageTicketMinor', 'rebookLowMinor', 'rebookHighMinor'];
  const arrays = ['remainingHours', 'fillRates', 'avgTicketPerHourMinor', 'usualMonthsMinor'];
  return nums.every((key) => typeof v[key] === 'number' && Number.isFinite(v[key])) && arrays.every((key) => Array.isArray(v[key]) && (v[key] as unknown[]).every((item) => typeof item === 'number'));
}
