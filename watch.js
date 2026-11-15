// Dashboard: the headline numbers and the watchlist: your drafts and the pending orders at the broker, each with how far the price
// is from its entry, live. Uses sb, call, $, h, num, openOrder, pipsBetween (earlier files).
let DRAFTS = [], PENDING = [], POSITIONS = [], ACCT_DATA = []; // filled by loadDrafts (desk.js) and overview (app.js)
const PX = {}; // symbol -> { bid, ask, digits, pip_size, simulated } or null when there is no price
const WATCH_MAX = 6; // symbols priced per round: each one is a call to the function

// The one number up top: what the running positions are worth now, summed (pairs whose pip value is unknown are left out).
// Equity summed over accounts says little, and the accounts table has each one.
// Floating result of a list of running trades in dollars; pairs whose pip value is unknown are left out (null when none could be valued).
function floating(trades) {
  let sum = null;
  for (const t of trades) {
    const q = PX[t.symbol], pv = q && pipValueUsd(t.symbol, q);
    if (!pv) continue;
    sum = (sum ?? 0) + Number(t.lots) * ((t.side === "buy" ? q.bid - t.price : t.price - q.ask) / q.pip_size) * pv;
  }
  return sum;
}
const sign = (v) => (v == null ? "muted" : v >= 0 ? "long" : "short");

// Top of the dashboard: the total, then one small tile per account (balance, open trades, what they are worth now).
function renderStats() {
  const total = floating(POSITIONS), open = POSITIONS.length, wait = PENDING.length + DRAFTS.length;
  const hero = h("div", { className: "hero" },
    h("span", { className: "hl", textContent: "Floating P/L" }),
    h("span", { className: "hv " + sign(total), textContent: total == null ? (open ? "–" : "No open trades") : money(total) }),
    h("span", { className: "hs", textContent: open + " open · " + wait + " waiting" }));
  const tiles = ACCT_DATA.map((a) => {
    if (a.error) return h("div", { className: "stat" }, h("span", { className: "sl", textContent: a.label }), h("span", { className: "ss", textContent: a.error }));
    const pos = (a.trades || []).filter((t) => t.kind === "position"), pnl = floating(pos);
    return h("div", { className: "stat" },
      h("span", { className: "sl" }, a.label.replace(/^MOCK /, ""), h("span", { className: "pill " + (a.is_live ? "warn" : "ok"), textContent: a.is_live ? "live" : "demo" })),
      h("span", { className: "sv " + sign(pnl), textContent: pnl == null ? (pos.length ? "–" : "flat") : money(pnl) }),
      h("span", { className: "ss", textContent: Math.round(a.balance).toLocaleString("en-US") + " · " + pos.length + " open" + (a.orders ? " · " + a.orders + " pending" : "") }));
  });
  $("stats").replaceChildren(hero); // shortcut: per-account tiles (the `tiles` list) were tried and dropped; delete them if nobody wants them back
}

function watchItems() {
  const items = DRAFTS.map((d) => ({ kind: "draft", d, symbol: d.symbol, side: d.side, entry: Number(d.entry), sl: d.sl, tp: d.tp, ref: d.entry_ref, type: d.order_type,
    meta: (d.targets || []).length ? d.targets.length + (d.targets.length === 1 ? " account" : " accounts") : "no accounts yet" }));
  // the same trade on several accounts is one row: same pair, side, entry, SL and TP
  const groups = new Map();
  const add = (kind, t) => {
    const key = [kind, t.symbol, t.side, t.price, t.sl, t.tp, t.orderType].join("|");
    if (!groups.has(key)) { const g = { kind, ts: [], symbol: t.symbol, side: t.side, entry: Number(t.price), sl: t.sl, tp: t.tp, ref: null, type: t.orderType || "limit" }; groups.set(key, g); items.push(g); }
    groups.get(key).ts.push(t);
  };
  PENDING.forEach((t) => add("pending", t));
  POSITIONS.forEach((t) => add("position", t));
  return items;
}

// Where the price is against the entry. A limit waits for the price to come to it, a stop for the price to break through; the intent
// comes from the market price the entry was set against (entry_ref), like on the server.
function distance(it) {
  const q = PX[it.symbol];
  if (!q) return null;
  const buy = it.side === "buy", price = buy ? q.ask : q.bid;
  const was = it.ref != null ? Number(it.ref) : null;
  const limit = was != null ? (buy ? it.entry < was : it.entry > was) : it.type !== "stop";
  const waiting = limit ? (buy ? it.entry < price : it.entry > price) : (buy ? it.entry > price : it.entry < price);
  const away = Math.abs(it.entry - price) / q.pip_size;
  const state = away < 1e-9 ? "at" : waiting ? "waiting" : "passed";
  return { away, state, limit, price: price.toFixed(q.digits) };
}

