begin;
select plan(16);

-- A13·v2: the six new guide blocks are accepted when well formed and refused when not.
select is(public.mova_blog_body_problem($$[
  {"type":"takeaways","items":[[{"text":"Price the time first."}],[{"text":"Add for length."}]]},
  {"type":"button","label":"Start free","href":"/signup","variant":"banner","title":"Know what salons charge","text":"Free for 30 days."},
  {"type":"before_after","before":{"url":"https://img.example/b.jpg","alt":"Before"},"after":{"url":"https://img.example/a.jpg","alt":"After"},"caption":"Mid-back retwist"},
  {"type":"video","provider":"youtube","id":"dQw4w9WgXcQ","caption":"Watch it"},
  {"type":"video","provider":"vimeo","id":"76979871"},
  {"type":"table","header":true,"rows":[["Length","Price"],["Shoulder","$95"]]},
  {"type":"faq","items":[{"question":"How long does it take?","answer":[{"text":"Two to three hours."}]}]}
]$$::jsonb), null, 'all six new block types are accepted');

select is(public.mova_blog_body_problem('[{"type":"paragraph","content":[{"text":"Old guides still pass."}]},{"type":"divider"}]'), null, 'existing blocks are unchanged');
select is(public.mova_blog_body_problem('[{"type":"takeaways","items":[]}]'), 'TAKEAWAYS_INVALID', 'takeaways need at least one item');
select is(public.mova_blog_body_problem('[{"type":"button","label":"Go","href":"javascript:alert(1)","variant":"button"}]'), 'BUTTON_LINK_INVALID', 'button links must be https or a site path');
select is(public.mova_blog_body_problem('[{"type":"button","label":"Go","href":"//evil.example","variant":"button"}]'), 'BUTTON_LINK_INVALID', 'protocol-relative links are refused');
select is(public.mova_blog_body_problem('[{"type":"button","label":"Go","href":"http://example.com","variant":"button"}]'), 'BUTTON_LINK_INVALID', 'button links must be https, not http');
select is(public.mova_blog_body_problem('[{"type":"button","label":"","href":"/signup","variant":"button"}]'), 'BUTTON_LABEL_INVALID', 'buttons need a label');
select is(public.mova_blog_body_problem('[{"type":"before_after","before":{"url":"https://a/b.jpg","alt":""},"after":{"url":"https://a/c.jpg","alt":"After"}}]'), 'BEFORE_AFTER_INVALID', 'both photos need alt text');
select is(public.mova_blog_body_problem('[{"type":"video","provider":"youtube","id":"<script>"}]'), 'VIDEO_INVALID', 'video ids are checked');
select is(public.mova_blog_body_problem('[{"type":"video","provider":"tiktok","id":"12345678"}]'), 'VIDEO_INVALID', 'only YouTube, Vimeo and Instagram');
select is(public.mova_blog_body_problem('[{"type":"table","header":true,"rows":[["a","b"],["c"]]}]'), 'TABLE_INVALID', 'table rows must be the same width');
select is(public.mova_blog_body_problem('[{"type":"table","header":false,"rows":[["a","b","c","d","e","f","g"]]}]'), 'TABLE_INVALID', 'tables have at most six columns');
select is(public.mova_blog_body_problem('[{"type":"faq","items":[{"question":"Why?","answer":[]}]}]'), 'FAQ_INVALID', 'FAQ answers need text');
select is(public.mova_blog_body_problem('[{"type":"embed","html":"<iframe>"}]'), 'BLOCK_TYPE_INVALID', 'unknown block types are still refused');

select is(public.mova_blog_reading_minutes((select jsonb_agg(b) from (
  select jsonb_build_object('type','faq','items', jsonb_build_array(jsonb_build_object('question', repeat('word ', 300), 'answer', '[{"text":"x"}]'::jsonb))) b
) s)), 2, 'reading time counts FAQ questions');
select ok(not has_function_privilege('anon', 'public.mova_blog_body_problem(jsonb)', 'EXECUTE'), 'the body check is not callable by visitors');

select * from finish();
rollback;
