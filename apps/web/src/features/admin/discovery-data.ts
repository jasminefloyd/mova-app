export type TrafficTotals = {
  visitors: number;
  identified_sessions: number;
  new_users: number;
  returning_users: number;
  sessions: number;
  page_views: number;
  signup_clicks: number;
  signups: number;
  converted: number;
};
export type DiscoveryRow = {
  kind: 'landing' | 'channel' | 'source' | 'referrer' | 'campaign' | 'device' | 'browser' | 'country';
  label: string;
  sessions: number;
  visitors: number;
  signups: number;
  converted: number;
};
export type GeographyRow = Pick<DiscoveryRow, 'sessions' | 'visitors' | 'signups' | 'converted'> & {
  city: string;
  region: string;
  country: string;
};
export type Discovery = {
  start: string;
  through: string;
  traffic_span?: { first_at: string; last_at: string } | null;
  current: TrafficTotals;
  prior: TrafficTotals;
  breakdown: DiscoveryRow[];
  geography?: GeographyRow[];
  pages: { path: string; views: number; sessions: number }[];
  calculator: { used: number; signup_clicks: number; signups: number; partial_history?: boolean };
};
export type ActivationCohort = {
  cohort: string;
  verified: number;
  published: number;
  booked: number;
  completed: number;
  published_hours: number | null;
  booked_hours: number | null;
  completed_hours: number | null;
};
export type SubscriptionSummary = {
  plans: Partial<Record<'free' | 'pro' | 'ai_growth', number>>;
  mrr_minor: number;
  paid_subscriptions: number;
  active_trials: number;
  expiring_trials: number;
  trials_converted: number;
  trials_resolved: number;
  past_due: number;
  pending_cancellations: number;
  billing_events: { payment_failures: number; cancellations: number };
  deletion_requests: number;
  open_deletion_requests: number;
};
