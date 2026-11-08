-- Task 5.10: client account actions. Deleting a client profile withdraws its marketing consents with
-- every stylist it was linked to, records an audit event, and removes the customer account (which
-- cascades to its contact methods and stylist links). The stylists' own client records and
-- appointment history stay with the stylist; only the link to the person's Mova account goes.
create or replace function public.mova_delete_customer_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account public.mova_customer_accounts%rowtype;
  link record;
  withdrawn integer := 0;
  links integer := 0;
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'USER_REQUIRED'; end if;
  select * into account from public.mova_customer_accounts where user_id = p_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CUSTOMER_ACCOUNT_NOT_FOUND'; end if;

  for link in
    select artist_business_id, client_id from public.mova_client_customer_links
    where customer_account_id = account.id and unlinked_at is null
  loop
    links := links + 1;
    insert into public.mova_client_consents(artist_business_id, client_id, purpose, channel, granted, locale, changed_by, evidence)
    select link.artist_business_id, link.client_id, purpose, channel, false, account.preferred_locale, null,
      jsonb_build_object('source', 'client_profile_deleted')
    from (values ('rebooking_reminders'), ('offers'), ('review_requests')) as p(purpose)
    cross join (values ('sms'), ('email')) as c(channel);
    withdrawn := withdrawn + 6;
    update public.mova_clients set marketing_opted_out = true where id = link.client_id and artist_business_id = link.artist_business_id;
  end loop;

  insert into public.mova_security_audit_events(actor_user_id, event_type, object_type, object_id, metadata)
  values (p_user_id, 'privacy.client_profile_deleted', 'customer_account', account.id::text,
    jsonb_build_object('linked_stylists', links, 'consents_withdrawn', withdrawn));

  delete from public.mova_customer_accounts where id = account.id;
  return jsonb_build_object('deleted', true, 'linked_stylists', links, 'consents_withdrawn', withdrawn);
end;
$$;

revoke all on function public.mova_delete_customer_profile(uuid) from public, anon, authenticated;
grant execute on function public.mova_delete_customer_profile(uuid) to service_role;
