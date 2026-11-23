-- Free trial (owner decisions D1–D9, Nov 22): every new stylist gets 30 days of AI + Growth with a card
-- collected up front. Stripe owns the subscription; this migration records trials, keeps the plan and fee
-- in step with Stripe, and schedules the trial messages. Off until the `trial_enabled` platform switch is on.

-- 1. Platform switch (default off in every environment).
alter table public.mova_platform_switches drop constraint if exists mova_platform_switches_key_check;
alter table public.mova_platform_switches add constraint mova_platform_switches_key_check
  check (key in ('autopilot','concierge','seat_filler','zelle','reviews','spanish','tap_to_pay','marketing_email','marketing_social','marketing_web_push','marketing_wallet','trial_enabled'));
insert into public.mova_platform_switches (key, enabled, reason)
values ('trial_enabled', false, 'Turn on after the Stripe test-clock run passes')
on conflict (key) do nothing;

-- 2. Who set the current plan. An admin-assigned plan is never overwritten by Stripe and hides trial UI.
alter table public.mova_business_plan_assignments
  add column if not exists assignment_source text not null default 'default'
  check (assignment_source in ('default','stripe','admin'));

-- 3. Subscription details the trial screens and messages need. Never the full card.
alter table public.mova_billing_subscriptions
  add column if not exists trial_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists current_period_end timestamptz,
  add column if not exists pending_plan_key text check (pending_plan_key is null or pending_plan_key in ('pro','ai_growth','free')),
  add column if not exists past_due_since timestamptz,
  add column if not exists payment_method_brand text check (payment_method_brand is null or length(payment_method_brand) <= 40),
  add column if not exists payment_method_last4 text check (payment_method_last4 is null or payment_method_last4 ~ '^[0-9]{4}$'),
  add column if not exists last_event_at timestamptz;
alter table public.mova_billing_subscriptions drop constraint if exists mova_billing_subscriptions_status_check;
alter table public.mova_billing_subscriptions add constraint mova_billing_subscriptions_status_check
  check (status in ('active','trialing','past_due','canceled','incomplete','unpaid','incomplete_expired'));

-- 4. Trials. One live row per business; one started trial per stylist (D6). An admin can release the lock.
create table public.mova_plan_trials (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  offered_at timestamptz,
  declined_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  after_trial_plan text not null default 'ai_growth' check (after_trial_plan in ('ai_growth','pro','free')),
  stripe_subscription_id text check (stripe_subscription_id is null or stripe_subscription_id like 'sub\_%'),
  card_fingerprint text check (card_fingerprint is null or length(card_fingerprint) <= 64),
  reminder_7d_at timestamptz,
  reminder_1d_at timestamptz,
  converted_at timestamptz,
  ended_at timestamptz,
  released_at timestamptz,
  released_reason text check (released_reason is null or length(released_reason) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index mova_plan_trials_business_live_uq on public.mova_plan_trials(artist_business_id) where released_at is null;
create unique index mova_plan_trials_user_started_uq on public.mova_plan_trials(user_id) where started_at is not null and released_at is null;
create index mova_plan_trials_reminders_idx on public.mova_plan_trials(ends_at) where started_at is not null and ended_at is null and released_at is null;
create trigger mova_plan_trials_touch_updated_at before update on public.mova_plan_trials for each row execute function public.mova_touch_updated_at();
alter table public.mova_plan_trials enable row level security;
revoke all on public.mova_plan_trials from public, anon, authenticated;
grant select on public.mova_plan_trials to authenticated;
grant all on public.mova_plan_trials to service_role;
create policy mova_plan_trials_member_select on public.mova_plan_trials for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));

-- 5. Idempotency log for the billing webhook. Service role only.
create table public.mova_billing_events (
  stripe_event_id text primary key check (stripe_event_id like 'evt\_%'),
  type text not null check (length(type) <= 120),
  livemode boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text check (error is null or length(error) <= 500)
);
alter table public.mova_billing_events enable row level security;
revoke all on public.mova_billing_events from public, anon, authenticated;
grant all on public.mova_billing_events to service_role;

-- 6. Account texts (trial and billing) need their own consent. Not client consent, not a stylist's number.
create table public.mova_account_sms_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  consent_text_version text not null check (length(consent_text_version) between 1 and 40),
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  source text not null default 'settings' check (source in ('start_trial','settings','sms_keyword')),
  updated_at timestamptz not null default now()
);
create index mova_account_sms_consents_phone_idx on public.mova_account_sms_consents(phone_e164);
create trigger mova_account_sms_consents_touch_updated_at before update on public.mova_account_sms_consents for each row execute function public.mova_touch_updated_at();
alter table public.mova_account_sms_consents enable row level security;
revoke all on public.mova_account_sms_consents from public, anon, authenticated;
grant select on public.mova_account_sms_consents to authenticated;
grant all on public.mova_account_sms_consents to service_role;
create policy mova_account_sms_consents_own_select on public.mova_account_sms_consents for select to authenticated
  using (user_id = auth.uid());

