// What the current plan locks, for lock cards and Settings badges (trial WP6). Built from the live
// catalog, never hard-coded, and never lists a feature whose platform switch is off (Concierge,
// wallet, texting), so lock copy can't promise something the platform doesn't do yet.

type Plan = { plan_key: string; entitlements?: { features?: Record<string, boolean> } };

const SWITCHED: Record<string, (switches: Record<string, boolean>, textsLive: boolean) => boolean> = {
  concierge: (s) => s.concierge === true,
  concierge_instagram: (s) => s.concierge === true,
  missed_call_textback: (s, texts) => s.concierge === true && texts,
  wallet_client_card: (s) => s.marketing_wallet === true,
  marketing_wallet: (s) => s.marketing_wallet === true,
  text_autopilot: (_s, texts) => texts,
  text_reminders: (_s, texts) => texts,
  seat_filler: (s) => s.seat_filler === true,
  rebooking_autopilot: (s) => s.autopilot === true,
  marketing_email: (s) => s.marketing_email === true,
  marketing_social: (s) => s.marketing_social === true,
  marketing_web_push: (s) => s.marketing_web_push === true,
};

export type LockedFeature = { feature: string; required_plan: 'pro' | 'ai_growth' };

export function lockedFeatures(current: Record<string, boolean>, plans: Plan[], switches: Record<string, boolean>, textsLive: boolean): LockedFeature[] {
  const pro = plans.find((plan) => plan.plan_key === 'pro')?.entitlements?.features ?? {};
  const top = plans.find((plan) => plan.plan_key === 'ai_growth')?.entitlements?.features ?? {};
  const locked: LockedFeature[] = [];
  for (const [feature, included] of Object.entries(top)) {
    if (!included || current[feature] === true) continue;
    const gate = SWITCHED[feature];
    if (gate && !gate(switches, textsLive)) continue;
    locked.push({ feature, required_plan: pro[feature] === true ? 'pro' : 'ai_growth' });
  }
  return locked.sort((a, b) => a.feature.localeCompare(b.feature));
}
