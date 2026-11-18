-- 002: let the "last message" trigger handle encrypted message text (TSK-38, package 2).
-- Apply BEFORE deploying the package 2 code. Works with the old code too
-- (plain text is handled exactly as before). Safe to run twice.
-- Apply with:  node azure/run-sql.mjs azure/migrations/002_encrypted_last_message.sql
--
-- Encrypted text can't be trimmed or cut to 120 characters in SQL (that would
-- break it), so it is copied whole; the app shortens the preview after
-- decrypting it.
begin;

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
          else left(
            coalesce(nullif(btrim(new.message_text), ''),
                     case when new.media_url is not null then 'Attachment' else '' end),
            120)
        end,
        last_message_direction = new.direction
    where id = new.contact_id
      and (last_message_at is null or last_message_at <= new.sent_at);
  end if;
  return new;
end;
$function$;

commit;
