-- Guide editor v2 (A13·v2, 2026-11-24): one Notion-style body editor in the admin portal, and six new block
-- types for guides: key takeaways, button, before and after, video, table and FAQ. Existing blocks keep their
-- saved shape, so published guides are unchanged. Blocks stay data only: no HTML is ever stored, links are
-- https or site paths, and videos are stored as a provider plus a checked id (never a free-form embed URL).
--
--   takeaways     { type, items: Inline[][] }                         1-8 items, each with text
--   button        { type, label, href, variant: 'banner'|'button', title?, text? }
--   before_after  { type, before: { url, alt }, after: { url, alt }, caption? }
--   video         { type, provider: 'youtube'|'vimeo'|'instagram', id, caption? }
--   table         { type, header: boolean, rows: string[][] }        1-30 rows, 1-6 equal-width columns
--   faq           { type, items: [{ question, answer: Inline[] }] } 1-20 questions

create or replace function public.mova_blog_link_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select public.mova_blog_text_ok(p, 1, 2048)
    and ((p #>> '{}') ~* '^https://' or ((p #>> '{}') like '/%' and (p #>> '{}') not like '//%'));
$$;

create or replace function public.mova_blog_photo_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select public.mova_blog_is(p, 'object')
    and public.mova_blog_text_ok(p -> 'url', 1, 2048) and coalesce((p #>> '{url}') like 'https://%', false)
    and public.mova_blog_text_ok(p -> 'alt', 1, 240);
$$;

create or replace function public.mova_blog_body_problem(p_body jsonb) returns text
language plpgsql immutable set search_path = pg_catalog, public as $$
declare blk jsonb; item jsonb; kind text; lvl text; width integer; provider text; video_id text;
begin
  if not public.mova_blog_is(p_body, 'array') then return 'BODY_NOT_ARRAY'; end if;
  if jsonb_array_length(p_body) > 300 or octet_length(p_body::text) > 200000 then return 'BODY_TOO_LARGE'; end if;
  for blk in select value from jsonb_array_elements(p_body) loop
    if not public.mova_blog_is(blk, 'object') then return 'BLOCK_INVALID'; end if;
    kind := blk ->> 'type';
    if kind = 'heading' then
      lvl := blk #>> '{level}';
      if not public.mova_blog_is(blk -> 'level', 'number') or coalesce(lvl, '') not in ('2', '3') then return 'HEADING_LEVEL_INVALID'; end if;
      if not public.mova_blog_text_ok(blk -> 'text', 1, 200) then return 'HEADING_TEXT_INVALID'; end if;
      if blk -> 'id' is not null and not (public.mova_blog_is(blk -> 'id', 'string') and coalesce((blk #>> '{id}') ~ '^[a-z0-9-]{1,80}$', false)) then return 'HEADING_ID_INVALID'; end if;
    elsif kind = 'paragraph' then
      if not public.mova_blog_inlines_ok(blk -> 'content', 1) then return 'PARAGRAPH_INVALID'; end if;
    elsif kind = 'list' then
      if not public.mova_blog_is(blk -> 'ordered', 'boolean') or not public.mova_blog_is(blk -> 'items', 'array') then return 'LIST_INVALID'; end if;
      if jsonb_array_length(blk -> 'items') not between 1 and 50 then return 'LIST_INVALID'; end if;
      for item in select value from jsonb_array_elements(blk -> 'items') loop
        if not public.mova_blog_inlines_ok(item, 1) then return 'LIST_INVALID'; end if;
      end loop;
    elsif kind = 'quote' then
      if not public.mova_blog_inlines_ok(blk -> 'content', 1) then return 'QUOTE_INVALID'; end if;
      if blk -> 'cite' is not null and not public.mova_blog_text_ok(blk -> 'cite', 0, 200) then return 'QUOTE_INVALID'; end if;
    elsif kind = 'image' then
      if not public.mova_blog_text_ok(blk -> 'url', 1, 2048) or not coalesce((blk #>> '{url}') like 'https://%', false) then return 'IMAGE_URL_INVALID'; end if;
      if not public.mova_blog_text_ok(blk -> 'alt', 1, 240) then return 'IMAGE_ALT_REQUIRED'; end if;
      if blk -> 'caption' is not null and not public.mova_blog_text_ok(blk -> 'caption', 0, 240) then return 'IMAGE_CAPTION_INVALID'; end if;
    elsif kind = 'callout' then
      if coalesce(blk #>> '{tone}', '') not in ('tip', 'note') then return 'CALLOUT_INVALID'; end if;
      if not public.mova_blog_inlines_ok(blk -> 'content', 1) then return 'CALLOUT_INVALID'; end if;
    elsif kind = 'divider' then
      null;
    elsif kind = 'takeaways' then
      if not public.mova_blog_is(blk -> 'items', 'array') or jsonb_array_length(blk -> 'items') not between 1 and 8 then return 'TAKEAWAYS_INVALID'; end if;
      for item in select value from jsonb_array_elements(blk -> 'items') loop
        if not public.mova_blog_inlines_ok(item, 1) then return 'TAKEAWAYS_INVALID'; end if;
      end loop;
    elsif kind = 'button' then
      if not public.mova_blog_text_ok(blk -> 'label', 1, 60) then return 'BUTTON_LABEL_INVALID'; end if;
      if not public.mova_blog_link_ok(blk -> 'href') then return 'BUTTON_LINK_INVALID'; end if;
      if coalesce(blk #>> '{variant}', '') not in ('banner', 'button') then return 'BUTTON_INVALID'; end if;
      if blk -> 'title' is not null and not public.mova_blog_text_ok(blk -> 'title', 0, 120) then return 'BUTTON_INVALID'; end if;
      if blk -> 'text' is not null and not public.mova_blog_text_ok(blk -> 'text', 0, 240) then return 'BUTTON_INVALID'; end if;
    elsif kind = 'before_after' then
      if not public.mova_blog_photo_ok(blk -> 'before') or not public.mova_blog_photo_ok(blk -> 'after') then return 'BEFORE_AFTER_INVALID'; end if;
      if blk -> 'caption' is not null and not public.mova_blog_text_ok(blk -> 'caption', 0, 240) then return 'BEFORE_AFTER_INVALID'; end if;
    elsif kind = 'video' then
      provider := blk #>> '{provider}';
      video_id := blk #>> '{id}';
      if not public.mova_blog_is(blk -> 'id', 'string') then return 'VIDEO_INVALID'; end if;
      if not (
        (provider = 'youtube' and video_id ~ '^[A-Za-z0-9_-]{11}$')
        or (provider = 'vimeo' and video_id ~ '^[0-9]{6,12}$')
        or (provider = 'instagram' and video_id ~ '^[A-Za-z0-9_-]{5,40}$')
      ) then return 'VIDEO_INVALID'; end if;
      if blk -> 'caption' is not null and not public.mova_blog_text_ok(blk -> 'caption', 0, 240) then return 'VIDEO_INVALID'; end if;
    elsif kind = 'table' then
      if not public.mova_blog_is(blk -> 'header', 'boolean') or not public.mova_blog_is(blk -> 'rows', 'array') then return 'TABLE_INVALID'; end if;
      if jsonb_array_length(blk -> 'rows') not between 1 and 30 then return 'TABLE_INVALID'; end if;
      width := null;
      for item in select value from jsonb_array_elements(blk -> 'rows') loop
        if not public.mova_blog_is(item, 'array') or jsonb_array_length(item) not between 1 and 6 then return 'TABLE_INVALID'; end if;
        if width is not null and jsonb_array_length(item) <> width then return 'TABLE_INVALID'; end if;
        width := jsonb_array_length(item);
        if exists (select 1 from jsonb_array_elements(item) c where not public.mova_blog_text_ok(c.value, 0, 200)) then return 'TABLE_INVALID'; end if;
      end loop;
    elsif kind = 'faq' then
      if not public.mova_blog_is(blk -> 'items', 'array') or jsonb_array_length(blk -> 'items') not between 1 and 20 then return 'FAQ_INVALID'; end if;
      for item in select value from jsonb_array_elements(blk -> 'items') loop
        if not public.mova_blog_is(item, 'object') or not public.mova_blog_text_ok(item -> 'question', 1, 200)
          or not public.mova_blog_inlines_ok(item -> 'answer', 1) then return 'FAQ_INVALID'; end if;
      end loop;
    else
      return 'BLOCK_TYPE_INVALID';
    end if;
  end loop;
  return null;
end $$;

-- Reading time also counts FAQ questions and table cells.
create or replace function public.mova_blog_reading_minutes(p_body jsonb) returns integer
language sql immutable set search_path = pg_catalog, public as $$
  select greatest(1, ceil(coalesce(sum(array_length(regexp_split_to_array(btrim(t #>> '{}'), '\s+'), 1)), 0) / 220.0)::integer)
  from (
    select t from jsonb_path_query(p_body, 'lax $.**.text') as t
    union all
    select t from jsonb_path_query(p_body, 'lax $[*] ? (@.type == "faq").items[*].question') as t
    union all
    select t from jsonb_path_query(p_body, 'lax $[*] ? (@.type == "table").rows[*][*]') as t
  ) words
  where jsonb_typeof(t) = 'string' and btrim(t #>> '{}') <> '';
$$;

revoke all on function public.mova_blog_link_ok(jsonb) from public, anon, authenticated;
revoke all on function public.mova_blog_photo_ok(jsonb) from public, anon, authenticated;
revoke all on function public.mova_blog_body_problem(jsonb) from public, anon, authenticated;
