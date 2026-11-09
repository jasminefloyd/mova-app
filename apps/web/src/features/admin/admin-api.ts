import { createMovaSupabaseClient } from '../../lib/supabase';

// Every admin screen reads and writes through these database functions. The database checks the
// platform admin role and a two-step session on each call, so this module only shapes requests.

export class AdminError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'AdminError';
    this.code = code;
  }
}

/** Calls a database function and returns its jsonb result. Error messages carry the database code. */
export async function adminRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = createMovaSupabaseClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new AdminError(extractCode(error.message));
  return data as T;
}

function extractCode(message: string | undefined): string {
  const match = /^[A-Z][A-Z0-9_]{2,}$/.exec((message ?? '').trim());
  return match ? match[0] : 'UNKNOWN';
}

/** Plain-English text for database codes the screens can show. */
const messages: Record<string, string> = {
  PLATFORM_ADMIN_REQUIRED: 'This account does not have admin access.',
  SLUG_TAKEN: 'Another guide already uses this URL.',
  SLUG_INVALID: 'Use lowercase letters, numbers and hyphens for the URL (3 to 120 characters).',
  TITLE_INVALID: 'Add a title (up to 140 characters).',
  SUMMARY_TOO_LONG: 'The summary is longer than 240 characters.',
  SUMMARY_REQUIRED: 'Add a summary before publishing.',
  BODY_REQUIRED: 'Add at least one block before publishing.',
  BODY_TOO_LARGE: 'This guide is too long to save. Shorten it or split it.',
  BLOCK_TYPE_INVALID: 'One block has a type the guide does not support.',
  IMAGE_ALT_REQUIRED: 'Every image needs alt text that describes it.',
  IMAGE_URL_INVALID: 'Image links must start with https://.',
  PARAGRAPH_INVALID: 'A link in this text is not allowed. Use an https:// link or a link inside this site.',
  LIST_INVALID: 'A list in this guide is not valid. Check that each item has text.',
  HEADING_TEXT_INVALID: 'A heading needs text (up to 200 characters).',
  HEADING_LEVEL_INVALID: 'Headings must be level 2 or 3.',
  CALLOUT_INVALID: 'A callout needs text.',
  QUOTE_INVALID: 'A quote needs text.',
  CATEGORY_REQUIRED: 'Choose a category before publishing.',
  CATEGORY_INVALID: 'Choose one of the listed categories.',
  TAGS_INVALID: 'Use up to 6 tags, each up to 30 characters.',
  COVER_URL_INVALID: 'The cover image link must start with https://.',
  COVER_ALT_INVALID: 'The cover image alt text is too long.',
  AUTHOR_INVALID: 'Add an author name.',
  META_TITLE_TOO_LONG: 'The meta title is longer than 60 characters.',
  META_DESCRIPTION_TOO_LONG: 'The meta description is longer than 160 characters.',
  CANONICAL_URL_INVALID: 'The canonical link must start with https://.',
  OG_TITLE_TOO_LONG: 'The social title is longer than 95 characters.',
  OG_DESCRIPTION_TOO_LONG: 'The social description is longer than 200 characters.',
  OG_IMAGE_URL_INVALID: 'The social image link must start with https://.',
  SCHEDULE_TIME_NOT_IN_FUTURE: 'Pick a time later than now.',
  UNPUBLISH_BEFORE_DRAFT: 'Unpublish this guide before saving it as a draft.',
  PUBLISHED_PIECE_CANNOT_BE_DELETED: 'Published guides cannot be deleted. Unpublish it instead.',
  BLOG_NOT_FOUND: 'That guide no longer exists.',
  STYLIST_FILTER_INVALID: 'That filter is not available.',
  BUSINESS_NOT_FOUND: 'That stylist no longer exists.',
  AUDIT_CATEGORY_INVALID: 'That audit filter is not available.',
  FEE_OUT_OF_RANGE: 'Fees must be between 0% and 3%.',
  REASON_REQUIRED: 'Write a reason of at least 5 characters.',
  START_IN_PAST: 'Choose today or a later date.',
  START_REQUIRED: 'Choose a start date.',
  END_BEFORE_START: 'The end date must be after the start date.',
  SWITCH_INVALID: 'That switch does not exist.',
  SWITCH_NOT_BUILT: 'This feature is not built yet, so it cannot be turned on.',
  PROFILE_NOT_FOUND: 'This stylist has no public page to unpublish.',
  SUPPORT_FILTER_INVALID: 'That inbox filter is not available.',
  SUPPORT_STATUS_INVALID: 'That status is not available.',
  SUPPORT_MESSAGE_NOT_FOUND: 'That message no longer exists.',
  REPLY_INVALID: 'Write a reply of up to 4000 characters.',
  BACKGROUND_JOB_NOT_FOUND: 'That job no longer exists.',
  JOB_NOT_REQUEUEABLE: 'Only dead, failed or stuck jobs can be requeued.',
  UNKNOWN: 'Something went wrong. Try again.',
};

export function adminErrorText(error: unknown): string {
  if (error instanceof AdminError) return messages[error.code] ?? messages.UNKNOWN ?? 'Something went wrong. Try again.';
  return messages.UNKNOWN ?? 'Something went wrong. Try again.';
}

export function isAdminError(error: unknown, code: string): boolean {
  return error instanceof AdminError && error.code === code;
}

export type WhoAmI = { is_admin: boolean; display_name?: string };

