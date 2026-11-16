// The menu for a running position or a pending order, laid out like the ticket: Take profit and Stop loss with the pips/price steppers and
// the gross result, then "Apply to" account cards, then Save / Close position (or Cancel order). One dashboard row is the same trade on one
// or more accounts. Uses call, $, h, msg, overview, PX, PREFS, guessPip, pipValueUsd (earlier files).
// Only simulated trades can be changed for now; real cTrader trades arrive with step 4 (amend and cancel at the broker).
const manageSheet = $("manageSheet");
let MG = null; // the group being managed
let ML = {};   // per leg: { on, pips, price, dirty, differs }

const mPip = () => (PX[MG.symbol]?.pip_size) || guessPip(MG.symbol);
const mDec = () => PX[MG.symbol]?.digits ?? (MG.symbol.includes("JPY") ? 3 : 5);
const mDir = (k) => ((k === "sl") === (MG.side === "buy") ? -1 : 1); // which side of the entry the leg sits on
const mSelected = () => MG.ts.filter((_, i) => manageSheet.querySelector(`[data-mi="${i}"]`).classList.contains("on"));
const mFmt = (v) => (v == null || v === "" || Number.isNaN(v) ? "" : String(v));

const legHtml = (k, word) => `
  <div class="line"><span class="lt">${word}</span><label class="sw"><input type="checkbox" data-sw="${k}" aria-label="${word}"></label></div>
  <div data-box="${k}" hidden>
    <div class="subline legrow"><div class="nudge" data-leg="${k}" data-field="pips"><button type="button" class="btn small" data-d="-1" aria-label="One pip less">−</button><input type="number" step="any" data-in="${k}-pips" placeholder="pips" aria-label="Pips"><button type="button" class="btn small" data-d="1" aria-label="One pip more">+</button></div><input class="pxin" type="number" step="any" data-in="${k}-price" placeholder="price" aria-label="Price"></div>
    <p class="gross" data-gross="${k}"></p>
  </div>`;
$("mLegs").innerHTML = legHtml("tp", "Take profit") + legHtml("sl", "Stop loss");
const mIn = (k, f) => manageSheet.querySelector(`[data-in="${k}-${f}"]`);

// A running position's result on one account right now, in dollars (pairs whose pip value is unknown show nothing).
function pnlOf(t) {
  const q = PX[MG.symbol], pv = q && pipValueUsd(MG.symbol, q);
  if (MG.kind !== "position" || !pv) return "";
  const amt = Number(t.lots) * ((MG.side === "buy" ? q.bid - MG.entry : MG.entry - q.ask) / q.pip_size) * pv;
  return h("span", { className: "mpnl " + (amt >= 0 ? "long" : "short"), textContent: money(amt) });
}

// Removing a stop loss or take profit remembers the level (in this browser), so switching it on again later brings it back.
const keepKey = (t, k) => "td-keep:" + t.id + ":" + k;
function keepLeg(k) {
  try { for (const t of mSelected()) if (t[k] != null) localStorage.setItem(keepKey(t, k), String(t[k])); } catch { /* storage blocked: nothing remembered */ }
}
function keptLeg(k) {
  try { for (const t of MG.ts) { const v = localStorage.getItem(keepKey(t, k)); if (v != null) return Number(v); } } catch { /* storage blocked */ }
  return null;
}

function openManage(it) {
  MG = it;
  const sim = it.ts.every((t) => t.sim), pos = it.kind === "position", total = it.ts.reduce((s, t) => s + Number(t.lots), 0);
  $("mTitle").textContent = pos ? "Running position" : "Pending order";
  $("mSym").textContent = it.symbol;
  $("mSide").textContent = it.side === "buy" ? "Long (buy)" : "Short (sell)"; $("mSide").className = it.side === "buy" ? "long" : "short";
  $("mEntry").textContent = it.entry;
  $("mAccts").replaceChildren(...it.ts.map((t, i) => {
    const sw = h("input", { type: "checkbox", checked: true });
    sw.setAttribute("aria-label", "Apply to " + t.account);
    const card = h("div", { className: "scard on", tabIndex: 0 }, h("div", { className: "shead" }, h("span", { className: "sname", textContent: t.account }), h("label", { className: "sw" }, sw)), h("div", { className: "sctl mrow" }, h("span", { className: "slots", textContent: t.lots + " lots" }), pnlOf(t)));
    card.dataset.mi = i;
    const set = (on) => { card.classList.toggle("on", on); sw.checked = on; updateManage(); };
    sw.onchange = () => set(sw.checked);
    card.onclick = (e) => { if (!e.target.closest(".sw")) set(!card.classList.contains("on")); };
    card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(!card.classList.contains("on")); } };
    return card;
  }));
  for (const k of ["tp", "sl"]) { // start from what the accounts hold; if they differ the leg starts off and says so
    const vals = new Set(it.ts.map((t) => t[k] ?? null)), v = vals.size === 1 ? [...vals][0] : null;
    ML[k] = { on: v != null, dirty: false, differs: vals.size > 1 };
    manageSheet.querySelector(`[data-sw="${k}"]`).checked = v != null;
    const shown = v ?? keptLeg(k); // a leg that was removed earlier comes back switched off, but with its old level ready
    mIn(k, "price").value = shown ?? "";
    mIn(k, "pips").value = shown == null ? "" : (((shown - it.entry) / mPip()) * mDir(k)).toFixed(1);
  }
  $("mFill").hidden = pos;
  $("mClose").textContent = pos ? "Close position" : "Cancel order";
  $("mMsg").textContent = sim ? "" : "Changing real cTrader trades arrives in step 4: for now manage them in cTrader.";
  manageSheet.querySelectorAll(".formfoot .btn, #mLegs input, #mLegs button").forEach((b) => (b.disabled = !sim));
  updateManage();
  manageSheet.hidden = false;
}

