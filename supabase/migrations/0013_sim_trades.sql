-- Simulated orders and positions on mock accounts (td_accounts.is_mock), so the whole flow can be tried before a real account is linked.
-- Written and read only by the Edge Function (service role). A mock send creates a row: 'pending' (waiting for the price) or 'open' (running).
create table public.td_sim (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references public.td_accounts on delete cascade,
  symbol text not null,
  side text not null,
  lots numeric not null,
  entry numeric not null,
  sl numeric,
  tp numeric,
  status text not null default 'pending' check (status in ('pending', 'open', 'closed')),
  close_price numeric,
  created_at timestamptz not null default now()
);
create index td_sim_user on public.td_sim (user_id, status);
alter table public.td_sim enable row level security;
revoke all on public.td_sim from anon, authenticated;
