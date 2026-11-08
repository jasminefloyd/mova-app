-- Task 5.4: concierge turns record the classified intent, and the daily AI turn cap is counted from
-- an index on business and time. Web chat messages already use channel 'web_chat' (0030). The public
-- page reads replies only through the concierge-web-chat Edge Function; no new browser grants.
alter table public.mova_concierge_turns add column if not exists intent text
  check (intent is null or intent in ('answer', 'price', 'offer_times', 'quote', 'complaint', 'greeting', 'unknown'));

create index if not exists mova_concierge_turns_business_day_idx on public.mova_concierge_turns (artist_business_id, created_at desc);