const pipsOf = (it, v) => {
  if (v == null) return "";
  const q = PX[it.symbol];
  return q ? String(Math.round((Math.abs(it.entry - v) / q.pip_size) * 10) / 10) : pipsBetween(it.symbol, it.entry, v);
};


const go = (it) => (it.kind === "draft" ? openOrder(it.d) : openManage(it));
function watchRow(it) {
  const sl = pipsOf(it, it.sl), tp = pipsOf(it, it.tp);
  const sub = "entry " + it.entry + (sl ? " \u00b7 SL " + sl : "") + (tp ? " \u00b7 TP " + tp : "") + (sl || tp ? " pips" : "");
  let left = "No price yet", right = "", cls = "", detail = null;
  const q = PX[it.symbol];
  if (it.kind === "position") {
    if (q) { // floating result in pips: a long closes at the bid, a short at the ask
      const pips = (it.side === "buy" ? q.bid - it.entry : it.entry - q.ask) / q.pip_size;
      left = "Price " + (it.side === "buy" ? q.bid : q.ask).toFixed(q.digits);
      right = (pips >= 0 ? "+" : "") + pips.toFixed(1) + " pips"; cls = pips >= 0 ? "long" : "short";
      detail = positionDetail(it, q, pips);
      if (detail.total != null) right = money(detail.total);
      detail = detail.el;
    }
  } else {
    const dist = distance(it);
    if (dist) {
      left = "Price " + dist.price;
      if (dist.state === "waiting") right = dist.away.toFixed(1) + " pips away";
      else if (dist.state === "at") { right = "At the price"; cls = "warn"; }
      else { right = dist.limit ? "Passed \u00b7 goes at market" : "Passed"; cls = "warn"; }
    }
  }
  if (it.kind === "pending" && q) detail = pendingDetail(it, q);
  const names = it.ts ? it.ts.map((t) => h("span", { className: "chip", textContent: t.account.replace(/^MOCK /, "") + " · " + t.lots })) : [h("span", { className: "chip", textContent: it.meta })];
  return h("div", { className: "wrow click", tabIndex: 0, onclick: () => go(it), onkeydown: (e) => { if (e.key === "Enter") go(it); } },
    h("div", { className: "wl" },
      h("div", { className: "wtitle" }, h("b", { textContent: it.symbol }), h("span", { className: it.side === "buy" ? "long" : "short", textContent: it.kind === "position" ? (it.side === "buy" ? "long" : "short") : (it.side === "buy" ? "Buy " : "Sell ") + it.type }), it.ts && it.ts[0].sim ? h("span", { className: "pill", textContent: "sim" }) : ""),
      it.kind === "draft" ? h("div", { className: "wfoot", textContent: "entry " + it.entry + " · " + it.meta }) : "",
      ""),
    h("div", { className: "wr" }, h("div", { className: "wbig " + cls, textContent: right || "–" })),
    detail || "");
}

const money = (v) => (v < 0 ? "−" : "+") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Under a running position: how far the price is between the stop loss and the take profit, and each account's running result.
// Left is always the loss side and right the profit side, for longs and shorts alike.
const foot = (n, extra) => h("div", { className: "wfoot", textContent: [n + (n === 1 ? " account" : " accounts"), extra].filter(Boolean).join(" · ") });
const zoneBg = (at, sl, tp) => "background:linear-gradient(to right," + (sl ? "color-mix(in srgb,var(--bad) 55%,transparent)" : "var(--soft)") + " " + at + "%," + (tp ? "color-mix(in srgb,var(--good) 55%,transparent)" : "var(--soft)") + " " + at + "%)";
const noLegs = (sl, tp) => (sl != null && tp != null ? "" : h("div", { className: "plabels" }, h("span", { textContent: sl == null ? "No stop loss" : "" }), h("span", { textContent: tp == null ? "No take profit" : "" })));

