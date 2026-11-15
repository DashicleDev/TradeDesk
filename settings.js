// Settings: the same window as the journal's (gear button, tabs, theme chips, round swatches, "Done"). Look is shared with the journal;
// Trading holds the Auto quantity numbers. Uses sb, $, h, msg, readLook, applyLook, writeLookLocal, ACCENTS, ACCENTS2 (earlier files).
const setSheet = $("setSheet");

// ---- a small confirmation at the bottom, like the journal's
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

// ---- Look
const THEMES = [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["black", "Black"]];
$("seg-theme").innerHTML = THEMES.map(([k, l]) => `<label class="seg"><input type="radio" name="stheme" value="${k}"><span>${l}</span></label>`).join("");
const swatch = (name) => ([k, l, c]) => `<label title="${l}"><input type="radio" name="${name}" value="${k}" aria-label="${l}"><span style="background:${c}"></span></label>`;
$("sAccent").innerHTML = ACCENTS.map(swatch("saccent")).join("");
$("sAccent2").innerHTML = ACCENTS2.map(swatch("saccent2")).join("");

const setRadio = (name, v) => { const el = setSheet.querySelector(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
function showLook() {
  const st = readLook();
  setRadio("stheme", st.theme); setRadio("saccent", st.accent); setRadio("saccent2", st.accent2);
}

// What the journal saved to the account, if anything: refresh the local copy and apply it.
async function loadLook() {
  const { data } = await sb.from("docs").select("data").eq("id", "settings").maybeSingle();
  const d = data?.data;
  if (!d || !(d.theme || d.accent || d.accent2)) return;
  const patch = {};
  for (const k of ["theme", "accent", "accent2"]) if (d[k]) patch[k] = d[k];
  writeLookLocal(patch); applyLook(readLook()); showLook();
}

// Change the look here: applied at once, then written into the same settings document the journal uses. Only theme, accent and accent2
// are written: the rest of that document (grading rules, periods...) is read and put back as it was.
async function saveLook(patch) {
  writeLookLocal(patch); applyLook(readLook());
  const { data } = await sb.from("docs").select("data").eq("id", "settings").maybeSingle();
  const merged = { id: "settings", kind: "settings", ...(data?.data || {}), ...patch };
  const { error } = data
    ? await sb.from("docs").update({ data: merged, updated_at: new Date().toISOString() }).eq("id", "settings")
    : await sb.from("docs").insert({ id: "settings", data: merged });
  toast(error ? "Not saved: " + error.message : "Saved to your account");
}
setSheet.addEventListener("change", (e) => {
  const n = e.target.name;
  if (n === "stheme") saveLook({ theme: e.target.value });
  else if (n === "saccent") saveLook({ accent: e.target.value });
  else if (n === "saccent2") saveLook({ accent2: e.target.value });
});

// ---- tabs and the gear button
function showSetTab(t) {
  setSheet.querySelectorAll("[data-settab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.settab === t));
  setSheet.querySelectorAll("[data-setpane]").forEach((p) => (p.hidden = p.dataset.setpane !== t));
}
setSheet.querySelectorAll("[data-settab]").forEach((b) => (b.onclick = () => showSetTab(b.dataset.settab)));
$("openSettings").onclick = () => { showLook(); showPrefs(); showSetTab("look"); setSheet.hidden = false; };
$("setDone").onclick = () => { setSheet.hidden = true; };
