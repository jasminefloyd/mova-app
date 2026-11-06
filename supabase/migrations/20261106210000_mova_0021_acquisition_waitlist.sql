create table public.mova_waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  work_arrangement text not null check (work_arrangement in ('booth_chair_renter','suite_renter','commission_stylist','other_beauty_professional')),
  marketing_opt_in boolean not null default false,
  marketing_opted_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_waitlist_signups_email_normalized_uq unique (email_normalized),
  constraint mova_waitlist_signups_email_nonempty check (length(trim(email)) between 3 and 254),
  constraint mova_waitlist_signups_email_normalized_check check (email_normalized = lower(trim(email))),
  constraint mova_waitlist_signups_marketing_consent_check check (marketing_opt_in = (marketing_opted_in_at is not null))
);

create trigger mova_waitlist_signups_touch_updated_at
  before update on public.mova_waitlist_signups
  for each row execute function public.mova_touch_updated_at();

alter table public.mova_waitlist_signups enable row level security;
revoke all on public.mova_waitlist_signups from public, anon, authenticated;

create function public.mova_waitlist_register(
  p_email text,
  p_email_normalized text,
  p_work_arrangement text,
  p_marketing_opt_in boolean
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  insert into public.mova_waitlist_signups as existing (
    email, email_normalized, work_arrangement, marketing_opt_in, marketing_opted_in_at
  ) values (
    p_email,
    p_email_normalized,
    p_work_arrangement,
    p_marketing_opt_in,
    case when p_marketing_opt_in then now() else null end
  )
  on conflict (email_normalized) do update set
    email = excluded.email,
    work_arrangement = excluded.work_arrangement,
    marketing_opt_in = existing.marketing_opt_in or excluded.marketing_opt_in,
    marketing_opted_in_at = coalesce(existing.marketing_opted_in_at, excluded.marketing_opted_in_at),
    updated_at = now();
$function$;

revoke all on function public.mova_waitlist_register(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.mova_waitlist_register(text,text,text,boolean) to service_role;

comment on table public.mova_waitlist_signups is 'Public acquisition waitlist submissions. Access is restricted to the server-side waitlist function.';
