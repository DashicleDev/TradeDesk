// The look follows the journal: same theme, same two accent colours. The journal keeps them in its settings document (Supabase `docs`,
// id "settings") and mirrors them in localStorage "tj-look" on this domain; Desk reads that mirror at once (no flash) and refreshes it
// from the document after sign-in (settings.js). The colour tables are the journal's own (js/settings.js there).
const ACCENTS = [
  ["blue", "Blue", "#2230d6", "#8590ff"],
  ["violet", "Violet", "#6b3fd4", "#a98bff"],
  ["teal", "Teal", "#0f7f86", "#45c4c9"],
  ["green", "Green", "#1f7a46", "#5cc98a"],
  ["rose", "Rose", "#b8326a", "#f07aa8"],
  ["slate", "Slate", "#3b4664", "#a3acc6"],
];
const ACCENTS2 = [
  ["orange", "Orange", "#d0601b", "#f08c4c"],
  ["amber", "Amber", "#a96f12", "#e8b04b"],
  ["red", "Red", "#c3342b", "#f06c60"],
  ["pink", "Pink", "#b8326a", "#f07aa8"],
  ["green", "Green", "#1f7a46", "#5cc98a"],
  ["teal", "Teal", "#0f7f86", "#45c4c9"],
];
const LOOK_KEY = "tj-look";
const LOOK_DEFAULT = { theme: "system", accent: "blue", accent2: "orange" };

function readLook() {
  try { return { ...LOOK_DEFAULT, ...JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") }; } catch { return { ...LOOK_DEFAULT }; }
}
// Keep the journal's other keys (period, grade rules) as they are: only theme and the two accents are ours to touch.
function writeLookLocal(patch) {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(LOOK_KEY) || "{}"), ...patch })); } catch { /* storage blocked: still applied for this visit */ }
}
function applyLook(st) {
  const r = document.documentElement;
  if (st.theme === "system") delete r.dataset.theme; else r.dataset.theme = st.theme;
  const dark = st.theme === "dark" || st.theme === "black" || (st.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const a = ACCENTS.find((x) => x[0] === st.accent) || ACCENTS[0];
  r.style.setProperty("--accent", dark ? a[3] : a[2]);
  const a2 = ACCENTS2.find((x) => x[0] === st.accent2) || ACCENTS2[0];
  r.style.setProperty("--live", dark ? a2[3] : a2[2]);
}
applyLook(readLook());
