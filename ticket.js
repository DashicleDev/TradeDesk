// Order ticket (bottom sheet): live price through the function, SL/TP in pips or price, entry distance from market.
// Only prices are saved. Uses sb, $, msg, call (app.js) and num, h, loadDrafts (desk.js).
const sheet = $("orderSheet");
const oe = $("orderForm").elements;
const POLL_MS = 4000;
const TK = { autoLots: true, baseline: null, editing: null, entryTouched: false, quote: null, simulated: false, account: "", timer: null, busy: false, src: { sl: "pips", tp: "pips" }, keep: {}, pipTouched: false };

const side = () => oe.side.value; // "buy" | "sell" | "" until chosen
const pip = () => num(oe.pip.value);
const market = () => (TK.quote && side() ? (side() === "buy" ? TK.quote.ask : TK.quote.bid) : null); // you buy at the ask, sell at the bid
const decs = (p) => Math.max(0, Math.round(-Math.log10(p))) + 1;
const dec = () => TK.quote?.digits ?? (pip() ? decs(pip()) : 5);
const guessPip = (s) => { s = s.toUpperCase(); return s.includes("JPY") ? 0.01 : s.startsWith("XAU") ? 0.1 : 0.0001; }; // shortcut: only until a live price brings the broker's pip size

function setLive(text, cls = "") { const e = $("liveLine"); e.textContent = text; e.className = "msg " + cls; e.style.display = "block"; }

// ---- entry: distance from market, direction rule, stepper
// The order type follows from the entry against the current price: a buy below it (or a sell above it) is a limit order, the
// other side a stop order. The server decides the same way when it sends; here it is only shown.
const orderTypeFor = (e, m) => (side() === "buy" ? (e < m ? "limit" : "stop") : (e > m ? "limit" : "stop"));
const orderTypeNow = () => { const e = num(oe.entry.value), m = market(); return e != null && m != null && e !== m ? orderTypeFor(e, m) : "limit"; };
function updateEntry() {
  const e = num(oe.entry.value), m = market(), p = pip();
  oe.entry.setCustomValidity("");
  const d = $("dist"); d.className = "fh"; oe.entry.classList.remove("flag");
  if (e == null || m == null || !p || !side()) { d.textContent = ""; return; }
  const dist = (e - m) / p;
  if (dist === 0) { // sitting exactly on the market is neither a limit nor a stop: blocks saving, quietly until you touch it
    const text = "Move the entry away from the market.";
    d.textContent = text; oe.entry.setCustomValidity(text); if (TK.entryTouched) d.className = "fh warn";
    return;
  }
  const flag = side() === "sell" ? dist > 0 : dist < 0; // a sell above the market or a buy below it: marked red
  if (flag) { d.className = "fh warn"; oe.entry.classList.add("flag"); }
  d.textContent = (side() === "buy" ? "Buy " : "Sell ") + orderTypeFor(e, m) + " \u00b7 " + Math.abs(dist).toFixed(1) + " pips " + (dist > 0 ? "above" : "below") + " the market";
}
function step(dir) {
  const p = pip(); if (!p) return;
  const base = num(oe.entry.value) ?? market(); if (base == null) return;
  oe.entry.value = (base + dir * p).toFixed(dec());
  oe.entry.dispatchEvent(new Event("input", { bubbles: true }));
}
$("entryUp").onclick = () => step(1);
$("entryDown").onclick = () => step(-1);

