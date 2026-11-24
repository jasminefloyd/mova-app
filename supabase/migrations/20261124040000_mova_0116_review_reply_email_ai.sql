-- Review replies (owner decisions RV-D1..RV-D3, 2026-11-23).
-- RV-D1: the stylist's first reply to a Mova review is emailed to the client; later edits are not.
--        A reply is part of the review the client chose to leave, so it goes to any email on file,
--        with an unsubscribe link. Clients who opted out of review emails are skipped.
-- RV-D2: one AI-suggested reply per review (Claude first, OpenAI if Claude is unavailable). It is
--        stored, so asking again returns the same text: there is no regenerate.

alter table public.mova_reviews
  add column if not exists reply_emailed_at timestamptz,
  add column if not exists ai_reply_suggestion text check (ai_reply_suggestion is null or length(ai_reply_suggestion) <= 1000),
  add column if not exists ai_reply_suggested_at timestamptz,
  add column if not exists ai_reply_model text check (ai_reply_model is null or length(ai_reply_model) <= 120);

alter table public.mova_google_reviews
  add column if not exists ai_reply_suggestion text check (ai_reply_suggestion is null or length(ai_reply_suggestion) <= 1000),
  add column if not exists ai_reply_suggested_at timestamptz,
  add column if not exists ai_reply_model text check (ai_reply_model is null or length(ai_reply_model) <= 120);

-- One-use links in review-reply emails. Only the hash is stored.
create table if not exists public.mova_email_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid,
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'review_requests' check (purpose in ('review_requests')),
  locale text not null default 'en-US' check (locale in ('en-US','es-US')),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint mova_email_unsubscribe_tokens_client_fk foreign key (client_id, artist_business_id)
    references public.mova_clients(id, artist_business_id) on delete cascade
);
alter table public.mova_email_unsubscribe_tokens enable row level security;
revoke all on public.mova_email_unsubscribe_tokens from public, anon, authenticated;
grant select, insert, update on public.mova_email_unsubscribe_tokens to service_role;

-- What the first-reply email needs. Null when there is nothing to send: no reply yet, already emailed,
-- no email on file, or the client opted out of review emails.
create or replace function public.mova_review_reply_email_context(p_review_id uuid, p_artist_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.mova_reviews%rowtype; a public.mova_appointments%rowtype; c public.mova_clients%rowtype;
  latest boolean; business_name text; handle text; recipient text;
begin
  select * into r from public.mova_reviews where id = p_review_id and artist_business_id = p_artist_business_id;
  if not found or r.artist_reply is null or r.reply_emailed_at is not null then return null; end if;
  select * into a from public.mova_appointments where id = r.appointment_id;
  if a.client_id is not null then
    select * into c from public.mova_clients where id = a.client_id and artist_business_id = a.artist_business_id;
    select cc.granted into latest from public.mova_client_consents cc
      where cc.artist_business_id = a.artist_business_id and cc.client_id = a.client_id and cc.purpose = 'review_requests' and cc.channel = 'email'
      order by cc.changed_at desc, cc.id desc limit 1;
    if latest is false then return jsonb_build_object('skip', 'unsubscribed'); end if;
  end if;
  recipient := nullif(lower(btrim(coalesce(a.client_email, c.email, ''))), '');
  if recipient is null then return jsonb_build_object('skip', 'contact_missing'); end if;
  select coalesce(p.display_name, b.name), p.handle into business_name, handle from public.mova_artist_businesses b
    left join public.mova_artist_profiles p on p.artist_business_id = b.id where b.id = r.artist_business_id;
  return jsonb_build_object('to', recipient, 'client_id', a.client_id, 'locale', r.locale, 'client_name', coalesce(a.client_name, r.display_name),
    'business_name', business_name, 'handle', handle, 'service_name', a.service_name_snapshot, 'rating', r.rating, 'review_body', r.body,
    'reply', r.artist_reply);
end $$;

-- Claims the one email for this review. True only for the first caller.
create or replace function public.mova_review_reply_email_claim(p_review_id uuid, p_artist_business_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.mova_reviews set reply_emailed_at = now() where id = p_review_id and artist_business_id = p_artist_business_id
    and reply_emailed_at is null and artist_reply is not null;
  return found;
end $$;

-- Gives the claim back when the email could not be sent, so the next save can try again.
create or replace function public.mova_review_reply_email_release(p_review_id uuid, p_artist_business_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.mova_reviews set reply_emailed_at = null where id = p_review_id and artist_business_id = p_artist_business_id;
$$;

-- The client's unsubscribe link: records "no review emails" from this stylist. Works once per token.
create or replace function public.mova_email_unsubscribe(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.mova_email_unsubscribe_tokens%rowtype; business_name text;
begin
  select * into t from public.mova_email_unsubscribe_tokens where token_hash = p_token_hash for update;
  if not found then return null; end if;
  select coalesce(p.display_name, b.name) into business_name from public.mova_artist_businesses b
    left join public.mova_artist_profiles p on p.artist_business_id = b.id where b.id = t.artist_business_id;
  if t.used_at is null then
    if t.client_id is not null then
      insert into public.mova_client_consents(artist_business_id, client_id, purpose, channel, granted, locale, evidence)
        values (t.artist_business_id, t.client_id, t.purpose, 'email', false, t.locale, jsonb_build_object('source', 'email_unsubscribe', 'token_id', t.id));
    else
      insert into public.mova_suppressions(artist_business_id, channel, address_hash, reason)
        values (t.artist_business_id, 'email', t.address_hash, 'manual') on conflict do nothing;
    end if;
    update public.mova_email_unsubscribe_tokens set used_at = now() where id = t.id;
  end if;
  return jsonb_build_object('business_name', business_name, 'locale', t.locale);
end $$;

revoke all on function public.mova_review_reply_email_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mova_review_reply_email_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mova_review_reply_email_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mova_email_unsubscribe(text) from public, anon, authenticated;
grant execute on function public.mova_review_reply_email_context(uuid, uuid) to service_role;
grant execute on function public.mova_review_reply_email_claim(uuid, uuid) to service_role;
grant execute on function public.mova_review_reply_email_release(uuid, uuid) to service_role;
grant execute on function public.mova_email_unsubscribe(text) to service_role;
