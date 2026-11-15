// Step 3: review and send. The server decides everything (lots, SL, TP, limits); this file only shows what it returned and
// asks for a confirmation. Uses sb, $, call, msg, emptyRow (app.js), h, num, loadDrafts (desk.js), TK, persistDraft, saveError (ticket.js).
const reviewSheet = $("reviewSheet");
let RV = null; // { orderId, rows, phase: "review" | "sent" }

const usd = (n) => "$" + Math.round(n).toLocaleString();
const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
const STATUS_PILL = { ready: "ok", sent: "ok", simulated: "ok", rejected: "no", blocked: "no", changed: "warn", unknown: "warn", pending: "" };
const stat = (label, value, cls = "", sub = "") => h("div", { className: "rstat" }, h("span", { className: "rl", textContent: label }), h("span", { className: "rv " + cls, textContent: value }), ...(sub ? [h("span", { className: "rsub", textContent: sub })] : []));

function reviewCard(r) {
  const head = h("div", { className: "shead" }, h("span", { className: "sname", textContent: r.label }));
  if (r.simulated) head.append(h("span", { className: "pill", textContent: "simulated" }));
  head.append(h("span", { className: "pill " + (r.is_live ? "warn" : "ok"), textContent: r.is_live ? "live" : "demo" }));
  const card = h("div", { className: "rcard " + (r.ok ? "" : "bad") }, head);
  if (r.template) card.append(h("p", { className: "rtpl", textContent: "Template: " + r.template }));
  if (r.lots != null) {
    const g = h("div", { className: "rgrid" }, stat("Lots", String(r.lots), "big"), stat("Order", (RV.side === "buy" ? "Buy " : "Sell ") + (r.orderType || "")), stat("Entry", String(r.entry)), stat("Stop loss", r.sl != null ? String(r.sl) : "none", "", r.slPips != null ? r.slPips + " pips" : ""), stat("Take profit", r.tp != null ? String(r.tp) : "none", "", r.tpPips != null ? r.tpPips + " pips" : ""));
    if (r.riskMoney != null) g.append(stat("Risk", usd(r.riskMoney) + (r.riskPct != null ? ` (${r.riskPct.toFixed(2)}%)` : "")));
    if (r.expiresAt) g.append(stat("Cancels at", when(r.expiresAt)));
    card.append(g);
    if (r.converted) card.append(h("p", { className: "rnote", textContent: "The price has passed your limit (" + r.limitEntry + "). This goes out as a market order at about " + r.entry + ", with the same stop loss and take profit distances." }));
  }
  if (RV.phase === "sent" && r.status && r.status !== "ready") {
    card.append(h("div", { className: "rresult" }, h("span", { className: "pill " + (STATUS_PILL[r.status] ?? ""), textContent: r.status }), h("span", { className: "rmsg", textContent: r.message || r.reason || "" })));
  } else if (!r.ok) {
    card.append(h("p", { className: "rwhy", textContent: "Won't be sent: " + (r.reason || "not allowed") }));
  }
  return card;
}

function renderReview() {
  const rows = RV.rows, okRows = rows.filter((r) => r.ok);
  $("reviewList").replaceChildren(...rows.map(reviewCard));
  const real = okRows.some((r) => !r.simulated);
  const o = $("orderForm").elements;
  $("rTitle").textContent = RV.phase === "sent" ? "Result" : "Review and send";
  $("rIntro").textContent = RV.phase === "sent" ? "This is what the broker answered. It is also in the send log."
    : o.symbol.value.trim().toUpperCase() + ": nothing is sent until you confirm. " + (real ? "Goes to your demo account(s)." : "Mock accounts: the answer is simulated.");
  const btn = $("doSend");
  if (RV.phase === "sent") {
    const again = rows.some((r) => r.status === "changed");
    btn.textContent = again ? "Review again" : "Done"; btn.disabled = false; btn.dataset.mode = again ? "again" : "done";
    $("rBack").hidden = true;
  } else {
    btn.textContent = okRows.length ? `Send ${okRows.length} order${okRows.length === 1 ? "" : "s"}` : "Nothing to send";
    btn.disabled = !okRows.length; btn.dataset.mode = "send"; $("rBack").hidden = false;
  }
}

async function startReview() {
  const f = $("orderForm");
  $("oMsg").textContent = "";
  if (!f.elements.symbol.value.trim()) { $("oMsg").textContent = "Choose a symbol."; return; } // first: a hidden field has no native message
  if (!f.reportValidity()) return;
  if (!TK.sel.size) { $("oMsg").textContent = "Switch on at least one account under Send to accounts."; document.querySelector(".sendbox").open = true; return; }
  const b = $("reviewBtn"); b.disabled = true;
  try {
    const { error, id } = await persistDraft(); // the server reads the saved draft, so save first
    if (error) { $("oMsg").textContent = saveError(error); return; }
    const r = await call("review", { order_id: id });
    RV = { orderId: id, rows: r.rows, phase: "review", side: f.elements.side.value };
    $("rMsg").textContent = ""; renderReview(); reviewSheet.hidden = false;
  } catch (e) { $("oMsg").textContent = e.message; }
  finally { b.disabled = false; }
}
$("reviewBtn").onclick = startReview;
$("rBack").onclick = () => { reviewSheet.hidden = true; };

$("doSend").onclick = async () => {
  const mode = $("doSend").dataset.mode;
  if (mode === "done") { reviewSheet.hidden = true; $("orderSheet").hidden = true; loadDrafts(); loadLog(); overview(); return; }
  if (mode === "again") { reviewSheet.hidden = true; loadDrafts(); loadLog(); overview(); return startReview(); }
  const expected = RV.rows.filter((r) => r.ok).map((r) => ({ account_id: r.account_id, lots: r.lots, orderType: r.orderType })); // what was confirmed is what the server must send
  $("doSend").disabled = true; $("rMsg").textContent = "";
  try {
    const r = await call("send", { order_id: RV.orderId, expected });
    RV.rows = r.rows; RV.phase = "sent";
    renderReview(); loadLog(); overview();
  } catch (e) { $("rMsg").textContent = e.message; $("doSend").disabled = false; }
};

// ---- the send log
async function loadLog() {
  const { data, error } = await sb.from("td_send_log").select("*").order("created_at", { ascending: false }).limit(30);
  if (error) return msg(error.message, true);
  $("logRows").replaceChildren(...(data.length ? data.map((l) => h("tr", {},
    cell(new Date(l.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })),
    cell(l.account_label),
    cell(`${l.symbol} ${l.side === "buy" ? "long" : "short"} ${l.order_type}${l.lots != null ? " " + l.lots + " lots" : ""}${l.entry != null ? " @ " + l.entry : ""}`+ (l.sl != null || l.tp != null ? " \u00b7 SL " + (pipsBetween(l.symbol, l.entry, l.sl) || "-") + " / TP " + (pipsBetween(l.symbol, l.entry, l.tp) || "-") + " pips" : "")),
    h("td", {}, h("span", { className: "pill " + (STATUS_PILL[l.status] ?? ""), textContent: l.status })),
    cell(l.message))) : [emptyRow(5, "Nothing sent yet.")]));
}

// ---- link again with the trading permission (the first link is view-only)
$("linkTrade").onclick = async () => {
  try { location.href = (await call("start", { redirect_uri: redirectUri, scope: "trading" })).url; } catch (e) { msg(e.message, true); }
};
