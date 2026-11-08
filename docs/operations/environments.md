# Environments

P01 separates local development and production configuration. The product owner directed that this project will not use a staging environment and will target production for hosted deployment. Do not copy credentials between environments.

## Local development

Copy the blank variables from the repository root `.env.example` into the ignored root `.env` file. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the development Supabase project values. Set `SUPABASE_PROJECT_REF_DEV` for local Supabase CLI commands. `VITE_` values are included in browser builds and must contain only the public Supabase URL and publishable/anon key.

No value from `.env` is required to build or run the P01 shell. Supabase client creation fails explicitly if the public URL or key is missing; the shell does not simulate a successful provider connection.

## Production deployment

Use separate development and production Supabase projects. Use the matching `SUPABASE_PROJECT_REF_*` when linking or deploying database changes. This phase creates no migrations or database objects.

Configure Vercel production with the production `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Do not configure a staging project or use the Preview scope as staging. Do not place service-role keys, database passwords, or Supabase access tokens in Vite variables. The repository release gate still requires a written production GO before any production deployment.

The repository's Vercel build uses the workspace root, `pnpm build`, and `apps/web/dist`; the root rewrite supports client-side deep links. This configuration does not deploy a project or create environment variables.

Provider project IDs, linked Vercel project, local `.env`, and hosted production secrets have not been supplied or verified in this repository. Add local CLI values to the ignored `.env`, and configure hosted production values in provider dashboards or deployment secrets only after the required GO. They do not belong in this document or Git.

## PWA install guidance

- **Android / desktop Chromium:** open the deployed app in a secure context and use the browser's install action when it is offered. The manifest start URL is `/app/home`.
- **iOS / iPadOS:** open the site in Safari, use Share, then choose **Add to Home Screen**. iOS does not use the Chromium install prompt.

The app icon in this phase is a temporary technical mark made from the approved brand wordmark/color tokens. Replace it when the final logo decision (A-15) is approved.

## Local Supabase integration

The approved development path is a local Supabase stack; CR-007 explicitly rules out a hosted staging project. Install Docker Desktop and the Supabase CLI, then run `supabase start`, `supabase db reset --no-seed` for empty-database pgTAP checks, and `supabase db reset` to validate the seed. Run `supabase stop` when finished. Local function secrets belong in ignored `supabase/.env.local` or the local CLI secret store; never copy production values into them. CI exercises isolated local stacks.

The production project must not be used for development, fixture cleanup, or test writes. The existing production demo-tenant cleanup remains unperformed and requires an owner-approved production release plan.
