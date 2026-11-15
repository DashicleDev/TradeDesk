-- Step 3: the send log. One row per account an order was sent (or refused) to, with the broker's answer.
-- Written only by the Edge Function (service role); the page can read its own rows, nothing else.
-- Rows with a client_order_id are real attempts: the unique index makes a second send of the same order to the same
-- account impossible (no double orders). 'blocked' and 'changed' rows are not attempts and carry no client_order_id.
create table public.td_send_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  order_id uuid references public.td_orders on delete set null,
  account_id uuid references public.td_accounts on delete set null,
  account_label text not null,
  is_live boolean not null default false,
  symbol text not null,
  side text not null,
  order_type text not null,
  lots numeric,
  entry numeric,
  sl numeric,
  tp numeric,
  template_name text,
  status text not null check (status in ('pending', 'sent', 'simulated', 'rejected', 'unknown', 'blocked', 'changed')),
  message text,
  broker_response jsonb,
  client_order_id text,
  created_at timestamptz not null default now()
);
create unique index td_send_log_attempt on public.td_send_log (client_order_id) where client_order_id is not null;
create index td_send_log_user_time on public.td_send_log (user_id, created_at desc);
alter table public.td_send_log enable row level security;
create policy td_send_log_select on public.td_send_log for select using (user_id = auth.uid() and (select public.is_approved()));
revoke all on public.td_send_log from anon, authenticated;
grant select on public.td_send_log to authenticated;
