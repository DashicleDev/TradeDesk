-- Which accounts were ticked for an order, and the template picked for each: [{"account_id": "...", "template_id": "..." | null}].
-- Stored with the draft so reopening it restores the selection. Sending (step 3) will read it.
alter table public.td_orders
  add column targets jsonb not null default '[]' check (jsonb_typeof(targets) = 'array');
