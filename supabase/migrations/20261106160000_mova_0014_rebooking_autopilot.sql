create table public.mova_growth_opportunities (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 client_id uuid not null, service_id uuid not null, service_category text, last_visit_at timestamptz not null, next_due_at timestamptz not null,
 window_end_at timestamptz not null, confidence text not null check(confidence in ('low','medium','high')),
 evidence jsonb not null default '{}', model_version text not null, status text not null default 'due' check(status in ('due','contacted','rebooked','no_reply','ineligible')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade,
 unique(artist_business_id,client_id,service_id)
);
create index mova_growth_opportunities_due_idx on public.mova_growth_opportunities(artist_business_id,next_due_at) where status='due';
create table public.mova_autopilot_settings (
 artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
 enabled boolean not null default false, slot_texts_autopilot boolean not null default false,
 rules jsonb not null default '{"new_client_weeks":6,"attribution_days":14,"per_client_days":14,"per_cycle_max":2,"daily_cap":10,"quiet_start":"09:00","quiet_end":"20:00"}'::jsonb,
 updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table public.mova_autopilot_decisions (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 client_id uuid, opportunity_id uuid references public.mova_growth_opportunities(id) on delete set null,
 slot_event_id uuid, action text not null check(action in ('sent','skipped','held','failed','rebooked')),
 reason_code text not null, consent_id uuid references public.mova_client_consents(id) on delete set null,
 message_id uuid references public.mova_messages(id) on delete set null, value_minor bigint,
 idempotency_key text not null, created_at timestamptz not null default now(),
 unique(artist_business_id,idempotency_key)
);
create index mova_autopilot_decisions_history_idx on public.mova_autopilot_decisions(artist_business_id,created_at desc);
alter table public.mova_growth_opportunities enable row level security;
alter table public.mova_autopilot_settings enable row level security;
alter table public.mova_autopilot_decisions enable row level security;
revoke all on public.mova_growth_opportunities,public.mova_autopilot_settings,public.mova_autopilot_decisions from public,anon,authenticated;
create policy mova_growth_opportunities_member_select on public.mova_growth_opportunities for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_autopilot_settings_member_select on public.mova_autopilot_settings for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_autopilot_decisions_member_select on public.mova_autopilot_decisions for select to authenticated using(public.mova_has_artist_membership(artist_business_id));

