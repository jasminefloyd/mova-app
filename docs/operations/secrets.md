# Secrets and configuration

## Browser-safe configuration

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are read by the browser client. These are public client settings; database row security and the application authorization model must protect data. The browser bundle must never contain server credentials.

## Server and deployment credentials

Keep `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN`, and Vercel deployment credentials in ignored local `.env` files for local use, or in environment-scoped GitHub/Vercel secret stores for hosted use. Do not add real values to `.env.example`, source code, logs, pull requests, or build output.

Use separate credentials for development and production. The product owner has directed that this project will not use staging. Grant each deployment only its environment's credentials. Production values must never be copied into local development.

## Variables in the root example

| Variable | Intended scope | Exposed to browser |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase API URL for the selected environment | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable/anon key for the selected environment | Yes |
| `VITE_CLIENT_PROFILES_ENABLED` / `MOVA_CLIENT_PROFILES_ENABLED` | Client profile rollout gate; both default to `false` | Browser flag / server gate |
| `VITE_WALLET_CLIENT_CARD_ENABLED` / `MOVA_WALLET_CLIENT_CARD_ENABLED` | Client wallet pass rollout gates; both default to `false` | Browser flag / server gate |
| `SUPABASE_PROJECT_REF_DEV` / `_PROD` | Supabase CLI project identifiers | No |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI authentication | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase administration only | No |
| `MOVA_PROVIDER_TOKENS_KEK_HEX` | Separate AES-256 key for Google refresh-token/OAuth-verifier encryption | No |
| `MOVA_CLIENT_CARD_TOKENS_HMAC_HEX` | Separate HMAC-SHA-256 key used to derive client-card QR tokens | No |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | Supabase Edge Function OAuth configuration | No |
| `DATABASE_URL` | Server-side database tooling only | No |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Vercel deployment tooling | No |

The root `.env.example` contains blank values only. This phase does not configure or deploy hosted secrets.

`MOVA_NOTES_KEK_HEX` is a server-only 32-byte AES-256 key encoded as 64 hexadecimal characters. Generate a deployment-specific key with `openssl rand -hex 32`, then store it in the local ignored `.env` and the production Edge Function secret store. Never place the key in a `VITE_` variable. Sensitive client-note operations fail closed when the key is absent or invalid. Keep a protected backup and do not rotate or replace the key without a key-version migration plan; existing ciphertext uses key version `v1`.

Calendar provider credentials are Edge Function secrets. Set `MOVA_PROVIDER_TOKENS_KEK_HEX` to a separate, deployment-specific 32-byte AES-256 key encoded as 64 hexadecimal characters; do not reuse the notes key. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and the exact registered `GOOGLE_OAUTH_REDIRECT_URI` for the Supabase `calendar-google-callback` function. OAuth asks for the Google Calendar events scope. Never add these values to `VITE_` variables or commit populated `.env` files. Calendar connect stays unavailable until the key and OAuth settings are configured.

Client-card QR tokens are derived with HMAC-SHA-256 from a random token-row ID and its client × stylist scope; the database stores only the token hash. Set `MOVA_CLIENT_CARD_TOKENS_HMAC_HEX` to its own deployment-specific 32-byte key encoded as 64 hexadecimal characters. Keep it separate from both the notes and calendar keys. A key change rotates a client's active card link on their next signed-in profile load, so previously saved QR images for that client stop working. The card flow fails closed if the key is missing or invalid; profile and wallet rollout flags remain off until the identity decision and local integration review are complete.

## Email (Resend)

Email goes through Resend (owner decision, 2026-11-13; approval A-03). `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `MOVA_EMAIL_FROM`, `MOVA_EMAIL_PROVIDER=resend` and `MOVA_MESSAGING_LIVE_EMAIL=true` are Supabase Edge Function secrets; none is read by the browser. `MOVA_EMAIL_PROPOSED_ENABLED=false` gates proposed messages (moved, cancelled, stylist welcome/request); keep false until deployed and reviewed. `MOVA_EMAIL_REVIEW_REQUESTS_ENABLED=false` is an additional gate for review requests; it also requires A-29 approval and a real `MOVA_EMAIL_POSTAL_ADDRESS`. `MOVA_EMAIL_PUBLIC_BASE_URL` is the canonical HTTPS public origin used to build email links. These flags default off in code when absent. Supabase Auth email uses Resend through Auth's custom SMTP settings, configured in the Supabase dashboard; local Auth templates live under `supabase/templates`. Setup and the delivery-receipt webhook are in `supabase/functions/_shared/providers/email/README.md`. `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_PUBLIC_KEY` and `MOVA_SENDGRID_SANDBOX` are no longer read; remove them from production if they were ever set.

System log alert email uses the existing Resend configuration plus `MOVA_LOG_ALERT_EMAIL` (the designated owner/support recipient). `job-dispatch` checks every run and sends at most one alert per hour when 20+ errors occur in 15 minutes or at least one background job is dead. Alerts include counts and a link only; they do not contain request payloads or client information. Leaving `MOVA_LOG_ALERT_EMAIL` unset keeps outbound alerts disabled.

## Environment-specific encryption keys

Generate each key independently for development and production; do not reuse a key across environments or purposes. For each environment, generate 32 random bytes as hex with `openssl rand -hex 32` for `MOVA_NOTES_KEK_HEX`, `MOVA_DOOR_CODE_KEK_HEX`, `MOVA_PROVIDER_TOKENS_KEK_HEX`, and `MOVA_CLIENT_CARD_TOKENS_HMAC_HEX`. Store development values only in the local development Supabase function secret store and production values only in the production Supabase function secret store. Never commit or print values. Before rotating a key, use the feature's documented key-version/rotation process so existing ciphertext or derived tokens remain readable.

The four names are documented, but environment-specific values have not been generated or installed. Production secret changes require the separate owner release process. Sensitive note save/read authorization must be verified against local Supabase before A11 acceptance.

## AI Price Pilot market sources
The approved discovery order is Claude Haiku 5.5 web search, then the least-cost OpenAI API model supported by web search (GPT-6 Luna). Use `MOVA_ANTHROPIC_API_KEY` and `MOVA_OPENAI_API_KEY`; ChatGPT subscriptions do not provide API access. Set `MOVA_PRICE_PILOT_PRIMARY_PROVIDER`, `MOVA_PRICE_PILOT_PRIMARY_MODEL`, `MOVA_PRICE_PILOT_FALLBACK_PROVIDER`, `MOVA_PRICE_PILOT_FALLBACK_MODEL`, and `MOVA_PRICE_PILOT_MAX_SEARCH_CALLS` in the Edge Function secret store. Yelp, Google Places, and SerpAPI discovery are not used by Price Pilot. Firecrawl may extract a stylist-submitted HTTPS menu URL only after the stylist confirms authorization. Web-search results are candidate discovery context, never price observations: keep source links and extract only prices explicitly stated on linked menus. Do not infer missing prices. Log provider outcomes and bounded search-call counts without prompts, raw results, or page contents. These secrets must never use a `VITE_` prefix. Provider keys alone do not enable the feature; the feature gate remains off by default.
