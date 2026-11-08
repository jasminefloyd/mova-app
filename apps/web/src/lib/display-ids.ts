export type DisplayIdKind = 'BID' | 'CID' | 'AID';

export function displayId(kind: DisplayIdKind, value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Display ID must be a positive safe integer');
  return `${kind}-${value}`;
}

/** Like displayId, but returns null for a missing or invalid number instead of throwing (records not yet numbered, absent links). */
export function displayIdOrNull(kind: DisplayIdKind, value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? `${kind}-${value}` : null;
}

export function displayIdLabel(kind: DisplayIdKind, value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Display ID must be a positive safe integer');
  return `${kind} ${value}`;
}

export function parseDisplayId(kind: DisplayIdKind, value: string | undefined): number | null {
  const match = value?.match(new RegExp(`^${kind}-(\\d+)$`, 'i'));
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
