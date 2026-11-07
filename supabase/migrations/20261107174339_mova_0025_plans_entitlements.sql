-- P15 configurable plans and usage metering. Commercial actions remain approval-gated.
create table public.mova_plan_catalog (
  plan_key text primary key check(plan_key in ('free','pro','ai_growth')),
  display_name text not null,
  monthly_price_minor integer not null check(monthly_price_minor>=0),
  mova_fee_basis_points integer not null check(mova_fee_basis_points between 0 and 10000),
  status text not null default 'proposed' check(status in ('proposed','active','retired')),
  entitlements jsonb not null default '{}'::jsonb check(jsonb_typeof(entitlements)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.mova_plan_catalog(plan_key,display_name,monthly_price_minor,mova_fee_basis_points,status,entitlements) values
 ('free','Free',0,150,'proposed','{"included_features":"to_be_finalized"}'),
 ('pro','Pro',1900,100,'proposed','{"included_features":"to_be_finalized"}'),
 ('ai_growth','AI Growth',3900,50,'proposed','{"included_features":"to_be_finalized"}')
on conflict(plan_key) do nothing;

create table public.mova_business_plan_assignments (
 artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
 plan_key text not null default 'free' references public.mova_plan_catalog(plan_key),
 assignment_status text not null default 'current' check(assignment_status in ('current','pending','cancelled')),
 assigned_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.mova_usage_meter_events (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 meter_key text not null check(meter_key in ('message_credits_monthly','concierge_turns_monthly')),
 quantity numeric(14,3) not null check(quantity>0), source_type text not null, source_id uuid not null,
 occurred_at timestamptz not null default now(), period_start date not null default date_trunc('month',now())::date,
 constraint mova_usage_meter_source_uq unique(artist_business_id,meter_key,source_type,source_id)
);
create index mova_usage_meter_month_idx on public.mova_usage_meter_events(artist_business_id,period_start,meter_key);

alter table public.mova_plan_catalog enable row level security;
alter table public.mova_business_plan_assignments enable row level security;
alter table public.mova_usage_meter_events enable row level security;
revoke all on public.mova_plan_catalog,public.mova_business_plan_assignments,public.mova_usage_meter_events from public,anon,authenticated;
create policy mova_plan_catalog_member_read on public.mova_plan_catalog for select to authenticated using(status<>'retired');
create policy mova_plan_assignment_member_read on public.mova_business_plan_assignments for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
grant select on public.mova_plan_catalog,public.mova_business_plan_assignments to authenticated;
grant all on public.mova_plan_catalog,public.mova_business_plan_assignments,public.mova_usage_meter_events to service_role;

create or replace function public.mova_plan_entitlement_summary(p_artist_business_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('current_plan',jsonb_build_object('plan_key',coalesce(p.plan_key,'free'),'display_name',coalesce(p.display_name,'Free'),
   'monthly_price_minor',coalesce(p.monthly_price_minor,0),'mova_fee_basis_points',coalesce(p.mova_fee_basis_points,150),'status',coalesce(p.status,'proposed')),
   'plans',coalesce((select jsonb_agg(jsonb_build_object('plan_key',c.plan_key,'display_name',c.display_name,'monthly_price_minor',c.monthly_price_minor,
      'mova_fee_basis_points',c.mova_fee_basis_points,'status',c.status,'entitlements',c.entitlements) order by c.monthly_price_minor)
     from public.mova_plan_catalog c where c.status<>'retired'),'[]'::jsonb),
   'usage',coalesce((select jsonb_object_agg(meter_key,quantity) from (select meter_key,sum(quantity) quantity from public.mova_usage_meter_events
     where artist_business_id=p_artist_business_id and period_start=date_trunc('month',now())::date group by meter_key) u),'{}'::jsonb))
 from (select 1) seed left join public.mova_business_plan_assignments a on a.artist_business_id=p_artist_business_id and a.assignment_status='current'
 left join public.mova_plan_catalog p on p.plan_key=a.plan_key
$$;

create or replace function public.mova_usage_meter_message_insert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_was_sent boolean:=false;
begin
 if tg_op='UPDATE' then v_was_sent:=old.status in ('sent','delivered'); end if;
 if new.direction='outbound' and new.status in ('sent','delivered') and not v_was_sent then
   insert into public.mova_usage_meter_events(artist_business_id,meter_key,quantity,source_type,source_id)
     values(new.artist_business_id,'message_credits_monthly',1,'message',new.id) on conflict do nothing;
   if new.origin='concierge' then
     insert into public.mova_usage_meter_events(artist_business_id,meter_key,quantity,source_type,source_id)
      values(new.artist_business_id,'concierge_turns_monthly',1,'message',new.id) on conflict do nothing;
   end if;
 end if;
 return new;
end $$;
create trigger mova_message_usage_after_send after insert or update of status on public.mova_messages for each row execute function public.mova_usage_meter_message_insert();

revoke all on function public.mova_plan_entitlement_summary(uuid) from public,anon,authenticated;
revoke all on function public.mova_usage_meter_message_insert() from public,anon,authenticated;
grant execute on function public.mova_plan_entitlement_summary(uuid) to service_role;
