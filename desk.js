// Step 2: ideas + templates. No sending yet. Straight supabase-js calls; row-level security does the locking.
// Uses sb, $, msg from app.js. User text goes in via textContent only.
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const num = (v) => (v === "" || v == null ? null : Number(v));
const cell = (t, cls) => h("td", { textContent: t ?? "", className: cls || "" });
const numCell = (t) => cell(t, "r num");
const delBtn = (table, id, reload) => h("td", { className: "r" }, h("button", { className: "btn small ghost danger", textContent: "Delete", onclick: () => del(table, id, reload) }));

document.querySelectorAll("nav [data-tab]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav [data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
  ["tOverview", "tIdeas", "tTemplates"].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
}));

async function del(table, id, reload) {
  if (!confirm("Delete this?")) return;
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) return msg(error.message, true);
  reload();
}

async function loadIdeas() {
  const { data, error } = await sb.from("td_ideas").select("*").neq("status", "archived").order("created_at", { ascending: false });
  if (error) return msg(error.message, true);
  $("ideaRows").replaceChildren(...(data.length ? data.map((i) => h("tr", {},
    cell(i.symbol), cell(i.side === "buy" ? "Long" : "Short", i.side === "buy" ? "long" : "short"), numCell(i.lots), numCell(i.entry), numCell(i.sl), numCell(i.tp), cell(i.note),
    delBtn("td_ideas", i.id, loadIdeas))) : [emptyRow(8, "No ideas yet. Save one above.")]));
}

$("ideaForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const row = { symbol: f.symbol.value.trim().toUpperCase(), side: f.side.value, lots: num(f.lots.value), entry: num(f.entry.value), sl: num(f.sl.value), tp: num(f.tp.value), note: f.note.value.trim() || null };
  const { error } = await sb.from("td_ideas").insert(row);
  if (error) return msg(error.code === "23514" ? "SL must be on the losing side of entry and TP on the winning side." : error.message, true);
  msg(""); f.reset(); loadIdeas();
};

const parseMap = (t) => Object.fromEntries(t.split("\n").map((l) => l.split("=").map((s) => s.trim())).filter(([a, b]) => a && b));
const lotText = (t) => ({ fixed: `${t.lot_value} lots`, risk_pct: `${t.lot_value}% at risk`, multiplier: `${t.lot_value}× idea` })[t.lot_mode];

let templates = [];
async function loadTemplates() {
  const { data, error } = await sb.from("td_templates").select("*").order("created_at");
  if (error) return msg(error.message, true);
  templates = data;
  $("tplRows").replaceChildren(...(data.length ? data.map((t) => h("tr", {},
    cell(t.name), cell(lotText(t) + (t.reverse ? ", reversed" : "")),
    cell([t.max_open && `max ${t.max_open} open`, t.max_risk_pct && `max ${t.max_risk_pct}% risk`].filter(Boolean).join(", ") || "none"),
    cell([t.copy_sl ? "SL" : "no SL", t.copy_tp ? "TP" : "no TP"].join(" / ")),
    delBtn("td_templates", t.id, loadTemplates))) : [emptyRow(5, "No templates yet. Save one above.")]));
  loadAccounts();
}

$("tplForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const row = { name: f.name.value.trim(), lot_mode: f.lot_mode.value, lot_value: num(f.lot_value.value), max_open: num(f.max_open.value), max_risk_pct: num(f.max_risk_pct.value),
    copy_sl: f.copy_sl.checked, copy_tp: f.copy_tp.checked, reverse: f.reverse.checked, symbol_map: parseMap(f.symbol_map.value) };
  const { error } = await sb.from("td_templates").insert(row);
  if (error) return msg(error.message, true);
  msg(""); f.reset(); f.copy_sl.checked = f.copy_tp.checked = true; loadTemplates();
};

async function loadAccounts() {
  const { data, error } = await sb.from("td_accounts").select("id,label,default_template_id,start_balance").order("created_at");
  if (error) return msg(error.message, true);
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

function loadDesk() { loadIdeas(); loadTemplates(); }
