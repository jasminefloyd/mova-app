-- Admin write functions: transaction fees (A6), feature switches (A9), support inbox (A7) and unpublishing a
-- stylist page (A4). 2026-11-09, P6 admin stream. Every change needs a written reason and is logged to
-- mova_admin_activity. Each function checks the platform admin role first.

-- A6: per-stylist fee overrides. mova_business_fee (0058) is replaced below so that an override wins over
-- the plan rate and the platform default. Payments snapshot the rate when they are created (0044/0058), so
-- an override never changes a past payment.
create table public.mova_stylist_fee_overrides (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete restrict,
  fee_bps integer not null check (fee_bps between 0 and 300),
  starts_at timestamptz not null,
  ends_at timestamptz,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  notify_stylist boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mova_stylist_fee_overrides_window_check check (ends_at is null or ends_at > starts_at)
);
create index mova_stylist_fee_overrides_business_idx on public.mova_stylist_fee_overrides (artist_business_id, starts_at desc);
alter table public.mova_stylist_fee_overrides enable row level security;
revoke all on public.mova_stylist_fee_overrides from public, anon, authenticated;
grant select, insert on public.mova_stylist_fee_overrides to service_role;

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
    join public.mova_plan_catalog c on c.plan_key = a.plan_key and c.status = 'active'
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

-- Fee limits: 0 to 3.00%. The admin screen and these functions share them.
create function public.mova_admin_fees_overview() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  return jsonb_build_object(
    'platform', (select jsonb_build_object('version', v.version, 'fee_bps', v.fee_bps, 'effective_at', v.effective_at)
      from public.mova_platform_fee_versions v where v.effective_at <= now() order by v.version desc limit 1),
    'stylists_on_override', (select count(distinct o.artist_business_id) from public.mova_stylist_fee_overrides o
      where o.starts_at <= now() and (o.ends_at is null or o.ends_at > now())),
    'stylists_total', (select count(*) from public.mova_artist_businesses where status <> 'deleted'),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_key', c.plan_key, 'display_name', c.display_name,
        'fee_bps', c.mova_fee_basis_points) order by c.monthly_price_minor) from public.mova_plan_catalog c where c.status = 'active'), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'bid', b.business_number, 'business_name', b.name,
        'name', coalesce(p.display_name, b.name), 'fee_bps', o.fee_bps,
        'starts_at', o.starts_at, 'ends_at', o.ends_at, 'reason', o.reason, 'notify_stylist', o.notify_stylist,
        'status', case when o.starts_at > now() then 'scheduled' when o.ends_at is null or o.ends_at > now() then 'active' else 'ended' end)
      order by o.starts_at desc)
      from (select * from public.mova_stylist_fee_overrides order by starts_at desc limit 100) o
      join public.mova_artist_businesses b on b.id = o.artist_business_id
      left join public.mova_artist_profiles p on p.artist_business_id = b.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', a.created_at, 'action', a.action,
        'bid', b.business_number, 'business_name', b.name, 'details', a.details, 'reason', a.reason,
        'admin_name', coalesce(pa.display_name, 'Staff')) order by a.created_at desc)
      from (select * from public.mova_admin_activity where action in ('fee.platform_default_set', 'fee.stylist_rate_set')
        order by created_at desc limit 50) a
      left join public.mova_artist_businesses b on b.id = a.artist_business_id
      left join public.mova_platform_admins pa on pa.user_id = a.admin_user_id), '[]'::jsonb)
  );
end $$;

