// Formatting for the admin screens. English only (the admin portal is staff-facing; see the report).

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const integer = new Intl.NumberFormat('en-US');

export function formatMoneyMinor(amountMinor: number | null | undefined): string {
  return money.format((amountMinor ?? 0) / 100);
}

export function formatCount(value: number | null | undefined): string {
  return integer.format(value ?? 0);
}

/** Rounded percent, e.g. 0.125 -> "12.5%". Returns an em dash when the base is zero. */
export function formatPercent(part: number, whole: number, digits = 0): string {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

export function formatFeeBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(1) : percent.toFixed(2).replace(/0$/, '')}%`;
}

/** Change against the prior window: "▲ 12%", "▼ 4%", or "—" when there is nothing to compare. */
export function formatChange(current: number, prior: number): { text: string; direction: 'up' | 'down' | 'flat' } {
  if (!prior) return { text: current > 0 ? 'New this period' : '—', direction: 'flat' };
  const change = Math.round(((current - prior) / prior) * 100);
  if (change === 0) return { text: 'No change', direction: 'flat' };
  return change > 0
    ? { text: `▲ ${change}%`, direction: 'up' }
    : { text: `▼ ${Math.abs(change)}%`, direction: 'down' };
}

const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
const timeOnly = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

/** Platform time (Eastern), e.g. "Nov 8, 3:42 PM". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? '—' : dateTime.format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? '—' : dateOnly.format(value);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? '—' : timeOnly.format(value);
}

/** Relative time for "last active" columns: "Today", "Yesterday", "3 days ago", or a date. */
export function formatRelativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '—';
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(value).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return formatDate(iso);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** ISO week number for a YYYY-MM-DD day, shown as "W45". */
export function isoWeekLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!match) return '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `W${Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)}`;
}

/** The calendar day (YYYY-MM-DD) in a time zone, offset by whole days. Used for date inputs. */
export function dayInZone(now: Date, timeZone: string, offsetDays = 0): string {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

/** Quotes a CSV cell, so commas and quotes in names and messages stay in their own column. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
