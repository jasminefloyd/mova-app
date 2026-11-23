-- Account closure separates scheduled access loss, reversible archive, and permanent purge.
create table public.mova_account_closures (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('stylist','admin')),
  state text not null check (state in ('scheduled','archived','purging')),
  ends_at timestamptz not null,
  archived_at timestamptz,
  prior_status text not null,
  was_published boolean not null,
  was_indexed boolean not null,
  previous_ban timestamptz,
  admin_notified_at timestamptz,
  farewell_sent_at timestamptz,
  feedback text check (length(feedback) <= 2000),
  feedback_reason text check (feedback_reason in ('cost','features','switching','no_longer_needed','other')),
  created_at timestamptz not null default now()
);
alter table public.mova_privacy_requests
  add column exit_feedback text check (length(exit_feedback) <= 2000),
  add column exit_reason text check (exit_reason in ('cost','features','switching','no_longer_needed','other'));

create index mova_account_closures_due on public.mova_account_closures(ends_at) where state='scheduled';
alter table public.mova_account_closures enable row level security;
revoke all on public.mova_account_closures from public, anon, authenticated;
grant select, update on public.mova_account_closures to service_role;

create function public.mova_account_available(p_business uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.mova_account_closures where artist_business_id=p_business
    and (state <> 'scheduled' or ends_at <= now()));
$$;

create or replace function public.mova_has_artist_membership(p_artist_business_id uuid) returns boolean
language sql stable security definer set search_path=public,auth,pg_temp as $$
  select public.mova_account_available(p_artist_business_id) and exists(
    select 1 from public.mova_artist_memberships where artist_business_id=p_artist_business_id
      and user_id=auth.uid() and status='active');
$$;

create function public.mova_account_owner(p_business uuid) returns uuid
language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.mova_artist_memberships
  where artist_business_id=p_business and role='owner' and status='active'
  order by created_at limit 1;
  if owner_id is null then raise exception 'ACCOUNT_OWNER_REQUIRED'; end if;
  if exists(select 1 from public.mova_platform_admins where user_id=owner_id)
    or exists(select 1 from public.mova_artist_memberships where user_id=owner_id and artist_business_id<>p_business)
    or exists(select 1 from public.mova_artist_memberships where artist_business_id=p_business and role='owner' and status='active' and user_id<>owner_id)
    or exists(select 1 from public.mova_client_customer_links l join public.mova_customer_accounts c on c.id=l.customer_account_id
      where c.user_id=owner_id and l.artist_business_id<>p_business) then
    raise exception 'ACCOUNT_IDENTITY_SHARED';
  end if;
  return owner_id;
end $$;

