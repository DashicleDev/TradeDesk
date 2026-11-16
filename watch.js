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

// The total of the running positions, in the header of their section.
function renderStats() {
  const total = floating(POSITIONS), el = $("posTotal");
  el.className = "btotal " + sign(total);
  el.textContent = total == null ? "" : money(total);
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

const money = (v) => (v < 0 ? "−" : "+") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const go = (it) => (it.kind === "draft" ? openOrder(it.d) : openManage(it));
const plural = (n) => n + (n === 1 ? " account" : " accounts");

const zoneBg = (at, sl, tp) => "background:linear-gradient(to right," + (sl ? "color-mix(in srgb,var(--bad) 55%,transparent)" : "var(--soft)") + " " + at + "%," + (tp ? "color-mix(in srgb,var(--good) 55%,transparent)" : "var(--soft)") + " " + at + "%)";
const noLegs = (sl, tp) => (sl != null && tp != null ? "" : h("div", { className: "plabels" }, h("span", { textContent: sl == null ? "No stop loss" : "" }), h("span", { textContent: tp == null ? "No take profit" : "" })));

// One trade as a track: stop loss zone on the left, the entry line, take profit zone on the right. The dot is where the price is now and
// its label rides above it: dollars for a running position, the gap for a pending order. Left is always the loss side, longs and shorts alike.
function track(it, q) {
  const buy = it.side === "buy", pend = it.kind === "pending";
  const price = pend ? (buy ? q.ask : q.bid) : (buy ? q.bid : q.ask); // a long closes at the bid, a short at the ask
  const from = ((price - it.entry) * (buy ? 1 : -1)) / q.pip_size; // profit pips a trade opened at the entry would show at this price
  const slS = it.sl != null ? (buy ? it.entry - it.sl : it.sl - it.entry) / q.pip_size : null; // zero or negative: breakeven, or profit locked in
  const locked = slS != null && slS <= 0, slP = slS != null && !locked ? slS : null;
  const tpP = it.tp != null ? Math.abs(it.tp - it.entry) / q.pip_size : null, pad = Math.max(10, Math.abs(from) * 1.3); // no SL or TP: a neutral stretch
  const L = pend ? Math.max(slP ?? 10, -from * 1.15, 10) : locked ? 0.0001 : slP ?? pad;
  const R = pend ? Math.max(tpP ?? 10, from * 1.15, 10) : Math.max(tpP ?? pad, locked ? -slS * 1.3 : 0);
  const at = (L / (L + R)) * 100, mark = ((L + (pend ? from : Math.max(-L, Math.min(R, from)))) / (L + R)) * 100;
  let label, cls = "";
  if (pend) {
    const d = distance(it);
    if (d.state === "waiting") label = d.away.toFixed(1) + " pips away";
    else { label = d.state === "at" ? "At the price" : d.limit ? "Passed: goes at market" : "Passed"; cls = "warn"; }
  } else {
    const usd = floating(it.ts);
    label = usd != null ? money(usd) : (from >= 0 ? "+" : "") + from.toFixed(1) + " pips"; cls = from >= 0 ? "long" : "short";
  }
  return h("div", { className: "btrack" },
    h("div", { className: "bbub " + cls, style: "--m:" + mark + "%", textContent: label }),
    h("div", { className: "bbar", style: zoneBg(at, slP != null, tpP != null) },
      h("i", { className: "bentry", style: "left:" + at + "%" }),
      locked ? h("i", { className: "bstop", style: "left:" + ((L - slS) / (L + R)) * 100 + "%" }) : "",
      h("i", { className: "bmark " + (pend ? "" : from >= 0 ? "up" : "down"), style: "left:" + mark + "%" })),
    noLegs(it.sl != null ? 1 : null, tpP));
}

function watchRow(it) {
  const buy = it.side === "buy", q = PX[it.symbol], word = it.kind === "position" ? (buy ? "long" : "short") : (buy ? "Buy " : "Sell ") + it.type;
  const head = h("div", { className: "bhd" },
    h("b", { className: "bsym", textContent: it.symbol }), h("span", { className: "bside " + (buy ? "long" : "short"), textContent: word }),
    h("span", { className: "bacc", textContent: it.ts ? plural(it.ts.length) : it.meta }));
  let body = "";
  if (it.kind === "draft") { // a draft has no trade yet: just how far the entry is from the price
    const d = distance(it);
    if (d) head.append(h("span", { className: "bgap " + (d.state === "waiting" ? "" : "warn"), textContent: d.state === "waiting" ? d.away.toFixed(1) + " pips away" : d.state === "at" ? "At the price" : "Passed" }));
  } else if (q) body = track(it, q);
  else body = h("div", { className: "bwait", textContent: "Waiting for a price" });
  const note = it.kind === "draft" ? it.d.note : (it.ts.find((t) => t.note) || {}).note;
  return h("div", { className: "bx click", tabIndex: 0, onclick: () => go(it), onkeydown: (e) => { if (e.key === "Enter") go(it); } }, head, note ? h("div", { className: "bnote", textContent: note }) : "", body);
}

function renderWatch() {
  const rank = (it) => { const d = distance(it); return !d ? [3, 0] : d.state === "passed" ? [0, d.away] : d.state === "at" ? [1, 0] : [2, d.away]; };
  const all = watchItems(), of = (k) => all.filter((i) => i.kind === k).sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; }); // passed first, then the closest
  const fill = (id, list) => $(id).replaceChildren(...list.map(watchRow));
  fill("pos", of("position")); fill("pend", of("pending")); fill("drafts", of("draft"));
  const none = !all.length;
  $("posPanel").hidden = !POSITIONS.length; $("pendPanel").hidden = !of("pending").length; $("draftPanel").hidden = none ? false : !of("draft").length;
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

// Coming back to the app (phones freeze timers while it is in the background): refresh at once instead of waiting for the next tick.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("main").hidden && !document.querySelector(".sheet:not([hidden])")) overview();
});
