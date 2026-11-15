// Runs the real Edge Function code (review / send) in Node against an in-memory fake of the database, on mock accounts only:
// nothing here touches cTrader or Supabase. Run: node supabase/functions/ctrader/run.test.mjs
// (uses Node's experimental type stripping to read index.ts)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripTypeScriptTypes } from "node:module";

// ---- a tiny fake of the supabase client: just the query shapes index.ts uses
const tables = { td_orders: [], td_accounts: [], td_templates: [], td_send_log: [], app_members: [], app_admins: [] };
let nextId = 1;
const fake = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from(name) {
    const st = { op: "select", filters: [], payload: null, single: false, maybe: false, returning: false };
    const api = {
      select() { if (st.op === "insert") st.returning = true; return api; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return api; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return api; },
      order() { return api; }, limit() { return api; },
      insert(p) { st.op = "insert"; st.payload = p; return api; },
      update(p) { st.op = "update"; st.payload = p; return api; },
      upsert(p) { st.op = "insert"; st.payload = p; return api; },
      single() { st.single = true; return api; },
      maybeSingle() { st.maybe = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      const t = tables[name];
      if (st.op === "insert") {
        const row = { id: "id" + nextId++, created_at: new Date().toISOString(), ...st.payload };
        if (name === "td_send_log" && row.client_order_id && t.some((r) => r.client_order_id === row.client_order_id)) return { data: null, error: { code: "23505" } };
        t.push(row);
        return { data: st.returning ? row : null, error: null };
      }
      const rows = t.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "update") { rows.forEach((r) => Object.assign(r, st.payload)); return { data: null, error: null }; }
      if (st.single || st.maybe) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
    return api;
  },
};

// ---- load index.ts with the Deno / npm bits stubbed
let handler;
globalThis.Deno = { env: { get: () => "x" }, serve: (h) => { handler = h; } };
globalThis.__createClient = () => fake;
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
let js = stripTypeScriptTypes(fs.readFileSync(path.join(dir, "index.ts"), "utf8"));
js = js.replace('import { createClient } from "npm:@supabase/supabase-js@2";', "const createClient = globalThis.__createClient;")
       .replace('"./plan.mjs"', JSON.stringify(pathToFileURL(path.join(dir, "plan.mjs")).href));
const tmp = path.join(os.tmpdir(), "ctrader_fn_" + Date.now() + ".mjs");
fs.writeFileSync(tmp, js);
await import(pathToFileURL(tmp).href);
const call = async (body) => (await handler(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify(body) }))).json();

// ---- data: 3 mock demo accounts, 1 live, templates, a draft order
tables.app_admins.push({ user_id: "u1" });
const acct = (id, n, o = {}) => ({ id, user_id: "u1", ctid_account_id: 900000000 + n, label: "MOCK " + id, is_live: false, is_mock: true, start_balance: 100000, ...o });
tables.td_accounts.push(acct("acc-aaaaaaaa", 2), acct("acc-bbbbbbbb", 1, { start_balance: 25000 }), acct("acc-cccccccc", 4, { is_live: true }), acct("acc-dddddddd", 3, { start_balance: null }));
tables.td_templates.push(
  { id: "t-scale", user_id: "u1", name: "Scale 100k", lot_mode: "size_scale", lot_value: 100000, copy_sl: true, copy_tp: true, sl_adjust_pips: 0, tp_adjust_pips: 0 },
  { id: "t-risk", user_id: "u1", name: "1% risk", lot_mode: "risk_pct", lot_value: 1, copy_sl: true, copy_tp: true, sl_adjust_pips: 0, tp_adjust_pips: 0, max_risk_pct: 1.5 },
);
const draft = (extra = {}) => ({ id: "ord-11111111-aaaa", user_id: "u1", status: "draft", symbol: "USDJPY", side: "sell", order_type: "limit", lots: 5, entry: 160.5, sl: 160.8, tp: 159.5, expires_at: null, note: null,
  targets: [{ account_id: "acc-aaaaaaaa", template_id: "t-scale" }, { account_id: "acc-bbbbbbbb", template_id: "t-scale" }, { account_id: "acc-cccccccc", template_id: "t-scale" }], ...extra });
