/** Dates are shown in UTC so the server render and the browser agree. */
export function formatGuideDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'es-US' ? 'es-US' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Absolute URL for canonical and social tags. Relative paths are resolved against the public site. */
export function absoluteUrl(value: string, base: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${base.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
}

export function headingId(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}
