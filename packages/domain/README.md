# packages/domain

Pure business rules, no I/O, shared by Edge Functions (Deno imports the build) and UI previews (§5). 100% branch coverage on money, deposits,
availability, booking state, consent, cadence, forecast, slot matching and concierge policy.

Planned modules (`src/`): `availability.ts`, `deposit.ts`, `fees.ts`, `ledger.ts`, `booking-state.ts`, `rebooking.ts`, `forecast.ts`,
`slot-matching.ts`, `autopilot-rules.ts`, `consent.ts` (`canSend`), `review-rules.ts`, `concierge-policy.ts`, `kpis.ts`.
