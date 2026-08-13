-- Hard placement holds use the existing durable JSON collection, but the seat
-- claim itself must be decided inside one PostgreSQL transaction. Applying
-- this function is intentionally separate from the production data migration.

create or replace function public.claim_group_placement_hold(p_hold jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id text := nullif(p_hold->>'student_id', '');
  v_hold_id text := nullif(p_hold->>'id', '');
  v_group_id text;
  v_capacity integer;
  v_occupied integer;
  v_existing jsonb;
begin
  if v_student_id is null or v_hold_id is null
     or jsonb_typeof(p_hold->'group_ids') <> 'array'
     or jsonb_array_length(p_hold->'group_ids') = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_hold');
  end if;

  -- Different group ids still contend for the same trainee. Lock the trainee
  -- before the group locks so only one active hold can ever be created.
  perform pg_advisory_xact_lock(hashtextextended('student-seat:' || v_student_id, 0));

  -- Every caller locks the same sorted ids, so multi-day placements cannot
  -- deadlock and two server instances cannot promise the last seat twice.
  for v_group_id in
    select elem from jsonb_array_elements_text(p_hold->'group_ids') as ids(elem) order by elem
  loop
    perform pg_advisory_xact_lock(hashtextextended('group-seat:' || v_group_id, 0));
  end loop;

  select data into v_existing
  from public.kv_collections
  where collection = 'group_placement_holds'
    and data->>'student_id' = v_student_id
    and data->>'status' = 'active'
    and coalesce(nullif(data->>'expires_at', '')::timestamptz, 'infinity'::timestamptz) > now()
  order by updated_at desc
  limit 1;

  if v_existing is not null then
    if coalesce(v_existing->>'idempotency_key', '') = coalesce(p_hold->>'idempotency_key', '') then
      return jsonb_build_object('ok', true, 'duplicate', true, 'record', v_existing);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'student_already_holding');
  end if;

  for v_group_id in
    select elem from jsonb_array_elements_text(p_hold->'group_ids') as ids(elem) order by elem
  loop
    select max_slots into v_capacity
    from public.groups
    where id::text = v_group_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'group_not_found', 'group_id', v_group_id);
    end if;
    if v_capacity is null or v_capacity <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'capacity_unknown', 'group_id', v_group_id);
    end if;

    with occupied_students as (
      select distinct s.id::text as student_id
      from public.students s
      where s.id::text <> v_student_id
        and s.status in (
          'registered', 'active', 'awaiting_parent_confirmation',
          'awaiting_centre_confirmation', 'intro_scheduled', 'intro_paid'
        )
        and (
          s.group_id::text = v_group_id
          or exists (
            select 1 from public.enrollments e
            where e.student_id::text = s.id::text
              and e.group_id::text = v_group_id
              and coalesce(e.status, 'active') not in ('cancelled', 'ended')
          )
        )
    ), occupied_holds as (
      select distinct data->>'student_id' as student_id
      from public.kv_collections
      where collection = 'group_placement_holds'
        and data->>'student_id' <> v_student_id
        and data->>'status' = 'active'
        and (data->'group_ids') ? v_group_id
        and coalesce(nullif(data->>'expires_at', '')::timestamptz, 'infinity'::timestamptz) > now()
    )
    select count(*) into v_occupied
    from (
      select student_id from occupied_students
      union
      select student_id from occupied_holds
    ) occupied;

    if v_occupied >= v_capacity then
      return jsonb_build_object(
        'ok', false,
        'reason', 'full',
        'group_id', v_group_id,
        'capacity', v_capacity,
        'occupied', v_occupied
      );
    end if;
  end loop;

  insert into public.kv_collections(collection, id, data, updated_at)
  values ('group_placement_holds', v_hold_id, p_hold, now())
  on conflict (collection, id) do update
    set data = excluded.data, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'duplicate', false, 'record', p_hold);
end;
$$;

revoke all on function public.claim_group_placement_hold(jsonb) from public;
revoke all on function public.claim_group_placement_hold(jsonb) from anon;
revoke all on function public.claim_group_placement_hold(jsonb) from authenticated;
grant execute on function public.claim_group_placement_hold(jsonb) to service_role;

create or replace function public.claim_registration_lifecycle_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(p_event->>'id', '');
  v_existing jsonb;
  v_updated_at timestamptz;
  v_next jsonb;
begin
  if v_id is null then
    return jsonb_build_object('claimed', false, 'reason', 'event_id_missing');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('registration-event:' || v_id, 0));
  select data, updated_at into v_existing, v_updated_at
  from public.kv_collections
  where collection = 'registration_lifecycle_events' and id = v_id
  for update;

  if v_existing is not null then
    if v_existing->>'status' in ('sent', 'done') then
      return jsonb_build_object('claimed', false, 'reason', 'already_finished', 'record', v_existing);
    end if;
    if v_existing->>'status' = 'processing' and v_updated_at > now() - interval '5 minutes' then
      return jsonb_build_object('claimed', false, 'reason', 'already_processing', 'record', v_existing);
    end if;
    v_next := v_existing || jsonb_build_object('status', 'processing', 'updated_at', now());
    update public.kv_collections
      set data = v_next, updated_at = now()
      where collection = 'registration_lifecycle_events' and id = v_id;
    return jsonb_build_object('claimed', true, 'record', v_next);
  end if;

  v_next := p_event || jsonb_build_object('status', 'processing', 'updated_at', now());
  insert into public.kv_collections(collection, id, data, updated_at)
  values ('registration_lifecycle_events', v_id, v_next, now());
  return jsonb_build_object('claimed', true, 'record', v_next);
end;
$$;

revoke all on function public.claim_registration_lifecycle_event(jsonb) from public;
revoke all on function public.claim_registration_lifecycle_event(jsonb) from anon;
revoke all on function public.claim_registration_lifecycle_event(jsonb) from authenticated;
grant execute on function public.claim_registration_lifecycle_event(jsonb) to service_role;
