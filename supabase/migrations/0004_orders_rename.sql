-- "Ideas" are orders: a draft until sent. Same table, renamed; status draft / sent / archived.
alter table public.td_ideas rename to td_orders;
alter policy td_ideas_own on public.td_orders rename to td_orders_own;
alter table public.td_orders drop constraint td_ideas_status_check;
update public.td_orders set status = 'draft' where status = 'open';
alter table public.td_orders alter column status set default 'draft';
alter table public.td_orders add constraint td_orders_status_check check (status in ('draft', 'sent', 'archived'));
