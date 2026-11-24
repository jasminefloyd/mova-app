export type VisitTotals = { visits: number; signup_clicks: number; signups: number; converted: number };
export type DiscoveryRow = VisitTotals & {
  kind: 'landing' | 'channel' | 'campaign';
  landing_path: string | null;
  channel: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
};
export type Discovery = {
  through: string;
  current: VisitTotals | null;
  prior: VisitTotals | null;
  breakdown: DiscoveryRow[];
  pages: { path: string; views: number; visits: number }[];
  calculator: { used: number; signup_clicks: number; signups: number };
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
export type SearchMetrics = { clicks: number; impressions: number; ctr: number; position: number };
export type SearchRow = SearchMetrics & { keys: string[] };
export type SearchDiscovery = { state: 'not_configured' | 'unavailable' } | {
  state: 'ready';
  start: string;
  through: string;
  current: SearchMetrics | null;
  prior: SearchMetrics | null;
  terms: SearchRow[];
  pages: SearchRow[];
};