// ---- stop loss / take profit: pips and price follow each other
function syncLeg(k) {
  const on = oe[k + "_on"].checked;
  $(k + "Box").hidden = !on;
  oe[k].setCustomValidity("");
  if (!on) { oe[k].value = oe[k + "_pips"].value = ""; return; }
  const entry = num(oe.entry.value), p = pip();
  if (entry == null || !p || !side()) return;
  const long = side() === "buy";
  const dir = k === "sl" ? (long ? -1 : 1) : (long ? 1 : -1); // which side of the entry this leg belongs on
  if (TK.src[k] === "pips") {
    const v = num(oe[k + "_pips"].value);
    oe[k].value = v == null ? "" : (entry + dir * (k === "sl" ? -v : Math.abs(v)) * p).toFixed(dec());
  } else {
    const price = num(oe[k].value);
    if (price == null) return void (oe[k + "_pips"].value = "");
    const v = ((price - entry) / p) * dir; // negative = wrong side of the entry
    oe[k + "_pips"].value = (k === "sl" ? -v : v).toFixed(1);
    if (v <= 0) oe[k].setCustomValidity(k === "sl" ? "The stop loss is on the wrong side of the entry." : "The take profit is on the wrong side of the entry.");
  }
}
// Distance between two prices in pips, for lists that only hold prices (drafts, the log). Uses the pair-name guess for the pip size,
// so only for plain FX pairs and gold; anything else gets no number rather than a wrong one. The ticket and the review use the broker's pip size.
function pipsBetween(symbol, a, b) {
  if (a == null || b == null || !/^([A-Z]{6}|XAU[A-Z]{3})$/.test(String(symbol || "").toUpperCase())) return "";
  const p = Math.abs(a - b) / guessPip(String(symbol));
  return String(Math.round(p * 10) / 10);
}
const updateAll = () => { updateEntry(); syncLeg("sl"); syncLeg("tp"); autoLots(); updateMoney(); updateSend(); };

for (const k of ["sl", "tp"]) {
  oe[k + "_on"].onchange = () => { // turning it off remembers the distance; turning it on again brings it back, else 10 pips so the buttons have something to move
    TK.src[k] = "pips";
    if (!oe[k + "_on"].checked) TK.keep[k] = oe[k + "_pips"].value;
    else if (oe[k + "_pips"].value === "") oe[k + "_pips"].value = TK.keep[k] || (k === "sl" ? "-10" : "10");
    updateAll();
  };
  oe[k + "_pips"].oninput = () => { TK.src[k] = "pips"; updateAll(); };
  oe[k].oninput = () => { TK.src[k] = "price"; updateAll(); };
}
oe.exp_on.onchange = () => {
  $("expBox").hidden = !oe.exp_on.checked;
  if (oe.exp_on.checked && !oe.expires.value) { const d = new Date(Date.now() + 24 * 3600e3 - new Date().getTimezoneOffset() * 60e3); oe.expires.value = d.toISOString().slice(0, 16); } // default: 24 h from now
};
oe.entry.oninput = () => { TK.entryTouched = true; updateAll(); };
oe.pip.oninput = () => { TK.pipTouched = true; updateAll(); };
$("orderForm").addEventListener("change", (e) => { if (e.target.name === "side") { showPrices(); defaultEntry(); updateAll(); } });

