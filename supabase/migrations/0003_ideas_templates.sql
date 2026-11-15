-- Trade Desk step 2: saved ideas and templates. No sending yet. Rows are locked to the signed-in, approved user.
create table public.td_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  lot_mode text not null check (lot_mode in ('fixed', 'risk_pct', 'multiplier')),
  lot_value numeric not null check (lot_value > 0),
  copy_sl boolean not null default true,
  copy_tp boolean not null default true,
  reverse boolean not null default false,
  max_open int check (max_open > 0),
  max_risk_pct numeric check (max_risk_pct > 0),
  symbol_map jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.td_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  lots numeric not null check (lots > 0),
  entry numeric not null,
  sl numeric,
  tp numeric,
  note text,
  status text not null default 'open' check (status in ('open', 'sent', 'archived')),
  created_at timestamptz not null default now(),
  -- stop loss on the losing side of entry, take profit on the winning side
  check (sl is null or (side = 'buy' and sl < entry) or (side = 'sell' and sl > entry)),
  check (tp is null or (side = 'buy' and tp > entry) or (side = 'sell' and tp < entry))
);

alter table public.td_accounts
  add column start_balance numeric check (start_balance > 0),  -- for "% of starting size" risk
  add column default_template_id uuid references public.td_templates on delete set null;

alter table public.td_templates enable row level security;
alter table public.td_ideas enable row level security;
create policy td_templates_own on public.td_templates for all
  using (user_id = auth.uid() and (select public.is_approved()))
  with check (user_id = auth.uid() and (select public.is_approved()));
create policy td_ideas_own on public.td_ideas for all
  using (user_id = auth.uid() and (select public.is_approved()))
  with check (user_id = auth.uid() and (select public.is_approved()));
revoke all on public.td_templates, public.td_ideas from anon;
grant select, insert, update, delete on public.td_templates, public.td_ideas to authenticated;
