-- Keep the message channel contract aligned with conversations and the gated
-- public web-chat flow. This stores messages only; it does not enable sending.
alter table public.mova_messages
  drop constraint if exists mova_messages_channel_check;

alter table public.mova_messages
  add constraint mova_messages_channel_check
  check (channel in ('sms','email','instagram','push','in_app','web_chat'));