// ---- live price
function showPrices() {
  const q = TK.quote, d = dec();
  $("bidTxt").textContent = q ? q.bid.toFixed(d) : "–";
  $("askTxt").textContent = q ? q.ask.toFixed(d) : "–";
}
function defaultEntry() { // start at the current price; the user moves it from there
  if (!TK.entryTouched && market() != null) oe.entry.value = market().toFixed(dec());
}
function applyQuote(q, simulated, account) {
  q.pip_size = Number(q.pip_size.toPrecision(6)); // 10 ** -4 comes through as 0.00009999999999999999
  TK.quote = q; TK.simulated = simulated; TK.account = account || "";
  if (!TK.pipTouched) { oe.pip.value = q.pip_size; $("pipHint").textContent = `1 pip = ${q.pip_size}${simulated ? " (standard for this pair)" : " (from the broker)"}.`; }
  oe.lots.min = q.min_lots; oe.lots.step = q.step_lots; // the browser then rejects lot sizes the broker wouldn't accept
  $("lotHint").textContent = `Min ${q.min_lots}, step ${q.step_lots}, max ${q.max_lots}.`;
  const spread = ((q.ask - q.bid) / q.pip_size).toFixed(1);
  const t = new Date().toLocaleTimeString();
  setLive(simulated ? `Simulated price (no cTrader account linked yet) · spread ${spread} pips · ${t}` : `Live price from ${account} · spread ${spread} pips · ${t}`, simulated ? "sim" : "live-ok");
  showPrices(); defaultEntry(); updateAll(); ensureConv();
}
function noQuote(text) {
  TK.quote = null; showPrices();
  oe.lots.removeAttribute("min"); oe.lots.step = "any"; $("lotHint").textContent = "";
  setLive(text + " You can still fill the order in by hand.", "warn"); updateAll();
}
async function pollQuote() {
  clearTimeout(TK.timer);
  if (sheet.hidden) return; // stop while closed
  const sym = oe.symbol.value.trim().toUpperCase();
  if (sym.length >= 5 && !TK.busy) {
    TK.busy = true;
    try {
      const r = await call("quote", { symbol: sym });
      if (oe.symbol.value.trim().toUpperCase() === sym && !sheet.hidden) applyQuote(r.quote, r.simulated, r.account);
    } catch (e) { if (oe.symbol.value.trim().toUpperCase() === sym) noQuote(`No live price: ${e.message}.`); }
    TK.busy = false;
  }
  TK.timer = setTimeout(pollQuote, POLL_MS);
}
let symDebounce;
function syncSymbolRow() {
  const v = oe.symbol.value.trim();
  $("symVal").textContent = v || "Choose"; $("symVal").classList.toggle("empty", !v);
}
oe.symbol.oninput = () => {
  syncSymbolRow();
  TK.quote = null; showPrices(); if (!TK.entryTouched) oe.entry.value = "";
  if (!TK.pipTouched) oe.pip.value = guessPip(oe.symbol.value);
  setLive(oe.symbol.value.trim().length >= 5 ? "Getting the live price…" : "Choose a symbol to see its live price.");
  clearTimeout(symDebounce); symDebounce = setTimeout(pollQuote, 400);
  updateAll();
};

// ---- open / close / save
function openSheet() {
  $("delDraft").hidden = true; TK.autoLots = true; TK.editing = null; TK.baseline = null; $("oTitle").textContent = "New order"; $("orderForm").querySelector("button[type=submit]").textContent = "Save draft";
  $("oMsg").textContent = "";
  $("orderForm").reset(); oe.symbol.value = ""; // a hidden field keeps its value through reset()
  TK.quote = null; TK.keep = {}; TK.src.sl = TK.src.tp = "pips"; TK.pipTouched = false; TK.entryTouched = false;
  oe.pip.value = "0.0001"; oe.lots.removeAttribute("min"); oe.lots.step = "any"; $("lotHint").textContent = ""; $("pipHint").textContent = "1 pip. Taken from the broker once a price is live.";
  ["sl", "tp", "exp"].forEach((k) => ($((k === "exp" ? "exp" : k) + "Box").hidden = true));
  showPrices(); setLive("Choose a symbol to see its live price.");
  TK.sel.clear(); TK.tpl = {}; renderSendTo(); updateAll();
  syncSymbolRow(); sheet.hidden = false; $("symBtn").focus();
}
$("fab").onclick = openSheet;

