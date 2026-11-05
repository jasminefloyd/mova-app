# packages/contracts

Zod DTOs for every Edge Function (`src/functions/<name>.ts`), shared enums (mirroring DB CHECKs), error codes, the API envelope
`{ data, error, request_id }`, locale types, and analytics event schemas (`src/analytics.ts`, §11). Used by `apps/web` and `supabase/functions`.
OpenAPI is generated from these in CI (§6.1). Replaces the retired `api-contracts` package (R-02).
