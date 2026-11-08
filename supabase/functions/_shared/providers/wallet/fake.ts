import type { ClientCardPass } from './pass.ts';

export type SignedPass = { contentType: string; fileName: string; base64: string; live: boolean };
export interface WalletSigner {
  readonly name: string;
  readonly live: boolean;
  sign(pass: ClientCardPass): Promise<SignedPass>;
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');

/**
 * Fake signer (task 5.7): returns the pass JSON with a deterministic SHA-256 "signature" so tests can
 * check it, never an Apple .pkpass or Google save link. Wallet apps will not accept it, by design.
 */
export class FakeWalletSigner implements WalletSigner {
  readonly name = 'fake';
  readonly live = false;
  async sign(pass: ClientCardPass): Promise<SignedPass> {
    const json = JSON.stringify(pass);
    const signature = hex(await crypto.subtle.digest('SHA-256', encoder.encode(`fake-wallet-signer:${json}`)));
    const bytes = encoder.encode(JSON.stringify({ pass, signature, signer: 'fake' }));
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return { contentType: 'application/json', fileName: `mova-client-card-${pass.platform}.json`, base64: btoa(binary), live: false };
  }
}

export function walletSignerFromEnv(env: (name: string) => string | undefined): WalletSigner | null {
  return env('MOVA_WALLET_SIGNER') === 'fake' ? new FakeWalletSigner() : null;
}
