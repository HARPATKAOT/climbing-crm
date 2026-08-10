-- Indexed financial reporting model. The application can stage the rollout in
-- kv_collections; these tables are the normalized destination for audited data.
create table if not exists public.finance_documents (
  id text primary key,
  source text not null check (source in ('icount','notion','pos')),
  source_id text,
  doctype text not null,
  docnum text,
  document_date date not null,
  client_id text,
  client_name text,
  total_net numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  total_gross numeric(14,2) not null default 0,
  currency text not null default 'ILS',
  exchange_rate numeric(16,6) not null default 1,
  paid boolean not null default false,
  remaining_sum numeric(14,2) not null default 0,
  is_storno boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (source, source_id, doctype)
);

create index if not exists finance_documents_date_idx on public.finance_documents(document_date);
create index if not exists finance_documents_client_idx on public.finance_documents(client_id);

create table if not exists public.finance_document_lines (
  id text primary key,
  document_id text not null references public.finance_documents(id) on delete cascade,
  line_number integer not null,
  item_id text,
  inventory_item_id text,
  sku text,
  description text not null default '',
  quantity numeric(14,3) not null default 1,
  unit_price_net numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  line_net numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  line_gross numeric(14,2) not null default 0,
  income_type text,
  unique(document_id, line_number)
);

create index if not exists finance_document_lines_item_idx on public.finance_document_lines(item_id, sku);

create table if not exists public.finance_payment_events (
  id text primary key,
  document_id text references public.finance_documents(id) on delete set null,
  source text not null,
  source_id text,
  payment_date date not null,
  method text,
  amount numeric(14,2) not null,
  currency text not null default 'ILS',
  exchange_rate numeric(16,6) not null default 1,
  card_last4 text,
  confirmation_code text,
  is_refund boolean not null default false,
  unique(source, source_id)
);

create index if not exists finance_payment_events_date_idx on public.finance_payment_events(payment_date);

create table if not exists public.finance_suppliers (
  id text primary key,
  source text not null,
  source_id text,
  source_url text,
  name text not null,
  vat_id text,
  status text,
  supplier_type text,
  last_edited_at timestamptz,
  unique(source, source_id)
);

create table if not exists public.finance_expenses (
  id text primary key,
  source text not null,
  source_id text,
  source_url text,
  name text not null,
  expense_date date,
  amount_net numeric(14,2),
  vat_amount numeric(14,2),
  amount_gross numeric(14,2),
  currency text not null default 'ILS',
  supplier_id text references public.finance_suppliers(id) on delete set null,
  supplier_name text,
  document_number text,
  categories text[] not null default '{}',
  payment_method text,
  paid boolean,
  paid_date date,
  reconciliation_status text,
  matched_expense_id text,
  fingerprint text,
  attachment_metadata jsonb not null default '[]'::jsonb,
  last_edited_at timestamptz,
  unique(source, source_id)
);

create index if not exists finance_expenses_date_idx on public.finance_expenses(expense_date);
create index if not exists finance_expenses_supplier_idx on public.finance_expenses(supplier_id);
create index if not exists finance_expenses_fingerprint_idx on public.finance_expenses(fingerprint);

create table if not exists public.finance_product_mappings (
  id text primary key,
  source text not null,
  source_item_id text,
  source_sku text,
  source_name text,
  product_id text,
  confidence numeric(5,4),
  status text not null default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  unique(source, source_item_id)
);

create table if not exists public.product_cost_history (
  id text primary key,
  product_id text not null,
  valid_from date not null,
  valid_to date,
  unit_cost_net numeric(14,2) not null,
  currency text not null default 'ILS',
  note text,
  unique(product_id, valid_from)
);

create table if not exists public.finance_sync_runs (
  id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  full_sync boolean not null default false,
  sources text[] not null default '{}',
  checkpoint jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

alter table public.finance_documents enable row level security;
alter table public.finance_document_lines enable row level security;
alter table public.finance_payment_events enable row level security;
alter table public.finance_suppliers enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_product_mappings enable row level security;
alter table public.product_cost_history enable row level security;
alter table public.finance_sync_runs enable row level security;

