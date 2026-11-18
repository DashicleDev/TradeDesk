-- Remove all test/mock data and structures: the simulated trades table, mock accounts and their simulated log rows, and the is_mock flag.
delete from public.td_send_log where status = 'simulated';
delete from public.td_accounts where is_mock;
drop table public.td_sim;
alter table public.td_accounts drop column is_mock;
