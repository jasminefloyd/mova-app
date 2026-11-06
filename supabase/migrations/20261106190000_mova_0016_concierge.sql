create table public.mova_concierge_settings (
 artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
 enabled boolean not null default false, channels jsonb not null default '{"instagram":false,"sms":false,"missed_call":false,"web_chat":false}',
 permissions jsonb not null default '{"answer":true,"book_instant":false,"request_salon":false,"reschedule":false,"reply_slot_offers":false}',
 tone text not null default 'warm', languages text[] not null default array['en-US'], hours jsonb,
 daily_ai_turn_cap integer not null default 0 check(daily_ai_turn_cap>=0), globally_paused boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.mova_concierge_knowledge (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 kind text not null check(kind in ('faq','prep','location_detail','policy')), location_id uuid,
 question text not null check(length(question)<=500), answer_en text not null check(length(answer_en)<=3000), answer_es text,
 status text not null default 'draft' check(status in ('draft','active','archived')), updated_at timestamptz not null default now(),
 constraint mova_concierge_knowledge_location_fk foreign key(artist_business_id,location_id) references public.mova_locations(artist_business_id,id)
);
create table public.mova_conversations (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 channel text not null check(channel in ('sms','missed_call','web_chat','instagram')), external_thread_id text not null,
 client_id uuid, contact_hash text, locale text not null default 'en-US' check(locale in ('en-US','es-US')),
 status text not null default 'handled' check(status in ('handled','needs_you','closed')),
 ai_enabled boolean not null default false, pause_until timestamptz, last_message_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete set null (client_id),
 unique(artist_business_id,channel,external_thread_id)
);
alter table public.mova_messages add constraint mova_messages_conversation_fk foreign key(conversation_id) references public.mova_conversations(id) on delete set null;
create index mova_conversations_inbox_idx on public.mova_conversations(artist_business_id,status,last_message_at desc);
create table public.mova_concierge_turns (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.mova_conversations(id) on delete cascade,
 artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 inbound_message_id uuid not null references public.mova_messages(id) on delete cascade,
 outbound_message_id uuid references public.mova_messages(id) on delete set null,
 model text, prompt_version text not null, tool_calls jsonb not null default '[]',
 decision text not null check(decision in ('replied','handoff','blocked')), confidence numeric(5,4),
 cost_micros bigint check(cost_micros is null or cost_micros>=0), latency_ms integer check(latency_ms is null or latency_ms>=0),
 created_at timestamptz not null default now()
);
create table public.mova_handoffs (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 conversation_id uuid not null references public.mova_conversations(id) on delete cascade,
 type text not null check(type in ('quote','exception','complaint','low_confidence','tool_error')),
 status text not null default 'open' check(status in ('open','resolved')), summary text not null check(length(summary)<=4000),
 created_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references auth.users(id) on delete set null
);
create table public.mova_quote_requests (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 conversation_id uuid not null references public.mova_conversations(id) on delete cascade, client_id uuid,
 service_category text not null check(length(service_category)<=120), details jsonb not null default '{}', media jsonb not null default '[]',
 risk_flags jsonb not null default '[]', quoted_minor bigint, status text not null default 'open' check(status in ('open','quoted','consult_offered','booked','closed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete set null (client_id)
);
do $$ declare t text; begin foreach t in array array['mova_concierge_settings','mova_concierge_knowledge','mova_conversations','mova_concierge_turns','mova_handoffs','mova_quote_requests'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); end loop; end $$;
create policy mova_concierge_settings_member_select on public.mova_concierge_settings for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_concierge_knowledge_member_select on public.mova_concierge_knowledge for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_conversations_member_select on public.mova_conversations for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_concierge_turns_member_select on public.mova_concierge_turns for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_handoffs_member_select on public.mova_handoffs for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_quote_requests_member_select on public.mova_quote_requests for select to authenticated using(public.mova_has_artist_membership(artist_business_id));

