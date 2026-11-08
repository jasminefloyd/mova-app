# Edge Function folders (task 4.5, Nov 8)

Phase 4 started with 39 folders under `supabase/functions/` that held only a `.gitkeep`. No screen, job or other
function called any of them by name (checked with a search of `apps/web`, `supabase/functions` and `tests` for
`functions/v1/<name>`, `invoke('<name>')` and quoted names). Each is now implemented, removed as a duplicate of a
canonical function, removed as unused, or handed to Phase 5, which owns the feature.

## Implemented in Phase 4

| Folder | Callers | Task |
| --- | --- | --- |
| `messaging-inbound-sms` | SMS provider inbound webhook (fake now, Twilio once live) | 4.4 |
| `missed-call-webhook` | Telephony missed-call webhook (off unless `MOVA_MISSED_CALL_TEXTBACK_ENABLED`) | 4.4 |
| `messaging-status` | Twilio status callbacks, SendGrid Event Webhook | 4.4 / O4 |

## Removed: covered by a canonical function (use these, do not add duplicates)

| Removed folder | Screen(s) | Canonical function and action |
| --- | --- | --- |
| `autopilot-activity` | 36 Activity | `revenue-center` `status` (decisions); Phase 5.2 extends logging there |
| `autopilot-plan` | 34 Autopilot | `revenue-center` `pipeline` / `refresh-pipeline` |
| `autopilot-settings` | 34, 35 | `revenue-center` `save-rules`, `enable-autopilot` |
| `rebooking-pipeline` | 32 Pipeline | `revenue-center` `pipeline` |
| `winback-list` | 33 Win-back | `revenue-center` `winback` |
| `winback-send` | 33 Win-back | `revenue-center` `send-winback` |
| `templates` | Growth templates | `messaging-settings` `status`, `save-template`, `approve-template` |
| `concierge-knowledge` | 43 | `concierge-artist` `save-knowledge`, `activate-knowledge` |
| `concierge-settings` | 40 | `concierge-artist` `save-settings`, `pause`, `unpause` |
| `conversations` | 41, 42 | `concierge-artist` `status`, `conversation`, `human-reply` |
| `handoff-resolve` | 42 Needs you | `concierge-artist` `resolve-handoff` |
| `quote-respond` | 41 quote | `concierge-artist` `save-quote-estimate`, `update-quote` |
| `web-chat` | 45 public web chat | `concierge-web-chat` |
| `review-reply` | 37 Reviews | `review-management` `reply` |
| `review-report` | 37 Reviews | `review-management` `report` |
| `otp-start`, `otp-verify` | 29 client sign-in | Supabase Auth `signInWithOtp` / `verifyOtp` (ClientProfilePage) |
| `social-share-record` | 31 Seat filler share | `slot-campaign` `share` |

## Removed: nothing calls them and no task needs them

| Removed folder | Why |
| --- | --- |
| `review-request-send` | No screen sends review requests; review requests would go through `sendSms`/`sendEmail` with purpose `review_requests` when a task asks for it. |
| `sending-identity-provision` | Twilio number and A2P 10DLC registration are owner/ops steps in the Twilio console (O4/O5, spending); the result is a row in `mova_sending_identities`. |
| `social-share-image` | The share image is drawn in the browser (Show my QR, 21). |

## Resolved in Phase 5

| Folder | Outcome |
| --- | --- |
| `slot-claim` | Implemented (5.1): a texted client views and claims an opened spot (board 31d). |
| `slot-approve`, `slot-send-next-wave`, `slot-stop` | Removed: `slot-campaign` actions `approve`, `send-next-wave` and `cancel`. |
| `slot-scan`, `slot-draft`, `slot-dispatch` | Removed: `job-worker` consumes `slot.opened` and drafts the campaign (`mova_slot_open_from_event`, `mova_slot_build_campaign`); `job-dispatch` sends due waves and expires campaigns. |
| `concierge-turn` | Removed: turns run in `_shared/concierge/pipeline.ts`, called by each channel (`concierge-web-chat`, `messaging-inbound-sms`, `instagram-webhook`). |
| `instagram-webhook` | Implemented (5.5) with the fake Meta provider; real Meta waits on O6. |
| `wallet-pass-create` | Implemented (5.7) with the fake signer. |
| `wallet-card-create` | Removed: duplicate of `wallet-pass-create`. |
| `wallet-apple-webservice`, `wallet-pass-refresh` | Removed: Apple's pass web service and push refresh need live Apple signing (O11 provider set-up); nothing calls them until then. |
| `subscription-checkout`, `subscription-portal` | Implemented (5.8) in Stripe test mode with O10 prices. |

No empty function folders remain.

Every remaining function passes `deno check` (`pnpm fn:check`).