function entryRef() {
  const b = TK.baseline;
  if (b && b.entry === num(oe.entry.value) && b.side === side() && b.symbol === oe.symbol.value.trim().toUpperCase()) return b.ref;
  return market(); // null when there was no live price: the server then never converts
}
function orderRow() {
  return {
    symbol: oe.symbol.value.trim().toUpperCase(), side: side(), order_type: orderTypeNow(), lots: num(oe.lots.value), entry: num(oe.entry.value), entry_ref: entryRef(),
    sl: oe.sl_on.checked ? num(oe.sl.value) : null, tp: oe.tp_on.checked ? num(oe.tp.value) : null,
    expires_at: oe.exp_on.checked && oe.expires.value ? new Date(oe.expires.value).toISOString() : null, note: oe.note.value.trim() || null,
    targets: TK.rows.filter((r) => TK.sel.has(r.a.id)).map((r) => ({ account_id: r.a.id, template_id: r.sel.value || null })), // ticked accounts and their templates
  };
}
// Insert, or update when editing. After the first save the form is an edit of that draft.
async function persistDraft() {
  if (!oe.symbol.value.trim()) return { error: { message: "Choose a symbol." } }; // a hidden field is not covered by the browser's own check
  const row = orderRow();
  TK.baseline = { entry: row.entry, side: row.side, symbol: row.symbol, ref: row.entry_ref };
  if (TK.editing) { const { error } = await sb.from("td_orders").update(row).eq("id", TK.editing); return { error, id: TK.editing }; }
  const { data, error } = await sb.from("td_orders").insert(row).select("id").single();
  if (data) TK.editing = data.id;
  return { error, id: data?.id };
}
const saveError = (error) => error.code === "23514" ? "Check the prices: a long needs its stop below the entry and its take profit above, a short the other way round." : error.message;

$("orderForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await persistDraft();
  // errors go inside the sheet: the page-level message sits behind it
  if (error) { $("oMsg").textContent = saveError(error); return; }
  $("oMsg").textContent = ""; sheet.hidden = true; loadDrafts();
};


// +1 / -1 / +10 / -10 on the pips and price rows of SL and TP. Pips change the distance; price moves the level up or down by that many pips.
$("orderForm").addEventListener("click", (e) => {
  const b = e.target.closest(".nudge button"); if (!b) return;
  const wrap = b.closest(".nudge"), k = wrap.dataset.leg, d = Number(b.dataset.d), p = pip();
  if (!p) return;
  if (wrap.dataset.field === "pips") {
    const cur = num(oe[k + "_pips"].value) ?? 0; // SL is negative, so + moves it toward the entry, and never past it
    oe[k + "_pips"].value = String(k === "sl" ? Math.min(0, +(cur + d).toFixed(1)) : Math.max(0, +(Math.abs(cur) + d).toFixed(1)));
    TK.src[k] = "pips";
  } else {
    const cur = num(oe[k].value) ?? num(oe.entry.value);
    if (cur == null) return;
    oe[k].value = (cur + d * p).toFixed(dec());
    TK.src[k] = "price";
  }
  updateAll();
});

