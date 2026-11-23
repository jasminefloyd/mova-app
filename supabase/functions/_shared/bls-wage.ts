// BLS OEWS hourly median pay for hairdressers, hairstylists and cosmetologists (SOC 39-5012) for PP2's
// context line. Public-domain data from the BLS Public Data API. Never throws; returns null when unknown.
//
// Series ID: OE + U (not seasonal) + area type (M metro, S state) + 7-digit area code + 000000 (all
// industries) + 395012 (occupation) + 08 (hourly median wage). Metro area code = "00" + CBSA code;
// state area code = state FIPS + "00000". Sources: download.bls.gov/pub/time.series/oe/oe.area and oe.datatype.

const ENDPOINT = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
export const OCCUPATION = '395012';

export function seriesId(areaType: 'M' | 'S', areaCode: string): string {
  return `OEU${areaType}${areaCode}000000${OCCUPATION}08`;
}

export function areaCodes(cbsa: string | null, stateFips: string | null): Array<{ type: 'M' | 'S'; code: string }> {
  const out: Array<{ type: 'M' | 'S'; code: string }> = [];
  if (cbsa && /^\d{5}$/.test(cbsa)) out.push({ type: 'M', code: `00${cbsa}` });
  if (stateFips && /^\d{2}$/.test(stateFips)) out.push({ type: 'S', code: `${stateFips}00000` });
  return out;
}

/** Latest value per series from a BLS API v2 response. "-" and "*" (not available) are skipped. */
export function parseBls(payload: unknown): Map<string, { value: number; year: number }> {
  const out = new Map<string, { value: number; year: number }>();
  const series = (payload as { Results?: { series?: Array<{ seriesID?: string; data?: Array<{ year?: string; value?: string }> }> } } | null)?.Results?.series ?? [];
  for (const item of series) {
    const latest = (item.data ?? []).map((row) => ({ year: Number(row.year), value: Number(String(row.value ?? '').replace(/,/g, '')) }))
      .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.value) && row.value > 0)
      .sort((a, b) => b.year - a.year)[0];
    if (item.seriesID && latest) out.set(item.seriesID, latest);
  }
  return out;
}

export async function fetchBlsHourlyMedians(ids: string[], key: string | undefined, fetchImpl: typeof fetch = fetch) {
  if (!ids.length) return new Map<string, { value: number; year: number }>();
  const year = new Date().getUTCFullYear();
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', signal: AbortSignal.timeout(12_000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seriesid: ids, startyear: String(year - 3), endyear: String(year), ...(key ? { registrationkey: key } : {}) }),
    });
    if (!response.ok) return new Map();
    return parseBls(await response.json());
  } catch {
    return new Map();
  }
}
