begin;
select plan(31);

create or replace function pg_temp.blog_fields(
  p_slug text, p_title text, p_category text, p_body jsonb, p_meta_description text default 'A short search description.'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'slug', p_slug, 'title', p_title, 'summary', 'One calendar for a week that spans two suites.',
    'body', p_body, 'category', p_category, 'tags', jsonb_build_array('Booking', 'calendar', 'calendar '),
    'cover_url', 'https://images.example.com/cover.jpg', 'cover_alt', 'A calendar on a desk',
    'cover_credit', null, 'author_name', 'Mova team',
    'meta_title', 'Manage appointments | Mova guides', 'meta_description', p_meta_description,
    'canonical_url', null, 'og_title', '', 'og_description', '', 'og_image_url', null, 'noindex', false
  );
$$;

insert into auth.users (id, email) values
  ('ad680000-0000-4000-8000-000000000001', 'blog-admin@mova.invalid'),
  ('ad680000-0000-4000-8000-000000000002', 'blog-stylist@mova.invalid');
select public.mova_grant_platform_admin('ad680000-0000-4000-8000-000000000001', 'Blog Admin');

-- A stylist (aal2) cannot use any admin blog function.
select set_config('request.jwt.claims', '{"sub":"ad680000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.mova_admin_blog_list()$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot list guides');
select throws_ok($$select public.mova_admin_blog_save(null, '{}'::jsonb, 'draft')$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot save guides');
reset role;

-- The admin, on a two-step session.
select set_config('request.jwt.claims', '{"sub":"ad680000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

create temp table saved (name text primary key, id uuid, body jsonb);

select lives_ok(
  $$insert into saved select 'draft', (public.mova_admin_blog_save(null, pg_temp.blog_fields('Manage-Appointments', 'Manage appointments across salons', 'Booking', '[{"type":"heading","level":2,"text":"Keep the week in one calendar"},{"type":"paragraph","content":[{"text":"Most stylists keep two calendars, then discover a double booking on Thursday.","bold":false},{"text":" Read the Mova guide.","href":"https://mova-beauty.co/guides"}]},{"type":"list","ordered":true,"items":[[{"text":"Block travel time"}],[{"text":"Set buffers"}]]},{"type":"callout","tone":"tip","content":[{"text":"Block travel time between suites."}]},{"type":"quote","content":[{"text":"One view fixes the timing."}],"cite":"Ari Monroe"},{"type":"image","url":"https://images.example.com/desk.jpg","alt":"A desk calendar","caption":"Week view"},{"type":"divider"}]'::jsonb), 'draft')->>'id')::uuid, null from (select 1) s$$,
  'an admin can save a full draft with every block type'
);
select is((select (public.mova_admin_blog_get((select id from saved where name = 'draft')) -> 'post' ->> 'slug')), 'manage-appointments', 'the slug is saved in lower case');
select is((select public.mova_admin_blog_get((select id from saved where name = 'draft')) -> 'post' ->> 'live_state'), 'draft', 'a saved draft is not live');
select ok((select (public.mova_admin_blog_get((select id from saved where name = 'draft')) -> 'post' ->> 'reading_minutes')::int >= 1), 'reading time is computed');
select is((select public.mova_admin_blog_get((select id from saved where name = 'draft')) -> 'post' -> 'tags'), '["booking", "calendar"]'::jsonb, 'tags are lower-cased, de-duplicated and sorted');

select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('manage-appointments', 'Copy', 'Booking', '[]'::jsonb), 'draft')$$,
  '23505', 'SLUG_TAKEN', 'a second piece cannot take the same slug'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('bad slug!', 'Title', 'Booking', '[]'::jsonb), 'draft')$$,
  '22023', 'SLUG_INVALID', 'a slug with spaces or symbols is refused'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('script-block', 'Title', 'Booking', '[{"type":"script","text":"alert(1)"}]'::jsonb), 'draft')$$,
  '22023', 'BLOCK_TYPE_INVALID', 'unknown block types are refused'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('no-alt', 'Title', 'Booking', '[{"type":"image","url":"https://images.example.com/a.jpg","alt":""}]'::jsonb), 'draft')$$,
  '22023', 'IMAGE_ALT_REQUIRED', 'images need alt text'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('js-link', 'Title', 'Booking', '[{"type":"paragraph","content":[{"text":"x","href":"javascript:alert(1)"}]}]'::jsonb), 'draft')$$,
  '22023', 'PARAGRAPH_INVALID', 'javascript links are refused'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('long-meta', 'Title', 'Booking', '[]'::jsonb, repeat('x', 161)), 'draft')$$,
  '22023', 'META_DESCRIPTION_TOO_LONG', 'meta descriptions stop at 160 characters'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('no-cat', 'Title', 'Nope', '[]'::jsonb), 'draft')$$,
  '22023', 'CATEGORY_INVALID', 'only listed categories are accepted'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('no-body', 'Title', 'Booking', '[]'::jsonb), 'publish')$$,
  '22023', 'BODY_REQUIRED', 'a piece without a body cannot be published'
);
select throws_ok(
  $$select public.mova_admin_blog_save(null, pg_temp.blog_fields('past', 'Title', 'Booking', '[{"type":"divider"}]'::jsonb), 'schedule', now() - interval '1 hour')$$,
  '22023', 'SCHEDULE_TIME_NOT_IN_FUTURE', 'a schedule time in the past is refused'
);

