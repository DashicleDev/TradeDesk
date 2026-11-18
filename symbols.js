// Symbol picker: a list like cTrader's, with a search box, a check on the current symbol and your recent picks on top.
// The list is the broker's, so it needs a linked cTrader account. Uses oe, call, h, $ (earlier files).
const symSheet = $("symSheet");
let SYM = { list: null, at: 0 };
const RECENT_KEY = "td_recent_symbols";
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };
const remember = (s) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([s, ...recent().filter((x) => x !== s)].slice(0, 5))); } catch { /* storage blocked: no recents, nothing else lost */ } };

async function loadSymbols() {
  if (SYM.list && Date.now() - SYM.at < 5 * 60e3) return;
  const r = await call("symbols");
  SYM = { list: r.symbols, at: Date.now() };
}

const matches = () => {
  const q = $("symSearch").value.trim().toUpperCase();
  return q ? (SYM.list || []).filter((s) => s.toUpperCase().includes(q)) : (SYM.list || []);
};

function renderSymbols() {
  const q = $("symSearch").value.trim().toUpperCase(), cur = oe.symbol.value.trim().toUpperCase();
  const all = SYM.list || [], found = matches(), shown = found.slice(0, 150); // a broker can list thousands: search narrows it
  const rec = q ? [] : recent().filter((s) => all.includes(s));
  const item = (s) => h("button", { type: "button", className: "symitem" + (s === cur ? " on" : ""), onclick: () => pickSymbol(s) },
    h("span", { className: "symck", textContent: s === cur ? "✓" : "" }), h("span", { textContent: s }));
  const kids = [];
  if (rec.length) kids.push(h("p", { className: "symgrp", textContent: "Recent" }), ...rec.map(item), h("p", { className: "symgrp", textContent: "All symbols" }));
  kids.push(...shown.map(item));
  if (!shown.length) kids.push(h("p", { className: "hint", textContent: q ? "No symbol matches " + q + "." : "No symbols." }));
  if (found.length > shown.length) kids.push(h("p", { className: "hint", textContent: found.length - shown.length + " more: type to narrow the list." }));
  $("symList").replaceChildren(...kids);
  $("symNote").textContent = "";
}

function pickSymbol(s) {
  oe.symbol.value = s; remember(s); symSheet.hidden = true;
  oe.symbol.dispatchEvent(new Event("input", { bubbles: true })); // the ticket reacts to a new symbol: price, pip size, entry
}

async function openSymbols() {
  $("symSearch").value = "";
  $("symList").replaceChildren(h("p", { className: "hint", textContent: "Loading…" }));
  symSheet.hidden = false;
  try { await loadSymbols(); renderSymbols(); }
  catch (e) { $("symList").replaceChildren(h("p", { className: "msg err", textContent: e.message })); }
}

$("symBtn").onclick = openSymbols;
$("symSearch").oninput = renderSymbols;
$("symSearch").onkeydown = (e) => { // Enter picks the one match, or an exact one
  if (e.key !== "Enter") return;
  e.preventDefault();
  const m = matches(), q = $("symSearch").value.trim().toUpperCase();
  const exact = m.find((s) => s.toUpperCase() === q);
  if (exact || m.length === 1) pickSymbol(exact || m[0]);
};
