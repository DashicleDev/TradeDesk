# Step 1 plan: link accounts + read-only overview

Scope: no ideas, templates or sending. Request scope `accounts` (view only) first, so nothing in step 1 can trade.

## By hand (you)
1. Open the cTrader Open API portal (connect.spotware.com, "Applications"), register an app. Add redirect URIs: the GitHub Pages URL of this page and `http://localhost:8080/` for dev. Copy client id + secret.
2. Put the secret in Supabase yourself: Dashboard > Edge Functions > Secrets: `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`. Never paste them to me or into files.
3. Confirm your FTMO / FundingPips cTrader accounts can be reached by the Open API at all (some firms block it). Start with a personal demo account.
4. Create the empty GitHub repo when you want one (I create no remote).

## Files
```
index.html            single page: sign-in, "Link account" button, overview table
app.js                supabase-js login, call the function, render
style.css             copy the journal's look
config.js             Supabase URL + anon key (public values) and cTrader client id (public)
supabase/migrations/0001_step1.sql
supabase/functions/ctrader/index.ts
```
No build step, no framework; supabase-js from a CDN, like the journal.

## Tables (own prefix `td_`, same Supabase project, RLS on, nothing touches journal tables)
- `td_accounts`: `id`, `user_id` (default `auth.uid()`), `ctid_account_id` bigint, `label`, `is_live` bool, `broker`, `login`, `created_at`. unique(`user_id`,`ctid_account_id`). Policy: select/update/delete where `user_id = auth.uid()`; insert only through the function (service role).
- `td_tokens`: `user_id` pk, `access_token`, `refresh_token`, `expires_at`, `scope`. RLS enabled, **no policies**, plus `revoke all ... from anon, authenticated`. Only the Edge Function (service role) can read or write.
- Same-login rule as the journal: reuse its approved-user check if it has one (I'll read the journal's policies first; not looked at yet).

## Edge Function `ctrader` (Deno, one function, JWT verified, action in body)
- `start`: returns the authorize URL (client id from secret, scope `accounts`, `product=web`). Page redirects to it.
- `exchange {code, redirect_uri}`: calls `openapi.ctrader.com/apps/token`, stores tokens in `td_tokens`, fetches the account list, upserts `td_accounts`.
- `overview`: refreshes the token if it expires within a day (store the new pair together), then for each account opens a WebSocket to the right host (live/demo by `is_live`), app auth, account auth, reads trader (balance, moneyDigits), positions/orders; returns rows. Reads only.
- Errors returned as `{error}` with no token or secret content; nothing logged that contains them.

## Page flow
Sign in (Supabase) > "Link cTrader" > cTrader login > back with `?code=` > page posts the code to `exchange` > overview table: name, demo/live, balance, equity, open trades, today's result. Refresh button; no auto-poll in step 1.

## Risks and opinions
- The design changed: the browser can't hold the connection because cTrader app auth needs the secret in the message. Every cTrader call goes through the function. Cost: slower calls (a connect + 2 auths each time) and Supabase function limits; fine for a personal tool.
- Unproven until built: Deno WebSocket to `wss://demo.ctraderapi.com:5036`, and the exact request names for positions, equity and today's result. First thing I'd test, read-only, by you on demo.
- Today's result needs deal history (rate limit 5 req/s); may ship as "closed P&L today" computed from deals.
- Prop firms: linking read-only is safe; the multi-account send in step 3 may count as copy trading. Check FTMO / FundingPips rules before step 3.

## Done when
You can link a demo account, see its balance and open trades, and `td_tokens` returns nothing when queried with the anon key.
