-- Guides & blog (admin A9-A10, English only) storage. 2026-11-09, P6 admin stream.
-- A piece is "published" when status = 'published'. It is live when published_at <= now(), so a scheduled
-- piece (published_at in the future) goes live on its own, with no job. guides-public (web stream) reads
-- these rows with the service role and only returns live pieces; the RLS policy below gives the same rule
-- to direct anonymous reads. Writes happen only through the admin functions in 0068.

create table public.mova_blog_categories (
  name text primary key check (length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);
insert into public.mova_blog_categories (name, sort_order) values
  ('Booking', 1), ('Clients', 2), ('Money', 3), ('Going independent', 4);

create table public.mova_blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 120),
  title text not null check (length(btrim(title)) between 1 and 140),
  summary text not null default '' check (length(summary) <= 240),
  status text not null default 'draft' check (status in ('draft', 'published')),
  body jsonb not null default '[]'::jsonb check (
    jsonb_typeof(body) = 'array' and jsonb_array_length(body) <= 300 and octet_length(body::text) <= 200000
  ),
  category text references public.mova_blog_categories(name) on update cascade on delete restrict,
  tags text[] not null default '{}' check (cardinality(tags) <= 6),
  cover_url text check (cover_url is null or (cover_url like 'https://%' and length(cover_url) <= 2048)),
  cover_alt text not null default '' check (length(cover_alt) <= 240),
  cover_credit text check (cover_credit is null or length(cover_credit) <= 200),
  author_name text not null default 'Mova team' check (length(btrim(author_name)) between 1 and 120),
  reading_minutes integer not null default 1 check (reading_minutes between 1 and 240),
  meta_title text not null default '' check (length(meta_title) <= 60),
  meta_description text not null default '' check (length(meta_description) <= 160),
  canonical_url text check (canonical_url is null or (canonical_url like 'https://%' and length(canonical_url) <= 2048)),
  og_title text not null default '' check (length(og_title) <= 95),
  og_description text not null default '' check (length(og_description) <= 200),
  og_image_url text check (og_image_url is null or (og_image_url like 'https://%' and length(og_image_url) <= 2048)),
  noindex boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint mova_blog_posts_publish_time_check check (
    (status = 'draft' and published_at is null) or (status = 'published' and published_at is not null)
  )
);
create index mova_blog_posts_live_idx on public.mova_blog_posts (status, published_at desc);
create index mova_blog_posts_category_idx on public.mova_blog_posts (category);

create function public.mova_blog_posts_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.mova_blog_posts_touch() from public, anon, authenticated;
create trigger mova_blog_posts_touch before update on public.mova_blog_posts
  for each row execute function public.mova_blog_posts_touch();

alter table public.mova_blog_categories enable row level security;
alter table public.mova_blog_posts enable row level security;
create policy mova_blog_categories_read on public.mova_blog_categories for select to anon, authenticated using (true);
create policy mova_blog_posts_live_read on public.mova_blog_posts for select to anon, authenticated
  using (status = 'published' and published_at <= now());
revoke all on public.mova_blog_categories from public, anon, authenticated;
revoke all on public.mova_blog_posts from public, anon, authenticated;
grant select on public.mova_blog_categories to anon, authenticated;
grant select on public.mova_blog_posts to anon, authenticated;
grant select, insert, update, delete on public.mova_blog_categories, public.mova_blog_posts to service_role;
