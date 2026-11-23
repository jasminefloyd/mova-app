-- Store only anonymous aggregate counts for the public calculator funnel.
create table public.mova_calculator_funnel_daily (
  day date not null,
  event text not null check (event in ('calculator_used', 'start_free_clicked', 'signup_completed')),
  total bigint not null check (total > 0),
  primary key (day, event)
);

alter table public.mova_calculator_funnel_daily enable row level security;
revoke all on public.mova_calculator_funnel_daily from public, anon, authenticated, service_role;
grant select on public.mova_calculator_funnel_daily to service_role;

create function public.mova_record_calculator_event(p_event text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into public.mova_calculator_funnel_daily as counter (day, event, total)
  values ((now() at time zone 'UTC')::date, p_event, 1)
  on conflict (day, event) do update set total = counter.total + 1;
$$;

revoke all on function public.mova_record_calculator_event(text) from public, anon, authenticated;
grant execute on function public.mova_record_calculator_event(text) to service_role;