create function public.mova_account_archive(p_business uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare closure public.mova_account_closures%rowtype;
begin
  perform 1 from public.mova_artist_businesses where id=p_business for update;
  select * into closure from public.mova_account_closures where artist_business_id=p_business for update;
  if not found or closure.state <> 'scheduled' or closure.ends_at > p_at then return; end if;
  if public.mova_account_owner(p_business) <> closure.owner_id then raise exception 'ACCOUNT_OWNER_CHANGED'; end if;
  update public.mova_account_closures set state='archived', archived_at=p_at,
    previous_ban=(select banned_until from auth.users where id=closure.owner_id)
    where artist_business_id=p_business;
  update auth.users set banned_until='9999-12-31 00:00:00+00' where id=closure.owner_id;
  delete from auth.sessions where user_id=closure.owner_id;
  update public.mova_artist_profiles set is_published=false, search_index_enabled=false where artist_business_id=p_business;
  update public.mova_artist_businesses set status='suspended' where id=p_business;
end $$;

create function public.mova_account_begin(p_business uuid, p_actor uuid, p_source text, p_ends_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare business public.mova_artist_businesses%rowtype; closure public.mova_account_closures%rowtype; owner_id uuid;
begin
  select * into business from public.mova_artist_businesses where id=p_business and status<>'deleted' for update;
  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;
  owner_id := public.mova_account_owner(p_business);
  if p_source='stylist' and p_actor<>owner_id then raise exception 'ACCOUNT_OWNER_REQUIRED'; end if;
  if p_source='admin' and not exists(select 1 from public.mova_platform_admins where user_id=p_actor)
    then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  select * into closure from public.mova_account_closures where artist_business_id=p_business for update;
  if found then
    if p_source='admin' and closure.state='scheduled' then
      update public.mova_account_closures set ends_at=now() where artist_business_id=p_business;
      perform public.mova_account_archive(p_business,now());
    end if;
    return (select jsonb_build_object('state', state, 'ends_at', ends_at) from public.mova_account_closures where artist_business_id=p_business);
  end if;
  insert into public.mova_account_closures(artist_business_id,owner_id,source,state,ends_at,prior_status,was_published,was_indexed)
  values(p_business,owner_id,p_source,'scheduled',greatest(now(),p_ends_at),business.status,
    coalesce((select is_published from public.mova_artist_profiles where artist_business_id=p_business),false),
    coalesce((select search_index_enabled from public.mova_artist_profiles where artist_business_id=p_business),false))
  returning * into closure;
  if p_source='stylist' then
    perform public.mova_privacy_request_create(owner_id,'artist_account','delete',p_business);
  else
    insert into public.mova_admin_activity(admin_user_id,action,object_type,object_id,artist_business_id)
    values(p_actor,'stylist.archived','stylist',p_business::text,p_business);
  end if;
  perform public.mova_account_archive(p_business,now());
  return (select jsonb_build_object('state', state, 'ends_at', ends_at) from public.mova_account_closures where artist_business_id=p_business);
end $$;

create function public.mova_account_finish_due() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid; total integer:=0;
begin
  for business in select artist_business_id from public.mova_account_closures
    where state='scheduled' and ends_at<=now() order by ends_at limit 100
  loop
    begin
      perform public.mova_account_archive(business,now());
      total:=total+1;
    exception when others then
      raise warning 'Account closure % could not transition: %', business, sqlstate;
    end;
  end loop;
  return total;
end $$;

create function public.mova_account_restore(p_business uuid,p_closure uuid) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare closure public.mova_account_closures%rowtype;
begin
  perform 1 from public.mova_artist_businesses where id=p_business for update;
  select * into closure from public.mova_account_closures
   where artist_business_id=p_business and (p_closure is null or (id=p_closure and source='stylist'))
   for update;
  if not found or closure.state <> 'archived' then return false; end if;
  update auth.users set banned_until=closure.previous_ban where id=closure.owner_id and banned_until='9999-12-31 00:00:00+00';
  update public.mova_artist_profiles set is_published=closure.was_published, search_index_enabled=closure.was_indexed where artist_business_id=p_business;
  update public.mova_artist_businesses set status=closure.prior_status where id=p_business;
  update public.mova_privacy_requests set status='declined', updated_at=now(), completed_at=now(),
      exit_reason=closure.feedback_reason,exit_feedback=closure.feedback
    where artist_business_id=p_business and request_scope='artist_account' and request_type='delete' and status in ('submitted','reviewing');
  delete from public.mova_account_closures where artist_business_id=p_business;
  return true;
end $$;

create function public.mova_admin_account_closures(p_business uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(item)) from (
    select requested.artist_business_id,requested.source,requested.state,requested.ends_at,
      requested.feedback_reason,requested.feedback,coalesce(p.display_name,b.name) as display_name,b.business_number
    from (
      select c.artist_business_id,c.source,c.state,c.ends_at,c.feedback_reason,c.feedback,c.created_at
      from public.mova_account_closures c
      where (p_business is null and c.source='stylist') or c.artist_business_id=p_business
      union all
      select r.artist_business_id,'stylist',case when r.status='declined' then 'restored' else 'review' end,
        null,r.exit_reason,r.exit_feedback,r.created_at
      from public.mova_privacy_requests r
      where r.request_scope='artist_account' and r.request_type='delete'
        and (r.status in ('submitted','reviewing') or (p_business is not null and r.status='declined'
          and (r.exit_reason is not null or r.exit_feedback is not null)))
        and (p_business is null or r.artist_business_id=p_business)
        and not exists(select 1 from public.mova_account_closures c where c.artist_business_id=r.artist_business_id)
    ) requested
    join public.mova_artist_businesses b on b.id=requested.artist_business_id
    left join public.mova_artist_profiles p on p.artist_business_id=b.id
    order by requested.created_at desc limit 100
  ) item),'[]'::jsonb);
