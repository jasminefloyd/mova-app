# Rooted Beauty full demo refresh

The renderer assembles a transaction for the existing Rooted Beauty demo tenant, BID-1. It verifies the business, public handle, and active owner. It refuses subscription and live financial records and refuses to reset while tenant jobs are pending. Back up the target tenant and verify its current identity and counts before running against a hosted database.

The transaction replaces the working dataset, retains the owner, tenant, public handle, and portfolio, and reseeds the 12-client and 41-appointment walkthrough. It keeps fictional contacts on example.invalid and clears generated outbox events before commit. The recorded payments use local ledger methods. Admin-assigned AI + Growth gives this tenant the paid plan without a subscription or trial. Other businesses retain the platform settings.

Rehearse on a disposable database that already contains the Rooted Beauty demo fixture. Run with a PostgreSQL client or the approved SQL deployment mechanism. Use a local connection for the example below.

```sh
python3 -B scripts/demo/render-rooted-beauty-reset.py |
  psql -X -v ON_ERROR_STOP=1 -d mova_rooted_demo_local
```
