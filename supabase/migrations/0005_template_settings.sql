-- More template settings (applied when sending, step 3; stored now).
-- fixed_*_pips: SL/TP distance from entry in pips, replaces the order's own value.
-- *_adjust_pips: widen (+) or tighten (-) the SL/TP by this many pips (e.g. to cover spread).
-- min_lots / max_lots: clamp the resulting lots. expiry_hours: pending order expires after N hours (null = good till cancelled).
-- comment: sent as the order comment/label (max 100 so it fits cTrader's label field).
alter table public.td_templates drop constraint td_templates_lot_mode_check;
alter table public.td_templates add constraint td_templates_lot_mode_check check (lot_mode in ('fixed', 'risk_pct', 'balance_pct', 'multiplier'));
alter table public.td_templates
  add column fixed_sl_pips numeric check (fixed_sl_pips > 0),
  add column fixed_tp_pips numeric check (fixed_tp_pips > 0),
  add column sl_adjust_pips numeric not null default 0,
  add column tp_adjust_pips numeric not null default 0,
  add column min_lots numeric check (min_lots > 0),
  add column max_lots numeric check (max_lots > 0),
  add column expiry_hours numeric check (expiry_hours > 0),
  add column comment text check (char_length(comment) <= 100),
  add constraint td_templates_lots_range check (min_lots is null or max_lots is null or min_lots <= max_lots);
