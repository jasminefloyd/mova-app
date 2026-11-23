const PREFIX = 'mova_calculator_';

type CalculatorEvent = 'calculator_used' | 'start_free_clicked' | 'signup_completed';

function recordOnce(event: CalculatorEvent) {
  try {
    const key = PREFIX + event;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
    const clear = () => { try { window.sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } };
    void fetch('/api/calculator-event', {
      method: 'POST',
      body: event,
      credentials: 'omit',
      keepalive: true,
      referrerPolicy: 'no-referrer',
    }).then((response) => { if (!response.ok) clear(); }).catch(clear);
  } catch {
    // Analytics must never interrupt the calculator or sign-up.
  }
}

export function trackCalculatorUse() {
  recordOnce('calculator_used');
}

export function startCalculatorSignup() {
  recordOnce('start_free_clicked');
}

export function completeCalculatorSignup(startedAt: number | null, accountCreatedAt: string | undefined) {
  if (startedAt === null || !accountCreatedAt) return;
  const createdAt = Date.parse(accountCreatedAt);
  // Allow for a small clock difference between the browser and Supabase Auth.
  if (createdAt >= startedAt - 5000 && createdAt <= Date.now() + 5000) recordOnce('signup_completed');
}
