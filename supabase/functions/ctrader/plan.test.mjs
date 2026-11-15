// Run: node supabase/functions/ctrader/plan.test.mjs
import assert from "node:assert/strict";
import { plan, pipValueUsd, conversionPair } from "./plan.mjs";

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
assert.equal(pipValueUsd("EURJPY", usdjpy, "USD"), null);   // cross without a conversion price: refused, not guessed
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
// ---- a limit the price has passed is sent at market; a stop is never chased
// sell limit composed when the bid was 159.834 (entry_ref), entry 159.9
const lim = { ...order, entry: 159.9, entry_ref: 159.834, sl: 160.1, tp: 159.5 };
const fixedTpl = tpl({ lot_mode: "fixed", lot_value: 1 });
r = run({ order: lim, tpl: fixedTpl });
assert.equal(r.orderType, "limit"); assert.equal(r.converted, false);                       // price still below the limit: waiting
// the bid has now risen through 159.9: market, at the bid, SL/TP keep their pip distances (20 pips / 40 pips) from the fill
const through = { ...usdjpy, bid: 159.95, ask: 159.962 };
r = run({ order: lim, tpl: fixedTpl, sym: through });
assert.equal(r.orderType, "market"); assert.equal(r.converted, true);
assert.equal(r.entry, 159.95); assert.equal(r.limitEntry, 159.9);
assert.equal(r.sl, 160.15); assert.equal(r.tp, 159.55);                                      // 159.95 + 20 pips, 159.95 - 40 pips
assert.equal(r.slPips, 20); assert.equal(r.tpPips, 40);
assert.equal(r.expiresAt, null, "market orders carry no expiry");
// buy limit composed at ask 159.846, entry 159.7; the ask drops to 159.6: fills at market, better than the limit
const bl = { ...order, side: "buy", entry: 159.7, entry_ref: 159.846, sl: 159.5, tp: 160.0 };
assert.equal(run({ order: bl, tpl: fixedTpl }).orderType, "limit");
r = run({ order: bl, tpl: fixedTpl, sym: { ...usdjpy, bid: 159.588, ask: 159.6 } });
assert.equal(r.orderType, "market"); assert.equal(r.entry, 159.6); assert.equal(r.sl, 159.4); assert.equal(r.tp, 159.9);
// exactly at the limit counts as reached
assert.equal(run({ order: bl, tpl: fixedTpl, sym: { ...usdjpy, bid: 159.688, ask: 159.7 } }).orderType, "market");
// a stop (entry on the far side of the reference): waits, and is refused (not chased) once the price has gone through it
const st = { ...order, entry: 159.7, entry_ref: 159.834, sl: 159.9, tp: 159.4 };            // sell stop below the bid
assert.equal(run({ order: st, tpl: fixedTpl }).orderType, "stop");
assert.match(run({ order: st, tpl: fixedTpl, sym: { ...usdjpy, bid: 159.65, ask: 159.662 } }).reason, /not chasing/);
// without a reference price the old rule holds: judged against the market now, never converted
r = run({ order: { ...order, entry: 159.7, sl: 159.9, tp: 159.4 }, tpl: fixedTpl });
assert.equal(r.orderType, "stop"); assert.equal(r.converted, false);

// ---- crosses: the quote currency is converted to USD with its own pair
assert.deepEqual(conversionPair("EURJPY"), { symbol: "USDJPY", direct: false });
assert.deepEqual(conversionPair("GBPCHF"), { symbol: "USDCHF", direct: false });
assert.deepEqual(conversionPair("EURGBP"), { symbol: "GBPUSD", direct: true });
assert.deepEqual(conversionPair("AUDNZD"), { symbol: "NZDUSD", direct: true });
assert.equal(conversionPair("EURUSD"), null); assert.equal(conversionPair("USDJPY"), null); assert.equal(conversionPair("XAUUSD"), null);
const eurjpy = { digits: 3, pip_size: 0.01, min_lots: 0.01, step_lots: 0.01, max_lots: 100, bid: 173.4, ask: 173.412 };
const usdjpyConv = { bid: 159.834, ask: 159.846, direct: false };
// EURJPY: 1,000 JPY a pip per lot, / 159.84 = $6.256
assert.ok(Math.abs(pipValueUsd("EURJPY", eurjpy, "USD", usdjpyConv) - 1000 / 159.84) < 1e-9);
// EURGBP: 10 GBP a pip per lot x GBPUSD 1.275 = $12.75
assert.ok(Math.abs(pipValueUsd("EURGBP", { ...eurusd, pip_size: 0.0001 }, "USD", { bid: 1.2749, ask: 1.2751, direct: true }) - 12.75) < 1e-9);
// a risk-sized EURJPY order now works with the conversion, and is refused without it
const jOrder = { side: "sell", lots: 5, entry: 173.6, entry_ref: 173.4, sl: 173.9, tp: 173.0 }; // 30 pip stop
r = plan({ symbol: "EURJPY", account: demo(), order: jOrder, tpl: tpl(), sym: eurjpy, ctx: { ...ctx, conv: usdjpyConv } });
assert.equal(r.ok, true, r.reason);
assert.ok(Math.abs(r.lots - Math.floor(1000 / (30 * (1000 / 159.84)) * 100) / 100) < 1e-9, "cross lots " + r.lots);
assert.match(plan({ symbol: "EURJPY", account: demo(), order: jOrder, tpl: tpl(), sym: eurjpy, ctx }).reason, /pip value/);

console.log("plan tests passed");
