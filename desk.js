// Step 2: orders (saved as drafts until sent) + templates. No sending yet. Straight supabase-js calls; row-level security does the locking.
// Uses sb, $, msg from app.js. User text goes in via textContent only.
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const num = (v) => (v === "" || v == null ? null : Number(v));
const cell = (t, cls) => h("td", { textContent: t ?? "", className: cls || "" });
const numCell = (t) => cell(t, "r num");
const delBtn = (table, id, reload) => h("td", { className: "r" }, h("button", { className: "btn small ghost danger", textContent: "Delete", onclick: () => del(table, id, reload) }));

document.querySelectorAll("nav [data-tab]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav [data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
  ["tDash", "tAccounts", "tTemplates"].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
}));

document.querySelectorAll(".sheet [data-close]").forEach((b) => (b.onclick = () => (b.closest(".sheet").hidden = true)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".sheet:not([hidden])").forEach((s) => (s.hidden = true)); });

async function del(table, id, reload) {
  if (!confirm("Delete this?")) return;
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) return msg(error.message, true);
  reload();
}

async function loadDrafts() {
  const { data, error } = await sb.from("td_orders").select("*").eq("status", "draft").order("created_at", { ascending: false });
  if (error) return msg(error.message, true);
  $("draftRows").replaceChildren(...(data.length ? data.map((i) => h("tr", {},
    cell(i.symbol), cell(i.side === "buy" ? "Long" : "Short", i.side === "buy" ? "long" : "short"), cell(i.order_type === "stop" ? "Stop" : "Limit"), numCell(i.lots), numCell(i.entry), numCell(i.sl), numCell(i.tp), cell(i.note),
    delBtn("td_orders", i.id, loadDrafts))) : [emptyRow(9, "No drafts yet. Use the + button.")]));
}


const lotText = (t) => ({ fixed: `${t.lot_value} lots`, risk_pct: `${t.lot_value}% of starting size at risk`, balance_pct: `${t.lot_value}% of balance at risk`, multiplier: `${t.lot_value}× order lots`, size_scale: `scaled to account size (reference ${t.lot_value})` })[t.lot_mode];
const slTpText = (t) => [
  t.fixed_sl_pips ? `SL ${t.fixed_sl_pips} pips` : t.copy_sl ? "SL copied" : "no SL",
  t.fixed_tp_pips ? `TP ${t.fixed_tp_pips} pips` : t.copy_tp ? "TP copied" : "no TP",
  t.sl_adjust_pips ? `SL ${t.sl_adjust_pips > 0 ? "+" : ""}${t.sl_adjust_pips}` : "", t.tp_adjust_pips ? `TP ${t.tp_adjust_pips > 0 ? "+" : ""}${t.tp_adjust_pips}` : ""].filter(Boolean).join(", ");
const limitText = (t) => [t.max_open && `max ${t.max_open} open`, t.max_risk_pct && `max ${t.max_risk_pct}% risk`, t.min_lots && `min ${t.min_lots} lots`, t.max_lots && `max ${t.max_lots} lots`, t.expiry_hours && `expires ${t.expiry_hours}h`].filter(Boolean).join(", ") || "none";

let templates = [];
async function loadTemplates() {
  const { data, error } = await sb.from("td_templates").select("*").order("created_at");
  if (error) return msg(error.message, true);
  templates = data;
  $("tplRows").replaceChildren(...(data.length ? data.map((t) => h("tr", {},
    cell(t.name), cell(lotText(t)),
    cell(limitText(t)), cell(slTpText(t)),
    h("td", { className: "r" },
      h("button", { className: "btn small ghost", textContent: "Edit", onclick: () => openTpl(t) }), " ",
      h("button", { className: "btn small ghost danger", textContent: "Delete", onclick: () => del("td_templates", t.id, loadTemplates) })))) : [emptyRow(5, "No templates yet. Use “New template”.")]));
  loadAccounts();
}

