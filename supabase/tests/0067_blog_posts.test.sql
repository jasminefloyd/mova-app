begin;
select plan(9);

select has_table('public'::name, 'mova_blog_posts'::name);
select ok((select relrowsecurity from pg_class where oid = 'public.mova_blog_posts'::regclass), 'blog posts have RLS enabled');
select is((select count(*)::int from public.mova_blog_categories), 4, 'the four launch categories are seeded');

-- One live piece, one scheduled piece, one draft. Inserted as the owner so RLS does not apply to setup.
insert into public.mova_blog_posts (slug, title, status, body, category, published_at) values
  ('live-piece', 'Live piece', 'published', '[]'::jsonb, 'Booking', now() - interval '1 hour'),
  ('scheduled-piece', 'Scheduled piece', 'published', '[]'::jsonb, 'Money', now() + interval '1 day'),
  ('draft-piece', 'Draft piece', 'draft', '[]'::jsonb, 'Clients', null);

set local role anon;
select is((select count(*)::int from public.mova_blog_live_posts), 1, 'anonymous readers see only the live piece');
select is((select min(slug) from public.mova_blog_live_posts), 'live-piece', 'the visible piece is the live one');
select throws_ok('select count(*) from public.mova_blog_posts', '42501', null, 'anonymous readers cannot read the table directly');
reset role;

select ok(not has_table_privilege('anon', 'public.mova_blog_posts', 'INSERT'), 'anonymous users cannot write blog posts');
select ok(not has_table_privilege('authenticated', 'public.mova_blog_posts', 'UPDATE'), 'signed-in users cannot write blog posts directly');
select throws_ok(
  $$insert into public.mova_blog_posts (slug, title, status) values ('bad slug', 'x', 'draft')$$,
  '23514', 'new row for relation "mova_blog_posts" violates check constraint "mova_blog_posts_slug_check"', 'slugs must be lowercase words joined by hyphens'
);

select * from finish();
rollback;
