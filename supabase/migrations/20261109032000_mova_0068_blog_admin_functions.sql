-- Guides & blog writer functions (admin A9-A10). 2026-11-09, P6 admin stream.
-- Every function starts with mova_require_platform_admin(). The database validates the whole editor state
-- (slug, limits, SEO limits, block shapes, safe links), so a client that skips the UI cannot store a piece
-- that the public Guides pages would reject. Body blocks are data only: no HTML is ever stored.
-- Modes for mova_admin_blog_save: 'draft' (not live), 'schedule' (live at p_publish_at), 'publish' (live now,
-- or keeps the original live time when the piece is already live). 'draft' is refused for a live piece:
-- unpublish it first, so saving a draft can never take a live guide down by accident.

-- Every check below is written so that a missing key (SQL NULL) fails, never passes.
create function public.mova_blog_is(p jsonb, p_type text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(jsonb_typeof(p) = p_type, false);
$$;

create function public.mova_blog_text_ok(p jsonb, p_min integer, p_max integer) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(jsonb_typeof(p) = 'string' and length(btrim(p #>> '{}')) >= p_min and length(p #>> '{}') <= p_max, false);
$$;

create function public.mova_blog_inlines_ok(p jsonb, p_min integer) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare inl jsonb; href text;
begin
  if not public.mova_blog_is(p, 'array') or jsonb_array_length(p) < p_min or jsonb_array_length(p) > 200 then return false; end if;
  for inl in select value from jsonb_array_elements(p) loop
    if not public.mova_blog_is(inl, 'object') or not public.mova_blog_text_ok(inl -> 'text', 0, 2000) then return false; end if;
    if inl -> 'bold' is not null and not public.mova_blog_is(inl -> 'bold', 'boolean') then return false; end if;
    if inl -> 'italic' is not null and not public.mova_blog_is(inl -> 'italic', 'boolean') then return false; end if;
    if inl -> 'href' is not null then
      if not public.mova_blog_text_ok(inl -> 'href', 1, 2048) then return false; end if;
      href := inl #>> '{href}';
      -- Links are http(s) or relative only, so a stored link can never run script.
      if not (href ~* '^https?://' or (href like '/%' and href not like '//%')) then return false; end if;
    end if;
  end loop;
  return true;
end $$;

-- Returns the first problem found as a code, or null when every block is well formed.
create function public.mova_blog_body_problem(p_body jsonb) returns text
language plpgsql immutable set search_path = pg_catalog, public as $$
declare blk jsonb; item jsonb; kind text; lvl text;
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
    else
      return 'BLOCK_TYPE_INVALID';
    end if;
  end loop;
  return null;
end $$;

-- Reading time from every text value in the body, at about 220 words a minute.
create function public.mova_blog_reading_minutes(p_body jsonb) returns integer
language sql immutable set search_path = pg_catalog, public as $$
  select greatest(1, ceil(coalesce(sum(array_length(regexp_split_to_array(btrim(t #>> '{}'), '\s+'), 1)), 0) / 220.0)::integer)
  from jsonb_path_query(p_body, 'lax $.**.text') as t
  where btrim(t #>> '{}') <> '';
$$;

create function public.mova_blog_post_admin_json(p public.mova_blog_posts) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'summary', p.summary, 'status', p.status,
    'live_state', case when p.status = 'draft' then 'draft' when p.published_at > now() then 'scheduled' else 'published' end,
    'body', p.body, 'category', p.category, 'tags', to_jsonb(p.tags),
    'cover_url', p.cover_url, 'cover_alt', p.cover_alt, 'cover_credit', p.cover_credit,
    'author_name', p.author_name, 'reading_minutes', p.reading_minutes,
    'seo', jsonb_build_object(
      'meta_title', p.meta_title, 'meta_description', p.meta_description, 'canonical_url', p.canonical_url,
      'og_title', p.og_title, 'og_description', p.og_description, 'og_image_url', p.og_image_url, 'noindex', p.noindex),
    'published_at', p.published_at, 'created_at', p.created_at, 'updated_at', p.updated_at
  );
$$;

create function public.mova_admin_blog_list(
  p_status text default 'all', p_category text default null, p_search text default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := nullif(btrim(coalesce(p_search, '')), ''); v_like text;
begin
  perform public.mova_require_platform_admin();
  if p_status not in ('all', 'published', 'scheduled', 'drafts') then raise exception using errcode = '22023', message = 'BLOG_FILTER_INVALID'; end if;
  if v_q is not null then v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return (
    with rows as (
      select p.* from public.mova_blog_posts p
      where (p_status = 'all')
        or (p_status = 'drafts' and p.status = 'draft')
        or (p_status = 'published' and p.status = 'published' and p.published_at <= now())
        or (p_status = 'scheduled' and p.status = 'published' and p.published_at > now())
    ), filtered as (
      select r.* from rows r
      where (p_category is null or r.category = p_category)
        and (v_like is null or r.title ilike v_like or exists (select 1 from unnest(r.tags) tag where tag ilike v_like))
    ), page as (
      select f.* from filtered f order by coalesce(f.published_at, f.updated_at) desc, f.id
      limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    ), next_up as (
      select p.title, p.slug, p.published_at from public.mova_blog_posts p
      where p.status = 'published' and p.published_at > now() order by p.published_at limit 1
    )
    select jsonb_build_object(
      'posts', coalesce((select jsonb_agg(jsonb_build_object(
          'id', g.id, 'slug', g.slug, 'title', g.title, 'status', g.status,
          'live_state', case when g.status = 'draft' then 'draft' when g.published_at > now() then 'scheduled' else 'published' end,
          'published_at', g.published_at, 'updated_at', g.updated_at, 'category', g.category, 'tags', to_jsonb(g.tags),
          'missing_meta_description', g.meta_description = ''
        ) order by coalesce(g.published_at, g.updated_at) desc, g.id) from page g), '[]'::jsonb),
      'filtered_total', (select count(*) from filtered),
      'counts', jsonb_build_object(
        'all', (select count(*) from public.mova_blog_posts),
        'published', (select count(*) from public.mova_blog_posts where status = 'published' and published_at <= now()),
        'scheduled', (select count(*) from public.mova_blog_posts where status = 'published' and published_at > now()),
        'drafts', (select count(*) from public.mova_blog_posts where status = 'draft')),
      'summary', jsonb_build_object(
        'missing_meta_description', (select count(*) from public.mova_blog_posts where meta_description = ''),
        'next_scheduled', (select jsonb_build_object('title', n.title, 'slug', n.slug, 'published_at', n.published_at) from next_up n)),
      'categories', coalesce((select jsonb_agg(c.name order by c.sort_order, c.name) from public.mova_blog_categories c), '[]'::jsonb)
    )
  );
end $$;

create function public.mova_admin_blog_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_post public.mova_blog_posts%rowtype;
begin
  perform public.mova_require_platform_admin();
  select * into v_post from public.mova_blog_posts where id = p_id;
  if not found then raise exception using errcode = 'P0002', message = 'BLOG_NOT_FOUND'; end if;
  return jsonb_build_object(
    'post', public.mova_blog_post_admin_json(v_post),
    'categories', coalesce((select jsonb_agg(c.name order by c.sort_order, c.name) from public.mova_blog_categories c), '[]'::jsonb)
  );
end $$;

create function public.mova_admin_blog_save(p_id uuid, p_fields jsonb, p_mode text, p_publish_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid := public.mova_require_platform_admin();
  v_now timestamptz := now();
  v_old public.mova_blog_posts%rowtype;
  v_has_old boolean := false;
  v_slug text; v_title text; v_summary text; v_category text; v_tags text[] := '{}'; v_tag jsonb;
  v_status text; v_published timestamptz; v_post public.mova_blog_posts%rowtype; v_problem text;
  v_body jsonb;
begin
  if p_mode not in ('draft', 'schedule', 'publish') then raise exception using errcode = '22023', message = 'BLOG_MODE_INVALID'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception using errcode = '22023', message = 'BLOG_FIELDS_INVALID'; end if;
  if p_id is not null then
    select * into v_old from public.mova_blog_posts where id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'BLOG_NOT_FOUND'; end if;
    v_has_old := true;
  end if;
  if p_mode = 'draft' and v_has_old and v_old.status = 'published' then
    raise exception using errcode = '55000', message = 'UNPUBLISH_BEFORE_DRAFT';
  end if;

  -- Slug, title and summary.
  v_slug := lower(btrim(coalesce(p_fields ->> 'slug', '')));
  if not public.mova_blog_is(p_fields -> 'slug', 'string') or not coalesce(v_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(v_slug) between 3 and 120, false) then
    raise exception using errcode = '22023', message = 'SLUG_INVALID';
  end if;
  if exists (select 1 from public.mova_blog_posts where slug = v_slug and id is distinct from p_id) then
    raise exception using errcode = '23505', message = 'SLUG_TAKEN';
  end if;
  if not public.mova_blog_text_ok(p_fields -> 'title', 1, 140) then raise exception using errcode = '22023', message = 'TITLE_INVALID'; end if;
  v_title := btrim(p_fields ->> 'title');
  if not public.mova_blog_text_ok(p_fields -> 'summary', 0, 240) then raise exception using errcode = '22023', message = 'SUMMARY_TOO_LONG'; end if;
  v_summary := btrim(coalesce(p_fields ->> 'summary', ''));

  -- Body: the block shapes are checked here, not only in the editor.
  v_problem := public.mova_blog_body_problem(p_fields -> 'body');
  if v_problem is not null then raise exception using errcode = '22023', message = v_problem; end if;
  v_body := p_fields -> 'body';

  -- Category and tags.
  if coalesce(jsonb_typeof(p_fields -> 'category'), 'null') <> 'null' then
    if not public.mova_blog_is(p_fields -> 'category', 'string') then raise exception using errcode = '22023', message = 'CATEGORY_INVALID'; end if;
    v_category := p_fields ->> 'category';
    if not exists (select 1 from public.mova_blog_categories where name = v_category) then
      raise exception using errcode = '22023', message = 'CATEGORY_INVALID';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_fields -> 'tags'), 'null') <> 'null' then
    if not public.mova_blog_is(p_fields -> 'tags', 'array') or jsonb_array_length(p_fields -> 'tags') > 6 then
      raise exception using errcode = '22023', message = 'TAGS_INVALID';
    end if;
    for v_tag in select value from jsonb_array_elements(p_fields -> 'tags') loop
      if not public.mova_blog_text_ok(v_tag, 1, 30) or not coalesce(lower(btrim(v_tag #>> '{}')) ~ '^[a-z0-9][a-z0-9 -]*$', false) then
        raise exception using errcode = '22023', message = 'TAGS_INVALID';
      end if;
    end loop;
    -- Tags are lower-cased and de-duplicated; order is alphabetical.
    select coalesce(array_agg(distinct t order by t), '{}'::text[]) into v_tags from (
      select lower(btrim(value #>> '{}')) as t from jsonb_array_elements(p_fields -> 'tags')
    ) normalized;
  end if;

  -- Cover and author.
  if coalesce(jsonb_typeof(p_fields -> 'cover_url'), 'null') <> 'null'
    and not (public.mova_blog_text_ok(p_fields -> 'cover_url', 1, 2048) and coalesce((p_fields ->> 'cover_url') like 'https://%', false)) then
    raise exception using errcode = '22023', message = 'COVER_URL_INVALID';
  end if;
  if not public.mova_blog_text_ok(p_fields -> 'cover_alt', 0, 240) then raise exception using errcode = '22023', message = 'COVER_ALT_INVALID'; end if;
  if coalesce(jsonb_typeof(p_fields -> 'cover_credit'), 'null') <> 'null' and not public.mova_blog_text_ok(p_fields -> 'cover_credit', 0, 200) then
    raise exception using errcode = '22023', message = 'COVER_CREDIT_INVALID';
  end if;
  if not public.mova_blog_text_ok(p_fields -> 'author_name', 1, 120) then raise exception using errcode = '22023', message = 'AUTHOR_INVALID'; end if;

  -- SEO limits (the same limits the editor shows).
  if not public.mova_blog_text_ok(p_fields -> 'meta_title', 0, 60) then raise exception using errcode = '22023', message = 'META_TITLE_TOO_LONG'; end if;
  if not public.mova_blog_text_ok(p_fields -> 'meta_description', 0, 160) then raise exception using errcode = '22023', message = 'META_DESCRIPTION_TOO_LONG'; end if;
  if coalesce(jsonb_typeof(p_fields -> 'canonical_url'), 'null') <> 'null'
    and not (public.mova_blog_text_ok(p_fields -> 'canonical_url', 1, 2048) and coalesce((p_fields ->> 'canonical_url') like 'https://%', false)) then
    raise exception using errcode = '22023', message = 'CANONICAL_URL_INVALID';
  end if;
  if not public.mova_blog_text_ok(p_fields -> 'og_title', 0, 95) then raise exception using errcode = '22023', message = 'OG_TITLE_TOO_LONG'; end if;
  if not public.mova_blog_text_ok(p_fields -> 'og_description', 0, 200) then raise exception using errcode = '22023', message = 'OG_DESCRIPTION_TOO_LONG'; end if;
  if coalesce(jsonb_typeof(p_fields -> 'og_image_url'), 'null') <> 'null'
    and not (public.mova_blog_text_ok(p_fields -> 'og_image_url', 1, 2048) and coalesce((p_fields ->> 'og_image_url') like 'https://%', false)) then
    raise exception using errcode = '22023', message = 'OG_IMAGE_URL_INVALID';
  end if;
  if not public.mova_blog_is(p_fields -> 'noindex', 'boolean') then raise exception using errcode = '22023', message = 'NOINDEX_INVALID'; end if;

  -- Status and live time.
  if p_mode = 'draft' then
    v_status := 'draft'; v_published := null;
  else
    -- Everything a reader needs must be present before a piece can go live.
    if v_summary = '' then raise exception using errcode = '22023', message = 'SUMMARY_REQUIRED'; end if;
    if jsonb_array_length(v_body) = 0 then raise exception using errcode = '22023', message = 'BODY_REQUIRED'; end if;
    if v_category is null then raise exception using errcode = '22023', message = 'CATEGORY_REQUIRED'; end if;
    v_status := 'published';
    if p_mode = 'schedule' then
      if p_publish_at is null or p_publish_at <= v_now then
        raise exception using errcode = '22023', message = 'SCHEDULE_TIME_NOT_IN_FUTURE';
      end if;
      v_published := p_publish_at;
    else
      -- Publish now. A piece that is already live keeps its original live time.
      if v_has_old and v_old.status = 'published' and v_old.published_at <= v_now then
        v_published := v_old.published_at;
      else
        v_published := v_now;
      end if;
    end if;
  end if;

  if v_has_old then
    update public.mova_blog_posts set
      slug = v_slug, title = v_title, summary = v_summary, status = v_status, body = v_body,
      category = v_category, tags = v_tags,
      cover_url = nullif(p_fields ->> 'cover_url', ''), cover_alt = btrim(coalesce(p_fields ->> 'cover_alt', '')),
      cover_credit = nullif(btrim(coalesce(p_fields ->> 'cover_credit', '')), ''),
      author_name = btrim(p_fields ->> 'author_name'), reading_minutes = public.mova_blog_reading_minutes(v_body),
      meta_title = btrim(coalesce(p_fields ->> 'meta_title', '')), meta_description = btrim(coalesce(p_fields ->> 'meta_description', '')),
      canonical_url = nullif(p_fields ->> 'canonical_url', ''), og_title = btrim(coalesce(p_fields ->> 'og_title', '')),
      og_description = btrim(coalesce(p_fields ->> 'og_description', '')), og_image_url = nullif(p_fields ->> 'og_image_url', ''),
      noindex = (p_fields ->> 'noindex')::boolean, published_at = v_published, updated_by = v_admin
    where id = p_id returning * into v_post;
  else
    insert into public.mova_blog_posts (
      slug, title, summary, status, body, category, tags, cover_url, cover_alt, cover_credit, author_name, reading_minutes,
      meta_title, meta_description, canonical_url, og_title, og_description, og_image_url, noindex, published_at,
      created_by, updated_by
    ) values (
      v_slug, v_title, v_summary, v_status, v_body, v_category, v_tags,
      nullif(p_fields ->> 'cover_url', ''), btrim(coalesce(p_fields ->> 'cover_alt', '')),
      nullif(btrim(coalesce(p_fields ->> 'cover_credit', '')), ''), btrim(p_fields ->> 'author_name'),
      public.mova_blog_reading_minutes(v_body),
      btrim(coalesce(p_fields ->> 'meta_title', '')), btrim(coalesce(p_fields ->> 'meta_description', '')),
      nullif(p_fields ->> 'canonical_url', ''), btrim(coalesce(p_fields ->> 'og_title', '')),
      btrim(coalesce(p_fields ->> 'og_description', '')), nullif(p_fields ->> 'og_image_url', ''),
      (p_fields ->> 'noindex')::boolean, v_published, v_admin, v_admin
    ) returning * into v_post;
  end if;

  perform public.mova_admin_log(
    case when p_mode = 'draft' then 'blog.saved_draft' when p_mode = 'schedule' then 'blog.scheduled' else 'blog.published' end,
    'blog_post', v_post.id::text, null, null,
    jsonb_build_object('slug', v_post.slug, 'status', v_post.status, 'published_at', v_post.published_at));
  return public.mova_blog_post_admin_json(v_post);
end $$;

create function public.mova_admin_blog_unpublish(p_id uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_post public.mova_blog_posts%rowtype;
begin
  select * into v_post from public.mova_blog_posts where id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'BLOG_NOT_FOUND'; end if;
  update public.mova_blog_posts set status = 'draft', published_at = null, updated_by = v_admin
  where id = p_id returning * into v_post;
  perform public.mova_admin_log('blog.unpublished', 'blog_post', v_post.id::text, null, null, jsonb_build_object('slug', v_post.slug));
  return public.mova_blog_post_admin_json(v_post);
end $$;

-- Only drafts can be deleted. A live or scheduled piece is unpublished instead, so its history stays.
create function public.mova_admin_blog_delete(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_post public.mova_blog_posts%rowtype;
begin
  perform public.mova_require_platform_admin();
  select * into v_post from public.mova_blog_posts where id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'BLOG_NOT_FOUND'; end if;
  if v_post.status <> 'draft' then raise exception using errcode = '55000', message = 'PUBLISHED_PIECE_CANNOT_BE_DELETED'; end if;
  delete from public.mova_blog_posts where id = p_id;
  perform public.mova_admin_log('blog.deleted_draft', 'blog_post', p_id::text, null, null, jsonb_build_object('slug', v_post.slug));
end $$;

-- Grants: clients may call only the admin functions, and each one checks the admin role itself.
revoke all on function public.mova_blog_text_ok(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.mova_blog_inlines_ok(jsonb, integer) from public, anon, authenticated;
revoke all on function public.mova_blog_body_problem(jsonb) from public, anon, authenticated;
revoke all on function public.mova_blog_reading_minutes(jsonb) from public, anon, authenticated;
revoke all on function public.mova_blog_post_admin_json(public.mova_blog_posts) from public, anon, authenticated;
revoke all on function public.mova_admin_blog_list(text, text, text, integer, integer) from public, anon;
revoke all on function public.mova_admin_blog_get(uuid) from public, anon;
revoke all on function public.mova_admin_blog_save(uuid, jsonb, text, timestamptz) from public, anon;
revoke all on function public.mova_admin_blog_unpublish(uuid) from public, anon;
revoke all on function public.mova_admin_blog_delete(uuid) from public, anon;
grant execute on function public.mova_admin_blog_list(text, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.mova_admin_blog_get(uuid) to authenticated, service_role;
grant execute on function public.mova_admin_blog_save(uuid, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function public.mova_admin_blog_unpublish(uuid) to authenticated, service_role;
grant execute on function public.mova_admin_blog_delete(uuid) to authenticated, service_role;