-- Every account text attempt (sent, skipped or failed), for the 5-per-trial cap and support.
create table public.mova_account_sms_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_business_id uuid references public.mova_artist_businesses(id) on delete cascade,
  event_type text not null check (length(event_type) <= 80),
  idempotency_key text not null unique check (length(idempotency_key) <= 200),
  phone_e164 text,
  status text not null check (status in ('sent','skipped','failed','deferred')),
  reason text check (reason is null or length(reason) <= 80),
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index mova_account_sms_log_user_idx on public.mova_account_sms_log(user_id, created_at desc);
alter table public.mova_account_sms_log enable row level security;
revoke all on public.mova_account_sms_log from public, anon, authenticated;
grant all on public.mova_account_sms_log to service_role;

-- 7. Marketing campaigns paused by a downgrade keep their content and come back on unlock.
alter table public.mova_marketing_campaigns drop constraint if exists mova_marketing_campaigns_status_check;
alter table public.mova_marketing_campaigns add constraint mova_marketing_campaigns_status_check
  check (status in ('draft','scheduled','sending','sent','partial','failed','cancelled','paused_plan'));

-- 8. During a trial the Mova fee is the Free rate (D4). Stylist fee overrides still win.
create or replace function public.mova_business_fee(p_artist_business_id uuid, p_at timestamptz default now())
returns table(fee_bps integer, platform_fee_version integer, plan_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(o.fee_bps, plan.mova_fee_basis_points, platform.fee_bps),
         case when o.fee_bps is not null then null when plan.mova_fee_basis_points is null then platform.version end,
         plan.plan_key
  from public.mova_current_platform_fee(p_at) as platform
  left join lateral (
    select c.plan_key, c.mova_fee_basis_points
    from public.mova_business_plan_assignments a
    join public.mova_plan_catalog c on c.status = 'active' and c.plan_key = case
      when exists (select 1 from public.mova_billing_subscriptions s
                   where s.artist_business_id = a.artist_business_id and s.status = 'trialing') then 'free'
      else a.plan_key end
    where a.artist_business_id = p_artist_business_id and a.assignment_status = 'current'
  ) as plan on true
  left join lateral (
    select f.fee_bps
    from public.mova_stylist_fee_overrides f
    where f.artist_business_id = p_artist_business_id and f.starts_at <= p_at and (f.ends_at is null or f.ends_at > p_at)
    order by f.starts_at desc, f.created_at desc
    limit 1
  ) as o on true;
$$;
revoke all on function public.mova_business_fee(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_business_fee(uuid, timestamptz) to service_role;

-- 9. Admin-assigned plans are marked so Stripe never overwrites them.
create or replace function public.mova_admin_set_stylist_plan(
  p_artist_business_id uuid, p_plan_key text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_before text;
begin
  if not exists(select 1 from public.mova_artist_businesses where id=p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  if not exists(select 1 from public.mova_plan_catalog where plan_key=p_plan_key and status='active') then
    raise exception using errcode = '22023', message = 'PLAN_INVALID';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  select plan_key into v_before from public.mova_business_plan_assignments
    where artist_business_id=p_artist_business_id and assignment_status='current' for update;
  insert into public.mova_business_plan_assignments(artist_business_id,plan_key,assignment_status,assignment_source)
    values(p_artist_business_id,p_plan_key,'current','admin')
    on conflict(artist_business_id) do update set plan_key=excluded.plan_key,assignment_status='current',assignment_source='admin',updated_at=now();
  perform public.mova_admin_log('stylist.plan_assigned','artist_business',p_artist_business_id::text,p_artist_business_id,btrim(p_reason),
    jsonb_build_object('from',coalesce(v_before,'free'),'to',p_plan_key,'source','admin'));
  return public.mova_admin_stylist_feature_controls(p_artist_business_id);
end $$;

-- 10. Plan side effects when the plan goes down or up. Idempotent.
create or replace function public.mova_apply_plan_side_effects(p_artist_business_id uuid, p_from text, p_to text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_marketing boolean;
begin
  v_marketing := coalesce((select (c.entitlements->'features'->>'marketing_email')::boolean
                           from public.mova_plan_catalog c where c.plan_key = p_to), false);
  if not v_marketing then
    update public.mova_marketing_campaigns set status = 'paused_plan', updated_at = now()
    where artist_business_id = p_artist_business_id and status = 'scheduled';
  else
    update public.mova_marketing_campaigns
    set status = case when scheduled_at is not null and scheduled_at > now() then 'scheduled' else 'draft' end, updated_at = now()
    where artist_business_id = p_artist_business_id and status = 'paused_plan';
  end if;
end $$;
revoke all on function public.mova_apply_plan_side_effects(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mova_apply_plan_side_effects(uuid, text, text) to service_role;

-- 11. The single writer for Stripe billing state: subscription row, trial row and plan assignment.
--     Rules (WP3): trialing → ai_growth; active → the price's plan; past_due → keep the paid plan;
--     canceled/unpaid/incomplete_expired → free; incomplete → unchanged. Admin assignments win.
create or replace function public.mova_apply_billing_state(
  p_artist_business_id uuid,
  p_customer text,
  p_subscription text,
  p_status text,
  p_price_plan text,
  p_trial_end timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_current_period_end timestamptz default null,
  p_livemode boolean default false,
  p_card_brand text default null,
  p_card_last4 text default null,
  p_card_fingerprint text default null,
  p_event_at timestamptz default now(),
  p_owner_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev public.mova_billing_subscriptions%rowtype;
  v_prev_plan text; v_source text; v_new_plan text; v_after text;
  v_trial public.mova_plan_trials%rowtype;
  v_trial_started boolean := false; v_converted boolean := false; v_trial_ended boolean := false;
  v_owner uuid;
begin
  if p_price_plan not in ('pro','ai_growth') then raise exception using errcode = '22023', message = 'PLAN_INVALID'; end if;
  if p_status not in ('active','trialing','past_due','canceled','incomplete','unpaid','incomplete_expired') then
    raise exception using errcode = '22023', message = 'SUBSCRIPTION_STATUS_INVALID';
  end if;
  select * into v_prev from public.mova_billing_subscriptions where artist_business_id = p_artist_business_id for update;
  if found and v_prev.last_event_at is not null and p_event_at < v_prev.last_event_at
     and v_prev.stripe_subscription_id is not distinct from p_subscription then
    return jsonb_build_object('ignored', true, 'reason', 'stale_event');
  end if;
  -- A different, older subscription never replaces a live one.
  if found and v_prev.stripe_subscription_id is distinct from p_subscription
     and v_prev.status in ('active','trialing','past_due') and p_status not in ('active','trialing','past_due') then
    return jsonb_build_object('ignored', true, 'reason', 'other_subscription_live');
  end if;

  v_after := case when p_cancel_at_period_end then 'free' else p_price_plan end;

  insert into public.mova_billing_subscriptions as s (artist_business_id, plan_key, stripe_customer_id, stripe_subscription_id, status, livemode,
    trial_end, cancel_at_period_end, current_period_end, pending_plan_key, past_due_since, payment_method_brand, payment_method_last4, last_event_at)
  values (p_artist_business_id, p_price_plan, p_customer, p_subscription, p_status, p_livemode,
    p_trial_end, coalesce(p_cancel_at_period_end, false), p_current_period_end, v_after,
    case when p_status = 'past_due' then now() end, p_card_brand, p_card_last4, p_event_at)
  on conflict (artist_business_id) do update set
    plan_key = excluded.plan_key, stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status, livemode = excluded.livemode, trial_end = excluded.trial_end,
    cancel_at_period_end = excluded.cancel_at_period_end, current_period_end = excluded.current_period_end,
    pending_plan_key = excluded.pending_plan_key,
    past_due_since = case when excluded.status = 'past_due' then coalesce(s.past_due_since, now()) else null end,
    payment_method_brand = coalesce(excluded.payment_method_brand, s.payment_method_brand),
    payment_method_last4 = coalesce(excluded.payment_method_last4, s.payment_method_last4),
    last_event_at = greatest(coalesce(s.last_event_at, excluded.last_event_at), excluded.last_event_at),
    updated_at = now();

  select plan_key, assignment_source into v_prev_plan, v_source
  from public.mova_business_plan_assignments where artist_business_id = p_artist_business_id for update;
  v_prev_plan := coalesce(v_prev_plan, 'free');
  v_new_plan := case
    when p_status = 'trialing' then 'ai_growth'
    when p_status = 'active' then p_price_plan
    when p_status = 'past_due' then case when v_prev_plan = 'free' then p_price_plan else v_prev_plan end
    when p_status = 'incomplete' then v_prev_plan
    else 'free' end;
  if coalesce(v_source, 'default') <> 'admin' then
    insert into public.mova_business_plan_assignments(artist_business_id, plan_key, assignment_status, assignment_source)
    values (p_artist_business_id, v_new_plan, 'current', 'stripe')
    on conflict (artist_business_id) do update set plan_key = excluded.plan_key, assignment_status = 'current', assignment_source = 'stripe', updated_at = now();
    if v_new_plan is distinct from v_prev_plan then
      perform public.mova_apply_plan_side_effects(p_artist_business_id, v_prev_plan, v_new_plan);
    end if;
  else
    v_new_plan := v_prev_plan;
  end if;

  -- Trial row.
  select * into v_trial from public.mova_plan_trials where artist_business_id = p_artist_business_id and released_at is null for update;
  if p_status = 'trialing' then
    v_owner := coalesce(v_trial.user_id, p_owner_user_id, (select m.user_id from public.mova_artist_memberships m
      where m.artist_business_id = p_artist_business_id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1));
    if v_owner is null then raise exception using errcode = '22023', message = 'OWNER_NOT_FOUND'; end if;
    if v_trial.id is null then
      insert into public.mova_plan_trials(artist_business_id, user_id, offered_at, started_at, ends_at, after_trial_plan, stripe_subscription_id, card_fingerprint)
      values (p_artist_business_id, v_owner, now(), now(), p_trial_end, v_after, p_subscription, p_card_fingerprint);
      v_trial_started := true;
    else
      update public.mova_plan_trials set
        started_at = coalesce(started_at, now()), ends_at = coalesce(p_trial_end, ends_at), after_trial_plan = v_after,
        stripe_subscription_id = p_subscription, card_fingerprint = coalesce(p_card_fingerprint, card_fingerprint)
      where id = v_trial.id;
      v_trial_started := v_trial.started_at is null;
    end if;
  elsif v_trial.id is not null and v_trial.started_at is not null and v_trial.stripe_subscription_id is not distinct from p_subscription then
    if p_status = 'active' and v_trial.converted_at is null and v_trial.ended_at is null then
      update public.mova_plan_trials set converted_at = now(), after_trial_plan = p_price_plan where id = v_trial.id;
      v_converted := true;
    elsif p_status in ('canceled','unpaid','incomplete_expired') and v_trial.ended_at is null then
      update public.mova_plan_trials set ended_at = now() where id = v_trial.id;
      v_trial_ended := v_trial.converted_at is null;
    end if;
  end if;

  return jsonb_build_object(
    'ignored', false,
    'previous_status', v_prev.status,
    'status', p_status,
    'previous_plan', v_prev_plan,
    'plan_key', v_new_plan,
    'admin_assigned', coalesce(v_source, 'default') = 'admin',
    'trial_started', v_trial_started,
    'trial_converted', v_converted,
    'trial_ended_free', v_trial_ended
  );
end $$;
revoke all on function public.mova_apply_billing_state(uuid, text, text, text, text, timestamptz, boolean, timestamptz, boolean, text, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.mova_apply_billing_state(uuid, text, text, text, text, timestamptz, boolean, timestamptz, boolean, text, text, text, timestamptz, uuid) to service_role;

-- The older writer follows the same rules: past_due keeps the paid plan; admin assignments win.
create or replace function public.mova_apply_plan_subscription(
  p_artist_business_id uuid, p_plan_key text, p_customer text, p_subscription text, p_status text, p_livemode boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_plan_key not in ('pro', 'ai_growth') then raise exception using errcode = '22023', message = 'PLAN_INVALID'; end if;
  perform public.mova_apply_billing_state(p_artist_business_id, p_customer, p_subscription, p_status, p_plan_key,
    null, false, null, p_livemode, null, null, null, now(), null);
  return public.mova_plan_entitlement_summary(p_artist_business_id);
end $$;
revoke all on function public.mova_apply_plan_subscription(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mova_apply_plan_subscription(uuid, text, text, text, text, boolean) to service_role;

-- 12. The trial and billing state the app shows. Members only.
create or replace function public.mova_trial_status_internal(p_artist_business_id uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_switch boolean; v_sub public.mova_billing_subscriptions%rowtype; v_trial public.mova_plan_trials%rowtype;
  v_source text; v_plan text; v_owner boolean; v_owner_user uuid; v_onboarded boolean; v_used boolean;
  v_state text; v_eligible boolean; v_days integer; v_after text;
begin
  v_switch := coalesce((select enabled from public.mova_platform_switches where key = 'trial_enabled'), false);
  select * into v_sub from public.mova_billing_subscriptions where artist_business_id = p_artist_business_id;
  select * into v_trial from public.mova_plan_trials where artist_business_id = p_artist_business_id and released_at is null;
  select plan_key, assignment_source into v_plan, v_source from public.mova_business_plan_assignments
    where artist_business_id = p_artist_business_id and assignment_status = 'current';
  v_plan := coalesce(v_plan, 'free');
  v_owner := exists(select 1 from public.mova_artist_memberships m where m.artist_business_id = p_artist_business_id
    and m.user_id = p_user and m.role = 'owner' and m.status = 'active');
  select m.user_id into v_owner_user from public.mova_artist_memberships m where m.artist_business_id = p_artist_business_id
    and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1;
  v_onboarded := exists(select 1 from public.mova_onboarding_progress o where o.artist_business_id = p_artist_business_id and o.current_step = 'complete');
  -- One trial per stylist across all their businesses.
  v_used := exists(select 1 from public.mova_plan_trials t where t.started_at is not null and t.released_at is null
    and (t.artist_business_id = p_artist_business_id or t.user_id = v_owner_user));
  v_eligible := v_switch and not v_used and coalesce(v_source, 'default') <> 'admin'
    and coalesce(v_sub.status, 'none') not in ('active','trialing','past_due');

  v_state := case
    when coalesce(v_source, 'default') = 'admin' then 'admin'
    when v_sub.status = 'trialing' then 'trialing'
    when v_sub.status = 'past_due' then 'past_due'
    when v_sub.status = 'active' then 'active'
    when v_trial.started_at is not null then 'ended_free'
    when v_eligible and v_trial.declined_at is not null then 'declined'
    when v_eligible then 'eligible'
    else 'free' end;
  v_after := case when v_sub.status = 'trialing' then coalesce(v_sub.pending_plan_key, v_trial.after_trial_plan, 'ai_growth') else v_trial.after_trial_plan end;
  if v_sub.status = 'trialing' and v_sub.trial_end is not null then
    v_days := greatest(0, ceil(extract(epoch from (v_sub.trial_end - now())) / 86400.0)::integer);
  end if;

  return jsonb_build_object(
    'enabled', v_switch,
    'state', v_state,
    'eligible', v_eligible,
    'is_owner', v_owner,
    'should_offer', v_eligible and v_owner and v_onboarded and v_trial.offered_at is null,
    'plan_key', v_plan,
    'admin_assigned', coalesce(v_source, 'default') = 'admin',
    'offered_at', v_trial.offered_at,
    'declined_at', v_trial.declined_at,
    'started_at', v_trial.started_at,
    'ends_at', coalesce(case when v_sub.status = 'trialing' then v_sub.trial_end end, v_trial.ends_at),
    'ended_at', v_trial.ended_at,
    'days_left', v_days,
    'trial_days', 30,
    'after_trial_plan', v_after,
    'subscription_plan', v_sub.plan_key,
    'subscription_status', v_sub.status,
    'cancel_at_period_end', coalesce(v_sub.cancel_at_period_end, false),
    'current_period_end', v_sub.current_period_end,
    'card', case when v_sub.payment_method_last4 is null then null
      else jsonb_build_object('brand', v_sub.payment_method_brand, 'last4', v_sub.payment_method_last4) end,
    'has_customer', v_sub.stripe_customer_id is not null,
    'past_due_since', v_sub.past_due_since,
    'grace_ends_at', v_sub.past_due_since + interval '7 days'
  );
end $$;
revoke all on function public.mova_trial_status_internal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mova_trial_status_internal(uuid, uuid) to service_role;

create or replace function public.mova_trial_status(p_artist_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.mova_has_artist_membership(p_artist_business_id) then
    raise exception using errcode = '42501', message = 'NOT_A_MEMBER';
  end if;
  return public.mova_trial_status_internal(p_artist_business_id, auth.uid());
end $$;
revoke all on function public.mova_trial_status(uuid) from public, anon;
grant execute on function public.mova_trial_status(uuid) to authenticated, service_role;

-- 13. T1 shown (and "Continue on Free"). Owner only. Never touches a started trial.
create or replace function public.mova_record_trial_offer(p_artist_business_id uuid, p_declined boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists(select 1 from public.mova_artist_memberships m where m.artist_business_id = p_artist_business_id
      and m.user_id = v_user and m.role = 'owner' and m.status = 'active') then
    raise exception using errcode = '42501', message = 'OWNER_REQUIRED';
  end if;
  insert into public.mova_plan_trials(artist_business_id, user_id, offered_at, declined_at)
  values (p_artist_business_id, v_user, now(), case when p_declined then now() end)
  on conflict (artist_business_id) where released_at is null do update set
    offered_at = coalesce(public.mova_plan_trials.offered_at, now()),
    declined_at = case when p_declined and public.mova_plan_trials.started_at is null then now() else public.mova_plan_trials.declined_at end;
  return public.mova_trial_status_internal(p_artist_business_id, v_user);
end $$;
revoke all on function public.mova_record_trial_offer(uuid, boolean) from public, anon;
grant execute on function public.mova_record_trial_offer(uuid, boolean) to authenticated, service_role;

-- The after-trial choice, written by plan-management once Stripe accepted it.
create or replace function public.mova_set_after_trial_plan(p_artist_business_id uuid, p_plan text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_plan not in ('ai_growth','pro','free') then raise exception using errcode = '22023', message = 'PLAN_INVALID'; end if;
  update public.mova_plan_trials set after_trial_plan = p_plan where artist_business_id = p_artist_business_id and released_at is null;
  update public.mova_billing_subscriptions set pending_plan_key = p_plan, cancel_at_period_end = (p_plan = 'free'), updated_at = now()
  where artist_business_id = p_artist_business_id;
end $$;
revoke all on function public.mova_set_after_trial_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.mova_set_after_trial_plan(uuid, text) to service_role;

-- 14. Account SMS consent (trial and billing texts). The caller's own row only.
create or replace function public.mova_set_account_sms_consent(p_phone text, p_consent boolean, p_source text default 'settings')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_user is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if p_source not in ('start_trial','settings') then raise exception using errcode = '22023', message = 'SOURCE_INVALID'; end if;
  if p_consent then
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception using errcode = '22023', message = 'PHONE_INVALID'; end if;
    insert into public.mova_account_sms_consents(user_id, phone_e164, consent_text_version, consented_at, revoked_at, source)
    values (v_user, v_phone, 'trial-billing-v1', now(), null, p_source)
    on conflict (user_id) do update set phone_e164 = excluded.phone_e164, consent_text_version = excluded.consent_text_version,
      consented_at = now(), revoked_at = null, source = excluded.source;
  else
    update public.mova_account_sms_consents set revoked_at = coalesce(revoked_at, now()) where user_id = v_user;
  end if;
  return public.mova_account_sms_status();
end $$;
revoke all on function public.mova_set_account_sms_consent(text, boolean, text) from public, anon;
grant execute on function public.mova_set_account_sms_consent(text, boolean, text) to authenticated;

create or replace function public.mova_account_sms_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('enabled', c.revoked_at is null, 'phone', c.phone_e164, 'consented_at', c.consented_at, 'revoked_at', c.revoked_at)
    from public.mova_account_sms_consents c where c.user_id = auth.uid()), jsonb_build_object('enabled', false, 'phone', null));
$$;
revoke all on function public.mova_account_sms_status() from public, anon;
grant execute on function public.mova_account_sms_status() to authenticated;

-- STOP / START from the platform number. Service role (inbound SMS handler).
create or replace function public.mova_account_sms_keyword(p_phone text, p_keyword text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_keyword = 'stop' then
    update public.mova_account_sms_consents set revoked_at = now(), source = 'sms_keyword' where phone_e164 = p_phone and revoked_at is null;
  elsif p_keyword = 'start' then
    update public.mova_account_sms_consents set revoked_at = null, consented_at = now(), source = 'sms_keyword' where phone_e164 = p_phone and revoked_at is not null;
  else
    return 0;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mova_account_sms_keyword(text, text) from public, anon, authenticated;
grant execute on function public.mova_account_sms_keyword(text, text) to service_role;

-- 15. Business time zone for account messages: the first active location's, else New York.
create or replace function public.mova_business_time_zone(p_artist_business_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select l.time_zone from public.mova_locations l
    where l.artist_business_id = p_artist_business_id and l.is_active order by l.created_at limit 1), 'America/New_York');
$$;
revoke all on function public.mova_business_time_zone(uuid) from public, anon, authenticated;
grant execute on function public.mova_business_time_zone(uuid) to service_role;

-- 16. Reminders 7 days and 1 day before the trial ends, at 10:00 business time. Called every minute by
--     job-dispatch. A reminder more than 24 hours late is stale and skipped.
create or replace function public.mova_enqueue_trial_messages(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_tz text; v_fire timestamptz; v_kind text; v_days integer; queued integer := 0; n integer;
begin
  for r in
    select t.*, s.status as sub_status
    from public.mova_plan_trials t
    join public.mova_billing_subscriptions s on s.artist_business_id = t.artist_business_id and s.stripe_subscription_id is not distinct from t.stripe_subscription_id
    where t.started_at is not null and t.ended_at is null and t.released_at is null and t.ends_at is not null
      and s.status = 'trialing' and t.ends_at > p_now and t.ends_at <= p_now + interval '8 days'
  loop
    v_tz := public.mova_business_time_zone(r.artist_business_id);
    foreach v_kind in array array['7d','1d'] loop
      v_days := case v_kind when '7d' then 7 else 1 end;
      continue when (v_kind = '7d' and r.reminder_7d_at is not null) or (v_kind = '1d' and r.reminder_1d_at is not null);
      v_fire := ((((r.ends_at at time zone v_tz) - make_interval(days => v_days))::date) + time '10:00') at time zone v_tz;
      continue when p_now < v_fire;
      if p_now < v_fire + interval '24 hours' then
        insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
        values (r.artist_business_id, 'plan_trial', r.id, 'trial.reminder_' || v_kind,
          jsonb_build_object('ends_at', r.ends_at),
          'trial-reminder-' || v_kind || ':' || r.artist_business_id::text || ':' || to_char(r.ends_at at time zone 'UTC', 'YYYYMMDDHH24MI'))
        on conflict (idempotency_key) do nothing;
        get diagnostics n = row_count;
        queued := queued + n;
      end if;
      if v_kind = '7d' then update public.mova_plan_trials set reminder_7d_at = p_now where id = r.id;
      else update public.mova_plan_trials set reminder_1d_at = p_now where id = r.id; end if;
    end loop;
  end loop;
  return queued;
end $$;
revoke all on function public.mova_enqueue_trial_messages(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_enqueue_trial_messages(timestamptz) to service_role;

-- 17. Everything an account message needs about the business owner and the subscription.
create or replace function public.mova_account_message_context(p_artist_business_id uuid)
returns jsonb language sql stable security definer set search_path = public, auth, pg_temp as $$
  select jsonb_build_object(
    'artist_business_id', b.id,
    'business_number', b.business_number,
    'locale', coalesce(p.preferred_locale, 'en-US'),
    'time_zone', public.mova_business_time_zone(b.id),
    'owner', (select jsonb_build_object('user_id', u.id, 'email', u.email,
        'first_name', coalesce(nullif(trim(n.first_name), ''), nullif(trim(u.raw_user_meta_data->>'first_name'), ''), p.display_name, b.name),
        'sms', (select jsonb_build_object('phone', c.phone_e164) from public.mova_account_sms_consents c where c.user_id = u.id and c.revoked_at is null))
      from public.mova_artist_memberships mm join auth.users u on u.id = mm.user_id
      left join public.mova_account_names n on n.user_id = u.id
      where mm.artist_business_id = b.id and mm.role = 'owner' and mm.status = 'active' order by mm.created_at limit 1),
    'subscription', (select jsonb_build_object('status', s.status, 'plan_key', s.plan_key, 'pending_plan_key', s.pending_plan_key,
        'trial_end', s.trial_end, 'cancel_at_period_end', s.cancel_at_period_end, 'past_due_since', s.past_due_since,
        'card_brand', s.payment_method_brand, 'card_last4', s.payment_method_last4)
      from public.mova_billing_subscriptions s where s.artist_business_id = b.id),
    'trial', (select jsonb_build_object('id', t.id, 'started_at', t.started_at, 'ends_at', t.ends_at, 'after_trial_plan', t.after_trial_plan)
      from public.mova_plan_trials t where t.artist_business_id = b.id and t.released_at is null),
    'plans', (select jsonb_object_agg(c.plan_key, jsonb_build_object('display_name', c.display_name, 'monthly_price_minor', c.monthly_price_minor))
      from public.mova_plan_catalog c where c.status = 'active')
  )
  from public.mova_artist_businesses b left join public.mova_artist_profiles p on p.artist_business_id = b.id
  where b.id = p_artist_business_id;
$$;
revoke all on function public.mova_account_message_context(uuid) from public, anon, authenticated;
grant execute on function public.mova_account_message_context(uuid) to service_role;

-- 18. Admin: trial details, and granting a second trial (releases the one-per-stylist lock; reason required).
create or replace function public.mova_admin_stylist_trial(p_artist_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  return public.mova_trial_status_internal(p_artist_business_id, null) || jsonb_build_object(
    'card_fingerprint', (select t.card_fingerprint from public.mova_plan_trials t where t.artist_business_id = p_artist_business_id and t.released_at is null),
    'stripe_subscription_id', (select s.stripe_subscription_id from public.mova_billing_subscriptions s where s.artist_business_id = p_artist_business_id),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('event_type', e.event_type, 'occurred_at', e.occurred_at, 'delivered_at', e.delivered_at) order by e.occurred_at desc)
      from public.mova_outbox_events e where e.artist_business_id = p_artist_business_id and (e.event_type like 'trial.%' or e.event_type like 'billing.%')), '[]'::jsonb),
    'texts', coalesce((select jsonb_agg(jsonb_build_object('event_type', l.event_type, 'status', l.status, 'reason', l.reason, 'created_at', l.created_at) order by l.created_at desc)
      from public.mova_account_sms_log l where l.artist_business_id = p_artist_business_id), '[]'::jsonb)
  );
end $$;
revoke all on function public.mova_admin_stylist_trial(uuid) from public, anon;
grant execute on function public.mova_admin_stylist_trial(uuid) to authenticated, service_role;

create or replace function public.mova_admin_release_trial(p_artist_business_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_owner uuid; n integer;
begin
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  if exists(select 1 from public.mova_billing_subscriptions s where s.artist_business_id = p_artist_business_id and s.status in ('trialing','active','past_due')) then
    raise exception using errcode = '55000', message = 'SUBSCRIPTION_LIVE';
  end if;
  select m.user_id into v_owner from public.mova_artist_memberships m where m.artist_business_id = p_artist_business_id
    and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1;
  update public.mova_plan_trials set released_at = now(), released_reason = btrim(p_reason)
  where released_at is null and started_at is not null and (artist_business_id = p_artist_business_id or user_id = v_owner);
  get diagnostics n = row_count;
  update public.mova_plan_trials set released_at = now(), released_reason = btrim(p_reason)
  where released_at is null and artist_business_id = p_artist_business_id;
  perform public.mova_admin_log('stylist.trial_released','artist_business',p_artist_business_id::text,p_artist_business_id,btrim(p_reason),
    jsonb_build_object('released', n));
  return public.mova_admin_stylist_trial(p_artist_business_id);
end $$;
revoke all on function public.mova_admin_release_trial(uuid, text) from public, anon;
grant execute on function public.mova_admin_release_trial(uuid, text) to authenticated, service_role;

-- Admin trial date changes go through Stripe (admin-billing function); this records them.
create or replace function public.mova_admin_log_trial_change(p_admin uuid, p_artist_business_id uuid, p_action text, p_reason text, p_details jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_action not in ('stylist.trial_extended','stylist.trial_ended') then raise exception using errcode = '22023', message = 'ACTION_INVALID'; end if;
  insert into public.mova_admin_activity(admin_user_id, action, object_type, object_id, artist_business_id, reason, details)
  values (p_admin, p_action, 'artist_business', p_artist_business_id::text, p_artist_business_id, btrim(p_reason), coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function public.mova_admin_log_trial_change(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mova_admin_log_trial_change(uuid, uuid, text, text, jsonb) to service_role;

-- 19. Billing webhook bookkeeping (service role). begin returns false for an event already processed.
create or replace function public.mova_billing_event_begin(p_event_id text, p_type text, p_livemode boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_processed timestamptz;
begin
  insert into public.mova_billing_events(stripe_event_id, type, livemode) values (p_event_id, left(p_type, 120), p_livemode)
  on conflict (stripe_event_id) do nothing;
  if found then return true; end if;
  select processed_at into v_processed from public.mova_billing_events where stripe_event_id = p_event_id;
  return v_processed is null;
end $$;
revoke all on function public.mova_billing_event_begin(text, text, boolean) from public, anon, authenticated;
grant execute on function public.mova_billing_event_begin(text, text, boolean) to service_role;

create or replace function public.mova_billing_event_finish(p_event_id text, p_error text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.mova_billing_events set processed_at = case when p_error is null then now() end, error = left(p_error, 500)
  where stripe_event_id = p_event_id;
$$;
revoke all on function public.mova_billing_event_finish(text, text) from public, anon, authenticated;
grant execute on function public.mova_billing_event_finish(text, text) to service_role;

-- Trial and billing messages (email, push, text) go through the outbox like every other send.
create or replace function public.mova_enqueue_account_event(p_artist_business_id uuid, p_event_type text, p_idempotency_key text, p_payload jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_event_type not in ('trial.started','trial.converted','trial.ended_free','billing.payment_failed') then
    raise exception using errcode = '22023', message = 'EVENT_INVALID';
  end if;
  insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (p_artist_business_id, 'billing', p_artist_business_id, p_event_type, coalesce(p_payload, '{}'::jsonb), left(p_idempotency_key, 200))
  on conflict (idempotency_key) do nothing;
  return found;
end $$;
revoke all on function public.mova_enqueue_account_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mova_enqueue_account_event(uuid, text, text, jsonb) to service_role;

-- The business a Stripe customer belongs to (card updates arrive without a subscription).
create or replace function public.mova_billing_business_for_customer(p_customer text)
returns table(artist_business_id uuid, stripe_subscription_id text) language sql stable security definer set search_path = public, pg_temp as $$
  select s.artist_business_id, s.stripe_subscription_id from public.mova_billing_subscriptions s where s.stripe_customer_id = p_customer limit 1;
$$;
revoke all on function public.mova_billing_business_for_customer(text) from public, anon, authenticated;
grant execute on function public.mova_billing_business_for_customer(text) to service_role;
