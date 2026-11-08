import { combinedDurationMinutes, requiresCardDeposit } from './rules.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
};

const services = [
  { id: 'silk', duration_minutes: 90, buffer_minutes: 15, deposit_type: 'none', deposit_value: 0 },
  { id: 'trim', duration_minutes: 45, buffer_minutes: 0, deposit_type: 'fixed', deposit_value: 2000 },
];

Deno.test('TC-B01-AVAIL-01 single service uses base duration plus buffer', () => {
  assertEquals(combinedDurationMinutes(['silk'], services, []), 105, 'silk press');
});

Deno.test('TC-B01-AVAIL-02 two services add up and honour a per-location override', () => {
  const overrides = [{ service_id: 'trim', duration_minutes_override: 30 }];
  assertEquals(combinedDurationMinutes(['silk', 'trim'], services, overrides), 135, 'silk + trim with override');
});

Deno.test('TC-B01-AVAIL-03 unknown service is rejected', () => {
  let threw = false;
  try { combinedDurationMinutes(['missing'], services, []); } catch { threw = true; }
  assertEquals(threw, true, 'throws');
});

Deno.test('TC-H06-DEPOSIT-01 deposit only applies where the stylist collects', () => {
  assertEquals(requiresCardDeposit('artist', services), true, 'stylist collects, one service has a deposit');
  assertEquals(requiresCardDeposit('salon', services), false, 'salon collects');
  assertEquals(requiresCardDeposit('artist', [services[0]!]), false, 'no deposit services');
});
