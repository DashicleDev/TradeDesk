// Trade Desk Edge Function. Holds the cTrader secret (env), tokens (td_tokens), relays read-only cTrader calls.
// Step 1 is read-only: scope "accounts". Payload type numbers below are from memory of ProtoOAPayloadType:
// verify against the docs on the first demo run (marked VERIFY).
import { createClient } from "npm:@supabase/supabase-js@2";

const CLIENT_ID = Deno.env.get("CTRADER_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("CTRADER_CLIENT_SECRET")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const T = { // VERIFY
  appAuthReq: 2100, accAuthReq: 2102, traderReq: 2121, reconcileReq: 2124,
  accListReq: 2149, pnlReq: 2187, errorRes: 2142, protoError: 50,
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const f = pending.get(m.clientMsgId);
    if (f) { pending.delete(m.clientMsgId); f(m); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cTrader connection failed")); });
  const send = (payloadType: number, payload: object) =>
    new Promise<any>((res, rej) => {
      const id = crypto.randomUUID();
      const t = setTimeout(() => { pending.delete(id); rej(new Error("cTrader timeout")); }, 10000);
      pending.set(id, (m) => {
        clearTimeout(t);
        if (m.payloadType === T.errorRes || m.payloadType === T.protoError) rej(new Error(m.payload?.description || m.payload?.errorCode || "cTrader error"));
        else res(m.payload);
      });
      ws.send(JSON.stringify({ clientMsgId: id, payloadType, payload }));
    });
  await send(T.appAuthReq, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  return { send, close: () => ws.close() };
}

async function tokenCall(params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  const r = await fetch(`https://openapi.ctrader.com/apps/token?${q}`, { method: params.grant_type === "refresh_token" ? "POST" : "GET" });
  const j = await r.json();
  if (!r.ok || j.errorCode || !j.accessToken) throw new Error("token request failed"); // never echo the body
  return j;
}

async function saveTokens(uid: string, j: any) {
  const { error } = await admin.from("td_tokens").upsert({
    user_id: uid, access_token: j.accessToken, refresh_token: j.refreshToken,
    expires_at: new Date(Date.now() + Number(j.expiresIn) * 1000).toISOString(), scope: "accounts",
  });
  if (error) throw new Error("could not store tokens");
}

async function accessToken(uid: string) {
  const { data } = await admin.from("td_tokens").select("*").eq("user_id", uid).maybeSingle();
  if (!data) throw new Error("No cTrader link yet");
  if (new Date(data.expires_at).getTime() - Date.now() > 24 * 3600_000) return data.access_token;
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  await saveTokens(uid, j); // new pair replaces old atomically (single upsert)
  return j.accessToken as string;
}

const money = (v: number | string | undefined, d: number) => Number(v ?? 0) / 10 ** d;

async function oneAccount(a: any, token: string) {
  const c = await open(a.is_live);
  try {
    const id = Number(a.ctid_account_id);
    await c.send(T.accAuthReq, { ctidTraderAccountId: id, accessToken: token });
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
  } finally { c.close(); }
}
const base = (a: any) => ({ id: a.id, label: a.label, is_live: a.is_live });

// Test rows (td_accounts.is_mock): fake numbers, never contact cTrader. Delete the rows to remove them.
function mockAccount(a: any) {
  const n = Number(a.ctid_account_id) % 5;
  const balance = [10000, 25000, 100000, 50000, 200000][n];
  const positions = n % 3, orders = n % 2;
  const trades = [
    ...Array.from({ length: positions }, (_, i) => ({ kind: "position", symbol: ["EURUSD", "GBPJPY"][i % 2], side: i % 2 ? "sell" : "buy", lots: 0.5, price: 1.085 + i * 0.001, sl: 1.082, tp: 1.092 })),
    ...Array.from({ length: orders }, () => ({ kind: "pending", symbol: "GBPUSD", side: "sell", lots: 1, price: 1.275, sl: 1.281, tp: 1.262 })),
  ];
  return { ...base(a), balance, equity: balance + n * 37 - 60, positions, orders, trades };
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
      const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: body.redirect_uri, scope: "accounts", product: "web" });
      return json({ url: `https://id.ctrader.com/my/settings/openapi/grantingaccess/?${q}` });
    }

    if (body.action === "exchange") {
      const j = await tokenCall({ grant_type: "authorization_code", code: body.code, redirect_uri: body.redirect_uri });
      await saveTokens(uid, j);
      const c = await open(true); // live host lists all accounts of the cTID
      try {
        const res = await c.send(T.accListReq, { accessToken: j.accessToken });
        const rows = (res.ctidTraderAccount ?? []).map((x: any) => ({
          user_id: uid, ctid_account_id: x.ctidTraderAccountId, is_live: !!x.isLive,
          broker: x.brokerTitleShort ?? null, login: x.traderLogin ?? null,
          label: `${x.brokerTitleShort ?? "cTrader"} ${x.traderLogin ?? x.ctidTraderAccountId}`,
        }));
        // ignoreDuplicates keeps labels the user renamed
        if (rows.length) await admin.from("td_accounts").upsert(rows, { onConflict: "user_id,ctid_account_id", ignoreDuplicates: true });
        return json({ linked: rows.length });
      } finally { c.close(); }
    }

    if (body.action === "overview") {
      const { data: accts } = await admin.from("td_accounts").select("*").eq("user_id", uid).order("created_at");
      if (!accts?.length) return json({ accounts: [] });
      const token = accts.some((a) => !a.is_mock) ? await accessToken(uid) : "";
      const accounts = [];
      for (const a of accts) { // sequential: stays far below the 50 req/s limit
        try { accounts.push(a.is_mock ? mockAccount(a) : await oneAccount(a, token)); }
        catch (e) { accounts.push({ ...base(a), error: (e as Error).message }); }
      }
      return json({ accounts });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
