const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g;
const secrets = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|\b(?:bearer\s+\S+|eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}|sk_(?:live|test)_[a-zA-Z0-9]+|rk_(?:live|test)_[a-zA-Z0-9]+|sb_secret_[a-zA-Z0-9_-]+|re_[a-zA-Z0-9]{12,}|whsec_[a-zA-Z0-9]+)|\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|authorization|password)\s*[:=]\s*[^\s,;]+)/gi;

export function redactSystemText(value: unknown, limit = 240): string {
  return String(value ?? '').replace(secrets, '[REDACTED]')
    .replace(email, '[EMAIL]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD]')
    .replace(phone, '[PHONE]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, limit);
}

const allowedKeys = new Set(['app_version', 'route', 'component', 'browser_event', 'provider', 'provider_reference', 'attempt', 'action', 'outcome', 'result_count', 'source_kind', 'extraction_count']);
export function safeSystemContext(input: unknown): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 12)) {
    if (!allowedKeys.has(key) || value === undefined) continue;
    if (typeof value === 'string') out[key] = redactSystemText(value, 120);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}
