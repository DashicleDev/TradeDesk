# Trade Desk

Personal multi-account order ticket + dashboard on cTrader. Design: `SPEC.md`. Separate from the TradeJournal repo and its extensions; never import from or push to them.

## Rules
- Claude never places trades or orders. The user runs any test that sends an order, demo accounts first.
- API secrets and tokens never go in chat, in the repo, or in client-side code. The user puts secrets into Supabase themselves.
- No commit, push, remote or release unless the user says so.
- Keep changes small and terse. Give an honest opinion.
- Prop firms (FTMO, FundingPips) may treat one trade sent to several accounts as copy trading: flag it wherever sending to multiple accounts comes up.
- Build in the order in SPEC.md; don't start a step before the user says so.
