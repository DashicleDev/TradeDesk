// shortcut: no cross-tab auth lock. The journal shares this browser session and a stuck lock left the page blank; if both tabs refresh at once supabase tolerates it (refresh-token reuse window).
const sb = supabase.createClient(TD.SUPABASE_URL, TD.SUPABASE_ANON_KEY, { auth: { lock: async (_n, _t, fn) => await fn() } });
const $ = id => document.getElementById(id);
const msg = (t, err) => { $("msg").textContent = t || ""; $("msg").className = err ? "msg err" : "msg"; };
const fmt = (n) => (typeof n === "number" ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n);
const BAL = {}; // account id -> current balance, from the last overview
const redirectUri = location.origin + location.pathname;

const emptyRow = (cols, text) => { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = cols; td.className = "empty"; td.textContent = text; tr.append(td); return tr; };

async function call(action, body = {}) {
  const { data, error } = await sb.functions.invoke("ctrader", { body: { action, ...body } });
  if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error || error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

async function overview() {
  msg("Loading…");
  try {
    const { accounts } = await call("overview");
    accounts.forEach((a) => { if (typeof a.balance === "number") BAL[a.id] = a.balance; });
    $("rows").replaceChildren(...accounts.map(a => {
      const tr = document.createElement("tr");
      const cells = a.error
        ? [a.label, a.is_live ? "live" : "demo", a.error, "", "", ""]
        : [a.label, a.is_live ? "live" : "demo", fmt(a.balance), fmt(a.equity), a.positions, a.orders];
      cells.forEach((c, i) => {
        const td = document.createElement("td");
        if (i === 1) { const p = document.createElement("span"); p.className = "pill " + (c === "live" ? "warn" : "ok"); p.textContent = c; td.append(p); }
        else { td.textContent = c ?? ""; if (i >= 2) td.className = a.error ? "r" : "r num"; }
        tr.append(td);
      });
      return tr;
    }));
    if (!accounts.length) $("rows").replaceChildren(emptyRow(6, "No accounts linked yet. Link one on the Accounts tab."));
    const trades = accounts.flatMap((a) => (a.trades || []).map((t) => ({ ...t, account: a.label })));
    POSITIONS = trades.filter((t) => t.kind === "position");
    ACCT_DATA = accounts; PENDING = trades.filter((t) => t.kind === "pending");
    renderStats(); renderWatch(); refreshPrices();
    msg("");
  } catch (e) { msg(e.message, true); }
}

async function handleCallback() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return;
  history.replaceState({}, "", redirectUri);
  msg("Linking…");
  try { await call("exchange", { code, redirect_uri: redirectUri }); } catch (e) { return msg(e.message, true); }
}

async function show(session) {
  if (!session) { $("auth").hidden = false; $("authForm").hidden = false; $("pendBox").hidden = true; $("main").hidden = true; return; }
  const { data: ok } = await sb.rpc("is_approved"); // same approval as the journal
  $("auth").hidden = !!ok; $("authForm").hidden = true; $("pendBox").hidden = !!ok; $("main").hidden = !ok;
  if (ok) { loadDesk(); await handleCallback(); overview(); }
}

let signup = false;
$("aMode").onclick = () => {
  signup = !signup;
  $("aGo").textContent = signup ? "Create account" : "Sign in";
  $("aMode").textContent = signup ? "Already have an account? Sign in" : "First time here? Create your account";
};
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const c = { email: $("aEmail").value, password: $("aPass").value };
  const { error } = signup ? await sb.auth.signUp(c) : await sb.auth.signInWithPassword(c);
  if (error) $("authMsg").textContent = error.message;
};
$("pendCheck").onclick = async () => show((await sb.auth.getSession()).data.session);
$("pendOut").onclick = () => sb.auth.signOut();
$("logout").onclick = () => sb.auth.signOut();
$("refresh").onclick = overview;
$("link").onclick = async () => {
  try { location.href = (await call("start", { redirect_uri: redirectUri })).url; } catch (e) { msg(e.message, true); }
};
// setTimeout: calling supabase inside this callback deadlocks. Skip repeat events for the same user (tab focus, token refresh).
let shownFor;
sb.auth.onAuthStateChange((ev, s) => setTimeout(() => {
  const id = s?.user?.id ?? null;
  if (ev !== "INITIAL_SESSION" && id === shownFor) return;
  shownFor = id; show(s);
}, 0));
