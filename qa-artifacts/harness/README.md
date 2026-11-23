# Native loopback workaround

The report records the exact commands for the original workstation stack. The fallback used these components when the local container runtime was unavailable.

- A fresh PostgreSQL database named `mova_qa_native` and a separate disposable pgTAP instance. The native instance on 55432 used a local Unix socket, the role definitions in `scripts/local-db/bootstrap.sql`, the actual GoTrue Auth schema, all repository migrations in filename order, and `supabase/seed.sql`. Start GoTrue against a new database before the application migrations that reference `auth.users`. Its connection uses `search_path=auth`.
- GoTrue bound to `127.0.0.1:55425`. The local JWT default group was `authenticated`, OTP length was 6, and Auth used the Confirm signup and Magic Link templates from the repository. GoTrue and PostgREST shared one freshly generated local signing secret. GoTrue sent mail to the local sink. PostgREST bound to `127.0.0.1:55426` with the same JWT secret, the `public` schema and `anon` role.
- The SMTP sink saves synthetic messages outside the repository. Its small runner requires Python 3.11 for `smtpd`. The Deno gateway loads the current local Edge Function entry points. It expects `MOVA_QA_REPO`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any disposable feature encryption keys for the selected cases. Generate the JWTs and encryption keys for this disposable stack. Never use values from the project's production configuration.
- Vite received local `VITE_SUPABASE_URL=http://127.0.0.1:55421` and a local `VITE_SUPABASE_ANON_KEY`. The browser harness expects `QA_SEED_DIR` to contain the mail directory and refuses non-loopback application and API origins.

Once PostgreSQL, GoTrue and PostgREST are configured, start the remaining processes in separate shells.

```sh
mkdir -p "$QA_SEED_DIR/mail"
python3.11 qa-artifacts/harness/mail.py "$QA_SEED_DIR/mail"
```

```sh
export MOVA_QA_REPO="$PWD"
deno run --no-lock --allow-env --allow-read --allow-net qa-artifacts/harness/gateway.ts
```

```sh
export VITE_SUPABASE_URL=http://127.0.0.1:55421
corepack pnpm --filter @mova/web dev --host 127.0.0.1 --port 4175
```
