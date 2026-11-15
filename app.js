const sb = supabase.createClient(TD.SUPABASE_URL, TD.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const msg = (t, err) => { $("msg").textContent = t || ""; $("msg").className = err ? "err" : ""; };
const redirectUri = location.origin + location.pathname;

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
    $("rows").replaceChildren(...accounts.map(a => {
      const tr = document.createElement("tr");
      const cells = a.error
        ? [a.label, a.is_live ? "live" : "demo", a.error, "", "", ""]
        : [a.label, a.is_live ? "live" : "demo", a.balance, a.equity, a.positions, a.orders];
      cells.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c ?? ""; if (i === 1) td.className = c; tr.append(td); });
      return tr;
    }));
    msg(accounts.length ? "" : "No accounts linked yet.");
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
  $("auth").hidden = !!session; $("main").hidden = !session;
  if (session) { await handleCallback(); overview(); }
}

$("login").onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("pw").value });
  if (error) alert(error.message);
};
$("logout").onclick = () => sb.auth.signOut();
$("refresh").onclick = overview;
$("link").onclick = async () => {
  try { location.href = (await call("start", { redirect_uri: redirectUri })).url; } catch (e) { msg(e.message, true); }
};
sb.auth.onAuthStateChange((_e, s) => show(s));
sb.auth.getSession().then(({ data }) => show(data.session));
