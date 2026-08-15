-- ============================================================================
-- 04-rewrite-urls.sql — repoint absolute Supabase Storage URLs at the new
--                        project ref, after the Seoul -> Frankfurt move.
--
-- WHY THIS EXISTS
--   A Postgres dump carries the rows, not the bucket objects, and it certainly
--   does not carry the hostname baked into a row. Every catalog photo is stored
--   as a whole address:
--       https://<ref>.supabase.co/storage/v1/object/public/product-images/<path>
--   server/productImages.js `storeImageValue` (:53) hands back any value that is
--   not a data: URI untouched — including an http(s) URL — so these rows never
--   repair themselves on the next save. They stay pointed at the old project
--   until something rewrites them. That is this file.
--
-- RUN IT AS THE OWNER
--   Every table in `public` has RLS enabled by
--   database/20260814_enforce_api_only_access.sql. Connect as the session-pooler
--   user `postgres.<newref>`, which maps to role `postgres`. Verified on the
--   source project: kv_collections and form_templates are both owned by
--   `postgres`, relforcerowsecurity is false, and `postgres` additionally holds
--   rolbypassrls — so the owner sees and updates every row. Connecting as
--   anon/authenticated would silently see and update zero rows.
--
-- SAFE BY DEFAULT
--   The updates run inside one transaction that ROLLS BACK unless you pass
--   -v apply=on. A plain run is a dry run: it shows the before/after counts the
--   commit would produce, then throws them away.
--
-- STANDALONE USAGE
--   Dry run:
--     psql -v old_ref=xaxykjvqqhrodmseqleu -v new_ref=<newref> \
--          -f migration/04-rewrite-urls.sql "<target connection string>"
--   Apply:
--     ... -v apply=on ...
--   Skip the residual scan (~3 s on data of this size, but it is a full pass
--   over every text/jsonb column in the schema):
--     ... -v scan=off ...
--   The .mjs wrapper next to this file passes all of that for you, refuses to
--   set apply=on without --confirm, and — unlike a human reading the output —
--   actually checks the scan result before declaring success.
--
-- IDEMPOTENT
--   Every statement is guarded by `strpos(value, old_ref) > 0`. A second run
--   matches nothing and reports 0. Running it twice is a no-op, not a double
--   substitution — `replace()` cannot find the old ref again once the new one is
--   in place (the two refs are asserted to differ, below).
--
-- ORDER OF OPERATIONS — READ THIS BEFORE TRUSTING AN ERROR MESSAGE
--   commit/rollback happens BEFORE the residual scan. If this file fails during
--   the scan on an apply=on run, the rewrite is already committed and re-running
--   is the correct response, not a panic. The wrapper distinguishes the two
--   cases by the [[REWRITE|RESULT|...]] marker below; a bare psql run has to be
--   read for the same marker by eye. Note also that Supabase sets
--   statement_timeout=2min for this role, and the scan is a single statement.
--
-- MACHINE-READABLE MARKERS
--   Lines of the form [[REWRITE|...]] are emitted for the wrapper to parse. They
--   survive psql's table formatting because they are extracted by regex, not by
--   column position. Emitted:
--     [[REWRITE|UPDATED|<key>|<rows>]]        rows each statement actually changed
--     [[REWRITE|AFTER_IN_TX|<key>|<rows>]]    rows still on the old ref, in-tx
--     [[REWRITE|NEWREF|<key>|<rows>]]         rows now on the new ref, in-tx
--     [[REWRITE|RESULT|COMMITTED]]            or |ROLLED_BACK
--     [[REWRITE|KVSCAN|<collection>|<rows>]]  kv collections holding the old ref
--     [[REWRITE|SCAN|<table>|<column>|<rows>]] any column holding the old ref
--     [[REWRITE|SCAN_DONE]]                   or [[REWRITE|SCAN_SKIPPED]]
--
-- ============================================================================
-- WHAT GETS REWRITTEN, AND WHY EACH ONE
-- ============================================================================
--
--  1. kv_collections WHERE collection = 'pricelist'  ->  data->>'image'   (42 rows)
--     `pricelist` is in OPERATIONAL_TABLES (server/supa.js:157), NOT in
--     DIRECT_TABLES. There is no `pricelist` table and no `image` column in
--     Postgres: the product record is a whole JSON document in the `data` jsonb
--     column of the single `kv_collections` table, keyed by
--     (collection, id) — see server/supa.js:825-846 (getAll) and 948-977
--     (upsert). `UPDATE pricelist SET image = ...` would fail with "relation
--     does not exist"; `UPDATE kv_collections SET image = ...` would fail with
--     "column does not exist". The value has to be reached through the jsonb.
--     Writer: server/index.js:10356 and :10378 (POST/PUT /api/pricelist)
--             -> storeImageValue(clampImage(body.image))   [prefix 'products']
--     Verified against the live source: `image` is the only key inside a
--     pricelist document that carries the old ref, in all 42 rows.
--
--  2. public.form_templates.cover_image                                (1 row)
--     `form_templates` IS in DIRECT_TABLES (server/supa.js:120) — a real table
--     with a real text column, added by
--     database/20260807_form_template_cover.sql:8. A plain column UPDATE is
--     correct here, and only here.
--     Writer: server/index.js:17742 and :17766
--             -> storeImageValue(..., 'form-covers')
--
--  3. kv_collections WHERE collection = 'product_categories' -> data->>'image'   (0 rows today)
--     Same bucket, same code path, same jsonb shape as (1); `product_categories`
--     is also an OPERATIONAL table (server/supa.js:158). It holds no old-ref URL
--     at the time of writing, which is why the headline count is 43 and not more.
--     It is included anyway: a category photo uploaded between the dump and the
--     cutover would otherwise be the one broken image nobody thought to check.
--     Writer: server/index.js:10433 and :10473
--             -> storeImageValue(clampImage(req.body.image), 'categories')
--
-- ============================================================================
-- EVERYTHING ELSE THAT WAS CHECKED, AND WHY IT IS NOT REWRITTEN
-- ============================================================================
-- Method: grepped server/, client/src/, database/, docs/ (excluding
-- node_modules, .git, .codex-*, archive, _archive and sibling worktrees) for
-- `storage/v1/object`, `supabase.co`, `getPublicUrl`, `storeImageValue`,
-- `uploadProductImage`, the literal old ref, and for every field name that
-- reads like an address: image, image_url, cover_image, coverImage, media_url,
-- logo_url, photo_url, avatar, storage_path. Then confirmed empirically: a full
-- scan of every text/varchar/json/jsonb column of every base table on the live
-- source returns exactly two rows — kv_collections.data (42) and
-- form_templates.cover_image (1). The reasoning below and the data agree.
--
--   * server/supa.js:1304 `getPublicUrl` is the ONLY call in the repo that
--     produces an absolute Supabase URL, and `uploadProductImage`
--     (server/supa.js:1295) is its only caller. Its return value reaches exactly
--     the three fields above, through the six `storeImageValue` call sites in
--     server/index.js (10356, 10378, 10433, 10473, 17742, 17766). That is the
--     whole surface.
--
--   * public.client_documents.storage_path — a path INSIDE the
--     'client-documents' bucket, never a URL (mapper at server/supa.js:643-667).
--     Addresses are minted per request and expire:
--     supa.createSignedClientDocumentUrl (server/supa.js:1257). Nothing durable
--     to rewrite. NOTE: the bucket objects themselves still have to be copied —
--     that is 03-copy-storage.mjs, not this file.
--
--   * employee documents — same shape. uploadEmployeeDocument /
--     downloadEmployeeDocument / removeEmployeeDocument (server/supa.js:1321-1355)
--     all take a storage path; no URL is ever stored.
--
--   * kv_collections WHERE collection = 'signature_evidence' — the append-only
--     seal journal (server/signatureEvidence.js) stores content hashes and HMAC
--     seals, not addresses; it never calls storeImageValue. Two things about it
--     matter here anyway:
--       - a BEFORE UPDATE OR DELETE trigger on kv_collections
--         (database/20260805_signature_evidence.sql:25-28) raises an exception
--         for any row whose collection is 'signature_evidence'. The three
--         statements below never match such a row, so the trigger fires and
--         returns NEW without objecting. Do not widen their WHERE clauses.
--       - its OTHER migration hazard — the HMAC key silently moving with the
--         service_role key — is handled before cutover by setting
--         EVIDENCE_SIGNING_SECRET on Render, not here.
--
--   * public.messages.media_url — holds a Meta media id or the encoded ref
--     produced by encodeMediaRef (server/channels/mediaRef.js, used at
--     server/whatsapp.js:984, :1529, :2012, :2054). Never a Supabase address.
--
--   * public.activities.registration_theme (jsonb) ->> 'cover_image' — set by
--     client/src/components/ActivityPageDesigner.jsx:249 as a `data:` URI and
--     only size-clamped by sanitizeRegistrationTheme
--     (server/activityRegistration.js:24). `storeImageValue` is never called on
--     it, so it carries inline bytes, not an address. Left alone.
--
--   * public.app_settings, key 'business_profile' -> 'logo_url' — defaults to
--     '/logo.png', otherwise a `data:` URI accepted by clampImage
--     (server/businessProfile.js:29, server/productCategories.js:17). Not a
--     storage path.
--
--   * SUPABASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY — configuration,
--     not data. Render env vars and the Vercel BUILD-time inline. Those belong
--     to the cutover checklist; this file will not find or fix them.
--
--   * server/scripts/apply*Migration.js — eleven developer scripts hardcode
--     `const PROJECT = 'xaxykjvqqhrodmseqleu'` for the Supabase Management API.
--     Source code, not rows. Listed so nobody mistakes a grep hit for data.
--
-- And because a list written by hand is a list that can be wrong, the last
-- section scans EVERY text / varchar / json / jsonb column of EVERY base table
-- in schema `public`, plus every kv collection, and prints whatever is left.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- Required variables. An absent one becomes a value the validator rejects with
-- a readable message, rather than an empty string that silently matches nothing.
\if :{?old_ref}
\else
  \echo '!! -v old_ref=<20-char source project ref> was not supplied'
  \set old_ref OLD_REF_NOT_SUPPLIED
