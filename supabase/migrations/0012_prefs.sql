-- Per-user ticket defaults: the risk % and the preset balance that "Auto" quantity is worked out from
-- (lots = preset balance x risk % / (stop pips x pip value)). One row per user, own rows only.
create table public.td_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  risk_pct numeric not null default 1 check (risk_pct > 0 and risk_pct <= 100),
  ref_balance numeric not null default 100000 check (ref_balance > 0),
  updated_at timestamptz not null default now()
);
alter table public.td_prefs enable row level security;
create policy td_prefs_own on public.td_prefs for all
  using (user_id = auth.uid() and (select public.is_approved()))
  with check (user_id = auth.uid() and (select public.is_approved()));
revoke all on public.td_prefs from anon;
grant select, insert, update on public.td_prefs to authenticated;
