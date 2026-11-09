-- P6 auth (2026-11-09): the waitlist and invite approval flow is retired. Only the functions that served it
-- are dropped. Tables, columns, rows and the invite allowlist stay, so no data is lost. Open sign-up
-- (20261109010000) replaces the allowlist check, and the waitlist-admin and waitlist-signup Edge Functions are removed.
drop function if exists public.mova_waitlist_register(text, text, text, boolean, text);
drop function if exists public.mova_waitlist_register(text, text, text, boolean);
drop function if exists public.mova_waitlist_admin_list();
drop function if exists public.mova_waitlist_approve(uuid[]);
drop function if exists public.mova_waitlist_decline(uuid[]);
drop function if exists public.mova_waitlist_invite_context(uuid);
drop function if exists public.mova_waitlist_mark_invited(uuid);
drop function if exists public.mova_waitlist_resend_invite(uuid);
drop function if exists public.mova_early_access_cap();