tables.td_orders.push(draft());
const logOf = (status) => tables.td_send_log.filter((r) => !status || r.status === status);

// 1. review: sizes and refusals, nothing is written
let r = await call({ action: "review", order_id: "ord-11111111-aaaa" });
const by = (rows, id) => rows.find((x) => x.account_id === id);
assert.equal(by(r.rows, "acc-aaaaaaaa").ok, true);
assert.equal(by(r.rows, "acc-aaaaaaaa").lots, 5);              // 100k account, reference 100k
assert.equal(by(r.rows, "acc-bbbbbbbb").lots, 1.25);           // 25k account
assert.equal(by(r.rows, "acc-cccccccc").ok, false);            // live
assert.match(by(r.rows, "acc-cccccccc").reason, /step 4/);
assert.equal(by(r.rows, "acc-aaaaaaaa").simulated, true);
assert.equal(tables.td_send_log.length, 0, "review must not write the log");

// 2. send without a matching confirmation is refused per account
r = await call({ action: "send", order_id: "ord-11111111-aaaa", expected: [{ account_id: "acc-aaaaaaaa", lots: 4 }] });
assert.equal(by(r.rows, "acc-aaaaaaaa").status, "changed");
assert.equal(by(r.rows, "acc-bbbbbbbb").status, "changed");   // not in what was confirmed
assert.equal(logOf("simulated").length, 0);
assert.equal(tables.td_orders[0].status, "draft");

// 3. a proper send: simulated for the two mock demo accounts, the live one blocked and logged
const review = await call({ action: "review", order_id: "ord-11111111-aaaa" });
const expected = review.rows.filter((x) => x.ok).map((x) => ({ account_id: x.account_id, lots: x.lots }));
r = await call({ action: "send", order_id: "ord-11111111-aaaa", expected });
assert.equal(by(r.rows, "acc-aaaaaaaa").status, "simulated");
assert.equal(by(r.rows, "acc-bbbbbbbb").status, "simulated");
assert.equal(by(r.rows, "acc-cccccccc").status, "blocked");
assert.equal(logOf("simulated").length, 2);
assert.ok(logOf("simulated").every((x) => x.client_order_id && /Simulated/.test(x.message)));
assert.equal(tables.td_orders[0].status, "draft", "the live account has no attempt, so the draft stays a draft");

// 4. sending again must not double-send
r = await call({ action: "send", order_id: "ord-11111111-aaaa", expected });
assert.match(by(r.rows, "acc-aaaaaaaa").reason, /already sent/);
assert.equal(logOf("simulated").length, 2, "no second attempt");
assert.equal(new Set(logOf("simulated").map((x) => x.client_order_id)).size, 2);

// 5. a draft whose accounts are all attempted becomes 'sent' and cannot be sent again
tables.td_orders.push(draft({ id: "ord-22222222-bbbb", targets: [{ account_id: "acc-aaaaaaaa", template_id: "t-risk" }] }));
const rv2 = await call({ action: "review", order_id: "ord-22222222-bbbb" });
const row2 = rv2.rows[0];
assert.equal(row2.ok, true, row2.reason);
assert.ok(row2.riskPct > 0 && row2.riskPct <= 1.5, "risk " + row2.riskPct);
assert.ok(row2.riskMoney > 0);
r = await call({ action: "send", order_id: "ord-22222222-bbbb", expected: [{ account_id: "acc-aaaaaaaa", lots: row2.lots }] });
assert.equal(r.rows[0].status, "simulated");
assert.equal(tables.td_orders.find((o) => o.id === "ord-22222222-bbbb").status, "sent");
let err = await call({ action: "send", order_id: "ord-22222222-bbbb", expected: [] });
assert.match(err.error, /already sent/);

