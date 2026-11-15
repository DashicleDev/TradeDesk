// Run: node supabase/functions/ctrader/plan.test.mjs
import assert from "node:assert/strict";
import { plan, pipValueUsd } from "./plan.mjs";

const usdjpy = { digits: 3, pip_size: 0.01, min_lots: 0.01, step_lots: 0.01, max_lots: 100, bid: 159.834, ask: 159.846 };
const eurusd = { digits: 5, pip_size: 0.0001, min_lots: 0.01, step_lots: 0.01, max_lots: 100, bid: 1.08499, ask: 1.08511 };
const ctx = { balance: 100000, currency: "USD", openCount: 0 };
const demo = (start_balance = 100000) => ({ is_live: false, start_balance });
const order = { side: "sell", order_type: "limit", lots: 5, entry: 159.9, sl: 160.07, tp: 158.71, expires_at: null };
const tpl = (o) => ({ lot_mode: "risk_pct", lot_value: 1, copy_sl: true, copy_tp: true, sl_adjust_pips: 0, tp_adjust_pips: 0, ...o });
const run = (o = {}) => plan({ symbol: "USDJPY", account: demo(), order, tpl: tpl(), sym: usdjpy, ctx, ...o });

// risk 1% of 100k on a 17-pip stop (entry 159.9, stop 160.07), USDJPY pip = 1000 JPY / 159.84
let r = run();
assert.equal(r.ok, true);
assert.equal(r.sl, 160.07); assert.equal(r.tp, 158.71);
assert.ok(Math.abs(r.lots - Math.floor((1000 / (17 * (1000 / 159.84))) * 100) / 100) < 1e-9, "risk lots " + r.lots);
assert.ok(r.riskPct <= 1.0001 && r.riskPct > 0.9, "risk % " + r.riskPct);

// EURUSD: a pip is $10
assert.equal(pipValueUsd("EURUSD", eurusd, "USD"), 10);
assert.equal(pipValueUsd("EURJPY", usdjpy, "USD"), null);   // cross: refused, not guessed
assert.equal(pipValueUsd("EURUSD", eurusd, "EUR"), null);   // non-USD account: refused

// live account, no template, wrong side of the market
assert.equal(run({ account: { is_live: true } }).ok, false);
assert.equal(run({ tpl: null }).reason, "no template chosen");
// the order type follows from the entry against the price (bid 159.834, ask 159.846)
assert.equal(run({ order: { ...order, entry: 159.9 } }).orderType, "limit");   // sell above the bid
assert.equal(run({ order: { ...order, entry: 159.7, sl: 159.9, tp: 159.5 } }).orderType, "stop"); // sell below the bid
assert.equal(run({ order: { ...order, side: "buy", entry: 159.7, sl: 159.5, tp: 159.9 } }).orderType, "limit"); // buy below the ask
assert.equal(run({ order: { ...order, side: "buy", entry: 160.0, sl: 159.8, tp: 160.3 } }).orderType, "stop");  // buy above the ask
assert.match(run({ order: { ...order, entry: 159.834 } }).reason, /equals the current price/);

// fixed, multiplier, scale
assert.equal(run({ tpl: tpl({ lot_mode: "fixed", lot_value: 0.5 }) }).lots, 0.5);
assert.equal(run({ tpl: tpl({ lot_mode: "multiplier", lot_value: 2 }) }).lots, 10);
assert.equal(run({ tpl: tpl({ lot_mode: "size_scale", lot_value: 100000 }), account: demo(25000) }).lots, 1.25);
assert.equal(run({ tpl: tpl({ lot_mode: "size_scale", lot_value: 100000 }), account: demo(1000) }).lots, 0.05);
assert.match(run({ tpl: tpl({ lot_mode: "size_scale", lot_value: 100000 }), account: demo(null) }).reason, /starting size/);
assert.match(run({ tpl: tpl({ lot_mode: "size_scale", lot_value: 100000 }), account: demo(10) }).reason, /minimum/);

// limits
assert.equal(run({ tpl: tpl({ lot_mode: "fixed", lot_value: 500, max_lots: 3 }) }).lots, 3);
assert.match(run({ tpl: tpl({ lot_mode: "fixed", lot_value: 50, max_risk_pct: 1 }) }).reason, /above the template/);
assert.match(run({ tpl: tpl({ lot_mode: "fixed", lot_value: 1, max_risk_pct: 1 }), order: { ...order, sl: null } }).reason, /can't check the risk limit/);
assert.match(run({ tpl: tpl({ max_open: 2 }), ctx: { ...ctx, openCount: 2 } }).reason, /open trades/);

// stop loss rules
assert.match(run({ order: { ...order, sl: null } }).reason, /no stop loss|there is none/);
assert.equal(run({ tpl: tpl({ fixed_sl_pips: 20, fixed_tp_pips: 40, lot_mode: "fixed", lot_value: 1 }) }).sl, 160.1);   // 159.9 + 20 pips (short)
assert.equal(run({ tpl: tpl({ fixed_sl_pips: 20, fixed_tp_pips: 40, lot_mode: "fixed", lot_value: 1 }) }).tp, 159.5);   // 159.9 - 40 pips
assert.equal(run({ tpl: tpl({ sl_adjust_pips: 3, lot_mode: "fixed", lot_value: 1 }) }).sl, 160.1);                         // 17 + 3 = 20 pips
assert.match(run({ tpl: tpl({ sl_adjust_pips: -17, lot_mode: "fixed", lot_value: 1 }) }).reason, /no distance/);
assert.equal(run({ tpl: tpl({ copy_tp: false, lot_mode: "fixed", lot_value: 1 }) }).tp, null);

// expiry
const now = Date.parse("2026-11-16T10:00:00Z");
assert.equal(run({ tpl: tpl({ expiry_hours: 24, lot_mode: "fixed", lot_value: 1 }), now }).expiresAt, now + 24 * 3600e3);
assert.equal(run({ order: { ...order, expires_at: "2026-11-16T12:00:00Z" }, now, tpl: tpl({ lot_mode: "fixed", lot_value: 1 }) }).expiresAt, Date.parse("2026-11-16T12:00:00Z"));
assert.match(run({ order: { ...order, expires_at: "2026-11-16T09:00:00Z" }, now, tpl: tpl({ lot_mode: "fixed", lot_value: 1 }) }).reason, /past/);

// long side mirror
const long = { ...order, side: "buy", entry: 1.084, sl: 1.082, tp: 1.088 };
r = plan({ symbol: "EURUSD", account: demo(), order: long, tpl: tpl(), sym: eurusd, ctx });
assert.equal(r.ok, true);
assert.equal(r.lots, 5);   // 1000 / (20 pips x $10) = 5
assert.equal(r.orderType, "limit");
console.log("plan tests passed");
