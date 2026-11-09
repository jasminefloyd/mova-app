-- Admin read functions: Overview (A2), Stylists (A3), Stylist detail (A4), Stylist audit log (A5) and
-- Admin activity (A11). 2026-11-09, P6 admin stream. Every function checks the platform admin role first
-- and returns aggregates or the rows the screens need. Client contact details are not returned by default.
-- Viewing a stylist and exporting an audit log are themselves recorded in mova_admin_activity.

-- A2: one window of the Overview. Money is in minor units (cents) and the screen formats it.
create function public.mova_admin_overview_window(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'active_stylists', (select count(distinct a.artist_business_id) from public.mova_appointments a
      join public.mova_artist_businesses b on b.id = a.artist_business_id
      where b.status = 'active' and a.status <> 'draft' and a.created_at >= p_from and a.created_at < p_to),
    'new_signups', (select count(*) from public.mova_artist_businesses where created_at >= p_from and created_at < p_to),
    'bookings_made', (select count(*) from public.mova_appointments where status <> 'draft' and created_at >= p_from and created_at < p_to),
    'completed', (select count(*) from public.mova_appointments where status = 'completed' and starts_at >= p_from and starts_at < p_to),
    'no_shows', (select count(*) from public.mova_appointments where status = 'no_show' and starts_at >= p_from and starts_at < p_to),
    'processed_minor', (select coalesce(sum(amount_minor), 0) from public.mova_payments
      where collector = 'mova_processed' and status in ('succeeded', 'partially_refunded') and created_at >= p_from and created_at < p_to),
    'fees_minor', (select coalesce(sum(platform_fee_minor), 0) from public.mova_payments
      where collector = 'mova_processed' and status in ('succeeded', 'partially_refunded') and created_at >= p_from and created_at < p_to),
    'recorded_minor', (select coalesce(sum(amount_minor), 0) from public.mova_payments
      where collector = 'artist' and status = 'succeeded' and created_at >= p_from and created_at < p_to),
    'salon_minor', (select coalesce(sum(amount_minor), 0) from public.mova_payments
      where collector = 'salon' and status = 'succeeded' and created_at >= p_from and created_at < p_to),
    'seat_filler_filled', (select count(*) from public.mova_slot_events where status = 'filled' and created_at >= p_from and created_at < p_to),
    'seat_filler_offered', (select count(*) from public.mova_slot_events where status in ('live', 'filled', 'expired') and created_at >= p_from and created_at < p_to),
    'seat_filler_total', (select count(*) from public.mova_slot_events where created_at >= p_from and created_at < p_to),
    'autopilot_sent', (select count(*) from public.mova_autopilot_decisions where action = 'sent' and created_at >= p_from and created_at < p_to),
    'autopilot_rebooked', (select count(*) from public.mova_autopilot_decisions where action = 'rebooked' and created_at >= p_from and created_at < p_to),
    'concierge_conversations', (select count(*) from public.mova_conversations where created_at >= p_from and created_at < p_to),
    'concierge_handed', (select count(distinct h.conversation_id) from public.mova_handoffs h where h.created_at >= p_from and h.created_at < p_to)
  );
$$;

create function public.mova_admin_overview(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_now timestamptz := now();
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 7), 90));
  v_prior timestamptz;
