-- Test accounts: rows flagged is_mock get fake numbers from the function and never contact cTrader.
alter table public.td_accounts add column is_mock boolean not null default false;
-- Remove them with: delete from public.td_accounts where is_mock;
