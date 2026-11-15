-- Order ticket: limit or stop (pending orders only; market orders can't carry an absolute SL/TP), and an optional expiry.
alter table public.td_orders
  add column order_type text not null default 'limit' check (order_type in ('limit', 'stop')),
  add column expires_at timestamptz;
