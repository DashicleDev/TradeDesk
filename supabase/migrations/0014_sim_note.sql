-- Simulated trades keep the note written on the order, so the dashboard can show it.
alter table public.td_sim add column note text;
