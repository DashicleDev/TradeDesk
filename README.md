# Dashicle Trade Desk

Personal multi-account order ticket and dashboard for cTrader. Static page (GitHub Pages) + Supabase (own tables, one Edge Function). Status: spec only, nothing built. See `SPEC.md`.

## Step 1 setup (you run these)
1. cTrader Open API portal: register an app, add redirect URIs (Pages URL and `http://localhost:8080/`).
2. Supabase dashboard: Edge Functions > Secrets: `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`.
3. Run `supabase/migrations/0001_step1.sql` in the SQL editor.
4. Fill public values in `config.js`; create a Supabase auth user (email + password) if you have none.
5. `supabase functions deploy ctrader --project-ref <ref>` (JWT verification stays on for the gateway; the function also checks the user).
6. Serve locally: `npx serve -l 8080 .`, open it, sign in, "Link cTrader", pick a **demo** account.
