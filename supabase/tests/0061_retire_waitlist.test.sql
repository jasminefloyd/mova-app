begin;
select plan(11);

select hasnt_function('public'::name, 'mova_waitlist_register'::name, 'waitlist registration function is retired');
select hasnt_function('public'::name, 'mova_waitlist_admin_list'::name, 'waitlist admin list function is retired');
select hasnt_function('public'::name, 'mova_waitlist_approve'::name, 'waitlist approval function is retired');
select hasnt_function('public'::name, 'mova_waitlist_decline'::name, 'waitlist decline function is retired');
select hasnt_function('public'::name, 'mova_waitlist_invite_context'::name, 'invite context function is retired');
select hasnt_function('public'::name, 'mova_waitlist_mark_invited'::name, 'invite marking function is retired');
select hasnt_function('public'::name, 'mova_waitlist_resend_invite'::name, 'invite resend function is retired');
select hasnt_function('public'::name, 'mova_early_access_cap'::name, 'cohort cap function is retired');

insert into public.mova_waitlist_signups (email, email_normalized, work_arrangement, marketing_opt_in)
values ('kept-signup@example.invalid', 'kept-signup@example.invalid', 'suite_renter', false);
insert into public.mova_early_access_invites (email_normalized) values ('kept-invite@example.invalid');

select ok(exists (select 1 from public.mova_waitlist_signups where email_normalized = 'kept-signup@example.invalid'),
  'waitlist submissions are kept');
select ok(exists (select 1 from public.mova_early_access_invites where email_normalized = 'kept-invite@example.invalid'),
  'invite allowlist rows are kept');
select has_table('public'::name, 'mova_waitlist_signups'::name, 'waitlist table stays');

select * from finish();
rollback;
