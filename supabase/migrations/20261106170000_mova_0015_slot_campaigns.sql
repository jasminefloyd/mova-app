create table public.mova_slot_events (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 location_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null,
 origin text not null check(origin in ('cancellation','no_show','gap_scan')), source_appointment_id uuid,
 status text not null default 'gap_found' check(status in ('gap_found','drafting','needs_approval','live','filled','expired','cancelled')),
 wave_plan jsonb not null default '[3,2,2]'::jsonb, expires_at timestamptz not null, filled_appointment_id uuid, filled_at timestamptz,
 value_minor bigint, dedupe_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint mova_slot_event_positive_span check(starts_at<ends_at),
 constraint mova_slot_event_location_fk foreign key(artist_business_id,location_id) references public.mova_locations(artist_business_id,id),
 constraint mova_slot_event_source_fk foreign key(source_appointment_id,artist_business_id) references public.mova_appointments(id,artist_business_id),
 constraint mova_slot_event_filled_fk foreign key(filled_appointment_id,artist_business_id) references public.mova_appointments(id,artist_business_id),
 unique(artist_business_id,dedupe_key)
);
create index mova_slot_events_open_idx on public.mova_slot_events(artist_business_id,starts_at) where status in ('gap_found','drafting','needs_approval','live');
create table public.mova_slot_candidates (
 id uuid primary key default gen_random_uuid(), slot_event_id uuid not null references public.mova_slot_events(id) on delete cascade,
 artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade, client_id uuid not null,
 rank integer not null check(rank>0), wave smallint not null check(wave between 1 and 3), reasons jsonb not null default '[]',
 status text not null default 'planned' check(status in ('planned','messaged','claimed','skipped','notified_taken')),
 claim_token_hash text, message_id uuid references public.mova_messages(id) on delete set null, created_at timestamptz not null default now(),
 foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade,
 unique(slot_event_id,client_id), unique(slot_event_id,rank)
);
create table public.mova_slot_campaign_copy (
 id uuid primary key default gen_random_uuid(), slot_event_id uuid not null unique references public.mova_slot_events(id) on delete cascade,
 artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 sms_example text not null check(length(sms_example)<=320), taken_message text not null check(length(taken_message)<=200),
 social_caption text not null check(length(social_caption)<=220), social_image_path text,
 approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz, ai_used boolean not null default false,
 prompt_version text, created_at timestamptz not null default now()
);
create table public.mova_social_share_events (
 id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
 slot_event_id uuid references public.mova_slot_events(id) on delete set null, initiated_at timestamptz not null default now(), target_hint text
);
create or replace function public.mova_prevent_overlapping_slot_events() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.artist_business_id::text||':'||new.location_id::text,0));
 if new.status in ('gap_found','drafting','needs_approval','live') and exists(select 1 from public.mova_slot_events e where e.artist_business_id=new.artist_business_id and e.location_id=new.location_id and e.id is distinct from new.id and e.status in ('gap_found','drafting','needs_approval','live') and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then
   raise exception using errcode='23P01',message='SLOT_EVENT_OVERLAP';
 end if;
 return new;
end $$;
create trigger mova_slot_event_no_overlap before insert or update of starts_at,ends_at,status on public.mova_slot_events for each row execute function public.mova_prevent_overlapping_slot_events();
revoke all on function public.mova_prevent_overlapping_slot_events() from public,anon,authenticated;
do $$ declare t text; begin foreach t in array array['mova_slot_events','mova_slot_candidates','mova_slot_campaign_copy','mova_social_share_events'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); end loop; end $$;
create policy mova_slot_events_member_select on public.mova_slot_events for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_slot_candidates_member_select on public.mova_slot_candidates for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_slot_campaign_copy_member_select on public.mova_slot_campaign_copy for select to authenticated using(public.mova_has_artist_membership(artist_business_id));