export type OverviewWindow = {
  active_stylists: number; new_signups: number; bookings_made: number; completed: number; no_shows: number;
  processed_minor: number; fees_minor: number; recorded_minor: number; salon_minor: number;
  seat_filler_filled: number; seat_filler_offered: number; seat_filler_total: number;
  autopilot_sent: number; autopilot_rebooked: number; concierge_conversations: number; concierge_handed: number;
};

export type Overview = {
  days: number;
  current: OverviewWindow;
  prior: OverviewWindow;
  funnel: { waitlist: number; invited: number; signed_up: number; published_page: number; stripe_connected: number; first_booking: number };
  weekly_active: { week: string; stylists: number }[];
  top_stylists: { business_id: string; bid: number; name: string; business_name: string; completed: number; processed_minor: number }[];
  needs_nudge: { quiet: number; items: { business_id: string; bid: number; name: string; business_name: string; reason: 'quiet' | 'stripe_restricted' | 'published_no_bookings' }[] };
  language: { en_us: number; es_us: number };
};

export type StylistStatusKey = 'active' | 'onboarding' | 'quiet' | 'suspended';
export type StylistRow = {
  id: string; bid: number; name: string; business_name: string; handle: string | null;
  status_key: StylistStatusKey; stripe_status: string; plan_name: string; fee_bps: number | null;
  done_30d: number; last_booking_at: string | null;
};
export type StylistList = {
  stylists: StylistRow[];
  total: number;
  counts: { all: number; active: number; onboarding: number; quiet: number; restricted: number; suspended: number };
};

export type StylistDetail = {
  business: { id: string; bid: number; name: string; status: string; created_at: string };
  profile: { display_name: string; handle: string; is_published: boolean; published_at: string | null; preferred_locale: string; has_photo: boolean } | null;
  owner_email: string | null;
  plan: { key: string; name: string };
  fee: { fee_bps: number | null; source: 'override' | 'plan' | 'platform' };
  stripe: { status: string; charges_enabled: boolean; payouts_enabled: boolean } | null;
  metrics: { completed_30d: number; processed_30d_minor: number; fees_30d_minor: number; repeat_clients_90d: number; clients_90d: number; locations: number; services: number; clients: number };
  switches: { zelle_recorded: boolean; rebooking_autopilot: boolean; ai_concierge: boolean; wallet_card: boolean; social_share: boolean };
  feedback: { id: string; type: string; status: string; created_at: string; preview: string }[];
  overrides: { fee_bps: number; starts_at: string; ends_at: string | null; reason: string }[];
};

export type AuditEvent = { occurred_at: string; category: string; actor: string; event: string; reference: string; summary: string };
export type AuditPage = { events: AuditEvent[]; has_more: boolean };

export type FeeOverride = {
  id: string; bid: number; business_name: string; name: string; fee_bps: number; starts_at: string; ends_at: string | null;
  reason: string; notify_stylist: boolean; status: 'active' | 'scheduled' | 'ended';
};
export type FeesOverview = {
  platform: { version: number; fee_bps: number; effective_at: string } | null;
  stylists_on_override: number; stylists_total: number;
  plans: { plan_key: string; display_name: string; fee_bps: number }[];
  overrides: FeeOverride[];
  history: { occurred_at: string; action: string; bid: number | null; business_name: string | null; details: Record<string, unknown>; reason: string | null; admin_name: string }[];
};

export type SupportReply = { id: string; body: string; delivery: string; created_at: string; admin_name: string };
export type SupportMessage = {
  id: string; type: 'idea' | 'broken' | 'question'; message: string; screen: string | null; device: string | null; app_version: string | null;
  locale: string; status: 'new' | 'in_progress' | 'waiting_on_stylist' | 'resolved'; created_at: string; has_screenshot: boolean;
  bid: number; business_name: string; stylist_name: string; replies: SupportReply[];
};
export type SupportList = {
  messages: SupportMessage[];
  counts: { all: number; new: number; in_progress: number; waiting_on_stylist: number; resolved: number };
};

export type Switch = { key: 'autopilot' | 'concierge' | 'seat_filler' | 'zelle' | 'reviews' | 'spanish' | 'tap_to_pay'; enabled: boolean; reason: string | null; updated_at: string; updated_by: string | null };

export type Health = {
  checked_at: string;
  stripe_webhooks: { received_24h: number; failed_24h: number };
  texts: { sent_24h: number; failed_24h: number };
  emails: { sent_24h: number; failed_24h: number };
  calendar: { errors: number; stylists_affected: number };
  jobs: { dead_24h: number; stuck: number };
  failed_texts: { id: string; created_at: string; purpose: string; error_code: string | null; bid: number | null; business_name: string | null; client_ref: string | null }[];
  webhook_failures: { id: string; event_type: string; provider_event_id: string; received_at: string }[];
  calendar_errors: { business_id: string; bid: number; business_name: string; updated_at: string }[];
  stuck_jobs: { id: string; job_type: string; status: string; run_at: string; attempts: number; last_error_code: string | null; lease_expires_at: string | null; bid: number | null; business_name: string | null }[];
};

export type ActivityRow = {
  id: string; occurred_at: string; admin_name: string; action: string; object_type: string; object_id: string | null;
  reason: string | null; bid: number | null; business_name: string | null; details: Record<string, unknown>;
};
export type ActivityPage = { rows: ActivityRow[]; has_more: boolean };

export type BlogStatusFilter = 'all' | 'published' | 'scheduled' | 'drafts';
