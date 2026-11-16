// Trade Desk Edge Function. Holds the cTrader secret (env) and the tokens (td_tokens); everything that talks to cTrader goes through here.
// Actions: start, exchange (link), overview, quote, symbols, review and send (step 3).
//
// Safety rules that live HERE, not in the page:
//  - send only ever goes to demo accounts (live ones arrive in step 4) and only with a link that has the trading permission;
//  - the server recomputes every order (lots, SL, TP, limits) itself; the page only displays what review returned;
//  - one attempt per order and account (unique client order id): never retried, a failure is shown and logged;
//  - mock accounts (td_accounts.is_mock) get a simulated answer and never touch cTrader.
// Payload type numbers are confirmed against help.ctrader.com/open-api/model-messages (2026-11-15).
// VERIFY on the first real run: the wss connection from here; pip size = 10^-pipPosition; the JSON form of the enums used in
// the new-order request (orderType 2 limit / 3 stop, tradeSide 1 buy / 2 sell, timeInForce 1 GTD / 2 GTC); the asset list field names.
import { createClient } from "npm:@supabase/supabase-js@2";
import { plan, conversionPair } from "./plan.mjs";

const CLIENT_ID = Deno.env.get("CTRADER_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("CTRADER_CLIENT_SECRET")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const T = {
  appAuthReq: 2100, accAuthReq: 2102, traderReq: 2121, reconcileReq: 2124,
  accListReq: 2149, pnlReq: 2187, errorRes: 2142, protoError: 50,
  symbolsListReq: 2114, symbolByIdReq: 2116, subscribeSpotsReq: 2127, spotEvent: 2131,
  assetListReq: 2112, newOrderReq: 2106, orderError: 2132,
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// One short-lived JSON WebSocket: app auth, then request/response by clientMsgId.
async function open(live: boolean) {
  const ws = new WebSocket(`wss://${live ? "live" : "demo"}.ctraderapi.com:5036`);
  const pending = new Map<string, (m: any) => void>();
  const waiters: { type: number; test: (p: any) => boolean; res: (p: any) => void }[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const f = pending.get(m.clientMsgId);
    if (f) { pending.delete(m.clientMsgId); return f(m); }
    const i = waiters.findIndex((w) => w.type === m.payloadType && w.test(m.payload)); // events have no clientMsgId
    if (i >= 0) waiters.splice(i, 1)[0].res(m.payload);
  };
  // Resolves with the first pushed event of this type that passes `test`. Register it BEFORE sending the request that triggers it.
  const waitFor = (type: number, test: (p: any) => boolean, ms = 8000) =>
    new Promise<any>((res, rej) => {
      const t = setTimeout(() => rej(new Error("no price received (market closed?)")), ms);
      waiters.push({ type, test, res: (p) => { clearTimeout(t); res(p); } });
    });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cTrader connection failed")); });
  const send = (payloadType: number, payload: object) =>
    new Promise<any>((res, rej) => {
      const id = crypto.randomUUID();
      const t = setTimeout(() => { pending.delete(id); rej(new Error("cTrader timeout")); }, 10000);
      pending.set(id, (m) => {
        clearTimeout(t);
        if (m.payloadType === T.errorRes || m.payloadType === T.protoError || m.payloadType === T.orderError)
          rej(new Error(m.payload?.description || m.payload?.errorCode || "cTrader error"));
        else res(m.payload);
      });
      ws.send(JSON.stringify({ clientMsgId: id, payloadType, payload }));
    });
  await send(T.appAuthReq, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  return { send, waitFor, close: () => ws.close() };
}

// Connect, authorize one trading account, run fn, always close.
async function inAccount<R>(a: any, token: string, fn: (c: Awaited<ReturnType<typeof open>>, id: number) => Promise<R>) {
  const c = await open(a.is_live);
  try {
    const id = Number(a.ctid_account_id);
    await c.send(T.accAuthReq, { ctidTraderAccountId: id, accessToken: token });
    return await fn(c, id);
  } finally { c.close(); }
}

async function tokenCall(params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  const r = await fetch(`https://openapi.ctrader.com/apps/token?${q}`, { method: params.grant_type === "refresh_token" ? "POST" : "GET" });
  const j = await r.json();
  if (!r.ok || j.errorCode || !j.accessToken) throw new Error("token request failed"); // never echo the body
  return j;
}

async function saveTokens(uid: string, j: any, scope: string) {
  const { error } = await admin.from("td_tokens").upsert({
    user_id: uid, access_token: j.accessToken, refresh_token: j.refreshToken,
    expires_at: new Date(Date.now() + Number(j.expiresIn) * 1000).toISOString(), scope,
  });
  if (error) throw new Error("could not store tokens");
}

async function tokenRow(uid: string) {
  const { data } = await admin.from("td_tokens").select("*").eq("user_id", uid).maybeSingle();
  if (!data) throw new Error("No cTrader link yet");
  if (new Date(data.expires_at).getTime() - Date.now() > 24 * 3600_000) return { token: data.access_token as string, scope: data.scope as string };
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  await saveTokens(uid, j, data.scope); // new pair replaces old atomically (single upsert); the permission stays what it was
  return { token: j.accessToken as string, scope: data.scope as string };
}
const accessToken = async (uid: string) => (await tokenRow(uid)).token;

const money = (v: number | string | undefined, d: number) => Number(v ?? 0) / 10 ** d;

async function oneAccount(a: any, token: string) {
  return await inAccount(a, token, async (c, id) => {
    const { trader } = await c.send(T.traderReq, { ctidTraderAccountId: id });
    const rec = await c.send(T.reconcileReq, { ctidTraderAccountId: id });
    const positions = rec.position ?? [], orders = rec.order ?? [];
    let pnl = 0;
    if (positions.length) {
      const p = await c.send(T.pnlReq, { ctidTraderAccountId: id });
      pnl = (p.positionUnrealizedPnL ?? []).reduce((s: number, x: any) => s + money(x.netUnrealizedPnL, p.moneyDigits ?? 2), 0);
    }
    const bal = money(trader.balance, trader.moneyDigits ?? 2);
    return { ...base(a), balance: bal, equity: +(bal + pnl).toFixed(2), positions: positions.length, orders: orders.length };
  });
}
const base = (a: any) => ({ id: a.id, label: a.label, is_live: a.is_live });

// Test rows (td_accounts.is_mock): fake numbers, never contact cTrader. Delete the rows to remove them.
function mockAccount(a: any) {
  const n = Number(a.ctid_account_id) % 5;
  const balance = [10000, 25000, 100000, 50000, 200000][n];
  return { ...base(a), balance, equity: balance + n * 37 - 60, positions: 0, orders: 0, trades: [] };
}

// Mock account plus its simulated orders and positions (td_sim)
async function simAccount(uid: string, a: any) {
  const m = mockAccount(a);
  const { data } = await admin.from("td_sim").select("*").eq("user_id", uid).eq("account_id", a.id).neq("status", "closed").order("created_at");
  const trades = (data ?? []).map((t: any) => ({ id: t.id, sim: true, kind: t.status === "open" ? "position" : "pending", symbol: t.symbol, side: t.side, lots: Number(t.lots), price: Number(t.entry), sl: t.sl == null ? null : Number(t.sl), tp: t.tp == null ? null : Number(t.tp), note: t.note ?? null }));
  return { ...m, trades, positions: trades.filter((t) => t.kind === "position").length, orders: trades.filter((t) => t.kind === "pending").length };
}

// ---- symbol details and live price
const symCache = new Map<string, any>(); // symbol details rarely change; cached per instance
async function symbolInfo(c: any, id: number, sym: string) {
  const key = `${id}:${sym}`;
  let info = symCache.get(key);
  if (info) return info;
  const list = await c.send(T.symbolsListReq, { ctidTraderAccountId: id });
  const ls = (list.symbol ?? []).find((s: any) => String(s.symbolName).toUpperCase() === sym);
  if (!ls) throw new Error(`${sym} not found at this broker`);
  const s = ((await c.send(T.symbolByIdReq, { ctidTraderAccountId: id, symbolId: [ls.symbolId] })).symbol ?? [])[0];
  if (!s) throw new Error("symbol details unavailable");
  const lot = Number(s.lotSize) || 10_000_000; // lot size and volumes are in cents of a unit
  info = { symbolId: ls.symbolId, digits: s.digits, pip_size: Number((10 ** -s.pipPosition).toPrecision(6)), lotSize: lot,
    min_lots: Number(s.minVolume) / lot, step_lots: Number(s.stepVolume) / lot, max_lots: Number(s.maxVolume) / lot };
  symCache.set(key, info);
  return info;
}
async function spot(c: any, id: number, info: any) {
  const w = c.waitFor(T.spotEvent, (p: any) => Number(p.symbolId) === Number(info.symbolId) && !!p.bid && !!p.ask);
  await c.send(T.subscribeSpotsReq, { ctidTraderAccountId: id, symbolId: [info.symbolId] });
  const ev = await w;
  return { bid: Number(ev.bid) / 1e5, ask: Number(ev.ask) / 1e5 }; // spot prices are scaled by 1/100000
}
async function realQuote(a: any, token: string, sym: string) {
  return await inAccount(a, token, async (c, id) => {
    const info = await symbolInfo(c, id, sym);
    const px = await spot(c, id, info);
    return { symbol: sym, ...px, digits: info.digits, pip_size: info.pip_size, min_lots: info.min_lots, step_lots: info.step_lots, max_lots: info.max_lots };
  });
}
// The broker's symbol names for the picker (enabled ones), cached for 10 minutes per account.
const listCache = new Map<string, { at: number; names: string[] }>();
async function brokerSymbols(a: any, token: string) {
  const hit = listCache.get(a.id);
  if (hit && Date.now() - hit.at < 600_000) return hit.names;
  const names = await inAccount(a, token, async (c, id) => {
    const list = await c.send(T.symbolsListReq, { ctidTraderAccountId: id });
    return (list.symbol ?? []).filter((s: any) => s.enabled !== false).map((s: any) => String(s.symbolName)).sort();
  });
  listCache.set(a.id, { at: Date.now(), names });
  return names;
}
async function accountContext(c: any, id: number) {
  const { trader } = await c.send(T.traderReq, { ctidTraderAccountId: id });
  const assets = await c.send(T.assetListReq, { ctidTraderAccountId: id });
  const cur = (assets.asset ?? []).find((x: any) => String(x.assetId) === String(trader.depositAssetId))?.name;
  const rec = await c.send(T.reconcileReq, { ctidTraderAccountId: id });
  return { balance: money(trader.balance, trader.moneyDigits ?? 2), currency: cur ?? "?", openCount: (rec.position ?? []).length };
}

// Simulated prices when no real account is linked yet: majors and gold only. [mid, digits, pipPosition]
const MOCK: Record<string, [number, number, number]> = {
  EURUSD: [1.085, 5, 4], GBPUSD: [1.275, 5, 4], AUDUSD: [0.665, 5, 4], NZDUSD: [0.615, 5, 4], USDCAD: [1.395, 5, 4], USDCHF: [0.905, 5, 4],
  USDJPY: [159.84, 3, 2], GBPJPY: [203.5, 3, 2], EURJPY: [173.5, 3, 2], XAUUSD: [2650.5, 2, 1],
};
function mockQuote(sym: string) {
  const m = MOCK[sym];
  if (!m) throw new Error(`No simulated price for ${sym} (majors and gold only until an account is linked)`);
  const [mid, digits, pipPos] = m, pip = 10 ** -pipPos;
  // steady for 30 s (same seed), so a review and the send that follows see the same price; it moves between windows like a real one
  const r = Math.abs((Math.sin(Math.floor(Date.now() / 30000) * 12.9898 + sym.length) * 43758.5453) % 1);
  const jitter = (r - 0.5) * pip * 4, half = pip * 0.6;
  return { symbol: sym, bid: +(mid + jitter - half).toFixed(digits), ask: +(mid + jitter + half).toFixed(digits), digits, pip_size: Number(pip.toPrecision(6)), min_lots: 0.01, step_lots: 0.01, max_lots: 100 };
}
const mockCtx = (a: any) => ({ balance: mockAccount(a).balance, currency: "USD", openCount: 0 });

// ---- review and send (step 3)
const BLOCKING = ["sent", "simulated", "pending", "unknown"]; // an earlier attempt that must not be repeated automatically

async function runOrder(uid: string, orderId: string, mode: "review" | "send", expected: { account_id: string; lots: number; orderType?: string }[]) {
  const { data: order } = await admin.from("td_orders").select("*").eq("id", orderId).eq("user_id", uid).maybeSingle();
  if (!order) throw new Error("order not found");
  if (order.status !== "draft") throw new Error("this order was already sent");
  const targets: { account_id: string; template_id: string | null }[] = order.targets ?? [];
  if (!targets.length) throw new Error("no accounts selected for this order");
  const [{ data: accts }, { data: tpls }, { data: prior }] = await Promise.all([
    admin.from("td_accounts").select("*").eq("user_id", uid).in("id", targets.map((t) => t.account_id)),
    admin.from("td_templates").select("*").eq("user_id", uid),
    admin.from("td_send_log").select("account_id,status").eq("user_id", uid).eq("order_id", orderId),
  ]);
  const needReal = (accts ?? []).some((a: any) => !a.is_mock && !a.is_live);
  const tk = needReal ? await tokenRow(uid) : null;

  const rows: any[] = [];
  for (const t of targets) {
    const a = (accts ?? []).find((x: any) => x.id === t.account_id);
    const tpl = (tpls ?? []).find((x: any) => x.id === t.template_id) ?? null;
    const head = { account_id: t.account_id, label: a?.label ?? "(removed account)", is_live: !!a?.is_live, template: tpl?.name ?? null, simulated: !!a?.is_mock };
    const logBase = { user_id: uid, order_id: order.id, account_id: a?.id ?? null, account_label: head.label, is_live: head.is_live, symbol: order.symbol,
      side: order.side, order_type: order.order_type, template_name: head.template };
    const blocked = async (reason: string, status = "blocked") => {
      if (mode === "send") await admin.from("td_send_log").insert({ ...logBase, status, message: reason, lots: null, entry: order.entry, sl: order.sl, tp: order.tp });
      return rows.push({ ...head, ok: false, reason, status });
    };
    if (!a) { await blocked("this account no longer exists"); continue; }
    const earlier = (prior ?? []).filter((p: any) => p.account_id === a.id);
    if (earlier.some((p: any) => BLOCKING.includes(p.status))) { await blocked("already sent to this account (see the log)"); continue; }
    if (a.is_live) { await blocked("live accounts arrive in step 4"); continue; }

    try {
      // everything that needs the broker happens on one connection, so review and send see the same state
      const work = async (c: any, id: number | null) => {
        let sym: any, ctx: any, info: any = null;
        const cp = conversionPair(order.symbol); // a cross needs the price of its USD pair to value a pip in dollars
        if (a.is_mock) {
          sym = mockQuote(order.symbol); ctx = mockCtx(a);
          if (cp) { try { const q = mockQuote(cp.symbol); ctx.conv = { bid: q.bid, ask: q.ask, direct: cp.direct }; } catch { /* no simulated price for it: the plan refuses */ } }
        } else {
          info = await symbolInfo(c, id!, order.symbol);
          sym = { ...info, ...(await spot(c, id!, info)) };
          ctx = await accountContext(c, id!);
          if (cp) { try { const ci = await symbolInfo(c, id!, cp.symbol); ctx.conv = { ...(await spot(c, id!, ci)), direct: cp.direct }; } catch { /* the plan refuses without it */ } }
        }
        const p = plan({ symbol: order.symbol, account: a, order, tpl, sym, ctx });
        if (!p.ok) return await blocked(p.reason);
        const shown = { ...head, ok: true, orderType: p.orderType, converted: p.converted, limitEntry: p.limitEntry, lots: p.lots, entry: p.entry, sl: p.sl, tp: p.tp, slPips: p.slPips, tpPips: p.tpPips, expiresAt: p.expiresAt, riskMoney: p.riskMoney, riskPct: p.riskPct, currency: ctx.currency };
        if (mode === "review") return rows.push({ ...shown, status: "ready" });

        // send: what was confirmed must be what goes out
        const want = expected.find((x) => x.account_id === a.id);
        if (!want || Math.abs(want.lots - p.lots) > 1e-9 || (want.orderType && want.orderType !== p.orderType)) {
          const why = !want ? "this account wasn't in what you confirmed: review again"
            : Math.abs(want.lots - p.lots) > 1e-9 ? `the lot size changed from ${want.lots} to ${p.lots} since you reviewed (the price moved): review again`
            : `the order type changed from ${want.orderType} to ${p.orderType} since you reviewed (the price moved): review again`;
          await admin.from("td_send_log").insert({ ...logBase, order_type: p.orderType, status: "changed", message: why, lots: p.lots, entry: p.entry, sl: p.sl, tp: p.tp });
          return rows.push({ ...shown, ok: false, reason: why, status: "changed" });
        }
        if (!a.is_mock && tk!.scope !== "trading") return await blocked("this link is view-only: link again with the trading permission (Accounts tab)");

        const clientId = `${order.id}-${String(a.id).slice(0, 8)}-${earlier.length + 1}`; // unique per attempt: a second send cannot go through
        const { data: row, error: insErr } = await admin.from("td_send_log").insert({ ...logBase, order_type: p.orderType, status: "pending", message: "sending", lots: p.lots, entry: p.entry, sl: p.sl, tp: p.tp, client_order_id: clientId }).select("id").single();
        if (insErr) return rows.push({ ...shown, ok: false, reason: "could not record the attempt, so nothing was sent", status: "blocked" });
        let status = "sent", message = "", response: any = null;
        const atMarket = p.converted ? "At market, the price had passed your limit. " : "";
        if (a.is_mock) { status = "simulated"; message = atMarket + "Simulated: nothing was sent to any broker"; response = { simulated: true, orderId: "SIM-" + crypto.randomUUID().slice(0, 8) }; }
        else {
          try {
            const kind = p.orderType; // "limit" | "stop" | "market", derived from the entry and the live price (plan.mjs)
            const rel = (pips: number | null) => (pips == null ? undefined : Math.round(pips * info.pip_size * 1e5)); // relative SL/TP: 1/100000 of a price unit
            const payload = {
              ctidTraderAccountId: id, symbolId: info.symbolId, orderType: kind === "market" ? 1 : kind === "limit" ? 2 : 3, tradeSide: order.side === "buy" ? 1 : 2,
              volume: Math.round(p.lots * info.lotSize),
              ...(kind === "market"
                ? { relativeStopLoss: rel(p.slPips), relativeTakeProfit: rel(p.tpPips) } // cTrader takes no absolute SL/TP on a market order
                : { [kind === "limit" ? "limitPrice" : "stopPrice"]: p.entry, stopLoss: p.sl ?? undefined, takeProfit: p.tp ?? undefined,
                    timeInForce: p.expiresAt ? 1 : 2, expirationTimestamp: p.expiresAt ?? undefined }),
              label: "Desk", comment: tpl.comment ?? undefined, clientOrderId: clientId,
            };
            const r = await c.send(T.newOrderReq, payload);
            response = { orderId: r?.order?.orderId ?? null, executionType: r?.executionType ?? null };
            message = `${atMarket}Accepted by the broker${response.orderId ? ` (order ${response.orderId})` : ""}`;
          } catch (e) {
            const m = (e as Error).message;
            if (m === "cTrader timeout") { status = "unknown"; message = "No answer from cTrader: check the account before sending again"; }
            else { status = "rejected"; message = m; }
          }
        }
        if (a.is_mock) await admin.from("td_sim").insert({ user_id: uid, account_id: a.id, symbol: order.symbol, side: order.side, lots: p.lots, entry: p.entry, sl: p.sl, tp: p.tp, note: order.note ?? null, status: p.orderType === "market" ? "open" : "pending" });
        await admin.from("td_send_log").update({ status, message, broker_response: response }).eq("id", row.id);
        return rows.push({ ...shown, ok: status === "sent" || status === "simulated", reason: status === "sent" || status === "simulated" ? undefined : message, message, status });
      };
      if (a.is_mock) await work(null, null);
      else await inAccount(a, tk!.token, (c, id) => work(c, id));
    } catch (e) {
      const m = (e as Error).message;
      if (mode === "send") await admin.from("td_send_log").insert({ ...logBase, status: "blocked", message: m, entry: order.entry, sl: order.sl, tp: order.tp });
      rows.push({ ...head, ok: false, reason: m, status: "blocked" });
    }
  }

  if (mode === "send") { // the draft is done once every account has an attempt on record
    const { data: after } = await admin.from("td_send_log").select("account_id,status").eq("user_id", uid).eq("order_id", orderId);
    if (targets.every((t) => (after ?? []).some((p: any) => p.account_id === t.account_id && BLOCKING.includes(p.status)))) {
      await admin.from("td_orders").update({ status: "sent" }).eq("id", orderId).eq("user_id", uid);
    }
  }
  return { rows };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { data: u } = await admin.auth.getUser((req.headers.get("Authorization") ?? "").replace("Bearer ", ""));
    const uid = u.user?.id;
    if (!uid) return json({ error: "not signed in" }, 401);
    // same approval rule as the journal (is_approved(): member with a non-pending role, or admin)
    const [{ data: m }, { data: ad }] = await Promise.all([
      admin.from("app_members").select("role").eq("user_id", uid).maybeSingle(),
      admin.from("app_admins").select("user_id").eq("user_id", uid).maybeSingle(),
    ]);
    if (!ad && (!m || m.role === "pending")) return json({ error: "account not approved yet" }, 403);
    const body = await req.json();

    if (body.action === "start") {
      const scope = body.scope === "trading" ? "trading" : "accounts"; // view-only unless asked for
      const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: body.redirect_uri, scope, product: "web" });
      return json({ url: `https://id.ctrader.com/my/settings/openapi/grantingaccess/?${q}` });
    }

    if (body.action === "exchange") {
      const j = await tokenCall({ grant_type: "authorization_code", code: body.code, redirect_uri: body.redirect_uri });
      await saveTokens(uid, j, "accounts"); // stored first: the login code works once
      const c = await open(true); // live host lists all accounts of the cTID
      try {
        const res = await c.send(T.accListReq, { accessToken: j.accessToken });
        // the response says which permission was actually granted (view or trade)
        const trade = res.permissionScope === 1 || String(res.permissionScope).toUpperCase().includes("TRADE");
        if (trade) await admin.from("td_tokens").update({ scope: "trading" }).eq("user_id", uid);
        const rows = (res.ctidTraderAccount ?? []).map((x: any) => ({
          user_id: uid, ctid_account_id: x.ctidTraderAccountId, is_live: !!x.isLive,
          broker: x.brokerTitleShort ?? null, login: x.traderLogin ?? null,
          label: `${x.brokerTitleShort ?? "cTrader"} ${x.traderLogin ?? x.ctidTraderAccountId}`,
        }));
        // ignoreDuplicates keeps labels the user renamed
        if (rows.length) await admin.from("td_accounts").upsert(rows, { onConflict: "user_id,ctid_account_id", ignoreDuplicates: true });
        return json({ linked: rows.length, trading: trade });
      } finally { c.close(); }
    }

    if (body.action === "quote") {
      const sym = String(body.symbol ?? "").toUpperCase().replace(/[^A-Z0-9._#]/g, "").slice(0, 20);
      if (!sym) return json({ error: "no pair given" }, 400);
      const { data: accts } = await admin.from("td_accounts").select("*").eq("user_id", uid).eq("is_mock", false).order("is_live").order("created_at").limit(1);
      const a = accts?.[0]; // a demo account first: the price is the broker's either way
      if (!a) return json({ quote: mockQuote(sym), simulated: true });
      return json({ quote: await realQuote(a, await accessToken(uid), sym), simulated: false, account: a.label });
    }

    if (body.action === "symbols") {
      const { data: accts } = await admin.from("td_accounts").select("*").eq("user_id", uid).eq("is_mock", false).order("is_live").order("created_at").limit(1);
      const a = accts?.[0];
      if (!a) return json({ symbols: Object.keys(MOCK).sort(), simulated: true }); // only what the simulated prices cover
      return json({ symbols: await brokerSymbols(a, await accessToken(uid)), simulated: false, account: a.label });
    }

    if (body.action === "review" || body.action === "send") {
      return json(await runOrder(uid, String(body.order_id ?? ""), body.action, Array.isArray(body.expected) ? body.expected : []));
    }

    if (body.action === "sim_fill" || body.action === "sim_close") { // simulated trades only: fill a waiting order now, or close a position / cancel an order
      const { data: t } = await admin.from("td_sim").select("*").eq("id", String(body.id ?? "")).eq("user_id", uid).neq("status", "closed").maybeSingle();
      if (!t) return json({ error: "no such simulated trade" }, 404);
      if (body.action === "sim_fill") { if (t.status !== "pending") return json({ error: "already running" }, 400); await admin.from("td_sim").update({ status: "open" }).eq("id", t.id); }
      else { const q = mockQuote(t.symbol); await admin.from("td_sim").update({ status: "closed", close_price: t.status === "open" ? (t.side === "buy" ? q.bid : q.ask) : null }).eq("id", t.id); }
      return json({ ok: true });
    }

    if (body.action === "sim_amend") { // move or remove SL / TP on simulated trades; null removes
      const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
      const patch: Record<string, number | null> = {}; // only what was sent: a field left out stays as it is
      for (const k of ["sl", "tp"]) if (k in body) { const v = num(body[k]); if (v !== null && !(v > 0)) return json({ error: "SL and TP must be prices" }, 400); patch[k] = v; }
      if (!Object.keys(patch).length) return json({ error: "nothing to change" }, 400);
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 50);
      if (!ids.length) return json({ error: "no trades chosen" }, 400);
      const { error } = await admin.from("td_sim").update(patch).in("id", ids).eq("user_id", uid).neq("status", "closed");
      if (error) return json({ error: "could not save" }, 500);
      return json({ ok: true });
    }

    if (body.action === "overview") {
      const { data: accts } = await admin.from("td_accounts").select("*").eq("user_id", uid).order("created_at");
      if (!accts?.length) return json({ accounts: [] });
      const token = accts.some((a) => !a.is_mock) ? await accessToken(uid) : "";
      const accounts = [];
      for (const a of accts) { // sequential: stays far below the 50 req/s limit
        try { accounts.push(a.is_mock ? await simAccount(uid, a) : await oneAccount(a, token)); }
        catch (e) { accounts.push({ ...base(a), error: (e as Error).message }); }
      }
      return json({ accounts });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
