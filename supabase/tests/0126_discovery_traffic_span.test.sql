begin;
select plan(4);

insert into auth.users(id,email) values ('ad125000-0000-4000-8000-000000000001','span-admin@mova.invalid');
select public.mova_grant_platform_admin('ad125000-0000-4000-8000-000000000001','Span Admin');
insert into public.mova_discovery_visits(id, started_at, landing_path, channel, source, medium, campaign)
values ('ad125000-0000-4000-8000-000000000010', '2026-01-02 15:00+00', '/', 'direct / unknown', '', '', '');
insert into public.mova_discovery_page_views(id, visit_id, path, viewed_at) values
  ('ad125000-0000-4000-8000-000000000020', 'ad125000-0000-4000-8000-000000000010', '/', '2026-01-02 15:05+00'),
  ('ad125000-0000-4000-8000-000000000021', 'ad125000-0000-4000-8000-000000000010', '/pricing', '2026-01-03 00:01+00');

select set_config('request.jwt.claims','{"sub":"ad125000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is((public.mova_admin_website_traffic('custom','2026-01-02','2026-01-02') #>> '{traffic_span,first_at}')::timestamptz,
  '2026-01-02 15:00+00'::timestamptz, 'Traffic starts at the first recorded session within the selection');
select is((public.mova_admin_website_traffic('custom','2026-01-02','2026-01-02') #>> '{traffic_span,last_at}')::timestamptz,
  '2026-01-02 15:05+00'::timestamptz, 'The next day’s view does not extend the selected traffic span');
select is((public.mova_admin_website_traffic('custom','2026-01-03','2026-01-03') #>> '{traffic_span,first_at}')::timestamptz,
  '2026-01-03 00:01+00'::timestamptz, 'A view counts as activity even when its session started on an earlier day');
select is(public.mova_admin_website_traffic('custom','2026-01-04','2026-01-04')->'traffic_span', 'null'::jsonb,
  'Prior-period traffic does not fill an empty selection');

select * from finish();
rollback;