function updateManage() {
  const it = MG, sel = mSelected(), n = sel.length, sim = it.ts.every((t) => t.sim);
  $("mCount").textContent = `(${n} of ${it.ts.length})`;
  const q = PX[it.symbol], pv = q ? pipValueUsd(it.symbol, q) : null, lots = sel.reduce((s, t) => s + Number(t.lots), 0);
  if (q) { const d = it.side === "buy" ? q.ask : q.bid; $("mDist").textContent = "price now " + d.toFixed(q.digits); }
  for (const k of ["tp", "sl"]) {
    const box = manageSheet.querySelector(`[data-box="${k}"]`), g = manageSheet.querySelector(`[data-gross="${k}"]`), pips = Math.abs(Number(mIn(k, "pips").value) || 0);
    box.hidden = !ML[k].on;
    const note = ML[k].differs && !ML[k].dirty ? "The accounts hold different levels: turn it on to set one for all chosen." : "";
    if (!ML[k].on || !pips || !lots || !pv) { g.textContent = ML[k].on ? "" : note; g.className = "gross"; continue; }
    const amt = lots * pips * pv;
    g.className = "gross " + (k === "tp" ? "good" : "bad");
    g.textContent = (k === "tp" ? "Gross profit" : "Gross loss") + ": ~ " + (k === "sl" ? "−" : "") + "$" + amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      + " · ~" + (amt / PREFS.ref_balance * 100).toFixed(2) + "% of " + PREFS.ref_balance.toLocaleString();
  }
  manageSheet.querySelectorAll('[data-sw]').forEach((el) => { const k = el.dataset.sw, d = ML[k].differs && !ML[k].dirty; if (d) el.parentElement.title = "Accounts differ"; });
  if (sim) manageSheet.querySelectorAll(".formfoot .btn").forEach((b) => (b.disabled = !n));
  const word = n === it.ts.length && n > 1 ? " (all)" : n > 1 ? ` (${n} accounts)` : "";
  $("mClose").textContent = (it.kind === "position" ? "Close position" : "Cancel order") + word;
}

// switch on/off
manageSheet.addEventListener("change", (e) => {
  const k = e.target.dataset?.sw; if (!k) return;
  ML[k].on = e.target.checked; ML[k].dirty = true;
  if (ML[k].on && mIn(k, "pips").value === "") { mIn(k, "pips").value = "10"; setFromPips(k); }
  updateManage();
});
// typing in pips or price keeps the other in step
function setFromPips(k) { const v = Number(mIn(k, "pips").value); mIn(k, "price").value = Number.isFinite(v) ? (MG.entry + mDir(k) * Math.abs(v) * mPip()).toFixed(mDec()) : ""; }
function setFromPrice(k) { const v = Number(mIn(k, "price").value); mIn(k, "pips").value = mIn(k, "price").value === "" ? "" : (((v - MG.entry) / mPip()) * mDir(k)).toFixed(1); }
manageSheet.addEventListener("input", (e) => {
  const m = /^(tp|sl)-(pips|price)$/.exec(e.target.dataset?.in || ""); if (!m) return;
  ML[m[1]].dirty = true; (m[2] === "pips" ? setFromPips : setFromPrice)(m[1]); updateManage();
});
// +1 / -1 / +10 / -10, like the ticket: pips change the distance, price moves the level by that many pips
manageSheet.addEventListener("click", (e) => {
  const b = e.target.closest(".nudge button"); if (!b) return;
  const wrap = b.closest(".nudge"), k = wrap.dataset.leg, d = Number(b.dataset.d), p = mPip();
  if (wrap.dataset.field === "pips") { mIn(k, "pips").value = String(Math.max(0, +((Math.abs(Number(mIn(k, "pips").value) || 0)) + d).toFixed(1))); setFromPips(k); }
  else { const cur = Number(mIn(k, "price").value) || MG.entry; mIn(k, "price").value = (cur + d * p).toFixed(mDec()); setFromPrice(k); }
  ML[k].dirty = true; updateManage();
});
const mAll = (on) => { manageSheet.querySelectorAll("[data-mi]").forEach((c) => { c.classList.toggle("on", on); c.querySelector("input").checked = on; }); updateManage(); };
$("mAll").onclick = () => mAll(true);
$("mNone").onclick = () => mAll(false);

async function manageDo(fn) {
  $("mMsg").textContent = "";
  try { await fn(); manageSheet.hidden = true; overview(); } catch (e) { $("mMsg").textContent = e.message; }
}
$("mClose").onclick = () => manageDo(async () => { for (const t of mSelected()) await call("sim_close", { id: t.id }); });
$("mFill").onclick = () => manageDo(async () => { for (const t of mSelected()) await call("sim_fill", { id: t.id }); });
$("mSave").onclick = () => {
  const patch = {};
  for (const k of ["sl", "tp"]) if (ML[k].dirty) {
    if (!ML[k].on) { patch[k] = null; keepLeg(k); continue; }
    const pips = Number(mIn(k, "pips").value), price = Number(mIn(k, "price").value);
    if (!(pips > 0) || !(price > 0)) return ($("mMsg").textContent = (k === "sl" ? "Stop loss" : "Take profit") + " is on the wrong side of the entry.");
    patch[k] = price;
  }
  if (!Object.keys(patch).length) return ($("mMsg").textContent = "Nothing changed.");
  manageDo(() => call("sim_amend", { ids: mSelected().map((t) => t.id), ...patch }));
};
