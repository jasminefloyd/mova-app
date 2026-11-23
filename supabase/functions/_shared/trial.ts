// Trial length: 30 days (D1). MOVA_TRIAL_DAYS exists only for test clocks and staging.
export function trialDaysFromEnv(env: (name: string) => string | undefined): number {
  const raw = Number(env('MOVA_TRIAL_DAYS') ?? '30');
  return Number.isInteger(raw) && raw >= 1 && raw <= 60 ? raw : 30;
}
