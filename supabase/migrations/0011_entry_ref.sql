-- The market price (bid for a sell, ask for a buy) at the moment the entry was set. It tells the server whether the order was meant as a
-- limit (entry on the better side of that price) or a stop, so a limit the price has since passed can be sent at market instead.
-- Null when the page had no live price: then no auto-conversion happens.
alter table public.td_orders add column entry_ref numeric;