\endif

\if :{?new_ref}
\else
  \echo '!! -v new_ref=<20-char target project ref> was not supplied'
  \set new_ref NEW_REF_NOT_SUPPLIED
\endif

-- Commit only when explicitly asked. Default is a dry run.
\if :{?apply}
\else
  \set apply off
\endif

-- The residual scan is the only thing here that turns "we think we got them
-- all" into a result, so it stays on by default.
\if :{?scan}
\else
  \set scan on
\endif

-- ─── The two refs and the two flags, as data ────────────────────────────────
-- psql does not interpolate :vars inside dollar-quoted bodies, so every later
-- statement — and every DO block — reads them from this table instead.
-- A fresh psql session has no temp schema yet, so these drops would otherwise
-- announce "schema pg_temp does not exist" before doing anything useful.
set client_min_messages = warning;
drop view  if exists pg_temp.url_rewrite_status;
drop table if exists pg_temp.url_rewrite_scan;
drop table if exists pg_temp.url_rewrite_kvscan;
drop table if exists pg_temp.url_rewrite_refs;
reset client_min_messages;

create temporary table url_rewrite_refs as
select :'old_ref'::text        as old_ref,
       :'new_ref'::text        as new_ref,
       lower(:'apply')::text   as apply_flag,
       lower(:'scan')::text    as scan_flag;

