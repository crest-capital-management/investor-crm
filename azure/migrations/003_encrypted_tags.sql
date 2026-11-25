-- 003: groundwork for encryption phase 3 (TSK-38, package 4).
-- Apply BEFORE deploying the package 4 code. Works with the old code too.
-- Safe to run twice.
-- Apply with:  node azure/run-sql.mjs azure/migrations/003_encrypted_tags.sql
begin;

-- Lookup hashes of a contact's tags (one HMAC per tag, blindIndex("tag", ...)
-- in lib/encryption.ts), so tag filters still run in SQL once contacts.tags
-- holds encrypted values. null = not filled in yet: the app then falls back to
-- the plain tags (lib/pii.ts tagMatch). Filled by the app from package 4 and by
-- azure/encrypt-columns.mjs 3 --hash-only.
alter table public.contacts add column if not exists tag_hashes text[];
create index if not exists contacts_tag_hashes_gin_idx on public.contacts using gin (tag_hashes);

-- The "last message" trigger no longer writes the plain word 'Attachment' for a
-- message without text (contacts.last_message_text is encrypted in phase 3, so
-- it must hold encrypted text or nothing). The Contacts list already shows
-- "Attachment" when the preview is empty. Encrypted text is still copied whole.
create or replace function public.touch_contact_last_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.contact_id is not null and new.deleted_at is null then
    update public.contacts
    set last_message_at = new.sent_at,
        last_message_text = case
          when new.message_text like 'enc:v1:%' then new.message_text
          else left(coalesce(btrim(new.message_text), ''), 120)
        end,
        last_message_direction = new.direction
    where id = new.contact_id
      and (last_message_at is null or last_message_at <= new.sent_at);
  end if;
  return new;
end;
$function$;

commit;
