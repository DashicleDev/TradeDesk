// Dashboard: the headline numbers and the watchlist: your drafts and the pending orders at the broker, each with how far the price
// is from its entry, live. Uses sb, call, $, h, num, openOrder, pipsBetween (earlier files).
let DRAFTS = [], PENDING = [], ACCT_DATA = []; // filled by loadDrafts (desk.js) and overview (app.js)
const PX = {}; // symbol -> { bid, ask, digits, pip_size, simulated } or null when there is no price
const WATCH_MAX = 6; // symbols priced per round: each one is a call to the function

function renderStats() {
  const acc = ACCT_DATA.filter((a) => !a.error);
  const equity = acc.reduce((s, a) => s + (a.equity || 0), 0);
  const open = acc.reduce((s, a) => s + (a.positions || 0), 0);
  const pend = PENDING.length || acc.reduce((s, a) => s + (a.orders || 0), 0);
  const card = (label, value, sub) => h("div", { className: "stat" }, h("span", { className: "sl", textContent: label }), h("span", { className: "sv", textContent: value }), h("span", { className: "ss", textContent: sub }));
  $("stats").replaceChildren(
    card("Equity", acc.length ? Math.round(equity).toLocaleString() : "–", acc.length ? "all " + acc.length + " account" + (acc.length === 1 ? "" : "s") : "no accounts linked yet"),
    card("Open trades", String(open), open ? "right now" : "nothing open"),
    card("Waiting", String(pend + DRAFTS.length), pend + " pending · " + DRAFTS.length + " draft" + (DRAFTS.length === 1 ? "" : "s")));
}

function watchItems() {
  const items = DRAFTS.map((d) => ({ kind: "draft", d, symbol: d.symbol, side: d.side, entry: Number(d.entry), sl: d.sl, tp: d.tp, ref: d.entry_ref, type: d.order_type,
    meta: (d.targets || []).length ? d.targets.length + (d.targets.length === 1 ? " account" : " accounts") : "no accounts yet" }));
  PENDING.forEach((t) => items.push({ kind: "pending", symbol: t.symbol, side: t.side, entry: Number(t.price), sl: t.sl, tp: t.tp, ref: null, type: t.orderType || "limit", meta: t.account }));
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
  const total = was != null ? Math.abs(it.entry - was) / q.pip_size : 0;
  const done = state !== "waiting" ? 1 : total > 0 ? Math.max(0, Math.min(1, 1 - away / total)) : null; // how much of the way to the entry the price has come
  return { away, state, done, limit, price: price.toFixed(q.digits) };
}

const pipsOf = (it, v) => {
  if (v == null) return "";
  const q = PX[it.symbol];
  return q ? String(Math.round((Math.abs(it.entry - v) / q.pip_size) * 10) / 10) : pipsBetween(it.symbol, it.entry, v);
};

function watchRow(it) {
  const dist = distance(it), sl = pipsOf(it, it.sl), tp = pipsOf(it, it.tp);
  const sub = "entry " + it.entry + (sl ? " · SL " + sl : "") + (tp ? " · TP " + tp : "") + (sl || tp ? " pips" : "");
  let left = "No price yet", right = "", cls = "", bar = null;
  if (dist) {
    left = "Price " + dist.price;
    if (dist.state === "waiting") right = dist.away.toFixed(1) + " pips away";
    else if (dist.state === "at") { right = "At the price"; cls = "warn"; }
    else { right = dist.limit ? "Passed · goes at market" : "Passed"; cls = "warn"; }
    if (dist.done != null) bar = h("div", { className: "wbar " + cls }, h("i", { style: "width:" + Math.round(dist.done * 100) + "%" }));
  }
  const open = it.kind === "draft";
  return h("div", { className: "wrow" + (open ? " click" : ""), tabIndex: open ? 0 : -1, onclick: open ? () => openOrder(it.d) : null, onkeydown: open ? (e) => { if (e.key === "Enter") openOrder(it.d); } : null },
    h("div", { className: "wmain" },
      h("div", { className: "wtitle" }, h("b", { textContent: it.symbol }), h("span", { className: it.side === "buy" ? "long" : "short", textContent: it.side === "buy" ? "long" : "short" }),
        h("span", { className: "wtype", textContent: it.type }), h("span", { className: "pill", textContent: it.kind })),
      h("div", { className: "wsub", textContent: sub })),
    h("div", { className: "wdist" }, h("div", { className: "wtext" }, h("span", { textContent: left }), h("span", { className: cls, textContent: right })), bar || ""),
    h("span", { className: "wmeta", textContent: it.meta }));
}

function renderWatch() {
  const rank = (it) => { const d = distance(it); return !d ? [3, 0] : d.state === "passed" ? [0, d.away] : d.state === "at" ? [1, 0] : [2, d.away]; };
  const items = watchItems().sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; }); // passed first, then the closest
  $("watch").replaceChildren(...(items.length ? items.map(watchRow) : [h("p", { className: "hint", textContent: "Nothing waiting. Tap + to plan an order." })]));
  const priced = Object.values(PX).filter(Boolean);
  $("watchNote").textContent = !items.length || !priced.length ? "" : priced.every((p) => p.simulated) ? "Simulated prices: no cTrader account is linked yet." : "Live prices, updated " + new Date().toLocaleTimeString();
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
