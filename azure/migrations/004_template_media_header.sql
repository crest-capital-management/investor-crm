-- 004: Meta templates with an image, video or document header (e.g. a PDF).
-- templates.header_format records the header kind from Meta (IMAGE, VIDEO or
-- DOCUMENT; null for no header or a text header). Such a template needs a file
-- with every message; a broadcast keeps that file in broadcasts.media_url.
-- The app works without this column (those templates are then skipped by
-- "Sync from Meta", as before), so it can be applied before or after the deploy.
-- Safe to run twice.
-- Apply with:  node azure/run-sql.mjs azure/migrations/004_template_media_header.sql
begin;

alter table public.templates add column if not exists header_format text;

commit;