-- ─── Refuse to run on anything that does not look right ─────────────────────
do $validate$
declare
  r          record;
  kv_data    text;
  missing    text[] := '{}';
  bools      text[] := array['on','off','true','false','yes','no','1','0','t','f','y','n'];
begin
  select * into r from url_rewrite_refs;

  if r.old_ref is null or r.old_ref !~ '^[a-z0-9]{20}$' then
    raise exception
      'old_ref is not a Supabase project ref: %. Expected 20 lowercase alphanumerics.',
      coalesce(r.old_ref, '<null>');
  end if;

  if r.new_ref is null or r.new_ref !~ '^[a-z0-9]{20}$' then
    raise exception
      'new_ref is not a Supabase project ref: %. Expected 20 lowercase alphanumerics.',
      coalesce(r.new_ref, '<null>');
  end if;

  if r.old_ref = r.new_ref then
    raise exception
      'old_ref and new_ref are both %. Rewriting a ref to itself is never what you meant.',
      r.old_ref;
  end if;

  -- An unrecognised value would make psql's \if silently take neither branch:
  -- the transaction would stay open, the scan would run inside it and report a
  -- reassuring zero, and the session would then roll the whole thing back. That
  -- failure looks exactly like success, so it is refused here instead.
  if not (r.apply_flag = any (bools)) then
    raise exception
      'apply=% is not a boolean. Use -v apply=on to commit, or omit it for a dry run.',
      r.apply_flag;
  end if;
  if not (r.scan_flag = any (bools)) then
    raise exception 'scan=% is not a boolean. Use -v scan=off to skip the residual scan.', r.scan_flag;
  end if;

  if to_regclass('public.kv_collections') is null then
    raise exception
      'public.kv_collections is missing. The 76 operational collections (pricelist among them) all live in that one table — this database is not a complete restore.';
  end if;

  if to_regclass('public.form_templates') is null then
    raise exception 'public.form_templates is missing. This database is not a complete restore.';
  end if;

  -- kv_collections must have the shape server/supa.js writes.
  select data_type into kv_data
    from information_schema.columns
   where table_schema = 'public' and table_name = 'kv_collections' and column_name = 'data';

  if kv_data is null then
    missing := missing || 'kv_collections.data';
  elsif kv_data <> 'jsonb' then
    raise exception
      'kv_collections.data is % , not jsonb. jsonb_set() cannot be used on it; stop and check the restore.',
      kv_data;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='kv_collections' and column_name='collection') then
    missing := missing || 'kv_collections.collection';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='kv_collections' and column_name='updated_at') then
    missing := missing || 'kv_collections.updated_at';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='form_templates' and column_name='cover_image') then
    missing := missing || 'form_templates.cover_image';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='form_templates' and column_name='updated_at') then
    missing := missing || 'form_templates.updated_at';
  end if;

  if array_length(missing, 1) is not null then
    raise exception 'Expected column(s) missing from the target database: %', array_to_string(missing, ', ');
  end if;

  raise notice 'rewriting % -> % as user % on database %',
    r.old_ref, r.new_ref, current_user, current_database();
