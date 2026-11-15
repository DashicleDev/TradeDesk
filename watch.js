// Dashboard: the headline numbers and the watchlist: your drafts and the pending orders at the broker, each with how far the price
// is from its entry, live. Uses sb, call, $, h, num, openOrder, pipsBetween (earlier files).
let DRAFTS = [], PENDING = [], POSITIONS = [], ACCT_DATA = []; // filled by loadDrafts (desk.js) and overview (app.js)
const PX = {}; // symbol -> { bid, ask, digits, pip_size, simulated } or null when there is no price
const WATCH_MAX = 6; // symbols priced per round: each one is a call to the function

function renderStats() {
  const acc = ACCT_DATA.filter((a) => !a.error);
  const equity = acc.reduce((s, a) => s + (a.equity || 0), 0);
  const open = POSITIONS.length || acc.reduce((s, a) => s + (a.positions || 0), 0);
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
  const sub = (it.ts ? it.ts.map((t) => t.lots).join(" + ") + " lots \u00b7 " : "") + "entry " + it.entry + (sl ? " \u00b7 SL " + sl : "") + (tp ? " \u00b7 TP " + tp : "") + (sl || tp ? " pips" : "");
  let left = "No price yet", right = "", cls = "", btns = [];
  const q = PX[it.symbol];
  if (it.kind === "position") {
    if (q) { // floating result in pips: a long closes at the bid, a short at the ask
      const pips = (it.side === "buy" ? q.bid - it.entry : it.entry - q.ask) / q.pip_size;
      left = "Price " + (it.side === "buy" ? q.bid : q.ask).toFixed(q.digits);
      right = (pips >= 0 ? "+" : "") + pips.toFixed(1) + " pips"; cls = pips >= 0 ? "long" : "short";
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
  const open = true; // drafts open the ticket, running and pending trades open the manage menu
  return h("div", { className: "wrow" + (open ? " click" : ""), tabIndex: open ? 0 : -1, onclick: () => go(it), onkeydown: (e) => { if (e.key === "Enter") go(it); } },
    h("div", { className: "wmain" },
      h("div", { className: "wtitle" }, h("b", { textContent: it.symbol }), h("span", { className: it.side === "buy" ? "long" : "short", textContent: it.side === "buy" ? "long" : "short" }),
        h("span", { className: "wtype", textContent: it.kind === "position" ? "" : it.type }), it.ts && it.ts[0].sim ? h("span", { className: "pill", textContent: "sim" }) : ""),
      h("div", { className: "wsub", textContent: sub })),
    h("div", { className: "wtext" }, h("span", { textContent: left }), h("span", { className: cls, textContent: right })),
    h("div", { className: "wmeta" }, h("span", { textContent: it.meta || it.ts.map((t) => t.account).join(", ") }), ...btns));
}

function renderWatch() {
  const rank = (it) => { const d = distance(it); return !d ? [3, 0] : d.state === "passed" ? [0, d.away] : d.state === "at" ? [1, 0] : [2, d.away]; };
  const all = watchItems(), of = (k) => all.filter((i) => i.kind === k).sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; }); // passed first, then the closest
  const fill = (id, list, none) => $(id).replaceChildren(...(list.length ? list.map(watchRow) : [h("p", { className: "hint", textContent: none })]));
  fill("pos", of("position"), "");
  $("posPanel").hidden = !POSITIONS.length;
  fill("pend", of("pending"), "No pending orders. Send a draft to an account to see it here.");
  fill("drafts", of("draft"), "No drafts. Tap + to plan an order.");
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
