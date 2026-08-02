-- The activities mapper (server/supa.js) writes show_on_site, but the live
-- table never got the column, so every save that includes it fails.
alter table activities add column if not exists show_on_site boolean not null default false;
notify pgrst, 'reload schema';