end
$validate$;

-- ─── One definition of "still broken", reused before and after ──────────────
-- rows_with_new_ref is the positive half: "zero left on the old ref" is also
-- what an empty table says, and an empty table is not a successful rewrite.
create or replace temporary view url_rewrite_status as
select 1                                                                     as ord,
       'pricelist_image'                                                     as key,
       'kv_collections[pricelist].data->>image'                              as target,
       count(*) filter (where strpos(coalesce(k.data->>'image',''), r.old_ref) > 0) as rows_with_old_ref,
       count(*) filter (where strpos(coalesce(k.data->>'image',''), r.new_ref) > 0) as rows_with_new_ref
  from kv_collections k
  cross join url_rewrite_refs r
 where k.collection = 'pricelist'
union all
select 2,
       'form_template_cover',
       'form_templates.cover_image',
       count(*) filter (where strpos(coalesce(t.cover_image,''), r.old_ref) > 0),
       count(*) filter (where strpos(coalesce(t.cover_image,''), r.new_ref) > 0)
  from public.form_templates t
  cross join url_rewrite_refs r
union all
select 3,
       'product_category_image',
       'kv_collections[product_categories].data->>image',
       count(*) filter (where strpos(coalesce(k.data->>'image',''), r.old_ref) > 0),
       count(*) filter (where strpos(coalesce(k.data->>'image',''), r.new_ref) > 0)
  from kv_collections k
  cross join url_rewrite_refs r
 where k.collection = 'product_categories';

\echo ''
\echo '── BEFORE ──────────────────────────────────────────────────────────────'
select target, rows_with_old_ref, rows_with_new_ref from url_rewrite_status order by ord;

-- ─── The rewrite ────────────────────────────────────────────────────────────
begin;

\echo ''
\echo '── rewriting (1/3) kv_collections[pricelist].data->>image ──────────────'
-- jsonb, not a column: the address is a key inside the product document.
-- create_if_missing = false, so a product with no photo is never given an
-- `image` key it did not have. The data-modifying CTE is here so the row count
-- comes back attached to a key the wrapper can check, instead of a bare
-- "UPDATE 42" that no machine can tie to a target.
with upd as (
  update kv_collections k
     set data       = jsonb_set(
                        k.data,
                        '{image}',
                        to_jsonb(replace(k.data->>'image', r.old_ref, r.new_ref)),
                        false
                      ),
         updated_at = now()
    from url_rewrite_refs r
   where k.collection = 'pricelist'
     and jsonb_typeof(k.data->'image') = 'string'
     and strpos(k.data->>'image', r.old_ref) > 0
  returning 1
)
select format('[[REWRITE|UPDATED|pricelist_image|%s]]', count(*)) as marker from upd;

\echo ''
\echo '── rewriting (2/3) form_templates.cover_image ──────────────────────────'
-- A real column on a real table. This is the only one of the three that a
-- naive `UPDATE <table> SET <column>` gets right.
with upd as (
  update public.form_templates t
     set cover_image = replace(t.cover_image, r.old_ref, r.new_ref),
         updated_at  = now()
    from url_rewrite_refs r
   where t.cover_image is not null
     and strpos(t.cover_image, r.old_ref) > 0
  returning 1
)
select format('[[REWRITE|UPDATED|form_template_cover|%s]]', count(*)) as marker from upd;

