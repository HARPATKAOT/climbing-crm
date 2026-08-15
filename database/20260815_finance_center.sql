-- מרכז פיננסי (FINANCE_SPEC.md) — התאום המנורמל של אוספי ה-kv.
-- Run once in the Supabase SQL editor. The application runs entirely on
-- kv_collections until these tables exist; nothing breaks if this waits.
-- Amounts are AGOROT integers (bigint), never floats — the kv records use the
-- same unit, so a future backfill is a straight copy.
--
-- DOWN (reverse order):
--   drop table if exists public.icount_links, public.icount_outbox,
--     public.finance_inbox_items, public.finance_rules, public.finance_cc_cycles,
--     public.finance_cash_flow_items, public.finance_cost_allocations,
--     public.finance_ledger_entries, public.finance_cost_centers,
--     public.finance_categories, public.finance_matches,
--     public.finance_transactions, public.financial_accounts,
--     public.finance_center_settings cascade;

create table if not exists public.financial_accounts (
  id text primary key,
  type text not null check (type in ('bank','credit_card','cash','clearing')),
  institution text not null default '',
  display_name text not null default '',
  last4 text,
  currency text not null default 'ILS',
  credential_shape jsonb,            -- שמות השדות הנדרשים בלבד; לעולם לא ערכים
  is_active boolean not null default true,
  branch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_transactions (
  id text primary key,
  account_id text not null references public.financial_accounts(id),
  external_id text,
  booking_date date not null,
  value_date date,
  amount_agorot bigint not null,      -- חתום: הוצאה שלילית, הכנסה חיובית
  currency text not null default 'ILS',
  raw_description text not null default '',
  merchant_raw text not null default '',
  direction text not null check (direction in ('in','out')),
  kind text not null check (kind in
    ('income','expense','transfer','settlement','fee','refund','installment_future')),
  status text not null default 'new' check (status in ('new','classified','matched','voided')),
  category_id text,
  supplier_id text,
  cc_cycle_id text,
  installment_number integer,
  installments_total integer,
  dedupe_hash text not null unique,
  source text not null default 'scraper' check (source in ('scraper','csv','manual','icount')),
  raw_json jsonb,
  voided_at timestamptz,
  voided_by text,
  branch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_transactions_date_idx on public.finance_transactions(booking_date);
create index if not exists finance_transactions_kind_idx on public.finance_transactions(kind, status);
create index if not exists finance_transactions_account_idx on public.finance_transactions(account_id, booking_date);

create table if not exists public.finance_matches (
  id text primary key,
  transaction_id text not null references public.finance_transactions(id),
  document_id text not null,          -- מצביע ל-finance_documents (kv) — FK רך
  allocated_agorot bigint not null,
  confidence integer not null default 0,
  score_breakdown jsonb,
  method text not null check (method in ('auto','rule','manual')),
  status text not null default 'proposed' check (status in ('proposed','confirmed','rejected','superseded')),
  matched_by text,
  matched_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists finance_matches_txn_idx on public.finance_matches(transaction_id);
create index if not exists finance_matches_doc_idx on public.finance_matches(document_id);

create table if not exists public.finance_categories (
  id text primary key,
  parent_id text references public.finance_categories(id),
  name text not null,
  cost_behavior text not null default 'variable' check (cost_behavior in ('fixed','variable','semi')),
  is_cogs boolean not null default false,
  vat_deductible_rate numeric(5,4) not null default 1,
  tax_deductible_rate numeric(5,4) not null default 1,
  icount_expense_type text,
  legacy_labels text[] not null default '{}',   -- הקטגוריות החופשיות הישנות שממופות לכאן
  sort_order integer not null default 0,
  is_income boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_cost_centers (
  id text primary key,
  type text not null check (type in
    ('class','activity','event','membership','pos_product','department','overhead')),
  name text not null,
  ref_table text,                     -- groups / activities / pricelist
  ref_id text,
  allocation_driver text check (allocation_driver in ('hours','sqm','revenue_share','manual')),
  is_active boolean not null default true,
  branch_id text,
  created_at timestamptz not null default now()
);
create index if not exists finance_cost_centers_ref_idx on public.finance_cost_centers(ref_table, ref_id);

create table if not exists public.finance_ledger_entries (
  id text primary key,
  entry_date date not null,
  period text not null,               -- YYYY-MM
  amount_agorot bigint not null,      -- חתום
  net_agorot bigint,
  vat_agorot bigint,
  basis text not null check (basis in ('cash','accrual')),
  category_id text,
  cost_center_id text,
  source_type text not null,          -- payment / document / expense / payroll / deferral / adjustment
  source_id text not null,
  description text not null default '',
  voided_at timestamptz,
  branch_id text,
  created_at timestamptz not null default now(),
  unique (basis, source_type, source_id, period)
);
create index if not exists finance_ledger_period_idx on public.finance_ledger_entries(period, basis);
create index if not exists finance_ledger_center_idx on public.finance_ledger_entries(cost_center_id, period);

create table if not exists public.finance_cost_allocations (
  id text primary key,
  entry_id text not null references public.finance_ledger_entries(id) on delete cascade,
  cost_center_id text not null references public.finance_cost_centers(id),
  ratio numeric(7,6) not null check (ratio > 0 and ratio <= 1),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_cash_flow_items (
  id text primary key,
  due_date date not null,
  amount_agorot bigint not null,
  direction text not null check (direction in ('in','out')),
  confidence text not null default 'estimated' check (confidence in ('known','recurring','estimated')),
  recurrence_rule text,
  source_type text not null,          -- installment / payroll / vat / recurring_income / manual
  source_id text,
  description text not null default '',
  settled_transaction_id text,
  branch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_cash_flow_due_idx on public.finance_cash_flow_items(due_date);

create table if not exists public.finance_cc_cycles (
  id text primary key,
  account_id text not null references public.financial_accounts(id),
  cycle_month text not null,          -- YYYY-MM
  charge_date date,
  expected_agorot bigint not null default 0,   -- סכום תנועות הכרטיס במחזור
  settled_agorot bigint,                       -- החיוב בפועל בבנק
  settlement_transaction_id text,
  gap_agorot bigint,                           -- פער = התראה, לא התעלמות
  status text not null default 'open' check (status in ('open','settled','gap')),
  created_at timestamptz not null default now(),
  unique (account_id, cycle_month)
);

create table if not exists public.finance_rules (
  id text primary key,
  matcher jsonb not null,             -- {merchant_pattern, account_id?, amount_range?}
  set_category_id text,
  set_supplier_id text,
  set_cost_center_id text,
  set_kind text,
  learned_from text,                  -- match id שממנו החוק נלמד
  created_by text,
  hits integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_inbox_items (
  id text primary key,
  item_type text not null check (item_type in
    ('charge_without_document','document_without_charge','proposed_match',
     'uncategorized_expense','suspected_duplicate','new_supplier',
     'reconciliation_gap','auth_required','sync_error')),
  ref_table text,
  ref_id text,
  title text not null,
  detail text not null default '',
  amount_agorot bigint,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_type, ref_table, ref_id)
);
create index if not exists finance_inbox_status_idx on public.finance_inbox_items(status, item_type);

create table if not exists public.icount_outbox (
  id text primary key,
  event_type text not null,           -- pos_invrec / refund_doc / client_upsert ...
  payload jsonb not null,
  idempotency_key text not null unique,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  status text not null default 'pending' check (status in ('pending','sent','failed','dead')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists icount_outbox_status_idx on public.icount_outbox(status, next_attempt_at);

create table if not exists public.icount_links (
  id text primary key,
  entity_type text not null,          -- parent / product / document / supplier
  local_id text not null,
  icount_id text not null,
  content_hash text,
  sync_status text not null default 'synced' check (sync_status in ('synced','pending','conflict')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (entity_type, local_id)
);

create table if not exists public.finance_center_settings (
  id text primary key,
  flags jsonb not null default '{}',
  employer_cost_factor numeric(6,4) not null default 1.28,
  vat_reporting_basis text not null default 'cash' check (vat_reporting_basis in ('cash','accrual')),
  updated_at timestamptz not null default now(),
  updated_by text
);
