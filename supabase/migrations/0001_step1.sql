-- Trade Desk step 1, for the journal's Supabase project (shares its logins and approval).
-- Own td_ tables only. Rows are locked to the signed-in, approved user.
create table public.td_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ctid_account_id bigint not null,
  label text,
  is_live boolean not null,
  broker text,
  login bigint,
  created_at timestamptz not null default now(),
  unique (user_id, ctid_account_id)
);
alter table public.td_accounts enable row level security;
-- page may read, rename and unlink; rows are inserted by the Edge Function (service role)
create policy td_accounts_select on public.td_accounts for select using (user_id = auth.uid() and (select public.is_approved()));
create policy td_accounts_update on public.td_accounts for update using (user_id = auth.uid() and (select public.is_approved())) with check (user_id = auth.uid());
create policy td_accounts_delete on public.td_accounts for delete using (user_id = auth.uid() and (select public.is_approved()));
revoke all on public.td_accounts from anon;
grant select, update, delete on public.td_accounts to authenticated;

create table public.td_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text
);
alter table public.td_tokens enable row level security;  -- no policies: only service role
revoke all on public.td_tokens from anon, authenticated;