begin
  perform public.mova_require_platform_admin();
  v_prior := v_from - make_interval(days => v_days);
  return jsonb_build_object(
    'days', v_days,
    'current', public.mova_admin_overview_window(v_from, v_now),
    'prior', public.mova_admin_overview_window(v_prior, v_from),
    'funnel', jsonb_build_object(
      'waitlist', (select count(*) from public.mova_waitlist_signups),
      'invited', (select count(*) from public.mova_waitlist_signups where invited_at is not null),
      'signed_up', (select count(*) from public.mova_artist_businesses where status <> 'deleted'),
      'published_page', (select count(*) from public.mova_artist_profiles where is_published),
      'stripe_connected', (select count(*) from public.mova_stripe_connections where status = 'active'),
      'first_booking', (select count(distinct artist_business_id) from public.mova_appointments where status <> 'draft')),
    'weekly_active', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.week, 'stylists', w.stylists) order by w.week)
      from (
        select date_trunc('week', a.created_at)::date as week, count(distinct a.artist_business_id) as stylists
        from public.mova_appointments a
        where a.status <> 'draft' and a.created_at >= date_trunc('week', v_now) - interval '7 weeks'
        group by 1
      ) w), '[]'::jsonb),
    'top_stylists', coalesce((
      select jsonb_agg(t order by (t ->> 'completed')::integer desc) from (
        select jsonb_build_object(
          'business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name), 'business_name', b.name,
          'completed', count(*), 'processed_minor', coalesce(sum(pay.amount_minor), 0)) as t
        from public.mova_appointments a
        join public.mova_artist_businesses b on b.id = a.artist_business_id
        left join public.mova_artist_profiles p on p.artist_business_id = b.id
        left join public.mova_payments pay on pay.appointment_id = a.id and pay.collector = 'mova_processed' and pay.status = 'succeeded'
        where a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_now
        group by b.id, b.business_number, b.name, p.display_name
        order by count(*) desc, b.business_number
        limit 5
      ) top), '[]'::jsonb),
    'needs_nudge', jsonb_build_object(
      'quiet', (select count(*) from public.mova_artist_businesses b where b.status = 'active'
        and not exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id and a.created_at >= v_now - interval '14 days')),
      'items', coalesce((
        select jsonb_agg(n order by n ->> 'reason') from (
          (select jsonb_build_object('business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name),
              'business_name', b.name, 'reason', 'quiet') as n
           from public.mova_artist_businesses b left join public.mova_artist_profiles p on p.artist_business_id = b.id
           where b.status = 'active' and exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id)
             and not exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id and a.created_at >= v_now - interval '14 days')
           order by b.business_number limit 2)
          union all
          (select jsonb_build_object('business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name),
              'business_name', b.name, 'reason', 'stripe_restricted')
           from public.mova_stripe_connections s join public.mova_artist_businesses b on b.id = s.artist_business_id
           left join public.mova_artist_profiles p on p.artist_business_id = b.id
           where s.status = 'restricted' order by b.business_number limit 2)
          union all
          (select jsonb_build_object('business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name),
              'business_name', b.name, 'reason', 'published_no_bookings')
           from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id = p.artist_business_id
           where p.is_published and b.status = 'active'
             and not exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id)
           order by b.business_number limit 2)
        ) items), '[]'::jsonb)),
    'language', jsonb_build_object(
      'en_us', (select count(*) from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id = p.artist_business_id where b.status = 'active' and p.preferred_locale = 'en-US'),
      'es_us', (select count(*) from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id = p.artist_business_id where b.status = 'active' and p.preferred_locale = 'es-US'))
  );
end $$;

