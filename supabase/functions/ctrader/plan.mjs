// Sizing and safety checks for one order on one account. Pure (no network, no database) so it can be tested on its own.
// Used by both "review" (what the confirm screen shows) and "send" (what actually goes out): the server decides, the page only displays.
//
// account: { is_live, start_balance }
// order:   { side: "buy"|"sell", lots, entry, entry_ref, sl, tp, expires_at }   (the order type is derived here, not read from the order)
// tpl:     a td_templates row
// sym:     { digits, pip_size, min_lots, step_lots, max_lots, bid, ask }
// ctx:     { balance, currency, openCount }  (the account's current state)

// Pip value in USD per 1 lot. Only for pairs containing USD on a USD account, with a standard contract
// (100,000 units, gold 100 oz). shortcut: anything else is refused, not guessed; broker conversion rates are a later step.
export function pipValueUsd(symbol, sym, currency) {
  if (currency !== "USD") return null;
  const pipUnits = (symbol.startsWith("XAU") ? 100 : 100000) * sym.pip_size;
  if (symbol.endsWith("USD")) return pipUnits;
  if (symbol.startsWith("USD")) return pipUnits / ((sym.bid + sym.ask) / 2);
  return null;
}

const block = (reason) => ({ ok: false, reason });

export function plan({ symbol, account, order, tpl, sym, ctx, now = Date.now() }) {
  if (account.is_live) return block("live accounts arrive in step 4");
  if (!tpl) return block("no template chosen");
  const buy = order.side === "buy", pip = sym.pip_size;
  const entry = Number(Number(order.entry).toFixed(sym.digits));

  // What the order was meant as: a limit if the entry sat on the better side of the market when it was set (entry_ref), else a stop.
  // Without that reference price (the page had no live price) it is judged against the market now, and never converted.
  const ref = buy ? sym.ask : sym.bid;          // what you would pay or receive right now
  if (order.entry_ref == null && entry === ref) return block("the entry equals the current price: move it away from the market");
  const was = order.entry_ref != null ? Number(order.entry_ref) : ref;
  const meant = (buy ? entry < was : entry > was) ? "limit" : "stop";
  let orderType = meant, converted = false;
  if (meant === "limit") {
    const waiting = buy ? entry < ref : entry > ref;          // the price has not reached the limit yet
    if (!waiting) {
      if (order.entry_ref == null) return block("the entry equals the current price: move it away from the market");
      // The price has passed the limit: the market is at the limit or better, so send at market instead. SL and TP keep their
      // pip distances from the fill (a market order takes them relative to the fill price, not as absolute prices).
      orderType = "market"; converted = true;
    }
  } else if (!(buy ? entry > ref : entry < ref)) {
    return block("the price has already passed your stop entry: not chasing it, move the entry");  // a market fill would be a worse price
  }
  const base = orderType === "market" ? ref : entry; // where SL and TP are measured from

  // stop loss / take profit: the template's fixed value, or the order's own, then the adjustment
  const leg = (own, fixedPips, copy, adjust, dir) => {
    let pips = fixedPips ?? (copy && own != null ? Math.abs(entry - own) / pip : null);
    if (pips == null) return { pips: null, price: null };
    pips = Number((pips + (adjust || 0)).toFixed(4)); // distances come from subtracting prices: strip the float noise
    if (pips <= 0) return { bad: true };
    return { pips, price: Number((base + dir * pips * pip).toFixed(sym.digits)) };
  };
  const slDir = buy ? -1 : 1;
  const sl = leg(order.sl, tpl.fixed_sl_pips, tpl.copy_sl, tpl.sl_adjust_pips, slDir);
  const tp = leg(order.tp, tpl.fixed_tp_pips, tpl.copy_tp, tpl.tp_adjust_pips, -slDir);
  if (sl.bad) return block("the stop loss adjustment leaves no distance");
  if (tp.bad) return block("the take profit adjustment leaves no distance");

  const riskMode = tpl.lot_mode === "risk_pct" || tpl.lot_mode === "balance_pct";
  const pv = pipValueUsd(symbol, sym, ctx.currency);

  // lots
  let lots;
  if (tpl.lot_mode === "fixed") lots = Number(tpl.lot_value);
  else if (tpl.lot_mode === "multiplier") lots = order.lots * tpl.lot_value;
  else if (tpl.lot_mode === "size_scale") {
    if (!account.start_balance) return block("set this account's starting size");
    lots = (order.lots * account.start_balance) / tpl.lot_value;
  } else if (riskMode) {
    if (sl.pips == null) return block("this template sizes from the stop loss, and there is none");
    const base = tpl.lot_mode === "risk_pct" ? account.start_balance : ctx.balance;
    if (!base) return block(tpl.lot_mode === "risk_pct" ? "set this account's starting size" : "the account balance is unknown");
    if (!pv) return block("pip value isn't supported yet for this pair or account currency");
    lots = (base * tpl.lot_value) / 100 / (sl.pips * pv);
  } else return block("unknown lot size rule");

  if (tpl.max_lots) lots = Math.min(lots, tpl.max_lots);
  if (tpl.min_lots) lots = Math.max(lots, tpl.min_lots);
  lots = Math.floor(Math.min(lots, sym.max_lots) / sym.step_lots + 1e-9) * sym.step_lots; // round down to the broker's lot step
  lots = Number(lots.toFixed(8));
  if (!(lots >= sym.min_lots - 1e-12)) return block("below the broker's minimum lot size");

  // risk in money and % (only when it can be known)
  const riskMoney = sl.pips != null && pv ? lots * sl.pips * pv : null;
  const riskPct = riskMoney != null && account.start_balance ? (riskMoney / account.start_balance) * 100 : null;

  // the template's hard limits
  if (tpl.max_risk_pct) {
    if (riskPct == null) return block("can't check the risk limit: it needs a stop loss, a starting size and a known pip value");
    if (riskPct > tpl.max_risk_pct + 1e-9) return block(`risk ${riskPct.toFixed(2)}% is above the template's ${tpl.max_risk_pct}% limit`);
  }
  if (tpl.max_open && ctx.openCount >= tpl.max_open) return block(`already ${ctx.openCount} open trades (limit ${tpl.max_open})`);

  // a market order fills at once, so an expiry means nothing for it
  const expiresAt = orderType === "market" ? null : order.expires_at ? Date.parse(order.expires_at) : tpl.expiry_hours ? now + tpl.expiry_hours * 3600e3 : null;
  if (expiresAt != null && expiresAt <= now) return block("the expiry is in the past");

  return { ok: true, orderType, converted, limitEntry: entry, entry: base, sl: sl.price, tp: tp.price, slPips: sl.pips, tpPips: tp.pips, lots, expiresAt, riskMoney, riskPct };
}