// Under an active order: the planned trade (SL .. entry .. TP) with a dot for where the price is now, so the gap to the entry is visible.
function pendingDetail(it, q) {
  const buy = it.side === "buy", price = buy ? q.ask : q.bid;
  const from = (buy ? price - it.entry : it.entry - price) / q.pip_size; // where the price sits against the entry, as profit pips of a trade opened there
  const slP = it.sl != null ? Math.abs(it.entry - it.sl) / q.pip_size : null, tpP = it.tp != null ? Math.abs(it.tp - it.entry) / q.pip_size : null;
  const L = Math.max(slP ?? 10, -from * 1.15, 10), R = Math.max(tpP ?? 10, from * 1.15, 10), at = (L / (L + R)) * 100, mark = ((L + from) / (L + R)) * 100;
  const bar = h("div", { className: "pbar" },
    h("div", { className: "ptrack", style: zoneBg(at, slP != null, tpP != null) },
      h("i", { className: "pentry", style: "left:" + at + "%" }), h("i", { className: "pmark now", style: "left:" + mark + "%" })), noLegs(slP, tpP));
  return h("div", { className: "wdetail" }, bar, foot(it.ts.length));
}

function positionDetail(it, q, pips) {
  const slP = it.sl != null ? Math.abs(it.entry - it.sl) / q.pip_size : null, tpP = it.tp != null ? Math.abs(it.tp - it.entry) / q.pip_size : null;
  const pad = Math.max(10, Math.abs(pips) * 1.3); // no SL or TP set: show a neutral stretch instead
  const L = slP ?? pad, R = tpP ?? pad, at = (L / (L + R)) * 100;
  const mark = ((L + Math.max(-L, Math.min(R, pips))) / (L + R)) * 100;
  const bar = h("div", { className: "pbar" },
    h("div", { className: "ptrack", style: zoneBg(at, slP != null, tpP != null) },
      h("i", { className: "pentry", style: "left:" + at + "%" }), h("i", { className: "pmark " + (pips >= 0 ? "up" : "down"), style: "left:" + mark + "%" })), noLegs(slP, tpP));
  const pv = pipValueUsd(it.symbol, q);
  let total = null;
  const rows = it.ts.map((t) => {
    const amt = pv ? Number(t.lots) * pips * pv : null;
    if (amt != null) total = (total ?? 0) + amt;
    return h("div", { className: "pacct" }, h("span", { textContent: t.account.replace(/^MOCK /, "") }), h("span", { className: "muted", textContent: t.lots + " lots" }),
      h("span", { className: "pamt " + (pips >= 0 ? "long" : "short"), textContent: amt != null ? money(amt) : (pips >= 0 ? "+" : "") + pips.toFixed(1) + " pips" }));
  });
  return { total, el: h("div", { className: "wdetail" }, bar, foot(it.ts.length, (pips >= 0 ? "+" : "") + pips.toFixed(1) + " pips")) };
}

function renderWatch() {
  const rank = (it) => { const d = distance(it); return !d ? [3, 0] : d.state === "passed" ? [0, d.away] : d.state === "at" ? [1, 0] : [2, d.away]; };
  const all = watchItems(), of = (k) => all.filter((i) => i.kind === k).sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; }); // passed first, then the closest
  const fill = (id, list, none) => $(id).replaceChildren(...(list.length ? list.map(watchRow) : [h("p", { className: "hint", textContent: none })]));
  fill("pos", of("position"), "");
  $("posPanel").hidden = !POSITIONS.length;
  fill("pend", of("pending"), ""); fill("drafts", of("draft"), "");
  const none = !all.length;
  $("pendPanel").hidden = !of("pending").length; $("draftPanel").hidden = none ? false : !of("draft").length;
  const both = !$("posPanel").hidden && !$("pendPanel").hidden; // two panels sit side by side, one alone takes the full width
  $("posPanel").classList.toggle("solo", !both); $("pendPanel").classList.toggle("solo", !both);
  if (none) $("drafts").replaceChildren(h("p", { className: "hint", textContent: "Nothing yet. Tap + to plan an order." }));
  renderStats();
  const priced = Object.values(PX).filter(Boolean);
  $("watchNote").textContent = !priced.length ? "" : priced.every((p) => p.simulated) ? "Simulated prices: no cTrader account is linked yet." : "Live prices, updated " + new Date().toLocaleTimeString();
}

let priceBusy = false;
async function refreshPrices() {
  if (priceBusy) return;
  const syms = [...new Set(watchItems().map((i) => i.symbol))].slice(0, WATCH_MAX);
  if (!syms.length) return;
  priceBusy = true;
  await Promise.all(syms.map(async (s) => {
    try { const r = await call("quote", { symbol: s }); PX[s] = { ...r.quote, simulated: r.simulated }; } catch { PX[s] = null; }
  }));
  priceBusy = false; renderWatch();
}
// every 8 s while the dashboard is in front: not in a background tab, and not while a form is open (the ticket polls its own pair)
setInterval(() => { if (document.hidden || $("main").hidden || $("tDash").hidden || document.querySelector(".sheet:not([hidden])")) return; refreshPrices(); }, 8000);
