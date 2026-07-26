-- The shared parents/students trigger cannot dereference NEW.parent_id when
-- invoked for a parents row, because that column does not exist on parents.
-- Read the trigger record through JSON so table-specific fields stay safe.

CREATE OR REPLACE FUNCTION public.record_lead_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_row jsonb;
  resolved_parent_id text;
  old_status text;
  new_status text;
  event_source text;
BEGIN
  new_row := to_jsonb(NEW);
  resolved_parent_id := CASE
    WHEN TG_TABLE_NAME = 'parents' THEN new_row ->> 'id'
    ELSE new_row ->> 'parent_id'
  END;
  old_status := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE NULLIF(OLD.status, '') END;
  new_status := CASE
    WHEN TG_OP = 'INSERT' THEN COALESCE(NULLIF(NEW.status, ''), 'lead_new')
    ELSE NULLIF(NEW.status, '')
  END;
  event_source := COALESCE(
    NULLIF(current_setting('app.lead_status_source', true), ''),
    'database_trigger'
  );

  IF resolved_parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR old_status IS DISTINCT FROM new_status THEN
    INSERT INTO public.lead_status_history (
      entity_type,
      entity_id,
      parent_id,
      from_status,
      to_status,
      source,
      is_baseline
    )
    VALUES (
      CASE WHEN TG_TABLE_NAME = 'parents' THEN 'parent' ELSE 'student' END,
      NEW.id,
      resolved_parent_id,
      old_status,
      new_status,
      event_source,
      false
    );
  END IF;

  RETURN NEW;
END;
$$;
