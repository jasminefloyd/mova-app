-- O2 (2026-11-08): waitlist -> super admin approves -> invite email. First cohort up to 10 stylists.
-- Approving adds the email to mova_early_access_invites (the signup allowlist read by the Before User
-- Created hook) and queues one invite email. Everything here is service-role only; the admin portal (not
-- built yet) and the waitlist-admin Edge Function call it.

alter table public.mova_waitlist_signups
  add column locale text not null default 'en-US' check (locale in ('en-US', 'es-US')),
  add column invite_status text not null default 'waiting' check (invite_status in ('waiting', 'approved', 'invited', 'declined')),
  add column approved_at timestamptz,
  add column invited_at timestamptz,
  add column declined_at timestamptz;
create index mova_waitlist_signups_status_idx on public.mova_waitlist_signups (invite_status, created_at);

-- Platform emails (not tied to a stylist) live in mova_messages too, so they count toward the shared
-- $50/month cap (0047) and respect global email suppressions. Only invite emails may omit the business.
alter table public.mova_messages alter column artist_business_id drop not null;
alter table public.mova_messages add constraint mova_messages_platform_email_check check (
  artist_business_id is not null
  or (channel = 'email' and direction = 'outbound' and origin = 'system' and purpose = 'early_access_invite' and client_id is null)
);
create unique index mova_messages_platform_idempotency_uq on public.mova_messages (idempotency_key) where artist_business_id is null;

-- A 5-argument version adds the visitor's language (used for the invite email). The 0021 signature
-- stays as a wrapper so older callers keep working.
create function public.mova_waitlist_register(
  p_email text, p_email_normalized text, p_work_arrangement text, p_marketing_opt_in boolean, p_locale text
) returns void language sql security definer set search_path = pg_catalog, public as $function$
  insert into public.mova_waitlist_signups as existing (
    email, email_normalized, work_arrangement, marketing_opt_in, marketing_opted_in_at, locale
  ) values (
    p_email, p_email_normalized, p_work_arrangement, p_marketing_opt_in,
    case when p_marketing_opt_in then now() else null end,
    case when p_locale = 'es-US' then 'es-US' else 'en-US' end
  )
  on conflict (email_normalized) do update set
    email = excluded.email,
    work_arrangement = excluded.work_arrangement,
    marketing_opt_in = existing.marketing_opt_in or excluded.marketing_opt_in,
    marketing_opted_in_at = coalesce(existing.marketing_opted_in_at, excluded.marketing_opted_in_at),
    locale = excluded.locale,
    updated_at = now();
$function$;
revoke all on function public.mova_waitlist_register(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.mova_waitlist_register(text, text, text, boolean, text) to service_role;

create or replace function public.mova_waitlist_register(p_email text, p_email_normalized text, p_work_arrangement text, p_marketing_opt_in boolean)
returns void language sql security definer set search_path = pg_catalog, public as $function$
  select public.mova_waitlist_register(p_email, p_email_normalized, p_work_arrangement, p_marketing_opt_in, 'en-US');
$function$;
revoke all on function public.mova_waitlist_register(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mova_waitlist_register(text, text, text, boolean) to service_role;

-- Cohort size: setting mova.early_access_cap, default 10 (O2). Counts every email on the allowlist.
create or replace function public.mova_early_access_cap() returns integer language sql stable as $$
  select coalesce(nullif(current_setting('mova.early_access_cap', true), '')::integer, 10);
$$;
revoke all on function public.mova_early_access_cap() from public, anon, authenticated;
grant execute on function public.mova_early_access_cap() to service_role;

create or replace function public.mova_waitlist_admin_list()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'cap', public.mova_early_access_cap(),
    'used', (select count(*) from public.mova_early_access_invites),
    'signups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'email', s.email, 'work_arrangement', s.work_arrangement, 'locale', s.locale,
        'marketing_opt_in', s.marketing_opt_in, 'created_at', s.created_at, 'invite_status', s.invite_status,
        'approved_at', s.approved_at, 'invited_at', s.invited_at,
        'has_account', exists (select 1 from auth.users u where lower(btrim(u.email)) = s.email_normalized)
      ) order by s.created_at)
      from public.mova_waitlist_signups s), '[]'::jsonb)
  );