-- A3: the stylist list with filters, search and paging. Status rules: suspended > onboarding > quiet > active.
create function public.mova_admin_stylists(
  p_filter text default 'all', p_search text default null, p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_bid bigint;
begin
  perform public.mova_require_platform_admin();
  if p_filter not in ('all', 'active', 'onboarding', 'quiet', 'restricted', 'suspended') then
    raise exception using errcode = '22023', message = 'STYLIST_FILTER_INVALID';
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if v_q ~* '^(BID-)?[0-9]{1,12}$' then v_bid := regexp_replace(v_q, '[^0-9]', '', 'g')::bigint; end if;
  end if;
  return (
    with base as (
      select b.id, b.business_number, b.name as business_name, b.status as business_status,
        p.display_name, p.handle, coalesce(p.is_published, false) as is_published,
        s.status as stripe_status,
        coalesce(plan.plan_name, 'Free') as plan_name,
        (select f.fee_bps from public.mova_business_fee(b.id) f) as fee_bps,
        (select max(a.created_at) from public.mova_appointments a where a.artist_business_id = b.id and a.status <> 'draft') as last_booking_at,
        (select count(*) from public.mova_appointments a where a.artist_business_id = b.id and a.status = 'completed' and a.starts_at >= now() - interval '30 days') as done_30d,
        ownr.email as owner_email
      from public.mova_artist_businesses b
      left join public.mova_artist_profiles p on p.artist_business_id = b.id
      left join public.mova_stripe_connections s on s.artist_business_id = b.id
      left join lateral (
        select c.display_name as plan_name from public.mova_business_plan_assignments pa
        join public.mova_plan_catalog c on c.plan_key = pa.plan_key
        where pa.artist_business_id = b.id and pa.assignment_status = 'current'
      ) plan on true
      left join lateral (
        select u.email from public.mova_artist_memberships m join auth.users u on u.id = m.user_id
        where m.artist_business_id = b.id and m.role = 'owner' and m.status = 'active'
        order by m.created_at limit 1
      ) ownr on true
      where b.status <> 'deleted'
    ), keyed as (
      select base.*,
        case when business_status = 'suspended' then 'suspended'
          when not is_published and last_booking_at is null then 'onboarding'
          when last_booking_at is null or last_booking_at < now() - interval '14 days' then 'quiet'
          else 'active' end as status_key
      from base
    ), searched as (
      select k.* from keyed k
      where v_q is null
        or k.business_name ilike v_like or coalesce(k.display_name, '') ilike v_like
        or coalesce(k.handle, '') ilike v_like or coalesce(k.owner_email, '') ilike v_like
        or (v_bid is not null and k.business_number = v_bid)
    ), filtered as (
      select f.* from searched f
      where p_filter = 'all' or (p_filter = 'restricted' and f.stripe_status = 'restricted') or f.status_key = p_filter
    ), page as (
      select f.* from filtered f
      order by f.last_booking_at desc nulls last, f.business_number
      limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    )
    select jsonb_build_object(
      'stylists', coalesce((select jsonb_agg(jsonb_build_object(
          'id', g.id, 'bid', g.business_number, 'name', coalesce(g.display_name, g.business_name),
          'business_name', g.business_name, 'handle', g.handle, 'status_key', g.status_key,
          'stripe_status', coalesce(g.stripe_status, 'not_connected'), 'plan_name', g.plan_name,
          'fee_bps', g.fee_bps, 'done_30d', g.done_30d, 'last_booking_at', g.last_booking_at
        ) order by g.last_booking_at desc nulls last, g.business_number) from page g), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'counts', jsonb_build_object(
        'all', (select count(*) from keyed),
        'active', (select count(*) from keyed where status_key = 'active'),
        'onboarding', (select count(*) from keyed where status_key = 'onboarding'),
        'quiet', (select count(*) from keyed where status_key = 'quiet'),
        'restricted', (select count(*) from keyed where stripe_status = 'restricted'),
        'suspended', (select count(*) from keyed where status_key = 'suspended'))
    )
  );
end $$;

-- A4: one stylist. Viewing is logged.
create function public.mova_admin_stylist_detail(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_business public.mova_artist_businesses%rowtype;
  v_fee record;
  v_result jsonb;
begin
  perform public.mova_require_platform_admin();
  select * into v_business from public.mova_artist_businesses where id = p_business_id and status <> 'deleted';
  if not found then raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND'; end if;
  select * into v_fee from public.mova_business_fee(p_business_id);
  perform public.mova_admin_log('stylist.viewed', 'artist_business', p_business_id::text, p_business_id, null, '{}'::jsonb);

  v_result := jsonb_build_object(
    'business', jsonb_build_object('id', v_business.id, 'bid', v_business.business_number, 'name', v_business.name,
      'status', v_business.status, 'created_at', v_business.created_at),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'handle', p.handle, 'is_published', p.is_published,
        'published_at', p.published_at, 'preferred_locale', p.preferred_locale, 'has_photo', p.profile_photo_path is not null)
      from public.mova_artist_profiles p where p.artist_business_id = p_business_id),
    'owner_email', (select u.email from public.mova_artist_memberships m join auth.users u on u.id = m.user_id
      where m.artist_business_id = p_business_id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1),
    'plan', jsonb_build_object('key', coalesce(v_fee.plan_key, 'free'),
      'name', coalesce((select c.display_name from public.mova_plan_catalog c where c.plan_key = v_fee.plan_key), 'Free')),
    'fee', jsonb_build_object('fee_bps', v_fee.fee_bps,
      'source', case when exists (select 1 from public.mova_stylist_fee_overrides o where o.artist_business_id = p_business_id
          and o.starts_at <= now() and (o.ends_at is null or o.ends_at > now())) then 'override'
        when v_fee.plan_key is not null then 'plan' else 'platform' end),
    'stripe', (select jsonb_build_object('status', s.status, 'charges_enabled', s.charges_enabled, 'payouts_enabled', s.payouts_enabled)
      from public.mova_stripe_connections s where s.artist_business_id = p_business_id),
    'metrics', jsonb_build_object(
      'completed_30d', (select count(*) from public.mova_appointments a where a.artist_business_id = p_business_id and a.status = 'completed' and a.starts_at >= now() - interval '30 days'),
      'processed_30d_minor', (select coalesce(sum(pay.amount_minor), 0) from public.mova_payments pay where pay.artist_business_id = p_business_id and pay.collector = 'mova_processed' and pay.status = 'succeeded' and pay.created_at >= now() - interval '30 days'),
      'fees_30d_minor', (select coalesce(sum(pay.platform_fee_minor), 0) from public.mova_payments pay where pay.artist_business_id = p_business_id and pay.collector = 'mova_processed' and pay.status = 'succeeded' and pay.created_at >= now() - interval '30 days'),
      'repeat_clients_90d', (select count(*) from (select a.client_id from public.mova_appointments a
          where a.artist_business_id = p_business_id and a.status = 'completed' and a.client_id is not null and a.starts_at >= now() - interval '90 days'
          group by a.client_id having count(*) >= 2) r),
      'clients_90d', (select count(distinct a.client_id) from public.mova_appointments a
          where a.artist_business_id = p_business_id and a.status = 'completed' and a.client_id is not null and a.starts_at >= now() - interval '90 days'),
      'locations', (select count(*) from public.mova_locations l where l.artist_business_id = p_business_id and l.is_active),
      'services', (select count(*) from public.mova_services sv where sv.artist_business_id = p_business_id and sv.status = 'active'),
      'clients', (select count(*) from public.mova_clients c where c.artist_business_id = p_business_id)),
    'switches', jsonb_build_object(
      'zelle_recorded', coalesce((select pm.zelle_recorded_enabled from public.mova_payment_method_settings pm where pm.artist_business_id = p_business_id), true),
      'rebooking_autopilot', coalesce((select a.enabled from public.mova_autopilot_settings a where a.artist_business_id = p_business_id), false),
      'ai_concierge', coalesce((select c.enabled from public.mova_concierge_settings c where c.artist_business_id = p_business_id), false),
      'wallet_card', coalesce((select f.wallet_card from public.mova_feature_settings f where f.artist_business_id = p_business_id), true),
      'social_share', coalesce((select f.social_share from public.mova_feature_settings f where f.artist_business_id = p_business_id), true)),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'type', m.type, 'status', m.status,
        'created_at', m.created_at, 'preview', left(m.message, 120)) order by m.created_at desc)
      from (select * from public.mova_support_messages where artist_business_id = p_business_id order by created_at desc limit 3) m), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('fee_bps', o.fee_bps, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'reason', o.reason)
      order by o.starts_at desc) from public.mova_stylist_fee_overrides o where o.artist_business_id = p_business_id), '[]'::jsonb)
  );
  return v_result;
