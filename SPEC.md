# Trade Desk — spec (draft, nothing built yet)

Working name. A personal multi-account order ticket and dashboard: save trade ideas, send them to the accounts you pick (each with its own template), and see all accounts and open trades in one place. Not a copier that follows another trader, not a broker, not a platform of its own.

## What it does
1. **Accounts:** link cTrader accounts once (cTrader login screen; we never see broker passwords). Overview: name, platform, balance, equity, open trades, today's result.
2. **Ideas:** saved trade ideas: pair, long/short, lots, entry price, SL, TP, a note. An idea with an entry price becomes a **pending order** (limit or stop). Absolute SL/TP are accepted on limit and stop orders, not on market orders, so v1 sends pending orders only.
3. **Templates:** a saved recipe for turning an idea into an order on one account. Every account has a default template; you can override it when sending.
   - lot size: fixed lots, % of the account's starting size at risk (your 1% rule), or a multiplier of the idea's lots
   - SL / TP: copy as given, or leave one off
   - direction: normal or reversed
   - limits: max open trades, max risk per account
   - symbol mapping (broker names that differ)
   - later: skip around heavy news or outside set hours
4. **Send:** pick an idea, tick the accounts. A confirm screen lists every account with its resulting lots, risk in money and %, and the template used. Nothing is sent before you confirm. A log records what was sent where and what the broker answered.
5. **Open trades and orders:** all accounts in one list; cancel a pending order; change SL/TP.

## How it is built
- **Screens:** a static web page on GitHub Pages, like the journal. Same look.
- **Storage:** your Supabase project: ideas, templates, account links, the send log. Rows locked to your login (same rules as the journal).
- **Edge Function (changed, see "Confirmed facts"):** one Supabase Edge Function holds the cTrader app secret. It (a) exchanges the login code for tokens and refreshes them, and (b) relays every cTrader call: per request it opens a WebSocket to cTrader, does app auth + account auth, sends the one request, returns the answer. Tokens live in a table the page can't read. The page only sends its Supabase login (JWT) plus a small action ({list accounts, list orders, place order, cancel}) to the function.
- **Why not browser-direct (original idea):** cTrader's app auth message carries the client secret, so a browser connection would expose it. Pending orders sit at the broker, so closing the page does not cancel them.
- **Broker layer:** the app only calls four actions (list accounts, list open trades/orders, place pending order, cancel order). cTrader is the first implementation. MT5 later = another implementation (no official open API: a paid bridge service or software on a server); nothing else changes.

## Safety
- Demo accounts first; each account is marked demo or live, and live sends need an extra confirm.
- Confirm screen with exact lots and risk per account; a hard per-account max risk from the template that can't be overridden at send time.
- One send = one log entry per account with the broker's answer; failures are shown, never retried silently (no double orders).
- Tokens only in the locked table; access to the app needs the same approved login as the journal.
- Prop firms (FTMO, FundingPips) may treat one trade sent to several of their accounts as copy trading. Check their rules before using it on those accounts.
- I (Claude) build it; you run the tests that place orders. I do not place trades.

## Not in v1
Automatic break-even at +1R (needs a server running all the time), market orders, MT5, news/session rules in templates, mobile app, notifications.

## Build order
1. Link accounts + read-only overview (proves the connection, no risk).
2. Saved ideas + templates (no sending yet).
3. Send pending orders to **demo** accounts; confirm screen and log.
4. Live accounts, cancel/amend, polish.

## To confirm before building
- All accounts on cTrader, or some on MT5 (later is fine)?
- Create a cTrader Open API application (Spotware connect portal) to get the client id and secret: done by you, the secret goes into Supabase, never into chat or the repo.
- ~~Docs check~~ done, see "Confirmed facts" below.
- Open: does the app's redirect URI allow `https://<user>.github.io/<repo>/` plus `http://localhost:<port>` for dev? (portal setting, user checks.)
- Open: do prop-firm cTrader accounts (FTMO, FundingPips) allow Open API access at all? Some firms disable it. Check before building further.
- Name and where the repo lives.

## Confirmed facts (cTrader Open API docs, checked 2026-11-15)
Docs: https://help.ctrader.com/open-api/ (overview), /connection/, /proxies-endpoints/, /account-authentication/, /sending-receiving-json/, /messages/, /model-messages/

