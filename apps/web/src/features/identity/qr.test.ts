import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';

describe('artist QR payload',()=>{
  it('creates a scannable error-correction-M QR for the approved public scan route',()=>{
    const matrix=QRCode.create('https://mova-beauty.co/s/rooted-beauty',{errorCorrectionLevel:'M'});
    expect(matrix.modules.size).toBeGreaterThanOrEqual(21);
    expect(matrix.modules.data.some(Boolean)).toBe(true);
    expect(matrix.errorCorrectionLevel.bit).toBe(0);
  });
});