end $$;

-- A5: the audit log for one stylist. Newest first, one page at a time. Event sources are the security
-- audit, appointment events, payments, messages and admin actions about this stylist.
create function public.mova_admin_audit_events(
  p_business_id uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_category text default 'all', p_search text default null, p_limit integer default 50, p_before timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
begin
  perform public.mova_require_platform_admin();
  if p_category not in ('all', 'bookings', 'payments', 'messages', 'settings', 'sign_ins', 'admin', 'errors') then
    raise exception using errcode = '22023', message = 'AUDIT_CATEGORY_INVALID';
  end if;
  if v_q is not null then v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return (
    with events as (
      select e.occurred_at as occurred_at, case when e.event_type like 'auth.%' then 'sign_ins' else 'settings' end as category,
        'Stylist'::text as actor, e.event_type as event, e.object_type || coalesce(' ' || e.object_id, '') as reference,
        e.event_type as summary
      from public.mova_security_audit_events e
      where e.artist_business_id = p_business_id
      union all
      select ae.occurred_at, 'bookings', case ae.actor_type when 'artist' then 'Stylist' when 'worker' then 'System' when 'provider' then 'System' else 'Client' end,
        'booking.' || ae.to_status, 'AID-' || coalesce(ap.appointment_number::text, '?'),
        'Status changed to ' || ae.to_status || coalesce(' · ' || ae.reason, '')
      from public.mova_appointment_events ae
      left join public.mova_appointments ap on ap.id = ae.appointment_id
      where ae.artist_business_id = p_business_id
      union all
      select pay.created_at, 'payments', case when pay.collector = 'artist' then 'Stylist' else 'System' end,
        'payment.' || pay.status, 'AID-' || coalesce(ap.appointment_number::text, '?'),
        '$' || to_char(pay.amount_minor / 100.0, 'FM999999990.00') || ' · ' || pay.method || ' · ' || pay.collector
          || case when pay.platform_fee_minor > 0 then ' · Mova fee $' || to_char(pay.platform_fee_minor / 100.0, 'FM999990.00') else '' end
      from public.mova_payments pay
      left join public.mova_appointments ap on ap.id = pay.appointment_id
      where pay.artist_business_id = p_business_id
      union all
      select m.created_at, case when m.status = 'failed' then 'errors' else 'messages' end, 'System',
        'message.' || m.status, 'CID-' || coalesce(left(m.client_id::text, 8), '-'),
        m.purpose || ' · ' || m.channel || case when m.error_code is not null then ' · ' || m.error_code else '' end
      from public.mova_messages m
      where m.artist_business_id = p_business_id
      union all
      select aa.created_at, 'admin', 'Admin', aa.action, coalesce(aa.object_type || ' ' || aa.object_id, aa.object_type),
        coalesce(aa.reason, aa.action)
      from public.mova_admin_activity aa
      where aa.artist_business_id = p_business_id
    ), filtered as (
      select e.* from events e
      where (p_from is null or e.occurred_at >= p_from)
        and (p_to is null or e.occurred_at < p_to)
        and (p_before is null or e.occurred_at < p_before)
        and (p_category = 'all' or e.category = p_category or (p_category = 'errors' and e.event like '%fail%'))
        and (v_like is null or e.event ilike v_like or e.summary ilike v_like or e.reference ilike v_like)
    ), page as (
      select f.* from filtered f order by f.occurred_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    )
    select jsonb_build_object(
      'events', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', g.occurred_at, 'category', g.category,
          'actor', g.actor, 'event', g.event, 'reference', g.reference, 'summary', g.summary) order by g.occurred_at desc) from page g), '[]'::jsonb),
      'has_more', (select count(*) > least(greatest(coalesce(p_limit, 50), 1), 200) from filtered)
    )
  );
