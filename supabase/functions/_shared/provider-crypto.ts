const encoder = new TextEncoder();
function keyBytes() {
  const value = Deno.env.get('MOVA_PROVIDER_TOKENS_KEK_HEX') ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('PROVIDER_TOKEN_KEY_UNAVAILABLE');
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}
function clientCardKeyBytes() {
  const value = Deno.env.get('MOVA_CLIENT_CARD_TOKENS_HMAC_HEX') ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('CLIENT_CARD_TOKEN_KEY_UNAVAILABLE');
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}
async function aesKey() { return crypto.subtle.importKey('raw', keyBytes(), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function encryptProviderSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), encoder.encode(value));
  return `\\x${[...iv, ...new Uint8Array(cipher)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function decryptProviderSecret(value: string | Uint8Array) {
  const hex = typeof value === 'string' ? value.replace(/^\\x/, '') : [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  if (bytes.length < 29) throw new Error('PROVIDER_TOKEN_CIPHERTEXT_INVALID');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await aesKey(), bytes.slice(12));
  return new TextDecoder().decode(plain);
}
export async function deriveClientCardToken(id: string, artistBusinessId: string, clientId: string, customerAccountId: string) {
  const key = await crypto.subtle.importKey('raw', clientCardKeyBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = encoder.encode(`mova-client-card:v1:${id}:${artistBusinessId}:${clientId}:${customerAccountId}`);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  return btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