// Template editor: collapsible sections in a bottom sheet. Use f.elements[...]: form.name is the form's own name, not the field.
const tplSheet = $("tplSheet"), tplForm = $("tplForm");
let editingTpl = null;
const LOT_LBL = { fixed: "Lots", multiplier: "Multiplier (×)", size_scale: "Reference account size", risk_pct: "Risk (% of starting size)", balance_pct: "Risk (% of balance)" };
const LOT_HELP = {
  fixed: "Every account trades exactly this many lots, whatever its size. Example: 0.5 means 0.5 lots on every account.",
  multiplier: "The order's lots times this number. Example: an order of 2 lots with 0.5 gives 1 lot; with 2 it gives 4 lots.",
  size_scale: "The order's lots are written for a reference account size. Each account gets lots in proportion to its starting size. Example: order 5 lots, reference 100000: a 200k account gets 10 lots, a 10k account 0.5. Needs each account's starting size (Accounts tab). An account too small for the broker's minimum lot is skipped.",
  risk_pct: "Lots are sized so that if the stop loss is hit you lose this % of the account's starting size. Example: 1 on a 100k account risks 1,000. Needs a stop loss on the order and the account's starting size (Accounts tab).",
  balance_pct: "Like the one above, but measured on the current balance: the money at risk shrinks after losses and grows after wins. Needs a stop loss on the order.",
};
const syncLotLbl = () => { const m = tplForm.elements.lot_mode.value; $("lotValLbl").textContent = LOT_LBL[m]; $("lotHelp").textContent = LOT_HELP[m]; };
tplForm.elements.lot_mode.onchange = syncLotLbl;
function openTpl(t) {
  editingTpl = t?.id ?? null;
  $("tMsg").textContent = "";
  tplForm.reset();
  $("tTitle").textContent = t ? "Edit template" : "New template";
  if (t) for (const el of tplForm.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") el.checked = !!t[el.name];
    else el.value = t[el.name] ?? "";
  }
  syncLotLbl();
  tplSheet.hidden = false;
  tplForm.elements.name.focus();
}
$("newTpl").onclick = () => openTpl();

tplForm.onsubmit = async (e) => {
  e.preventDefault();
  const el = tplForm.elements, v = (n) => el[n].value;
  const row = { name: v("name").trim(), lot_mode: v("lot_mode"), lot_value: num(v("lot_value")), max_open: num(v("max_open")), max_risk_pct: num(v("max_risk_pct")),
    copy_sl: el.copy_sl.checked, copy_tp: el.copy_tp.checked,
    fixed_sl_pips: num(v("fixed_sl_pips")), fixed_tp_pips: num(v("fixed_tp_pips")), sl_adjust_pips: num(v("sl_adjust_pips")) ?? 0, tp_adjust_pips: num(v("tp_adjust_pips")) ?? 0,
    min_lots: num(v("min_lots")), max_lots: num(v("max_lots")), expiry_hours: num(v("expiry_hours")), comment: v("comment").trim() || null };
  const { error } = editingTpl ? await sb.from("td_templates").update(row).eq("id", editingTpl) : await sb.from("td_templates").insert(row);
  if (error) { $("tMsg").textContent = error.code === "23514" ? "A value is out of range (for example minimum lots above maximum lots)." : error.message; return; }
  $("tMsg").textContent = ""; tplSheet.hidden = true; loadTemplates();
};

async function loadAccounts() {
  const { data, error } = await sb.from("td_accounts").select("id,label,is_live,default_template_id,start_balance").order("created_at");
  if (error) return msg(error.message, true);
  // "Send to" list in the order form: pick accounts and a template per account (sending itself is step 3)
  $("sendTo").replaceChildren(...(data.length ? data.map((a) => {
    const sel = h("select", {}, h("option", { value: "", textContent: "no template" }), ...templates.map((t) => h("option", { value: t.id, textContent: t.name })));
    sel.value = a.default_template_id || "";
    return h("div", { className: "sendrow" }, h("input", { type: "checkbox", value: a.id }), h("span", { textContent: a.label }),
      h("span", { className: "pill " + (a.is_live ? "warn" : "ok"), textContent: a.is_live ? "live" : "demo" }), sel);
  }) : [h("p", { className: "hint", textContent: "No accounts linked yet." })]));
  const save = async (id, patch) => { const { error: er } = await sb.from("td_accounts").update(patch).eq("id", id); if (er) msg(er.message, true); };
  if (!data.length) return $("accRows").replaceChildren(emptyRow(3, "No accounts linked yet."));
  $("accRows").replaceChildren(...data.map((a) => {
    const sel = h("select", { onchange: () => save(a.id, { default_template_id: sel.value || null }) },
      h("option", { value: "", textContent: "none" }), ...templates.map((t) => h("option", { value: t.id, textContent: t.name })));
    sel.value = a.default_template_id || "";
    const bal = h("input", { type: "number", step: "any", min: "0", value: a.start_balance ?? "", onchange: () => save(a.id, { start_balance: num(bal.value) }) });
    return h("tr", {}, cell(a.label), h("td", {}, sel), h("td", { className: "r" }, bal));
  }));
}

function loadDesk() { loadDrafts(); loadTemplates(); }