create function public.mova_admin_set_platform_fee(p_fee_bps integer, p_effective_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version integer; v_effective timestamptz := coalesce(p_effective_at, now());
begin
  perform public.mova_require_platform_admin();
  if p_fee_bps is null or p_fee_bps not between 0 and 300 then raise exception using errcode = '22023', message = 'FEE_OUT_OF_RANGE'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  if v_effective < now() - interval '1 minute' then raise exception using errcode = '22023', message = 'START_IN_PAST'; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.mova_platform_fee_versions;
  insert into public.mova_platform_fee_versions (version, fee_bps, effective_at) values (v_version, p_fee_bps, v_effective);
  perform public.mova_admin_log('fee.platform_default_set', 'platform_fee', v_version::text, null, p_reason,
    jsonb_build_object('fee_bps', p_fee_bps, 'effective_at', v_effective, 'version', v_version));
  return jsonb_build_object('version', v_version, 'fee_bps', p_fee_bps, 'effective_at', v_effective);
end $$;

-- Starts are dates in the platform's time zone (America/New_York) and must be today or later.
create function public.mova_admin_set_stylist_fee(
  p_artist_business_id uuid, p_fee_bps integer, p_starts_on date, p_ends_on date, p_reason text, p_notify_stylist boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_start timestamptz; v_end timestamptz; v_id uuid;
  v_today_start timestamptz := date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
begin
  perform public.mova_require_platform_admin();
  if not exists (select 1 from public.mova_artist_businesses where id = p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  if p_fee_bps is null or p_fee_bps not between 0 and 300 then raise exception using errcode = '22023', message = 'FEE_OUT_OF_RANGE'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  if p_starts_on is null then raise exception using errcode = '22023', message = 'START_REQUIRED'; end if;
  v_start := p_starts_on::timestamp at time zone 'America/New_York';
  if v_start < v_today_start then raise exception using errcode = '22023', message = 'START_IN_PAST'; end if;
  if p_ends_on is not null then
    v_end := (p_ends_on + 1)::timestamp at time zone 'America/New_York';
    if v_end <= v_start then raise exception using errcode = '22023', message = 'END_BEFORE_START'; end if;
  end if;
  insert into public.mova_stylist_fee_overrides (artist_business_id, fee_bps, starts_at, ends_at, reason, notify_stylist, created_by)
  values (p_artist_business_id, p_fee_bps, v_start, v_end, btrim(p_reason), coalesce(p_notify_stylist, true), auth.uid())
  returning id into v_id;
  perform public.mova_admin_log('fee.stylist_rate_set', 'fee_override', v_id::text, p_artist_business_id, p_reason,
    jsonb_build_object('fee_bps', p_fee_bps, 'starts_at', v_start, 'ends_at', v_end, 'notify_stylist', coalesce(p_notify_stylist, true)));
  return jsonb_build_object('id', v_id, 'fee_bps', p_fee_bps, 'starts_at', v_start, 'ends_at', v_end);
end $$;

-- A9: platform switches. Each change needs a reason and is logged with its before and after values.
-- Enforcement in the product (edge functions and screens) reads these rows in a later change.
create table public.mova_platform_switches (
  key text primary key check (key in ('autopilot', 'concierge', 'seat_filler', 'zelle', 'reviews', 'spanish', 'tap_to_pay')),
  enabled boolean not null,
  reason text check (reason is null or length(reason) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mova_platform_switches_tap_to_pay_check check (key <> 'tap_to_pay' or enabled = false)
);
insert into public.mova_platform_switches (key, enabled) values
  ('autopilot', true), ('concierge', true), ('seat_filler', true), ('zelle', false), ('reviews', true), ('spanish', true), ('tap_to_pay', false);
alter table public.mova_platform_switches enable row level security;
revoke all on public.mova_platform_switches from public, anon, authenticated;
grant select, insert, update on public.mova_platform_switches to service_role;

create function public.mova_admin_switches() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'enabled', s.enabled, 'reason', s.reason,
      'updated_at', s.updated_at, 'updated_by', coalesce(pa.display_name, null)) order by s.key)
    from public.mova_platform_switches s left join public.mova_platform_admins pa on pa.user_id = s.updated_by), '[]'::jsonb);
end $$;

