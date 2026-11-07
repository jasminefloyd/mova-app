-- P16 privacy request intake, audit trail and operational status records.
create table public.mova_privacy_requests (
 id uuid primary key default gen_random_uuid(),
 requester_user_id uuid not null references auth.users(id) on delete cascade,
 artist_business_id uuid references public.mova_artist_businesses(id) on delete cascade,
 request_scope text not null check(request_scope in ('artist_account','client_profile')),
 request_type text not null check(request_type in ('delete','access')),
 status text not null default 'submitted' check(status in ('submitted','reviewing','completed','declined')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 constraint mova_privacy_requests_scope_tenant_check check((request_scope='artist_account' and artist_business_id is not null) or (request_scope='client_profile' and artist_business_id is null))
);
create unique index mova_privacy_requests_active_uq on public.mova_privacy_requests(requester_user_id,coalesce(artist_business_id,'00000000-0000-0000-0000-000000000000'::uuid),request_scope,request_type)
 where status in ('submitted','reviewing');
create table public.mova_security_audit_events (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid references public.mova_artist_businesses(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null, event_type text not null,
 object_type text not null, object_id text, request_id text, metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 occurred_at timestamptz not null default now()
);
create index mova_security_audit_tenant_time_idx on public.mova_security_audit_events(artist_business_id,occurred_at desc);

alter table public.mova_privacy_requests enable row level security;
alter table public.mova_security_audit_events enable row level security;
revoke all on public.mova_privacy_requests,public.mova_security_audit_events from public,anon,authenticated;
grant all on public.mova_privacy_requests,public.mova_security_audit_events to service_role;

create or replace function public.mova_privacy_request_create(p_actor_id uuid,p_scope text,p_type text,p_artist_business_id uuid default null)
returns public.mova_privacy_requests language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare saved public.mova_privacy_requests%rowtype;
begin
 if p_scope not in ('artist_account','client_profile') or p_type not in ('delete','access') then raise exception using errcode='22023',message='PRIVACY_REQUEST_INVALID'; end if;
 if p_scope='artist_account' and (p_artist_business_id is null or not exists(select 1 from public.mova_artist_memberships where user_id=p_actor_id and artist_business_id=p_artist_business_id and status='active')) then
  raise exception using errcode='42501',message='ARTIST_MEMBERSHIP_REQUIRED';
 end if;
 if p_scope='client_profile' and p_artist_business_id is not null then raise exception using errcode='22023',message='PRIVACY_REQUEST_INVALID'; end if;
 insert into public.mova_privacy_requests(requester_user_id,artist_business_id,request_scope,request_type)
 values(p_actor_id,p_artist_business_id,p_scope,p_type) on conflict do nothing;
 select * into saved from public.mova_privacy_requests where requester_user_id=p_actor_id and artist_business_id is not distinct from p_artist_business_id
  and request_scope=p_scope and request_type=p_type and status in ('submitted','reviewing') order by created_at desc limit 1;
 insert into public.mova_security_audit_events(artist_business_id,actor_user_id,event_type,object_type,object_id)
 values(p_artist_business_id,p_actor_id,'privacy.request_submitted','privacy_request',saved.id::text);
 return saved;
end $$;
revoke all on function public.mova_privacy_request_create(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_privacy_request_create(uuid,text,text,uuid) to service_role;
