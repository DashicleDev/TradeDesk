-- Removed from templates: reverse direction and symbol mapping (not needed; a broker with a different pair name gets a clear "pair not found" at send time).
alter table public.td_templates drop column reverse, drop column symbol_map;
