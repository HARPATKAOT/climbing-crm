-- Expense-inbox automation: read-only financial movements, invoice matching,
-- and an auditable accountant delivery journal. Never stores bank credentials
-- or full card/account numbers.
create table if not exists public.finance_bank_transactions (
  id text primary key,
  source text not null,
  provider text not null,
  account_type text not null check (account_type in ('bank','credit_card')),
  account_last4 text,
  external_id text,
  transaction_date date not null,
  description text not null,
  amount numeric(14,2) not null,
  currency text not null default 'ILS',
  imported_at timestamptz not null default now(),
  imported_by text
);

create index if not exists finance_bank_transactions_date_idx
  on public.finance_bank_transactions(transaction_date);

create table if not exists public.finance_expense_matches (
  id text primary key,
  expense_id text not null references public.finance_expenses(id) on delete cascade,
  transaction_id text not null references public.finance_bank_transactions(id) on delete cascade,
  status text not null check (status in ('matched','review','superseded')),
  confidence numeric(5,4) not null,
  score integer not null,
  reasons text[] not null default '{}',
  amount_difference numeric(14,2),
  date_difference_days integer,
  method text not null,
  matched_at timestamptz,
  matched_by text,
  unique(expense_id, transaction_id)
);

create table if not exists public.finance_accountant_deliveries (
  id text primary key,
  expense_id text not null references public.finance_expenses(id) on delete cascade,
  attachment_id text not null,
  phone_last4 text,
  status text not null,
  sent_at timestamptz,
  meta_message_id text,
  error text,
  unique(expense_id, attachment_id)
);

alter table public.finance_bank_transactions enable row level security;
alter table public.finance_expense_matches enable row level security;
alter table public.finance_accountant_deliveries enable row level security;
