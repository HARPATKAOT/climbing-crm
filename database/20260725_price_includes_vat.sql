-- Add VAT mode flag for activity prices (before VAT vs includes VAT).
alter table public.activities
  add column if not exists price_includes_vat boolean not null default false;

alter table public.activity_templates
  add column if not exists price_includes_vat boolean not null default false;