// ---- "Send to accounts": pick accounts and a template for each, with the resulting lots. Sending itself is step 3.
let ACCTS = [];
TK.sel = new Set(); TK.tpl = {}; TK.rows = []; // selected account ids; template picked per account
const fmtLots = (v) => String(Math.round(v * 1e4) / 1e4);
// Pip value in USD per lot, from the live price. Only for pairs with USD in them, and it assumes a USD account and a standard
// contract (100,000 units, gold 100 oz). shortcut: an estimate for the preview; the real figure comes from the broker at step 3.
// A cross's pip is valued through its USD pair (same table as the function, plan.mjs): EURJPY via USDJPY, EURGBP via GBPUSD.
function conversionPairFor(symbol) {
  if (!/^[A-Z]{6}$/.test(symbol) || symbol.endsWith("USD") || symbol.startsWith("USD")) return null;
  const q = symbol.slice(3);
  if (["GBP", "AUD", "NZD", "EUR"].includes(q)) return { symbol: q + "USD", direct: true };
  if (["JPY", "CHF", "CAD"].includes(q)) return { symbol: "USD" + q, direct: false };
  return null;
}
let CONV = { symbol: null, direct: false, bid: 0, ask: 0, at: 0 };
async function ensureConv() { // the conversion pair's price, refreshed at most every 15 s while the ticket is open
  const cp = conversionPairFor(oe.symbol.value.trim().toUpperCase());
  if (!cp || (CONV.symbol === cp.symbol && Date.now() - CONV.at < 15000)) return;
  try {
    const r = await call("quote", { symbol: cp.symbol });
    CONV = { symbol: cp.symbol, direct: cp.direct, bid: r.quote.bid, ask: r.quote.ask, at: Date.now() };
    updateAll();
  } catch { /* no conversion price: the estimates stay blank, the server will say why */ }
}
// Pip value in USD per 1 lot (an estimate: a USD account and a standard contract, 100,000 units, gold 100 oz).
function pipValueUsd(sym, q) {
  const pipUnits = (sym.startsWith("XAU") ? 100 : 100000) * q.pip_size;
  if (sym.endsWith("USD")) return pipUnits;
  if (sym.startsWith("USD")) return pipUnits / ((q.bid + q.ask) / 2);
  const cp = conversionPairFor(sym);
  if (cp && CONV.symbol === cp.symbol && CONV.bid) { const m = (CONV.bid + CONV.ask) / 2; return cp.direct ? pipUnits * m : pipUnits / m; }
  return null;
}
function lotsFor(a, tpl, lots) {
  if (!tpl) return { text: "pick a template", cls: "warn" };
  let v, est = false;
  if (tpl.lot_mode === "fixed") v = Number(tpl.lot_value);
  else if (tpl.lot_mode === "multiplier" || tpl.lot_mode === "size_scale") {
    if (!lots) return { text: "enter a quantity", cls: "" };
    if (tpl.lot_mode === "size_scale" && !a.start_balance) return { text: "set its starting size", cls: "warn" };
    v = tpl.lot_mode === "multiplier" ? lots * tpl.lot_value : (lots * a.start_balance) / tpl.lot_value;
  } else { // risk_pct / balance_pct: lots = money at risk / (stop in pips x pip value)
    const slPips = Math.abs(num(oe.sl_pips.value) ?? 0);
    if (!oe.sl_on.checked || !slPips) return { text: "needs a stop loss", cls: "warn" };
    const base = tpl.lot_mode === "risk_pct" ? a.start_balance : BAL[a.id];
    if (!base) return { text: tpl.lot_mode === "risk_pct" ? "set its starting size" : "balance unknown", cls: "warn" };
    if (!TK.quote) return { text: "needs a live price", cls: "warn" };
    const pv = pipValueUsd(oe.symbol.value.trim().toUpperCase(), TK.quote);
    if (!pv) return { text: "pip value: step 3", cls: "" };
    v = (base * tpl.lot_value) / 100 / (slPips * pv);
    est = true;
  }
  if (tpl.max_lots) v = Math.min(v, tpl.max_lots);
  if (tpl.min_lots) v = Math.max(v, tpl.min_lots);
  const q = TK.quote;
  if (q) { // the broker's own limits: round down to the lot step, skip what is below its minimum
    v = Math.floor(Math.min(v, q.max_lots) / q.step_lots + 1e-9) * q.step_lots;
    if (v < q.min_lots - 1e-12) return { text: "below the broker minimum: skipped", cls: "warn" };
  }
  return { text: (est ? "≈ " : "") + fmtLots(v) + " lots", cls: "ok big", est };
}
function updateSend() {
  const lots = num(oe.lots.value);
  let n = 0, anyEst = false;
  for (const r of TK.rows) {
    const on = TK.sel.has(r.a.id); n += on ? 1 : 0;
    r.row.classList.toggle("on", on); r.swIn.checked = on;
    const out = on ? lotsFor(r.a, templates.find((x) => x.id === r.sel.value), lots) : { text: "", cls: "" };
    r.res.textContent = out.text; r.res.className = "slots " + out.cls; anyEst = anyEst || !!out.est;
  }
  $("sendCount").textContent = n ? "· " + n + " selected" : "";
  $("multiWarn").hidden = n < 2;
  $("estNote").hidden = !anyEst;
}
function renderSendTo() {
  TK.rows = [];
  if (!ACCTS.length) { $("sendTo").replaceChildren(h("p", { className: "hint", textContent: "No accounts linked yet." })); return updateSend(); }
  $("sendTo").replaceChildren(...ACCTS.map((a) => {
    const sel = h("select", { onchange: () => { TK.tpl[a.id] = sel.value; updateSend(); } },
      h("option", { value: "", textContent: "No template" }), ...templates.map((x) => h("option", { value: x.id, textContent: x.name })));
    sel.setAttribute("aria-label", "Template for " + a.label);
    sel.value = TK.tpl[a.id] ?? a.default_template_id ?? "";
    const res = h("span", { className: "slots" });
    const swIn = h("input", { type: "checkbox", checked: TK.sel.has(a.id) });
    swIn.setAttribute("aria-label", "Send to " + a.label);
    const swLabel = h("label", { className: "sw" }, swIn);
    // the whole card is the control: tap to select, it lights up; the template picker inside does not toggle it
    const row = h("div", { className: "scard" },
      h("div", { className: "shead" }, h("span", { className: "sname", textContent: a.label }), h("span", { className: "pill " + (a.is_live ? "warn" : "ok"), textContent: a.is_live ? "live" : "demo" }), swLabel),
      h("div", { className: "sctl" }, sel, res));
    const toggle = () => { TK.sel.has(a.id) ? TK.sel.delete(a.id) : TK.sel.add(a.id); updateSend(); };
    swIn.onchange = toggle; // the switch itself
    row.onclick = (e) => { if (!e.target.closest("select, .sw")) toggle(); }; // the rest of the card is a big tap target too
    TK.rows.push({ a, row, sel, res, swIn });
    return row;
  }));
  updateSend();
}
$("selAll").onclick = () => { ACCTS.forEach((a) => TK.sel.add(a.id)); renderSendTo(); };
$("selNone").onclick = () => { TK.sel.clear(); renderSendTo(); };
oe.lots.oninput = () => { TK.autoLots = false; updateAll(); }; // typing a quantity is manual from then on