$$;
revoke all on function public.mova_waitlist_admin_list() from public, anon, authenticated;
grant execute on function public.mova_waitlist_admin_list() to service_role;

create or replace function public.mova_waitlist_approve(p_signup_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer := public.mova_early_access_cap();
  used integer;
  adding integer;
  signup record;
  approved integer := 0;
begin
  -- One approval at a time, so two admins cannot overshoot the cohort together.
  perform pg_advisory_xact_lock(hashtext('mova_early_access_cohort'));
  select count(*) into used from public.mova_early_access_invites;
  select count(*) into adding from public.mova_waitlist_signups s
    where s.id = any(p_signup_ids) and s.invite_status in ('waiting', 'declined')
      and not exists (select 1 from public.mova_early_access_invites i where i.email_normalized = s.email_normalized);
  if used + adding > cap then
    raise exception using errcode = 'P0001', message = 'EARLY_ACCESS_CAP_REACHED', detail = format('%s of %s places used', used, cap);
  end if;
  for signup in select * from public.mova_waitlist_signups s
      where s.id = any(p_signup_ids) and s.invite_status in ('waiting', 'declined') order by s.created_at for update loop
    insert into public.mova_early_access_invites (email_normalized) values (signup.email_normalized) on conflict do nothing;
    update public.mova_waitlist_signups set invite_status = 'approved', approved_at = now(), declined_at = null, updated_at = now()
      where id = signup.id;
    insert into public.mova_background_jobs (job_type, payload, idempotency_key)
      values ('early_access_invite', jsonb_build_object('signup_id', signup.id), 'early_access_invite:' || signup.id)
      on conflict (idempotency_key) do nothing;
    approved := approved + 1;
  end loop;
  return jsonb_build_object('approved', approved, 'used', used + adding, 'cap', cap);
end $$;
revoke all on function public.mova_waitlist_approve(uuid[]) from public, anon, authenticated;
grant execute on function public.mova_waitlist_approve(uuid[]) to service_role;

create or replace function public.mova_waitlist_decline(p_signup_ids uuid[])
returns integer language sql security definer set search_path = public, pg_temp as $$
  with changed as (
    update public.mova_waitlist_signups set invite_status = 'declined', declined_at = now(), updated_at = now()
    where id = any(p_signup_ids) and invite_status = 'waiting' returning 1
  ) select count(*)::integer from changed;
$$;
revoke all on function public.mova_waitlist_decline(uuid[]) from public, anon, authenticated;
grant execute on function public.mova_waitlist_decline(uuid[]) to service_role;

-- For the job worker: what the invite email needs, and marking it sent.
create or replace function public.mova_waitlist_invite_context(p_signup_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('email', s.email_normalized, 'locale', s.locale, 'invite_status', s.invite_status,
    'allowlisted', exists (select 1 from public.mova_early_access_invites i where i.email_normalized = s.email_normalized))
  from public.mova_waitlist_signups s where s.id = p_signup_id;
$$;
revoke all on function public.mova_waitlist_invite_context(uuid) from public, anon, authenticated;
grant execute on function public.mova_waitlist_invite_context(uuid) to service_role;

create or replace function public.mova_waitlist_mark_invited(p_signup_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  with changed as (
    update public.mova_waitlist_signups set invite_status = 'invited', invited_at = now(), updated_at = now()
    where id = p_signup_id and invite_status = 'approved' returning 1
  ) select exists (select 1 from changed);
$$;
revoke all on function public.mova_waitlist_mark_invited(uuid) from public, anon, authenticated;
grant execute on function public.mova_waitlist_mark_invited(uuid) to service_role;

-- Re-queue an invite that was approved but never sent (for example, the email cap was reached).
create or replace function public.mova_waitlist_resend_invite(p_signup_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.mova_waitlist_signups where id = p_signup_id and invite_status = 'approved') then return false; end if;
  insert into public.mova_background_jobs (job_type, payload, idempotency_key)
    values ('early_access_invite', jsonb_build_object('signup_id', p_signup_id), 'early_access_invite:' || p_signup_id || ':' || extract(epoch from clock_timestamp())::bigint);
  return true;
end $$;
revoke all on function public.mova_waitlist_resend_invite(uuid) from public, anon, authenticated;
grant execute on function public.mova_waitlist_resend_invite(uuid) to service_role;
