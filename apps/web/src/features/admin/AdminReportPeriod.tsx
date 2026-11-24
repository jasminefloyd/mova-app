import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorNote, Segmented } from './AdminPrimitives';

const presetLabels = {
  '24h': 'Last 24 hours',
  '7d': '7 days',
  '14d': '14 days',
  '28d': '28 days',
} as const;

type Preset = keyof typeof presetLabels;
export type ReportPeriod =
  | { p_period: Preset }
  | { p_period: 'custom'; p_start: string; p_end: string };

const options: { value: ReportPeriod['p_period']; label: string }[] = [
  { value: '24h', label: presetLabels['24h'] },
  { value: '7d', label: presetLabels['7d'] },
  { value: '14d', label: presetLabels['14d'] },
  { value: '28d', label: presetLabels['28d'] },
  { value: 'custom', label: 'Custom' },
];

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validRange(start: string | null, end: string | null, today: string): { p_start: string; p_end: string } | null {
  return isDate(start) && isDate(end) && start <= end && end <= today ? { p_start: start, p_end: end } : null;
}

export function useAdminReportPeriod() {
  const [params, setParams] = useSearchParams();
  const today = new Date().toISOString().slice(0, 10);
  const requested = params.get('period');
  const custom = requested === 'custom' ? validRange(params.get('start'), params.get('end'), today) : null;
  const preset = options.find(option => option.value !== 'custom' && option.value === requested)?.value;
  const period: ReportPeriod = custom
    ? { p_period: 'custom', ...custom }
    : { p_period: preset && preset !== 'custom' ? preset : '28d' };

  function select(next: ReportPeriod) {
    setParams(current => {
      const updated = new URLSearchParams(current);
      updated.set('period', next.p_period);
      updated.delete('start');
      updated.delete('end');
      if (next.p_period === 'custom') {
        updated.set('start', next.p_start);
        updated.set('end', next.p_end);
      }
      return updated;
    });
  }

  return { period, select, today, search: params.toString() };
}

export function reportPeriodLabel(period: ReportPeriod) {
  if (period.p_period === 'custom') return `${period.p_start} to ${period.p_end} (UTC)`;
  return period.p_period === '24h' ? presetLabels['24h'] : `Last ${presetLabels[period.p_period]}`;
}

export function AdminReportPeriodPicker({ period, select, today }: ReturnType<typeof useAdminReportPeriod>) {
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || period.p_period === 'custom';

  return <div className="stack">
    <Segmented
      label="Report period"
      value={showCustom ? 'custom' : period.p_period}
      onChange={next => {
        setCustomOpen(next === 'custom');
        if (next !== 'custom') select({ p_period: next });
      }}
      options={options}
    />
    {showCustom && <CustomRangeForm
      key={period.p_period === 'custom' ? `${period.p_start}/${period.p_end}` : 'new'}
      period={period} select={select} today={today}
    />}
  </div>;
}

function CustomRangeForm({ period, select, today }: Pick<ReturnType<typeof useAdminReportPeriod>, 'period' | 'select' | 'today'>) {
  const [from, setFrom] = useState(period.p_period === 'custom' ? period.p_start : '');
  const [to, setTo] = useState(period.p_period === 'custom' ? period.p_end : '');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const range = validRange(from, to, today);
    if (!range) {
      setError('Choose a start and end date in order, ending today or earlier.');
      return;
    }
    setError('');
    select({ p_period: 'custom', ...range });
  }

  return <form className="row toolbar-form" onSubmit={submit}>
    <label className="field"><span className="lbl">Start date (UTC)</span><input className="input" type="date" value={from} max={today} required onChange={event => setFrom(event.target.value)} /></label>
    <label className="field"><span className="lbl">End date (UTC)</span><input className="input" type="date" value={to} max={today} required onChange={event => setTo(event.target.value)} /></label>
    <button type="submit" className="btn sm">Apply range</button>
    {error && <ErrorNote message={error} />}
  </form>;
}