end $$;

create function public.mova_account_prepare_purge(p_business uuid,p_admin uuid,p_name text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare display_name text;
begin
  if not exists(select 1 from public.mova_platform_admins where user_id=p_admin) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  select coalesce(p.display_name,b.name) into display_name from public.mova_artist_businesses b
  left join public.mova_artist_profiles p on p.artist_business_id=b.id where b.id=p_business for update of b;
  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;
  if display_name is distinct from p_name then raise exception 'DISPLAY_NAME_MISMATCH'; end if;
  perform public.mova_account_begin(p_business,p_admin,'admin',now());
  update public.mova_account_closures set state='purging' where artist_business_id=p_business and state='archived';
end $$;

create function public.mova_account_storage(p_business uuid) returns table(bucket_id text,name text)
language sql stable security definer set search_path=public,storage,pg_temp as $$
  select o.bucket_id,o.name from storage.objects o
  join public.mova_account_closures c on c.artist_business_id=p_business and c.state='purging'
  left join public.mova_artist_profiles p on p.artist_business_id=p_business
  where o.bucket_id in ('mova_portfolio_media','mova_profile_photos','mova_visit_private','mova_support_screenshots')
    and (split_part(o.name,'/',1)=p_business::text or (
      o.bucket_id in ('mova_portfolio_media','mova_profile_photos') and split_part(o.name,'/',1)=p.handle))
  order by o.bucket_id,o.name limit 100;
$$;

create or replace function public.mova_admin_activity_append_only() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' and current_setting('mova.purge_business',true)=old.artist_business_id::text
    and exists(select 1 from public.mova_account_closures where artist_business_id=old.artist_business_id and state='purging') then return old; end if;
  raise exception using errcode='42501',message='ADMIN_ACTIVITY_IS_APPEND_ONLY';
end $$;

create or replace function public.mova_payment_ledger_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' and current_setting('mova.purge_business',true)=old.artist_business_id::text
    and exists(select 1 from public.mova_account_closures where artist_business_id=old.artist_business_id and state='purging') then return old; end if;
  raise exception using errcode='55000',message='PAYMENT_LEDGER_IMMUTABLE';
end $$;

create function public.mova_account_purge(p_business uuid,p_admin uuid) returns void
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare closure public.mova_account_closures%rowtype;
begin
  if not exists(select 1 from public.mova_platform_admins where user_id=p_admin) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  select * into closure from public.mova_account_closures where artist_business_id=p_business and state='purging' for update;
  if not found or closure.owner_id<>public.mova_account_owner(p_business) then raise exception 'ACCOUNT_NOT_READY_TO_PURGE'; end if;
  if exists(select 1 from public.mova_account_storage(p_business)) then raise exception 'ACCOUNT_MEDIA_REMAINS'; end if;
  perform set_config('mova.purge_business',p_business::text,true);
  perform set_config('mova.system_log_cleanup','on',true);
  delete from public.mova_admin_activity where artist_business_id=p_business;
  delete from public.mova_stylist_fee_overrides where artist_business_id=p_business;
  delete from public.mova_security_audit_events where artist_business_id=p_business or actor_user_id=closure.owner_id;
  delete from public.mova_system_logs where artist_business_id=p_business or user_id=closure.owner_id;
  delete from public.mova_payment_ledger where artist_business_id=p_business;
  delete from public.mova_reviews where artist_business_id=p_business;
  delete from public.mova_artist_businesses where id=p_business;
  delete from auth.users where id=closure.owner_id;
  insert into public.mova_admin_activity(admin_user_id,action,object_type)
    values(p_admin,'stylist.permanently_deleted','stylist');
end $$;

create function public.mova_account_mail() returns table(
  closure_id uuid,business_id uuid, kind text, email text, display_name text, locale text, ends_at timestamptz
)
language sql security definer set search_path=public,auth,pg_temp as $$
  select c.id,c.artist_business_id,'admin',a.email,coalesce(p.display_name,b.name),'en-US',c.ends_at
   from public.mova_account_closures c join public.mova_artist_businesses b on b.id=c.artist_business_id
   left join public.mova_artist_profiles p on p.artist_business_id=b.id
   cross join lateral (select u.email from public.mova_platform_admins x join auth.users u on u.id=x.user_id
     where u.email_confirmed_at is not null and u.deleted_at is null order by x.created_at limit 1) a
   where c.source='stylist' and c.admin_notified_at is null
  union all
  select c.id,c.artist_business_id,'farewell',u.email,coalesce(p.display_name,b.name),coalesce(p.preferred_locale,'en-US'),c.ends_at
   from public.mova_account_closures c join public.mova_artist_businesses b on b.id=c.artist_business_id
   join auth.users u on u.id=c.owner_id left join public.mova_artist_profiles p on p.artist_business_id=b.id
   where c.source='stylist' and c.state in ('archived','purging') and c.farewell_sent_at is null
  limit 100;
$$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'mova_account_available(uuid)','mova_account_owner(uuid)','mova_account_archive(uuid,timestamptz)',
    'mova_account_begin(uuid,uuid,text,timestamptz)','mova_account_finish_due()','mova_account_restore(uuid,uuid)',
    'mova_account_prepare_purge(uuid,uuid,text)','mova_account_storage(uuid)','mova_account_purge(uuid,uuid)','mova_account_mail()'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to service_role';
  end loop;
end $$;
revoke all on function public.mova_admin_account_closures(uuid) from public,anon;
grant execute on function public.mova_admin_account_closures(uuid) to authenticated;

-- Prevent a stale authenticated artist token from writing through a direct owner policy.
-- Public and customer reads use their existing selectors, with archive removing publication.
grant execute on function public.mova_account_available(uuid) to anon,authenticated;
do $$
declare relation record;
begin
  for relation in select c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='artist_business_id' and not a.attisdropped
    where n.nspname='public' and c.relrowsecurity and c.relkind in ('r','p')
      and c.relname<>'mova_account_closures' and left(c.relname,5)='mova_'
  loop
    execute format('create policy mova_account_access on public.%I as restrictive for all to anon,authenticated using (public.mova_account_available(artist_business_id)) with check (public.mova_account_available(artist_business_id))',relation.relname);
  end loop;
end $$;

create function public.mova_admin_restore_account(p_business uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  if not public.mova_account_restore(p_business,null) then return false; end if;
  perform public.mova_admin_log('stylist.restored','stylist',p_business::text,p_business,null);
  return true;
end $$;
revoke all on function public.mova_admin_restore_account(uuid) from public,anon;
grant execute on function public.mova_admin_restore_account(uuid) to authenticated;

create or replace function public.mova_stripe_paylink_resolve(p_short_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare link public.mova_paylinks%rowtype; client_locale text;
begin
  if p_short_code is null or p_short_code !~ '^[A-Za-z0-9_-]{40,96}$' then return null; end if;
  select * into link from public.mova_paylinks where short_code=p_short_code;
  if not found or not public.mova_account_available(link.artist_business_id) then return null; end if;
  select a.client_locale into client_locale from public.mova_appointments a where a.id=link.appointment_id and a.artist_business_id=link.artist_business_id;
  if link.status='open' and link.expires_at<=now() then
    update public.mova_paylinks set status='expired',updated_at=now() where id=link.id and status='open' returning * into link;
    update public.mova_payments set status='failed',updated_at=now() where id=link.payment_id and status='pending';
  end if;
  return jsonb_build_object('status',link.status,'expires_at',link.expires_at,'checkout_url',link.checkout_session_url,'locale',coalesce(client_locale,'en-US'));
end $$;

create or replace function public.mova_review_submit(p_token_hash bytea,p_rating smallint,p_tags text[],p_body text,p_locale text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare request public.mova_review_requests%rowtype; appointment public.mova_appointments%rowtype; safe_name text;
begin
  if p_rating not between 1 and 5 or coalesce(array_length(p_tags,1),0)>5 or coalesce(p_body,'')<>trim(coalesce(p_body,''))
    or length(coalesce(p_body,''))>1000 or p_locale not in ('en-US','es-US')
    or not coalesce(p_tags,'{}') <@ array['great_results','listened_to_me','on_time','clean_space','healthy_hair']::text[] then
    raise exception using errcode='22023',message='REVIEW_INPUT_INVALID';
  end if;
  select * into request from public.mova_review_requests where token_hash=p_token_hash for update;
  if not found or not public.mova_account_available(request.artist_business_id) or request.status<>'sent' or request.expires_at<=now() then raise exception using errcode='P0002',message='REVIEW_LINK_INVALID'; end if;
  select * into appointment from public.mova_appointments where id=request.appointment_id and artist_business_id=request.artist_business_id and status='completed';
  if not found then raise exception using errcode='42501',message='COMPLETED_VISIT_REQUIRED'; end if;
  safe_name:=split_part(trim(appointment.client_name),' ',1)||case when position(' ' in trim(appointment.client_name))>0 then ' '||upper(left(split_part(trim(appointment.client_name),' ',2),1))||'.' else '' end;
  insert into public.mova_reviews(artist_business_id,appointment_id,request_id,rating,tags,body,display_name,locale,moderation_status,public_display_enabled)
  values(request.artist_business_id,appointment.id,request.id,p_rating,coalesce(p_tags,'{}'),trim(coalesce(p_body,'')),safe_name,p_locale,'pending',false);
  update public.mova_review_requests set status='used',used_at=now() where id=request.id;
  return jsonb_build_object('saved',true,'moderation_status','pending');
exception when unique_violation then raise exception using errcode='23505',message='REVIEW_ALREADY_SUBMITTED';
end $$;

create or replace function public.mova_review_public_context(p_token_hash bytea)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare request public.mova_review_requests%rowtype;
begin
  select * into request from public.mova_review_requests where token_hash=p_token_hash;
  if not found or not public.mova_account_available(request.artist_business_id) or request.status<>'sent' or request.expires_at<=now() then return null; end if;
  return (select jsonb_build_object('artist_name',p.display_name,'artist_handle',p.handle,'profile_photo_path',p.profile_photo_path,
    'service_name',a.service_name_snapshot,'visit_date',a.starts_at,'location_name',l.name,'google_review_url',s.google_review_url,
    'reviewer_display_name',split_part(trim(a.client_name),' ',1)||case when position(' ' in trim(a.client_name))>0 then ' '||upper(left(split_part(trim(a.client_name),' ',2),1))||'.' else '' end)
    from public.mova_appointments a join public.mova_artist_profiles p on p.artist_business_id=a.artist_business_id
    join public.mova_locations l on l.id=a.location_id and l.artist_business_id=a.artist_business_id
    left join public.mova_review_settings s on s.artist_business_id=a.artist_business_id
    where a.id=request.appointment_id and a.artist_business_id=request.artist_business_id and a.status='completed');
end $$;
