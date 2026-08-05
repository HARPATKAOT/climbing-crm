-- Unified family participation forms, document eligibility and cancellation policy versions.
-- Safe to re-run. Existing CRM people, registrations, payments and templates are preserved.

create table if not exists public.households (
  id text primary key,
  status text not null default 'active' check (status in ('active', 'merged', 'split')),
  merged_into_id text references public.households(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id text primary key,
  household_id text not null references public.households(id) on delete cascade,
  parent_id text references public.parents(id) on delete cascade,
  student_id text references public.students(id) on delete cascade,
  role text not null check (role in ('adult', 'child')),
  profile_status text not null default 'complete'
    check (profile_status in ('pending_profile', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((parent_id is null) <> (student_id is null))
);

create unique index if not exists household_members_parent_uidx
  on public.household_members(parent_id) where parent_id is not null;
create unique index if not exists household_members_student_uidx
  on public.household_members(student_id) where student_id is not null;
create index if not exists household_members_household_idx
  on public.household_members(household_id, role);

create table if not exists public.participation_waivers (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  signer_parent_id text references public.parents(id) on delete set null,
  scope text not null check (scope in ('wall', 'event', 'trip')),
  template_id text,
  signed_at timestamptz not null,
  expires_at timestamptz not null,
  signature_url text,
  status text not null default 'approved' check (status in ('approved', 'rejected', 'cancelled')),
  form_snapshot jsonb not null default '{}'::jsonb,
  activity_id text references public.activities(id) on delete set null,
  order_id text references public.activity_registration_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists participation_waivers_student_scope_idx
  on public.participation_waivers(student_id, scope, signed_at desc);

create table if not exists public.health_holds (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  reason text not null default 'health_changed',
  status text not null default 'active' check (status in ('active', 'released')),
  created_by_parent_id text references public.parents(id) on delete set null,
  released_by_declaration_id text references public.health_declarations(id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists health_holds_one_active_per_student_uidx
  on public.health_holds(student_id) where released_at is null and status = 'active';

alter table public.health_declarations
  add column if not exists expires_at timestamptz,
  add column if not exists medical_clearance_document_id text,
  add column if not exists supersedes_id text;

alter table public.activity_registration_orders
  add column if not exists household_id text references public.households(id) on delete restrict,
  add column if not exists payer_person_id text,
  add column if not exists cancellation_acceptance_id text,
  add column if not exists policy_snapshot jsonb;

alter table public.activity_registrations
  add column if not exists participation_waiver_id text references public.participation_waivers(id) on delete set null,
  add column if not exists document_status text not null default 'awaiting_documents'
    check (document_status in ('pending_profile', 'awaiting_documents', 'eligible', 'blocked_health'));

alter table public.client_documents
  add column if not exists waiver_id text references public.participation_waivers(id) on delete set null;

create table if not exists public.cancellation_policies (
  id text primary key,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_default boolean not null default false,
  current_version_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cancellation_policies_one_default_uidx
  on public.cancellation_policies(is_default) where is_default = true and status <> 'archived';

create table if not exists public.cancellation_policy_versions (
  id text primary key,
  policy_id text not null references public.cancellation_policies(id) on delete cascade,
  version_number integer not null,
  rules jsonb not null default '[]'::jsonb,
  free_text text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  unique(policy_id, version_number)
);

alter table public.cancellation_policies
  drop constraint if exists cancellation_policies_current_version_id_fkey;
alter table public.cancellation_policies
  add constraint cancellation_policies_current_version_id_fkey
  foreign key (current_version_id) references public.cancellation_policy_versions(id) on delete set null;

create table if not exists public.cancellation_acceptances (
  id text primary key,
  policy_id text not null references public.cancellation_policies(id) on delete restrict,
  policy_version_id text not null references public.cancellation_policy_versions(id) on delete restrict,
  parent_id text references public.parents(id) on delete set null,
  activity_id text references public.activities(id) on delete set null,
  order_id text references public.activity_registration_orders(id) on delete set null,
  pos_sale_id text,
  payment_id text,
  accepted_via text not null check (accepted_via in ('online', 'counter', 'host')),
  accepted_by_staff text,
  snapshot jsonb not null,
  accepted_at timestamptz not null default now()
);

alter table public.cancellation_acceptances
  add column if not exists payment_id text;

-- Initial published default. ON CONFLICT keeps this migration re-runnable and
-- never replaces a version that an owner has subsequently edited.
insert into public.cancellation_policies (
  id, name, status, is_default, current_version_id, created_by
) values (
  'cp_default_20260805', 'מדיניות ביטול רגילה', 'published', true, null, 'migration'
) on conflict (id) do nothing;

insert into public.cancellation_policy_versions (
  id, policy_id, version_number, rules, free_text, status, published_at, created_by
) values (
  'cpv_default_20260805_v1',
  'cp_default_20260805',
  1,
  '[{"id":"seven_days","min_hours_before":168,"max_hours_before":null,"refund_percent":100,"fixed_fee":50},{"id":"two_to_seven_days","min_hours_before":48,"max_hours_before":168,"refund_percent":50,"fixed_fee":0},{"id":"under_two_days","min_hours_before":0,"max_hours_before":48,"refund_percent":0,"fixed_fee":0}]'::jsonb,
  'הפעילות מותנית במינימום משתתפים. במקרה של ביטול הפעילות על ידינו יוחזר מלוא הסכום.',
  'published',
  now(),
  'migration'
) on conflict (id) do nothing;

update public.cancellation_policies
set current_version_id = coalesce(current_version_id, 'cpv_default_20260805_v1')
where id = 'cp_default_20260805';

alter table public.activities
  add column if not exists cancellation_policy_id text references public.cancellation_policies(id) on delete set null,
  add column if not exists cancellation_policy_disabled boolean not null default false,
  add column if not exists audience text not null default '',
  add column if not exists included text not null default '',
  add column if not exists what_to_bring text not null default '',
  add column if not exists important_info text not null default '';
alter table public.activity_templates
  add column if not exists cancellation_policy_id text references public.cancellation_policies(id) on delete set null,
  add column if not exists cancellation_policy_disabled boolean not null default false,
  add column if not exists audience text not null default '',
  add column if not exists included text not null default '',
  add column if not exists what_to_bring text not null default '',
  add column if not exists important_info text not null default '';

-- The legal domain is explicit. The defaults below preserve the legacy type
-- inference once, while every future edit stores the owner's exact choice.
alter table public.activities
  add column if not exists participation_scope text
    check (participation_scope in ('wall', 'event', 'trip'));
alter table public.activity_templates
  add column if not exists participation_scope text
    check (participation_scope in ('wall', 'event', 'trip'));

update public.activities
set participation_scope = case
  when lower(coalesce(type, '')) in ('trip', 'טיול', 'hike', 'rappelling', 'caving') then 'trip'
  when lower(coalesce(type, '')) in ('birthday', 'event', 'company', 'school') then 'event'
  else 'wall'
end
where participation_scope is null;

update public.activity_templates
set participation_scope = case
  when lower(coalesce(type, '')) in ('trip', 'טיול', 'hike', 'rappelling', 'caving') then 'trip'
  when lower(coalesce(type, '')) in ('birthday', 'event', 'company', 'school') then 'event'
  else 'wall'
end
where participation_scope is null;

-- Legacy trip templates carried a tenth, claustrophobia-specific medical
-- question. The global health declaration is deliberately m1-m9 only.
update public.form_templates
set health_questions = coalesce((
  select jsonb_agg(question.value order by question.ordinality)
  from jsonb_array_elements(coalesce(form_templates.health_questions, '[]'::jsonb))
    with ordinality as question(value, ordinality)
  where question.value ->> 'id' <> 'm10'
), '[]'::jsonb)
where coalesce(health_questions, '[]'::jsonb) @> '[{"id":"m10"}]'::jsonb;

alter table if exists public.pricelist
  add column if not exists grants_wall_climbing boolean not null default false,
  add column if not exists family_shared boolean not null default false,
  add column if not exists cancellation_policy_id text references public.cancellation_policies(id) on delete set null,
  add column if not exists cancellation_policy_disabled boolean not null default false;

alter table if exists public.payments
  add column if not exists policy_snapshot jsonb,
  add column if not exists cancellation_acceptance_id text;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.participation_waivers enable row level security;
alter table public.health_holds enable row level security;
alter table public.cancellation_policies enable row level security;
alter table public.cancellation_policy_versions enable row level security;
alter table public.cancellation_acceptances enable row level security;

revoke all on public.households, public.household_members, public.participation_waivers,
  public.health_holds, public.cancellation_policies, public.cancellation_policy_versions,
  public.cancellation_acceptances from anon;
grant all on public.households, public.household_members, public.participation_waivers,
  public.health_holds, public.cancellation_policies, public.cancellation_policy_versions,
  public.cancellation_acceptances to postgres, service_role;

-- Passes and punches are operational JSON records. Lock the pass row, validate
-- the actual entrant, decrement the balance and append the audit row together.
create or replace function public.punch_customer_pass(
  p_pass_id text,
  p_punch_id text,
  p_punch_data jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pass_data jsonb;
  remaining integer;
  actual_student_id text;
  shared boolean;
  household_id text;
begin
  select data into pass_data
  from public.kv_collections
  where collection = 'customer_passes' and id = p_pass_id
  for update;

  if pass_data is null then raise exception 'כרטיסייה לא נמצאה'; end if;
  if coalesce(pass_data ->> 'pass_type', '') <> 'punch_card' then raise exception 'אפשר לנקב רק כרטיסיית כניסות'; end if;
  if coalesce(pass_data ->> 'status', '') <> 'active' then raise exception 'הכרטיסייה אינה פעילה'; end if;
  remaining := coalesce((pass_data ->> 'visits_remaining')::integer, 0);
  if remaining <= 0 then raise exception 'נגמרו הניקובים בכרטיסייה'; end if;

  actual_student_id := nullif(p_punch_data ->> 'student_id', '');
  shared := coalesce((pass_data ->> 'family_shared')::boolean, false);
  household_id := nullif(pass_data ->> 'shared_household_id', '');
  if shared then
    if actual_student_id is null or household_id is null or not exists (
      select 1 from public.household_members
      where household_members.household_id = household_id
        and household_members.student_id = actual_student_id
    ) then
      raise exception 'המתאמן שנכנס אינו חבר במשפחה של הכרטיסייה';
    end if;
  elsif actual_student_id is distinct from nullif(pass_data ->> 'student_id', '') then
    raise exception 'הכרטיסייה אינה משויכת למתאמן שנכנס';
  end if;

  pass_data := pass_data || jsonb_build_object(
    'visits_remaining', remaining - 1,
    'status', case when remaining - 1 <= 0 then 'depleted' else 'active' end,
    'updated_at', now()
  );
  update public.kv_collections
  set data = pass_data, updated_at = now()
  where collection = 'customer_passes' and id = p_pass_id;

  p_punch_data := p_punch_data || jsonb_build_object(
    'visits_before', remaining,
    'visits_after', remaining - 1
  );

  insert into public.kv_collections(collection, id, data, updated_at)
  values ('pass_punches', p_punch_id, p_punch_data, now());
  return jsonb_build_object('pass', pass_data, 'punch', p_punch_data);
end;
$$;

revoke all on function public.punch_customer_pass(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.punch_customer_pass(text, text, jsonb) to postgres, service_role;
