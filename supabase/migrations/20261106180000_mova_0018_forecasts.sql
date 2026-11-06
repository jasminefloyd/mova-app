create table public.mova_forecasts (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 period_start date not null, period_end date not null check(period_end>period_start), booked_minor bigint not null default 0,
 likely_minor bigint not null default 0, likely_low_minor bigint not null default 0, likely_high_minor bigint not null default 0,
 usual_minor bigint, inputs jsonb not null, method_version text not null, computed_at timestamptz not null default now(),
 unique(artist_business_id,period_start,method_version)
);
alter table public.mova_forecasts enable row level security;
revoke all on public.mova_forecasts from public,anon,authenticated;
create policy mova_forecasts_member_select on public.mova_forecasts for select to authenticated using(public.mova_has_artist_membership(artist_business_id));

