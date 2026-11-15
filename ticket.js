// Order ticket (bottom sheet): live price through the function, SL/TP in pips or price, entry distance from market.
// Only prices are saved. Uses sb, $, msg, call (app.js) and num, h, loadDrafts (desk.js).
const sheet = $("orderSheet");
const oe = $("orderForm").elements;
const POLL_MS = 4000;
const TK = { editing: null, entryTouched: false, quote: null, simulated: false, account: "", timer: null, busy: false, src: { sl: "pips", tp: "pips" }, pipTouched: false };

const side = () => oe.side.value; // "buy" | "sell" | "" until chosen
const pip = () => num(oe.pip.value);
const market = () => (TK.quote && side() ? (side() === "buy" ? TK.quote.ask : TK.quote.bid) : null); // you buy at the ask, sell at the bid
const decs = (p) => Math.max(0, Math.round(-Math.log10(p))) + 1;
const dec = () => TK.quote?.digits ?? (pip() ? decs(pip()) : 5);
const guessPip = (s) => { s = s.toUpperCase(); return s.includes("JPY") ? 0.01 : s.startsWith("XAU") ? 0.1 : 0.0001; }; // shortcut: only until a live price brings the broker's pip size

function setLive(text, cls = "") { const e = $("liveLine"); e.textContent = text; e.className = "msg " + cls; e.style.display = "block"; }

// ---- entry: distance from market, direction rule, stepper
function updateEntry() {
  const e = num(oe.entry.value), m = market(), p = pip();
  oe.entry.setCustomValidity("");
  const d = $("dist"); d.className = "fh";
  if (e == null || m == null || !p) { d.textContent = m == null ? "" : "Enter an entry price."; return; }
  const dist = (e - m) / p;
  const type = oe.order_type.value, buy = side() === "buy";
  const below = (type === "limit") === buy; // limit buy and stop sell wait below the market; limit sell and stop buy above
  const ok = below ? e < m : e > m;
  d.textContent = `Distance from market: ${dist > 0 ? "+" : ""}${dist.toFixed(1)} pips`;
  if (!ok) {
    const msgText = `A ${type} ${buy ? "buy" : "sell"} has to sit ${below ? "below" : "above"} the current price (${m.toFixed(dec())}).`;
    d.textContent += `. ${msgText}`; oe.entry.setCustomValidity(msgText); if (TK.entryTouched) d.className = "fh warn"; // a default entry sitting on the market only blocks saving, it does not nag
  }
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
    oe[k].value = v == null ? "" : (entry + dir * Math.abs(v) * p).toFixed(dec());
  } else {
    const price = num(oe[k].value);
    if (price == null) return void (oe[k + "_pips"].value = "");
    const v = ((price - entry) / p) * dir; // negative = wrong side of the entry
    oe[k + "_pips"].value = v.toFixed(1);
    if (v <= 0) oe[k].setCustomValidity(k === "sl" ? "The stop loss is on the wrong side of the entry." : "The take profit is on the wrong side of the entry.");
  }
}
function updateRR() {
  const s = Math.abs(num(oe.sl_pips.value)), t = Math.abs(num(oe.tp_pips.value)); // a minus sign (as TradingView shows a stop) only marks the direction
  $("rr").textContent = oe.sl_on.checked && oe.tp_on.checked && s > 0 && t > 0 ? `Reward to risk: ${(t / s).toFixed(2)} : 1` : "";
}
const updateAll = () => { updateEntry(); syncLeg("sl"); syncLeg("tp"); updateRR(); updateSend(); };

