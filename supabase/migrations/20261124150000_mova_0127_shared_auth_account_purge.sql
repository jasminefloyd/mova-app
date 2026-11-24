-- The Auth database is shared with other applications. A Mova closure must
-- not ban or delete an identity while another application's rows refer to it.
alter table public.mova_account_closures add column auth_ban_applied boolean not null default false;
update public.mova_account_closures set auth_ban_applied = true where state in ('archived', 'purging');

create function public.mova_account_has_external_auth_reference(p_owner uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  reference record;
  identity_in_use boolean;
begin
  for reference in
    select n.nspname as schema_name, r.relname as table_name, a.attname as column_name
    from pg_constraint f
    join pg_class r on r.oid = f.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    join pg_attribute a on a.attrelid = r.oid and a.attnum = f.conkey[1]
    join pg_attribute owner_key on owner_key.attrelid = f.confrelid and owner_key.attname = 'id'
    where f.contype = 'f' and f.confrelid = 'auth.users'::regclass
      and f.confkey = array[owner_key.attnum]
      and n.nspname <> 'auth'
      and not (n.nspname = 'public' and left(r.relname, 5) = 'mova_')
  loop
    execute format('select exists(select 1 from %I.%I where %I = $1)',
      reference.schema_name, reference.table_name, reference.column_name)
      into identity_in_use using p_owner;
    if identity_in_use then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function public.mova_account_has_external_auth_reference(uuid) from public, anon, authenticated, service_role;

create or replace function public.mova_account_archive(p_business uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  closure public.mova_account_closures%rowtype;
  apply_auth_ban boolean;
begin
  perform 1 from public.mova_artist_businesses where id=p_business for update;
  select * into closure from public.mova_account_closures where artist_business_id=p_business for update;
  if not found or closure.state <> 'scheduled' or closure.ends_at > p_at then return; end if;
  if public.mova_account_owner(p_business) <> closure.owner_id then raise exception 'ACCOUNT_OWNER_CHANGED'; end if;
  perform 1 from auth.users where id=closure.owner_id for update;
  apply_auth_ban := not public.mova_account_has_external_auth_reference(closure.owner_id);
  update public.mova_account_closures set state='archived', archived_at=p_at, auth_ban_applied=apply_auth_ban,
    previous_ban=(select banned_until from auth.users where id=closure.owner_id)
    where artist_business_id=p_business;
  if apply_auth_ban then
    update auth.users set banned_until='9999-12-31 00:00:00+00' where id=closure.owner_id;
    delete from auth.sessions where user_id=closure.owner_id;
  end if;
  update public.mova_artist_profiles set is_published=false, search_index_enabled=false where artist_business_id=p_business;
  update public.mova_artist_businesses set status='suspended' where id=p_business;
end $$;

create or replace function public.mova_account_restore(p_business uuid,p_closure uuid) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare closure public.mova_account_closures%rowtype;
begin
  perform 1 from public.mova_artist_businesses where id=p_business for update;
  select * into closure from public.mova_account_closures
   where artist_business_id=p_business and (p_closure is null or (id=p_closure and source='stylist'))
   for update;
  if not found or closure.state <> 'archived' then return false; end if;
  if closure.auth_ban_applied then
    update auth.users set banned_until=closure.previous_ban where id=closure.owner_id and banned_until='9999-12-31 00:00:00+00';
  end if;
  update public.mova_artist_profiles set is_published=closure.was_published, search_index_enabled=closure.was_indexed where artist_business_id=p_business;
  update public.mova_artist_businesses set status=closure.prior_status where id=p_business;
  update public.mova_privacy_requests set status='declined', updated_at=now(), completed_at=now(),
      exit_reason=closure.feedback_reason,exit_feedback=closure.feedback
    where artist_business_id=p_business and request_scope='artist_account' and request_type='delete' and status in ('submitted','reviewing');
  delete from public.mova_account_closures where artist_business_id=p_business;
  return true;
end $$;

create or replace function public.mova_account_purge(p_business uuid,p_admin uuid) returns void
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  closure public.mova_account_closures%rowtype;
  shared_identity boolean;
begin
  if not exists(select 1 from public.mova_platform_admins where user_id=p_admin) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  select * into closure from public.mova_account_closures where artist_business_id=p_business and state='purging' for update;
  if not found or closure.owner_id<>public.mova_account_owner(p_business) then raise exception 'ACCOUNT_NOT_READY_TO_PURGE'; end if;
  if exists(select 1 from public.mova_account_storage(p_business)) then raise exception 'ACCOUNT_MEDIA_REMAINS'; end if;
  perform 1 from auth.users where id=closure.owner_id for update;
  shared_identity := public.mova_account_has_external_auth_reference(closure.owner_id);
  perform set_config('mova.purge_business',p_business::text,true);
  perform set_config('mova.system_log_cleanup','on',true);
  delete from public.mova_admin_activity where artist_business_id=p_business;
  delete from public.mova_stylist_fee_overrides where artist_business_id=p_business;
  delete from public.mova_security_audit_events where artist_business_id=p_business or actor_user_id=closure.owner_id;
  delete from public.mova_system_logs where artist_business_id=p_business or user_id=closure.owner_id;
  delete from public.mova_payment_ledger where artist_business_id=p_business;
  delete from public.mova_reviews where artist_business_id=p_business;
  delete from public.mova_artist_businesses where id=p_business;
  if not shared_identity then
    delete from auth.users where id=closure.owner_id;
  elsif closure.auth_ban_applied then
    -- A purge started before this migration may have banned the shared login.
    update auth.users set banned_until=closure.previous_ban where id=closure.owner_id and banned_until='9999-12-31 00:00:00+00';
  end if;
  insert into public.mova_admin_activity(admin_user_id,action,object_type)
    values(p_admin,'stylist.permanently_deleted','stylist');
end $$;