// Edit a saved draft: the same ticket, filled in. Prices are what is stored, so SL/TP open as prices and the pips follow.
function openOrder(dr) {
  openSheet();
  $("delDraft").hidden = false; TK.editing = dr.id; TK.autoLots = false; // a saved draft keeps its own quantity
  TK.baseline = { entry: dr.entry, side: dr.side, symbol: dr.symbol, ref: dr.entry_ref ?? null };
  $("oTitle").textContent = "Edit draft";
  $("orderForm").querySelector("button[type=submit]").textContent = "Save changes";
  oe.symbol.value = dr.symbol;
  document.querySelector('input[name=side][value="' + dr.side + '"]').checked = true;
  oe.lots.value = dr.lots; oe.entry.value = dr.entry; TK.entryTouched = true; // keep the saved entry, don't reset it to the market
  for (const k of ["sl", "tp"]) if (dr[k] != null) { oe[k + "_on"].checked = true; oe[k].value = dr[k]; TK.src[k] = "price"; }
  if (dr.expires_at) {
    oe.exp_on.checked = true; $("expBox").hidden = false;
    oe.expires.value = new Date(new Date(dr.expires_at).getTime() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  }
  oe.note.value = dr.note ?? "";
  const targets = (dr.targets || []).filter((x) => ACCTS.some((a) => a.id === x.account_id)); // accounts removed since are dropped
  TK.sel = new Set(targets.map((x) => x.account_id));
  TK.tpl = Object.fromEntries(targets.map((x) => [x.account_id, x.template_id ?? ""]));
  renderSendTo();
  if (targets.length) document.querySelector(".sendbox").open = true;
  oe.symbol.oninput(); // pip size guess, live price, recalculate everything
}

// ---- Auto quantity: lots = preset balance x risk % / (stop in pips x pip value). Fills the Quantity box; typing there makes it manual.
// The same number is what Scale-to-account-size templates scale from. Needs a stop, a live price and a USD pair (an estimate: see pipValueUsd).
let PREFS = { risk_pct: 1, ref_balance: 100000 };
async function loadPrefs() {
  const { data } = await sb.from("td_prefs").select("risk_pct,ref_balance").maybeSingle();
  if (data) PREFS = { risk_pct: Number(data.risk_pct), ref_balance: Number(data.ref_balance) };
  showPrefs();
}
const showPrefs = () => { $("prefRisk").value = PREFS.risk_pct; $("prefBal").value = PREFS.ref_balance; };
let prefTimer;
function savePrefs() { // after a short pause, so typing a number does not save on every key
  clearTimeout(prefTimer);
  prefTimer = setTimeout(async () => {
    const row = { risk_pct: PREFS.risk_pct, ref_balance: PREFS.ref_balance, updated_at: new Date().toISOString() };
    const { data } = await sb.from("td_prefs").select("user_id").maybeSingle();
    const { error } = data ? await sb.from("td_prefs").update(row).eq("user_id", data.user_id) : await sb.from("td_prefs").insert(row);
    if (error) return msg(error.message, true);
    toast("Saved to your account");
  }, 600);
}
function autoLots() {
  const b = $("lotAuto"), base = PREFS.risk_pct + "% of " + PREFS.ref_balance.toLocaleString();
  if (!TK.autoLots) { b.textContent = "Manual \u00b7 use auto (" + base + ")"; return; }
  const slPips = oe.sl_on.checked ? Math.abs(num(oe.sl_pips.value) ?? 0) : 0;
  if (!slPips) { b.textContent = "Auto \u00b7 switch on a stop loss (" + base + ")"; return; }
  const q = TK.quote, sym = oe.symbol.value.trim().toUpperCase();
  if (!q || !sym) { b.textContent = ""; return; }
  const pv = pipValueUsd(sym, q);
  if (!pv) { b.textContent = conversionPairFor(sym) ? "Auto · waiting for the USD conversion price" : "Auto can't value this pair: type the lots"; return; }
  const lots = Math.floor((PREFS.ref_balance * PREFS.risk_pct / 100 / (slPips * pv)) / q.step_lots + 1e-9) * q.step_lots;
  oe.lots.value = String(Number(lots.toFixed(8)));
  b.textContent = "Auto \u00b7 " + base + " at a " + slPips + "-pip stop";
}
$("lotAuto").onclick = () => { TK.autoLots = !TK.autoLots; updateAll(); };
$("prefRisk").oninput = $("prefBal").oninput = () => {
  const r = num($("prefRisk").value), bal = num($("prefBal").value);
  if (r > 0 && r <= 100) PREFS.risk_pct = r;
  if (bal > 0) PREFS.ref_balance = bal;
  savePrefs(); updateAll();
};

// Delete lives inside the opened draft (the draft list itself has no buttons)
$("delDraft").onclick = async () => {
  if (!TK.editing || !confirm("Delete this draft?")) return;
  const { error } = await sb.from("td_orders").delete().eq("id", TK.editing);
  if (error) { $("oMsg").textContent = error.message; return; }
  sheet.hidden = true; loadDrafts();
};

// Money at stake for the quantity in the box, like cTrader's "Gross profit: ~ $277.36": quantity x pips x pip value, and its share of the
// preset balance. An estimate (USD pairs on a USD account, see pipValueUsd); blank when it cannot be worked out.
function updateMoney() {
  const lots = num(oe.lots.value), q = TK.quote, sym = oe.symbol.value.trim().toUpperCase();
  const pv = q && sym ? pipValueUsd(sym, q) : null;
  for (const [k, word, cls] of [["tp", "Gross profit", "good"], ["sl", "Gross loss", "bad"]]) {
    const el = $(k + "Gross");
    const pips = oe[k + "_on"].checked ? Math.abs(num(oe[k + "_pips"].value) ?? 0) : 0;
    if (!pips || !lots || !pv) { el.textContent = ""; el.className = "gross"; continue; }
    const amt = lots * pips * pv;
    el.className = "gross " + cls;
    el.textContent = word + ": ~ " + (k === "sl" ? "−" : "") + "$" + amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      + " · ~" + (amt / PREFS.ref_balance * 100).toFixed(2) + "% of " + PREFS.ref_balance.toLocaleString();
  }
}

showPrefs();