end $$;

-- Exporting an audit log is recorded. The export itself is built in the browser from the same rows.
create function public.mova_admin_log_audit_export(p_business_id uuid, p_row_count integer, p_include_contacts boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  perform public.mova_admin_log('audit.exported', 'artist_business', p_business_id::text, p_business_id, null,
    jsonb_build_object('rows', p_row_count, 'contacts_included', coalesce(p_include_contacts, false)));
end $$;

-- A11: the admin activity log. Append-only, so this only reads.
create function public.mova_admin_activity_list(
  p_from timestamptz default null, p_action text default null, p_search text default null,
  p_limit integer default 50, p_before timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
begin
  perform public.mova_require_platform_admin();
  if v_q is not null then v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return (
    with rows as (
      select aa.id, aa.created_at, aa.action, aa.object_type, aa.object_id, aa.reason, aa.details,
        coalesce(pa.display_name, 'Staff') as admin_name, b.business_number, b.name as business_name
      from public.mova_admin_activity aa
      left join public.mova_platform_admins pa on pa.user_id = aa.admin_user_id
      left join public.mova_artist_businesses b on b.id = aa.artist_business_id
      where (p_from is null or aa.created_at >= p_from)
        and (p_before is null or aa.created_at < p_before)
        and (p_action is null or p_action = '' or aa.action = p_action)
        and (v_like is null or aa.action ilike v_like or coalesce(aa.reason, '') ilike v_like
          or coalesce(b.name, '') ilike v_like or (b.business_number is not null and ('BID-' || b.business_number) ilike v_like))
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'occurred_at', r.created_at, 'admin_name', r.admin_name,
          'action', r.action, 'object_type', r.object_type, 'object_id', r.object_id, 'reason', r.reason,
          'bid', r.business_number, 'business_name', r.business_name, 'details', r.details)
        order by r.created_at desc) from (select * from rows order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb),
      'has_more', (select count(*) > least(greatest(coalesce(p_limit, 50), 1), 200) from rows)
    )
  );
end $$;

-- Grants. Clients may call these only as signed-in users; each function checks the admin role itself.
revoke all on function public.mova_admin_overview_window(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mova_admin_overview(integer) from public, anon;
revoke all on function public.mova_admin_stylists(text, text, integer, integer) from public, anon;
revoke all on function public.mova_admin_stylist_detail(uuid) from public, anon;
revoke all on function public.mova_admin_audit_events(uuid, timestamptz, timestamptz, text, text, integer, timestamptz) from public, anon;
revoke all on function public.mova_admin_log_audit_export(uuid, integer, boolean) from public, anon;
revoke all on function public.mova_admin_activity_list(timestamptz, text, text, integer, timestamptz) from public, anon;
grant execute on function public.mova_admin_overview(integer) to authenticated, service_role;
grant execute on function public.mova_admin_stylists(text, text, integer, integer) to authenticated, service_role;
grant execute on function public.mova_admin_stylist_detail(uuid) to authenticated, service_role;
grant execute on function public.mova_admin_audit_events(uuid, timestamptz, timestamptz, text, text, integer, timestamptz) to authenticated, service_role;
grant execute on function public.mova_admin_log_audit_export(uuid, integer, boolean) to authenticated, service_role;
grant execute on function public.mova_admin_activity_list(timestamptz, text, text, integer, timestamptz) to authenticated, service_role;
