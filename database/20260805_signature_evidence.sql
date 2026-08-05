-- Immutable evidence journal for public participation signatures and PDFs.
-- Events live in kv_collections so the application keeps one hydration path.

alter table public.client_documents add column if not exists sha256 text;
alter table public.client_documents add column if not exists evidence_id text;
alter table public.client_documents add column if not exists sealed_at timestamptz;

create or replace function public.prevent_signature_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.collection = 'signature_evidence' then
    raise exception 'signature evidence is append-only';
  end if;
  if tg_op = 'UPDATE' and new.collection = 'signature_evidence' then
    raise exception 'signature evidence is append-only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists signature_evidence_is_append_only on public.kv_collections;
create trigger signature_evidence_is_append_only
before update or delete on public.kv_collections
for each row execute function public.prevent_signature_evidence_mutation();