create function public.mova_admin_set_platform_switch(p_key text, p_enabled boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before boolean; v_admin uuid := public.mova_require_platform_admin();
begin
  if p_key not in ('autopilot', 'concierge', 'seat_filler', 'zelle', 'reviews', 'spanish', 'tap_to_pay') then
    raise exception using errcode = '22023', message = 'SWITCH_INVALID';
  end if;
  if p_key = 'tap_to_pay' and p_enabled then raise exception using errcode = '55000', message = 'SWITCH_NOT_BUILT'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  select enabled into v_before from public.mova_platform_switches where key = p_key for update;
  update public.mova_platform_switches set enabled = p_enabled, reason = btrim(p_reason), updated_by = v_admin, updated_at = now()
  where key = p_key;
  perform public.mova_admin_log('switch.updated', 'platform_switch', p_key, null, p_reason,
    jsonb_build_object('from', v_before, 'to', p_enabled));
  return public.mova_admin_switches();
end $$;

-- A4: take a stylist's public page down. The stylist's account and data stay as they are.
create function public.mova_admin_unpublish_page(p_artist_business_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  update public.mova_artist_profiles set is_published = false, search_index_enabled = false, updated_at = now()
  where artist_business_id = p_artist_business_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND'; end if;
  perform public.mova_admin_log('stylist.page_unpublished', 'artist_business', p_artist_business_id::text, p_artist_business_id, p_reason, '{}'::jsonb);
  return jsonb_build_object('is_published', false);
end $$;

-- A7: support inbox. Replies are stored with the message. Email delivery is not connected yet, so each
-- reply is saved with delivery 'not_sent' until the email provider is configured.
alter table public.mova_support_messages drop constraint if exists mova_support_messages_status_check;
alter table public.mova_support_messages add constraint mova_support_messages_status_check
  check (status in ('new', 'in_progress', 'waiting_on_stylist', 'resolved'));

create table public.mova_support_replies (
  id uuid primary key default gen_random_uuid(),
  support_message_id uuid not null references public.mova_support_messages(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 4000),
  delivery text not null default 'not_sent' check (delivery in ('not_sent', 'sent', 'failed')),
  created_at timestamptz not null default now()
);
create index mova_support_replies_message_idx on public.mova_support_replies (support_message_id, created_at);
alter table public.mova_support_replies enable row level security;
revoke all on public.mova_support_replies from public, anon, authenticated;
grant select, insert on public.mova_support_replies to service_role;

create function public.mova_admin_support_list(
  p_status text default 'all', p_search text default null, p_limit integer default 50, p_before timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
begin
  perform public.mova_require_platform_admin();
  if p_status not in ('all', 'new', 'in_progress', 'waiting_on_stylist', 'resolved') then raise exception using errcode = '22023', message = 'SUPPORT_FILTER_INVALID'; end if;
  if v_q is not null then v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return (
    with rows as (
      select m.*, b.business_number, b.name as business_name, coalesce(p.display_name, b.name) as stylist_name
      from public.mova_support_messages m
      join public.mova_artist_businesses b on b.id = m.artist_business_id
      left join public.mova_artist_profiles p on p.artist_business_id = b.id
      where (p_status = 'all' or m.status = p_status)
        and (p_before is null or m.created_at < p_before)
        and (v_like is null or m.message ilike v_like or b.name ilike v_like or coalesce(p.display_name, '') ilike v_like)
    ), page as (
      select r.* from rows r order by r.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    select jsonb_build_object(
      'messages', coalesce((select jsonb_agg(jsonb_build_object(
          'id', g.id, 'type', g.type, 'message', g.message, 'screen', g.screen, 'device', g.device,
          'app_version', g.app_version, 'locale', g.locale, 'status', g.status, 'created_at', g.created_at,
          'has_screenshot', g.screenshot_path is not null, 'bid', g.business_number, 'business_name', g.business_name,
          'stylist_name', g.stylist_name,
          'replies', coalesce((select jsonb_agg(jsonb_build_object('id', rp.id, 'body', rp.body, 'delivery', rp.delivery,
              'created_at', rp.created_at, 'admin_name', coalesce(pa.display_name, 'Staff')) order by rp.created_at)
            from public.mova_support_replies rp left join public.mova_platform_admins pa on pa.user_id = rp.admin_user_id
            where rp.support_message_id = g.id), '[]'::jsonb)
        ) order by g.created_at desc) from page g), '[]'::jsonb),
      'counts', jsonb_build_object(
        'all', (select count(*) from public.mova_support_messages),
        'new', (select count(*) from public.mova_support_messages where status = 'new'),
        'in_progress', (select count(*) from public.mova_support_messages where status = 'in_progress'),
        'waiting_on_stylist', (select count(*) from public.mova_support_messages where status = 'waiting_on_stylist'),
        'resolved', (select count(*) from public.mova_support_messages where status = 'resolved'))
    )
  );
end $$;

create function public.mova_admin_support_set_status(p_message_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.mova_support_messages%rowtype;
begin
  perform public.mova_require_platform_admin();
  if p_status not in ('new', 'in_progress', 'waiting_on_stylist', 'resolved') then raise exception using errcode = '22023', message = 'SUPPORT_STATUS_INVALID'; end if;
  update public.mova_support_messages set status = p_status where id = p_message_id returning * into v_row;
  if not found then raise exception using errcode = 'P0002', message = 'SUPPORT_MESSAGE_NOT_FOUND'; end if;
  perform public.mova_admin_log('support.status_changed', 'support_message', p_message_id::text, v_row.artist_business_id, null,
    jsonb_build_object('status', p_status));
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $$;

create function public.mova_admin_support_reply(p_message_id uuid, p_body text, p_close boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_row public.mova_support_messages%rowtype; v_reply_id uuid;
begin
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception using errcode = '22023', message = 'REPLY_INVALID'; end if;
  update public.mova_support_messages set status = case when coalesce(p_close, false) then 'resolved' else 'waiting_on_stylist' end
  where id = p_message_id returning * into v_row;
  if not found then raise exception using errcode = 'P0002', message = 'SUPPORT_MESSAGE_NOT_FOUND'; end if;
  insert into public.mova_support_replies (support_message_id, admin_user_id, body) values (p_message_id, v_admin, btrim(p_body))
  returning id into v_reply_id;
  perform public.mova_admin_log('support.replied', 'support_message', p_message_id::text, v_row.artist_business_id, null,
    jsonb_build_object('closed', coalesce(p_close, false), 'reply_id', v_reply_id));
  return jsonb_build_object('reply_id', v_reply_id, 'status', v_row.status, 'delivery', 'not_sent');
end $$;

-- Grants.
revoke all on function public.mova_admin_fees_overview() from public, anon;
revoke all on function public.mova_admin_set_platform_fee(integer, timestamptz, text) from public, anon;
revoke all on function public.mova_admin_set_stylist_fee(uuid, integer, date, date, text, boolean) from public, anon;
revoke all on function public.mova_admin_switches() from public, anon;
revoke all on function public.mova_admin_set_platform_switch(text, boolean, text) from public, anon;
revoke all on function public.mova_admin_unpublish_page(uuid, text) from public, anon;
revoke all on function public.mova_admin_support_list(text, text, integer, timestamptz) from public, anon;
revoke all on function public.mova_admin_support_set_status(uuid, text) from public, anon;
revoke all on function public.mova_admin_support_reply(uuid, text, boolean) from public, anon;
grant execute on function public.mova_admin_fees_overview() to authenticated, service_role;
grant execute on function public.mova_admin_set_platform_fee(integer, timestamptz, text) to authenticated, service_role;
grant execute on function public.mova_admin_set_stylist_fee(uuid, integer, date, date, text, boolean) to authenticated, service_role;
grant execute on function public.mova_admin_switches() to authenticated, service_role;
grant execute on function public.mova_admin_set_platform_switch(text, boolean, text) to authenticated, service_role;
grant execute on function public.mova_admin_unpublish_page(uuid, text) to authenticated, service_role;
grant execute on function public.mova_admin_support_list(text, text, integer, timestamptz) to authenticated, service_role;
grant execute on function public.mova_admin_support_set_status(uuid, text) to authenticated, service_role;
grant execute on function public.mova_admin_support_reply(uuid, text, boolean) to authenticated, service_role;
