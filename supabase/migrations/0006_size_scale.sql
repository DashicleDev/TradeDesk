-- "Scale to account size": lots = order lots x (account starting size / reference size). lot_value holds the reference size.
alter table public.td_templates drop constraint td_templates_lot_mode_check;
alter table public.td_templates add constraint td_templates_lot_mode_check check (lot_mode in ('fixed', 'risk_pct', 'balance_pct', 'multiplier', 'size_scale'));