-- Scheduled: stored as published with a future time. Not visible to readers yet.
insert into saved select 'scheduled', (public.mova_admin_blog_save(null, pg_temp.blog_fields('booth-rent', 'Booth rent vs. commission', 'Money', '[{"type":"divider"}]'::jsonb), 'schedule', now() + interval '3 days')->>'id')::uuid, null;
select is((select public.mova_admin_blog_get((select id from saved where name = 'scheduled')) -> 'post' ->> 'live_state'), 'scheduled', 'a future time is a scheduled piece');

-- Publish now: live straight away.
insert into saved select 'live', (public.mova_admin_blog_save(null, pg_temp.blog_fields('ai-and-personal', 'AI and personal beauty', 'Clients', '[{"type":"paragraph","content":[{"text":"Clients still want a person."}]}]'::jsonb), 'publish')->>'id')::uuid, null;
select is((select public.mova_admin_blog_get((select id from saved where name = 'live')) -> 'post' ->> 'live_state'), 'published', 'publish now makes a piece live');

-- Live pieces cannot be saved as drafts, and cannot be deleted.
select throws_ok(
  format($$select public.mova_admin_blog_save(%L, pg_temp.blog_fields('ai-and-personal', 'AI and personal beauty', 'Clients', '[{"type":"divider"}]'::jsonb), 'draft')$$, (select id from saved where name = 'live')),
  '55000', 'UNPUBLISH_BEFORE_DRAFT', 'a live piece cannot be saved as a draft'
);
select throws_ok(
  format($$select public.mova_admin_blog_delete(%L)$$, (select id from saved where name = 'live')),
  '55000', 'PUBLISHED_PIECE_CANNOT_BE_DELETED', 'a live piece cannot be deleted'
);
select lives_ok(
  format($$select public.mova_admin_blog_unpublish(%L)$$, (select id from saved where name = 'live')),
  'a live piece can be unpublished'
);
select is((select public.mova_admin_blog_get((select id from saved where name = 'live')) -> 'post' ->> 'live_state'), 'draft', 'an unpublished piece is a draft again');
select lives_ok(
  format($$select public.mova_admin_blog_delete(%L)$$, (select id from saved where name = 'live')),
  'a draft can be deleted'
);

-- Filters.
select is((select (public.mova_admin_blog_list('all') -> 'counts' ->> 'all')::int), 2, 'the list counts every remaining piece');
select is((select (public.mova_admin_blog_list('scheduled') -> 'counts' ->> 'scheduled')::int), 1, 'the scheduled tab counts scheduled pieces');
select is((select jsonb_array_length(public.mova_admin_blog_list('drafts') -> 'posts')), 1, 'the drafts tab lists drafts');
select is((select jsonb_array_length(public.mova_admin_blog_list('all', 'Money') -> 'posts')), 1, 'the category filter works');
select is((select jsonb_array_length(public.mova_admin_blog_list('all', null, 'Manage appointments') -> 'posts')), 1, 'search finds a piece by title');
select is((select public.mova_admin_blog_list() -> 'summary' ->> 'missing_meta_description'), '0', 'no piece is missing a meta description');
reset role;
select ok((select count(*) from public.mova_admin_activity where action = 'blog.saved_draft' and admin_user_id = 'ad680000-0000-4000-8000-000000000001') >= 1, 'saving a draft is logged');

-- Readers see only the live piece, and anonymous readers see nothing scheduled.
set local role anon;
select is((select count(*)::int from public.mova_blog_posts), 0, 'anonymous readers see no live pieces yet');
reset role;

select * from finish();
rollback;
