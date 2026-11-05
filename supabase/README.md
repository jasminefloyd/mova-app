# supabase

- `migrations/`: ordered SQL migrations (§4.5), each shipped with pgTAP tests and seed updates.
- `functions/`: one folder per Edge Function (§6); shared code in `functions/_shared/`.
- `tests/`: pgTAP tests, including the full RLS matrix (§4.4) with negative tests for other artist, client of same artist, client of another
  artist, anonymous and expired token.
- `seed.sql`: two tenants, two locations (suite/instant/artist-collects and salon/request/salon-collects), services with fixed/percent/no deposit,
  clients with 0/1/2/4+ visit intervals, one customer linked to both artists, appointments and slot events in every state, EN/ES templates,
  conversations per channel, reviews from both sources, 90 days of metrics. **No real PII.**
- `config.toml`: created in P01.
