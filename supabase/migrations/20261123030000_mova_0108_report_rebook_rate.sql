-- Audit 37 (Nov 22): Reports shows "N% rebooked". Of the distinct clients with a completed visit in the
-- range, the share who already have a later appointment (requested, confirmed or completed).
-- Read-only; called by reports-summary with the service role.
create or replace function public.mova_reports_rebook_rate(p_artist_business_id uuid, p_start date, p_end date, p_time_zone text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with visits as (
    select a.client_id, max(a.starts_at) as last_visit
    from public.mova_appointments a
    where a.artist_business_id = p_artist_business_id and a.status = 'completed' and a.client_id is not null
      and (a.starts_at at time zone coalesce(nullif(p_time_zone, ''), 'UTC'))::date between p_start and p_end
    group by a.client_id
  )
  select jsonb_build_object(
    'clients', count(*)::int,
    'rebooked', count(*) filter (where exists (
      select 1 from public.mova_appointments n
      where n.artist_business_id = p_artist_business_id and n.client_id = v.client_id and n.starts_at > v.last_visit
        and n.status in ('pending_artist', 'pending_payment', 'confirmed', 'completed')
    ))::int
  )
  from visits v;
$$;
revoke all on function public.mova_reports_rebook_rate(uuid, date, date, text) from public, anon, authenticated;
grant execute on function public.mova_reports_rebook_rate(uuid, date, date, text) to service_role;
