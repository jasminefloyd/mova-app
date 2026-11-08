# Early access invites (owner decision O2, 2026-11-08)

Stylists join the waitlist on the marketing page. A super admin approves them, which adds their email to the signup allowlist (`mova_early_access_invites`, enforced by the Before User Created hook) and sends one invite email in the language they used. The first cohort is capped at 10 places, counting every email on the allowlist.

Until the admin portal exists, approvals go through the `waitlist-admin` Edge Function with a server-side secret. Never call it from a browser or share the secret.

## Setup

| Where | Setting | Value |
| --- | --- | --- |
| Supabase function secrets | `MOVA_ADMIN_API_SECRET` | `openssl rand -hex 32` (at least 32 characters; shorter fails closed) |
| Supabase function secrets | `PUBLIC_SITE_URL` | `https://mova-beauty.co` (the invite links to `/auth` here) |
| Database (optional) | `mova.early_access_cap` | defaults to 10; change with `alter database postgres set mova.early_access_cap = '25'` only when the owner decides |

Invite emails go through the email adapter (SendGrid, O4) and count toward the shared $50/month cap. They are only sent once email is live (`MOVA_EMAIL_PROVIDER=sendgrid`, `MOVA_MESSAGING_LIVE_EMAIL=true`). Before that, approving still adds the email to the allowlist, and the job retries the email until it gives up; use `resend` once email is live. Replies to the invite go to the `MOVA_EMAIL_FROM` address, so someone needs to watch that inbox.

## Calls

```bash
call() { curl -sS "$SUPABASE_URL/functions/v1/waitlist-admin" -H "x-mova-admin-secret: $MOVA_ADMIN_API_SECRET" -H 'Content-Type: application/json' -d "$1"; }
call '{"action":"list"}'                                          # cap, places used, every signup with its status and whether it has an account
call '{"action":"approve","signup_ids":["<id>","<id>"]}'          # up to 50 at once; 409 EARLY_ACCESS_CAP_REACHED if it would go over the cap
call '{"action":"decline","signup_ids":["<id>"]}'                 # only signups still waiting
call '{"action":"resend","signup_ids":["<id>"]}'                  # an approved signup whose invite has not gone out yet
```

Statuses: `waiting` (new), `approved` (on the allowlist, email queued), `invited` (email sent), `declined`. A declined signup can still be approved later.

## Checks

- After approving: `select email_normalized from mova_early_access_invites` lists the email, and `select status from mova_background_jobs where job_type = 'early_access_invite'` shows the job.
- After the email goes out: the signup's status is `invited`, and `mova_messages` has a row with `purpose = 'early_access_invite'` and no stylist.
- Removing someone: delete their row from `mova_early_access_invites` (see `docs/engineering/DECISION_LOG.md`). The invite email cannot be recalled.