- **Endpoints:** `live.ctraderapi.com` and `demo.ctraderapi.com`; port 5035 protobuf, 5036 JSON; each over TCP or WebSocket. A live-flagged account (`ProtoOACtidTraderAccount.isLive`) must be authorized on the live host. Demo and live are fully separate.
- **Not confirmed:** exact `wss://` URL form and whether a browser can connect (community reports of failures, 2023). Moot with the Edge Function design, but the function's Deno WebSocket to `wss://demo.ctraderapi.com:5036` must be proven on the first demo call.
- **JSON framing:** `{clientMsgId, payloadType, payload}`. App auth = payloadType 2100 (`ProtoOAApplicationAuthReq`: `clientId`, **`clientSecret`**), reply 2101. Nothing may be sent before app auth.
- **Sequence:** app auth, then `ProtoOAGetAccountListByAccessTokenReq` (accessToken), then `ProtoOAAccountAuthReq` (ctidTraderAccountId, accessToken) per account.
- **Heartbeat:** `ProtoHeartbeatEvent` every 10 s on a long-lived connection.
- **Rate limits (per connection):** 50 req/s normal, 5 req/s historical data.
- **OAuth:** authorize at `https://id.ctrader.com/my/settings/openapi/grantingaccess/?client_id=&redirect_uri=&scope=accounts|trading&product=web`. `redirect_uri` must be registered on the app in the Open API portal. Scope `accounts` = view only, `trading` = view + trade.
- **Token exchange:** `https://openapi.ctrader.com/apps/token`, params `grant_type` (`authorization_code` | `refresh_token`), `code`, `redirect_uri`, `client_id`, `client_secret`. Docs show GET for the code exchange, POST for refresh. Code lives 1 minute. CORS on this endpoint is not documented (irrelevant: server-side only).
- **Token lifetime:** access token default `expiresIn` 2628000 s (about 30 days). Refresh token has no expiry; each refresh returns a new access + refresh token and invalidates the old pair, so store both atomically. A refresh can also be sent as `ProtoOARefreshTokenReq`.
- **Volume:** int64 in cents of a unit: 1000 = 10.00 units. Lots = volume / `ProtoOASymbol.lotSize` (also in cents). Respect symbol `minVolume`, `stepVolume`, `maxVolume`. Need `ProtoOASymbol` (not the light symbol) for these.
- **Pending orders:** `ProtoOANewOrderReq` with `orderType` LIMIT (`limitPrice`) or STOP (`stopPrice`); absolute `stopLoss`/`takeProfit` accepted on these, not on MARKET. Optional `timeInForce` (GTC/GTD), `expirationTimestamp` (ms), `clientOrderId` (max 50, usable as idempotency tag), `label`, `comment`. Limited-risk accounts (`isLimitedRisk`) need relative SL/TP + guaranteed SL instead.
- **Cancel / amend:** `ProtoOACancelOrderReq` (orderId), `ProtoOAAmendOrderReq` (orderId + changed fields). Both need trade permission.
- **Money values:** int64 scaled by `moneyDigits` (e.g. 8: 10053099944 = 100.53099944). Account type HEDGED or NETTED (matters for position handling).
- **Not confirmed:** open-orders/positions request name and equity/PnL fields (look up `ProtoOAReconcileReq` and `ProtoOAGetPositionUnrealizedPnLReq` in /messages/ at build time); Supabase Edge Function limits for outbound WebSockets.

## Build status
- Step 1 (link accounts + read-only overview): code deployed; real linking untested, waiting on cTrader app approval. Mock accounts (`td_accounts.is_mock`) cover the overview meanwhile.
- Step 2 (ideas + templates): built, migration `0003` applied. Templates hold lot mode (fixed / % of starting size at risk / multiple), copy-SL/TP, reverse, max open trades, max risk %, symbol map; each account has a default template and a starting size. Not done in step 2: live preview of resulting lots/risk (needs symbol tick/pip data from cTrader, so it belongs with the step 3 confirm screen), news/hours rules (later).
- Naming (2026-11-15): "ideas" are **orders**. A saved, unsent order is a **draft** (`td_orders.status = draft`; later `sent`, `archived`). The Dashboard shows Accounts, **Active orders** (open trades and pending orders at the broker; mock data only until step 3 reads real details) and Drafts. Tabs: Dashboard / Accounts / Templates; orders are created from the round + button.