\echo ''
\echo '── rewriting (3/3) kv_collections[product_categories].data->>image ─────'
-- Expected to report 0. See the header: it is here so a photo added between
-- the dump and the cutover cannot slip through.
with upd as (
  update kv_collections k
     set data       = jsonb_set(
                        k.data,
                        '{image}',
                        to_jsonb(replace(k.data->>'image', r.old_ref, r.new_ref)),
                        false
                      ),
         updated_at = now()
    from url_rewrite_refs r
   where k.collection = 'product_categories'
     and jsonb_typeof(k.data->'image') = 'string'
     and strpos(k.data->>'image', r.old_ref) > 0
  returning 1
)
select format('[[REWRITE|UPDATED|product_category_image|%s]]', count(*)) as marker from upd;

\echo ''
\echo '── AFTER (inside the transaction; old must be 0, new must be non-zero) ─'
select target, rows_with_old_ref, rows_with_new_ref from url_rewrite_status order by ord;
select format('[[REWRITE|AFTER_IN_TX|%s|%s]]', key, rows_with_old_ref) as marker
  from url_rewrite_status order by ord;
select format('[[REWRITE|NEWREF|%s|%s]]', key, rows_with_new_ref) as marker
  from url_rewrite_status order by ord;

\if :apply
  \echo ''
  \echo '>> apply=on — committing.'
  commit;
  \echo '[[REWRITE|RESULT|COMMITTED]]'
\else
  \echo ''
  \echo '>> apply is off — DRY RUN, rolling back. Nothing was changed.'
  \echo '>> Re-run with -v apply=on (or the .mjs wrapper with --confirm) to commit.'
  rollback;
  \echo '[[REWRITE|RESULT|ROLLED_BACK]]'
\endif

-- ─── Proof, or a list of what the header comment missed ─────────────────────
-- Read-only, and OUTSIDE the transaction above: on an apply=on run the commit
-- has already happened by the time these lines execute. A failure here (for
-- instance the 2-minute statement_timeout) does not undo it.
--
-- Two passes, because one is not enough:
--   KVSCAN  — which kv collections hold the old ref anywhere in their document.
--             The column scan can only say "kv_collections.data", which covers
--             76 collections and would hide a photo that landed in the wrong one.
--   SCAN    — every text/varchar/json/jsonb column of every base table in public,
--             including the columns the header argues are clean, because an
--             argument is not evidence.
--
-- After a committed run both must be empty. After a dry run they still show the
-- pre-rewrite state, so the meaningful reading is "does anything appear here
-- that the three statements above do not cover" — which is what the wrapper
-- checks.
\if :scan
\echo ''
\echo '── residual scan ───────────────────────────────────────────────────────'

create temporary table url_rewrite_kvscan as
select k.collection, count(*) as rows_with_old_ref
  from kv_collections k
  cross join url_rewrite_refs r
 where strpos(k.data::text, r.old_ref) > 0
 group by k.collection;

create temporary table url_rewrite_scan as
select table_name, column_name, rows_with_old_ref
  from (
        select c.table_name,
               c.column_name,
               (xpath(
                  '/row/c/text()',
                  query_to_xml(
                    format('select count(*) as c from public.%I where strpos(%I::text, %L) > 0',
                           c.table_name, c.column_name, r.old_ref),
                    false, true, ''
                  )
               ))[1]::text::bigint as rows_with_old_ref
          from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema
           and t.table_name   = c.table_name
           and t.table_type   = 'BASE TABLE'
          cross join url_rewrite_refs r
         where c.table_schema = 'public'
           and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb')
       ) hits
 where rows_with_old_ref > 0;

\echo ''
\echo '   kv collections holding the old ref:'
select collection, rows_with_old_ref from url_rewrite_kvscan order by collection;

\echo ''
\echo '   columns holding the old ref:'
select table_name, column_name, rows_with_old_ref from url_rewrite_scan order by table_name, column_name;

select format('[[REWRITE|KVSCAN|%s|%s]]', collection, rows_with_old_ref) as marker
  from url_rewrite_kvscan order by collection;
select format('[[REWRITE|SCAN|%s|%s|%s]]', table_name, column_name, rows_with_old_ref) as marker
  from url_rewrite_scan order by table_name, column_name;
\echo '[[REWRITE|SCAN_DONE]]'
\else
\echo ''
\echo '>> residual scan skipped (scan=off) — nothing here proves the rewrite was complete'
\echo '[[REWRITE|SCAN_SKIPPED]]'
\endif

set client_min_messages = warning;
drop view  if exists pg_temp.url_rewrite_status;
drop table if exists pg_temp.url_rewrite_scan;
drop table if exists pg_temp.url_rewrite_kvscan;
drop table if exists pg_temp.url_rewrite_refs;
reset client_min_messages;

\echo ''
\echo '── 04-rewrite-urls.sql finished ───────────────────────────────────────'
