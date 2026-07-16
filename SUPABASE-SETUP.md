# Supabase wiring — environment variables

The CRM-core data (parents, students, groups, enrollments, attendance,
activities, activity_registrations) now lives in **Supabase** and is loaded into
the server on startup. Everything else still lives in `server/db.json`.

## Required environment variables (server)

Set these on **Render** (Dashboard → your service → Environment) and locally in
`server/.env`:

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://xaxykjvqqhrodmseqleu.supabase.co` | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | *(secret)* | **Recommended.** Supabase Dashboard → Project Settings → API → `service_role`. Bypasses RLS. |
| `SUPABASE_KEY` | anon key (already in `.env`) | Fallback if the service role key is not set. Works today only because RLS is disabled. |

The server reads the service role key first, then falls back to `SUPABASE_KEY`.

## Security TODO (not blocking)

RLS (Row Level Security) is currently **disabled** on all core tables, so the
anon key can read/write. Before going to real production you should:

1. Add `SUPABASE_SERVICE_ROLE_KEY` on Render (server-only, never expose to the browser).
2. Enable RLS on the core tables and add policies (e.g. allow all for the
   service role, deny anon). Example:
   ```sql
   alter table parents enable row level security;
   alter table students enable row level security;
   alter table groups enable row level security;
   -- ...repeat for the other core tables, then add policies.
   ```

## How persistence works now

- On boot, `server/db.js → initDb()` pulls the core tables from Supabase into
  `db.json` so the ephemeral Render disk always reflects the durable store.
- On every write to a core collection, the change is mirrored to Supabase
  (write-through). Reads stay synchronous from the local cache.
- If Supabase is unreachable, the server falls back to `db.json` only (offline mode).