for (const k of ["sl", "tp"]) {
  oe[k + "_on"].onchange = () => { TK.src[k] = "pips"; if (oe[k + "_on"].checked && oe[k + "_pips"].value === "") oe[k + "_pips"].value = "10"; updateAll(); }; // start at 10 pips so the buttons have something to move
  oe[k + "_pips"].oninput = () => { TK.src[k] = "pips"; updateAll(); };
  oe[k].oninput = () => { TK.src[k] = "price"; updateAll(); };
}
oe.exp_on.onchange = () => {
  $("expBox").hidden = !oe.exp_on.checked;
  if (oe.exp_on.checked && !oe.expires.value) { const d = new Date(Date.now() + 24 * 3600e3 - new Date().getTimezoneOffset() * 60e3); oe.expires.value = d.toISOString().slice(0, 16); } // default: 24 h from now
};
oe.entry.oninput = () => { TK.entryTouched = true; updateAll(); };
oe.pip.oninput = () => { TK.pipTouched = true; updateAll(); };
$("orderForm").addEventListener("change", (e) => { if (e.target.name === "side" || e.target.name === "order_type") { showPrices(); if (e.target.name === "side") defaultEntry(); updateAll(); } });

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
  showPrices(); defaultEntry(); updateAll();
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
oe.symbol.oninput = () => {
  TK.quote = null; showPrices(); if (!TK.entryTouched) oe.entry.value = "";
  if (!TK.pipTouched) oe.pip.value = guessPip(oe.symbol.value);
  setLive(oe.symbol.value.trim().length >= 5 ? "Getting the live price…" : "Type a pair to see its live price.");
  clearTimeout(symDebounce); symDebounce = setTimeout(pollQuote, 400);
  updateAll();
};

// ---- open / close / save
function openSheet() {
  TK.editing = null; $("oTitle").textContent = "New order"; $("orderForm").querySelector("button[type=submit]").textContent = "Save draft";
  $("oMsg").textContent = "";
  $("orderForm").reset();
  TK.quote = null; TK.src.sl = TK.src.tp = "pips"; TK.pipTouched = false; TK.entryTouched = false;
  oe.pip.value = "0.0001"; oe.lots.removeAttribute("min"); oe.lots.step = "any"; $("lotHint").textContent = ""; $("pipHint").textContent = "1 pip. Taken from the broker once a price is live.";
  ["sl", "tp", "exp"].forEach((k) => ($((k === "exp" ? "exp" : k) + "Box").hidden = true));
  showPrices(); setLive("Type a pair to see its live price.");
  TK.sel.clear(); TK.tpl = {}; renderSendTo(); updateAll();
  sheet.hidden = false; oe.symbol.focus();
}
$("fab").onclick = openSheet;

function orderRow() {
  return {
    symbol: oe.symbol.value.trim().toUpperCase(), side: side(), order_type: oe.order_type.value, lots: num(oe.lots.value), entry: num(oe.entry.value),
    sl: oe.sl_on.checked ? num(oe.sl.value) : null, tp: oe.tp_on.checked ? num(oe.tp.value) : null,
    expires_at: oe.exp_on.checked && oe.expires.value ? new Date(oe.expires.value).toISOString() : null, note: oe.note.value.trim() || null,
    targets: TK.rows.filter((r) => TK.sel.has(r.a.id)).map((r) => ({ account_id: r.a.id, template_id: r.sel.value || null })), // ticked accounts and their templates
  };
}
// Insert, or update when editing. After the first save the form is an edit of that draft.
async function persistDraft() {
  const row = orderRow();
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
    const cur = Math.abs(num(oe[k + "_pips"].value) ?? 0);
    oe[k + "_pips"].value = String(Math.max(0, +(cur + d).toFixed(1)));
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
function pipValueUsd(sym, q) {
  const pipUnits = (sym.startsWith("XAU") ? 100 : 100000) * q.pip_size;
  if (sym.endsWith("USD")) return pipUnits;
  if (sym.startsWith("USD")) return pipUnits / ((q.bid + q.ask) / 2);
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
oe.lots.oninput = updateSend;

// Edit a saved draft: the same ticket, filled in. Prices are what is stored, so SL/TP open as prices and the pips follow.
function openOrder(dr) {
  openSheet();
  TK.editing = dr.id;
  $("oTitle").textContent = "Edit draft";
  $("orderForm").querySelector("button[type=submit]").textContent = "Save changes";
  oe.symbol.value = dr.symbol;
  document.querySelector('input[name=side][value="' + dr.side + '"]').checked = true;
  document.querySelector('input[name=order_type][value="' + (dr.order_type || "limit") + '"]').checked = true;
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
