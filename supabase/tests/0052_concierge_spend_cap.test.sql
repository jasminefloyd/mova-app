begin;
select plan(5);
select ok(not has_function_privilege('authenticated','public.mova_concierge_month_spend()','EXECUTE'),'TC-O8-CAP-01 stylists cannot read platform AI spend');
select is((public.mova_concierge_month_spend()->>'cap_micros')::bigint,25000000::bigint,'TC-O8-CAP-01 the default cap is $25 a month');
insert into public.mova_artist_businesses(id,name,status) values('e5700000-0000-4000-8000-000000000101','Spend fixture','active');
insert into public.mova_conversations(id,artist_business_id,channel,external_thread_id) values('e5700000-0000-4000-8000-000000000201','e5700000-0000-4000-8000-000000000101','web_chat','spend-thread');
insert into public.mova_messages(id,artist_business_id,conversation_id,direction,channel,purpose,origin,body,status,idempotency_key) values('e5700000-0000-4000-8000-000000000301','e5700000-0000-4000-8000-000000000101','e5700000-0000-4000-8000-000000000201','inbound','web_chat','concierge','concierge','hi','received','spend:in:1');
select set_config('mova.ai_monthly_cap_micros','',true);
create temp table before_spend as select (public.mova_concierge_month_spend()->>'spent_micros')::bigint as spent;
insert into public.mova_concierge_turns(conversation_id,artist_business_id,inbound_message_id,prompt_version,decision,cost_micros,created_at) values
 ('e5700000-0000-4000-8000-000000000201','e5700000-0000-4000-8000-000000000101','e5700000-0000-4000-8000-000000000301','concierge-v1','replied',1200,now()),
 ('e5700000-0000-4000-8000-000000000201','e5700000-0000-4000-8000-000000000101','e5700000-0000-4000-8000-000000000301','concierge-v1','replied',999999,date_trunc('month',now())-interval '1 day');
select is((public.mova_concierge_month_spend()->>'spent_micros')::bigint-(select spent from before_spend),1200::bigint,'TC-O8-CAP-02 only this month counts');
select set_config('mova.ai_monthly_cap_micros','1000',true);
select is((public.mova_concierge_month_spend()->>'cap_micros')::bigint,1000::bigint,'TC-O8-CAP-03 the cap follows the server setting');
select ok((public.mova_concierge_month_spend()->>'spent_micros')::bigint>=(public.mova_concierge_month_spend()->>'cap_micros')::bigint,'TC-O8-CAP-03 spend at or over the cap is visible to the pipeline');
select * from finish();
rollback;