// 6. refusals: a template that needs a starting size the account lacks; no template; entry on the wrong side
tables.td_orders.push(draft({ id: "ord-33333333-cccc", targets: [{ account_id: "acc-dddddddd", template_id: "t-scale" }, { account_id: "acc-aaaaaaaa", template_id: null }] }));
const rv3 = await call({ action: "review", order_id: "ord-33333333-cccc" });
assert.match(by(rv3.rows, "acc-dddddddd").reason, /starting size/);
assert.match(by(rv3.rows, "acc-aaaaaaaa").reason, /template/);
tables.td_orders.push(draft({ id: "ord-44444444-dddd", entry: 159.0, targets: [{ account_id: "acc-aaaaaaaa", template_id: "t-scale" }] })); // a sell below the price is a stop order
const rv4 = await call({ action: "review", order_id: "ord-44444444-dddd" });
assert.equal(rv4.rows[0].ok, true, rv4.rows[0].reason);
assert.equal(rv4.rows[0].orderType, "stop");
assert.equal(by(review.rows, "acc-aaaaaaaa").orderType, "limit"); // the earlier entry (160.5) sat above the bid: a limit

// 6b. a limit the price has passed: composed when the bid was 159.0 (entry_ref), limit sell at 159.5; the market is now ~159.8, through it
tables.td_orders.push(draft({ id: "ord-66666666-ffff", entry: 159.5, entry_ref: 159.0, sl: 159.8, tp: 159.0, targets: [{ account_id: "acc-aaaaaaaa", template_id: "t-scale" }] }));
const rv6 = await call({ action: "review", order_id: "ord-66666666-ffff" });
assert.equal(rv6.rows[0].ok, true, rv6.rows[0].reason);
assert.equal(rv6.rows[0].orderType, "market");
assert.equal(rv6.rows[0].converted, true);
assert.equal(rv6.rows[0].limitEntry, 159.5);
// confirming the lots but a different type (what was reviewed was a limit) is refused: the order kind changed since the review
r = await call({ action: "send", order_id: "ord-66666666-ffff", expected: [{ account_id: "acc-aaaaaaaa", lots: rv6.rows[0].lots, orderType: "limit" }] });
assert.equal(r.rows[0].status, "changed");
assert.match(r.rows[0].reason, /order type changed from limit to market/);
r = await call({ action: "send", order_id: "ord-66666666-ffff", expected: [{ account_id: "acc-aaaaaaaa", lots: rv6.rows[0].lots, orderType: "market" }] });
assert.equal(r.rows[0].status, "simulated");
assert.match(r.rows[0].message, /At market/);
assert.equal(logOf("simulated").find((x) => x.order_id === "ord-66666666-ffff").order_type, "market");

// 7. someone else's order is invisible
tables.td_orders.push(draft({ id: "ord-55555555-eeee", user_id: "other" }));
err = await call({ action: "review", order_id: "ord-55555555-eeee" });
assert.match(err.error, /not found/);

// 7b. a JPY cross sized by risk: EURJPY is valued through USDJPY (mock prices: EURJPY ~173.5, USDJPY ~159.84)
tables.td_orders.push(draft({ id: "ord-77777777-gggg", symbol: "EURJPY", entry: 174.5, entry_ref: 173.5, sl: 174.8, tp: 174.0, targets: [{ account_id: "acc-aaaaaaaa", template_id: "t-risk" }] }));
const rv7 = await call({ action: "review", order_id: "ord-77777777-gggg" });
assert.equal(rv7.rows[0].ok, true, rv7.rows[0].reason);
assert.ok(rv7.rows[0].lots > 4 && rv7.rows[0].lots < 8, "cross lots " + rv7.rows[0].lots);   // 1000 / (30 pips x ~$6.26)
assert.ok(rv7.rows[0].riskPct > 0.9 && rv7.rows[0].riskPct <= 1.0001, "cross risk " + rv7.rows[0].riskPct);

// 8. the symbol list for the picker: with only mock accounts it is the simulated set
const sy = await call({ action: "symbols" });
assert.equal(sy.simulated, true);
assert.ok(sy.symbols.includes("EURUSD") && sy.symbols.includes("USDJPY") && sy.symbols.includes("XAUUSD"));
assert.deepEqual(sy.symbols, [...sy.symbols].sort(), "sorted");

console.log("function flow tests passed");
fs.unlinkSync(tmp);
