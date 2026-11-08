begin;
select no_plan();

create function public.mova_test_rls_matrix_catalog_assertions()
returns setof text
language plpgsql
as $rls_catalog$
declare
  table_row record;
  command_name text;
  policy_exists boolean;
begin
  for table_row in
    select
      relation.oid,
      relation.relname,
      relation.relrowsecurity,
      relation.relname = 'mova_artist_businesses' or exists (
        select 1 from pg_attribute attribute
        where attribute.attrelid = relation.oid
          and attribute.attname = 'artist_business_id'
          and attribute.attnum > 0
          and not attribute.attisdropped
      ) as is_tenant_table
    from pg_class relation
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname like 'mova\_%' escape '\'
      and relation.relkind in ('r', 'p')
    order by relation.relname
  loop
    return query select ok(table_row.relrowsecurity, format('TC-STATIC-TAP-01 / TC-RLS-TENANT-MATRIX: %s has row-level security enabled', table_row.relname));
    return query select ok(not has_table_privilege('anon', table_row.oid, 'SELECT'), format('TC-STATIC-TAP-01 / TC-RLS-TENANT-MATRIX: anon cannot directly read %s', table_row.relname));

    if has_table_privilege('authenticated', table_row.oid, 'SELECT') then
      select exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = table_row.relname
          and policy.cmd in ('SELECT', 'ALL')
          and policy.roles && array['authenticated'::name, 'public'::name]
      ) into policy_exists;
      return query select ok(policy_exists, format('TC-STATIC-TAP-01 / TC-RLS-TENANT-MATRIX: authenticated SELECT on %s is governed by an RLS policy', table_row.relname));

      if table_row.is_tenant_table then
        select exists (
          select 1 from pg_policies policy
          where policy.schemaname = 'public'
            and policy.tablename = table_row.relname
            and policy.cmd in ('SELECT', 'ALL')
            and policy.roles && array['authenticated'::name, 'public'::name]
            and coalesce(policy.qual, '') ilike '%mova_has_artist_membership%'
        ) into policy_exists;
        return query select ok(policy_exists, format('TC-STATIC-TAP-01 / TC-RLS-TENANT-MATRIX: authenticated SELECT on tenant table %s is membership-scoped', table_row.relname));
      end if;
    end if;

    foreach command_name in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', table_row.oid, command_name) then
        select exists (
          select 1 from pg_policies policy
          where policy.schemaname = 'public'
            and policy.tablename = table_row.relname
            and policy.cmd in (command_name, 'ALL')
            and policy.roles && array['authenticated'::name, 'public'::name]
        ) into policy_exists;
        return query select ok(policy_exists, format('TC-STATIC-TAP-01 / TC-RLS-TENANT-MATRIX: authenticated %s on %s is governed by an RLS policy', command_name, table_row.relname));
      end if;
    end loop;
  end loop;
end;
$rls_catalog$;

select * from public.mova_test_rls_matrix_catalog_assertions();

-- A fixture row makes the business-table denial meaningful even without the optional demo seed.
insert into public.mova_artist_businesses (id, name, status)
values ('f4444444-4444-4444-8444-444444444441', 'RLS matrix fixture', 'active')
on conflict (id) do nothing;

select ok(
  not exists (
    select 1 from public.mova_artist_memberships
    where user_id = 'f4444444-4444-4444-8444-444444444442'::uuid
      and status = 'active'
  ),
  'the synthetic non-member has no active artist membership'
);

create function public.mova_test_rls_matrix_nonmember_assertions()
returns setof text
language plpgsql
as $rls_nonmember$
declare
  table_row record;
  visible_rows bigint;
begin
  for table_row in
    select relation.relname
    from pg_class relation
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname like 'mova\_%' escape '\'
      and relation.relkind in ('r', 'p')
      and (relation.relname = 'mova_artist_businesses' or exists (
        select 1 from pg_attribute attribute
        where attribute.attrelid = relation.oid
          and attribute.attname = 'artist_business_id'
          and attribute.attnum > 0
          and not attribute.attisdropped
      ))
      and has_table_privilege(current_user, relation.oid, 'SELECT')
    order by relation.relname
  loop
    execute format('select count(*) from public.%I', table_row.relname) into visible_rows;
    return query select is(visible_rows, 0::bigint, format('TC-STATIC-TAP-01 / TC-RLS-TENANT-MATRIX: non-member cannot read rows from %s', table_row.relname));
  end loop;
end;
$rls_nonmember$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4444444-4444-4444-8444-444444444442', true);
select * from public.mova_test_rls_matrix_nonmember_assertions();

reset role;
select * from finish();
rollback;
