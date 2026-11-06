export type DepositPolicy =
  | { type: 'none' }
  | { type: 'fixed'; amountMinor: number }
  | { type: 'percent'; basisPoints: number };

/** Returns the amount collected at booking, in integer minor currency units. */
export function depositAmount(
  priceMinor: number,
  policy: DepositPolicy,
  paymentCollector: 'artist' | 'salon',
): number {
  assertMinorUnits(priceMinor, 'priceMinor');
  if (paymentCollector === 'salon' || policy.type === 'none') return 0;

  if (policy.type === 'fixed') {
    assertMinorUnits(policy.amountMinor, 'amountMinor');
    return Math.min(priceMinor, policy.amountMinor);
  }

  if (!Number.isInteger(policy.basisPoints) || policy.basisPoints < 0 || policy.basisPoints > 10_000) {
    throw new RangeError('basisPoints must be an integer from 0 to 10000');
  }

  return Math.min(priceMinor, Math.floor((priceMinor * policy.basisPoints + 5_000) / 10_000));
}

function assertMinorUnits(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
