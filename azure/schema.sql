-- CREST CRM schema for the Azure PostgreSQL database (Phase 1).
--
-- Generated 2026-11-04 from the live Supabase database (PostgreSQL 17.6),
-- read from its catalog, so it includes the foreign-key ON DELETE rules, CHECK
-- constraints and indexes that the baseline migration does not capture.
--
-- Left out on purpose (Supabase-only, or replaced by code):
--   row-level security and its 11 policies, is_crm_owner() (auth.uid()),
--   grants/revokes for anon/authenticated, storage buckets, the supabase_realtime
--   publication, and the pgcrypto/uuid-ossp extensions (gen_random_uuid() is built
--   into PostgreSQL 13+).
--
-- Run once on an empty database, as the user the app connects with:
--   the whole file is one transaction, so it either all applies or nothing does.

begin;

create table public.contacts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text not null,
  tags text[] default '{}'::text[],
  created_at timestamp with time zone default now(),
  date_saved date,
  email text,
  deleted_at timestamp with time zone,
  whatsapp_summary text,
  whatsapp_summary_generated_at timestamp with time zone,
  notes text,
  last_read_at timestamp with time zone,
  last_message_at timestamp with time zone,
  last_message_text text,
  last_message_direction text,
  company text,
  ai_score smallint,
  ai_score_reason text,
  ai_scored_at timestamp with time zone,
  manual_score smallint,
  manual_score_reason text,
  manual_scored_at timestamp with time zone,
  constraint contacts_pkey PRIMARY KEY (id),
  constraint contacts_ai_score_range CHECK (((ai_score IS NULL) OR ((ai_score >= 1) AND (ai_score <= 5)))),
  constraint contacts_manual_score_range CHECK (((manual_score IS NULL) OR ((manual_score >= 1) AND (manual_score <= 5))))
);

create table public.groups (
  id uuid not null default gen_random_uuid(),
  name text not null,
  created_at timestamp with time zone default now(),
  deleted_at timestamp with time zone,
  constraint groups_pkey PRIMARY KEY (id)
);

create table public.templates (
  id uuid not null default gen_random_uuid(),
  name text not null,
  meta_template_id text,
  variables jsonb default '{}'::jsonb,
  category text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  body_text text,
  language text not null default 'en_US'::text,
  constraint templates_pkey PRIMARY KEY (id)
);

create table public.broadcasts (
  id uuid not null default gen_random_uuid(),
  message_text text not null,
  media_url text,
  target_type text not null,
  target_ids text[] not null default '{}'::text[],
  status text not null default 'draft'::text,
  scheduled_for timestamp with time zone,
  sent_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  template_id uuid,
  variable_mappings jsonb default '{}'::jsonb,
  send_summary jsonb,
  constraint broadcasts_pkey PRIMARY KEY (id),
  constraint broadcasts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text]))),
  constraint broadcasts_target_type_check CHECK ((target_type = ANY (ARRAY['group'::text, 'tag'::text, 'manual'::text])))
);

create table public.broadcast_recipients (
  id uuid not null default gen_random_uuid(),
  broadcast_id uuid not null,
  contact_id uuid,
  name text,
  phone text,
  email text,
  status text not null default 'pending'::text,
  error text,
  claimed_at timestamp with time zone,
  sent_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  wamid text,
  constraint broadcast_recipients_pkey PRIMARY KEY (id),
  constraint broadcast_recipients_broadcast_id_contact_id_key UNIQUE (broadcast_id, contact_id),
  constraint broadcast_recipients_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
);

create table public.contact_groups (
  contact_id uuid not null,
  group_id uuid not null,
  constraint contact_groups_pkey PRIMARY KEY (contact_id, group_id)
);

create table public.follow_ups (
  id uuid not null default gen_random_uuid(),
  contact_id uuid,
  due_date date not null,
  message text,
  is_done boolean default false,
  created_at timestamp with time zone default now(),
  deleted_at timestamp with time zone,
  constraint follow_ups_pkey PRIMARY KEY (id)
);

create table public.interactions (
  id uuid not null default gen_random_uuid(),
  contact_id uuid,
  type text not null,
  note text,
  created_at timestamp with time zone default now(),
  deleted_at timestamp with time zone,
  constraint interactions_pkey PRIMARY KEY (id),
  constraint interactions_type_check CHECK ((type = ANY (ARRAY['meeting'::text, 'follow_up'::text])))
);

create table public.portfolio_updates (
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  title text,
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  source text not null default 'file'::text,
  analysis jsonb,
  analysis_status text not null default 'pending'::text,
  analysis_error text,
  as_of_date date,
  created_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  constraint portfolio_updates_pkey PRIMARY KEY (id),
  constraint portfolio_updates_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text]))),
  constraint portfolio_updates_source_check CHECK ((source = ANY (ARRAY['file'::text, 'paste'::text])))
);

create table public.whatsapp_messages (
  id uuid not null default gen_random_uuid(),
  contact_id uuid,
  direction text not null,
  message_text text,
  media_url text,
  sent_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  phone text,
  profile_name text,
  wamid text,
  status text,
  status_error text,
  status_at timestamp with time zone,
  constraint whatsapp_messages_pkey PRIMARY KEY (id),
  constraint whatsapp_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])))
);

create table public.app_settings (
  id text not null default 'default'::text,
  reminder_email_enabled boolean not null default true,
  reminder_email_to text,
  reminder_include_followups boolean not null default true,
  reminder_include_unread boolean not null default true,
  notify_messages boolean not null default true,
  notify_followups boolean not null default true,
  notify_broadcasts boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  constraint app_settings_pkey PRIMARY KEY (id),
  constraint app_settings_id_check CHECK ((id = 'default'::text))
);

-- Foreign keys (added after all tables exist).
alter table public.broadcasts add constraint broadcasts_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;
alter table public.broadcast_recipients add constraint broadcast_recipients_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.broadcasts(id) ON DELETE CASCADE;
alter table public.broadcast_recipients add constraint broadcast_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
alter table public.contact_groups add constraint contact_groups_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
alter table public.contact_groups add constraint contact_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
alter table public.follow_ups add constraint follow_ups_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
alter table public.interactions add constraint interactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
alter table public.portfolio_updates add constraint portfolio_updates_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
alter table public.whatsapp_messages add constraint whatsapp_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id);

-- Indexes (besides the ones behind primary keys and unique constraints).
CREATE INDEX broadcast_recipients_broadcast_status_idx ON public.broadcast_recipients USING btree (broadcast_id, status);
CREATE INDEX idx_broadcasts_scheduled_for ON public.broadcasts USING btree (scheduled_for);
CREATE INDEX idx_broadcasts_status ON public.broadcasts USING btree (status);
CREATE INDEX idx_broadcasts_template_id ON public.broadcasts USING btree (template_id);
CREATE INDEX contact_groups_contact_id_idx ON public.contact_groups USING btree (contact_id);
CREATE INDEX contact_groups_group_id_idx ON public.contact_groups USING btree (group_id);
CREATE INDEX contacts_last_message_at_idx ON public.contacts USING btree (last_message_at DESC NULLS LAST) WHERE (deleted_at IS NULL);
CREATE INDEX contacts_phone_idx ON public.contacts USING btree (phone);
CREATE INDEX contacts_tags_gin_idx ON public.contacts USING gin (tags);
CREATE INDEX idx_contacts_email ON public.contacts USING btree (lower(email));
CREATE INDEX follow_ups_contact_id_idx ON public.follow_ups USING btree (contact_id);
CREATE INDEX follow_ups_pending_due_date_idx ON public.follow_ups USING btree (is_done, due_date) WHERE (deleted_at IS NULL);
CREATE INDEX interactions_contact_id_created_at_idx ON public.interactions USING btree (contact_id, created_at);
CREATE INDEX portfolio_updates_contact_idx ON public.portfolio_updates USING btree (contact_id, created_at DESC);
CREATE INDEX idx_whatsapp_messages_contact_id ON public.whatsapp_messages USING btree (contact_id);
CREATE INDEX idx_whatsapp_messages_sent_at ON public.whatsapp_messages USING btree (sent_at);
CREATE INDEX whatsapp_messages_contact_direction_sent_at_idx ON public.whatsapp_messages USING btree (contact_id, direction, sent_at) WHERE (deleted_at IS NULL);
CREATE INDEX whatsapp_messages_unmatched_phone_idx ON public.whatsapp_messages USING btree (phone) WHERE (contact_id IS NULL);
CREATE UNIQUE INDEX whatsapp_messages_wamid_unique ON public.whatsapp_messages USING btree (wamid) WHERE (wamid IS NOT NULL);

-- Functions.
CREATE OR REPLACE FUNCTION public.bulk_change_contact_tags(p_ids uuid[], p_mode text, p_tag text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  n integer := 0;
begin
  if p_mode = 'add' then
    update public.contacts
    set tags = coalesce(tags, '{}') || p_tag
    where id = any(p_ids)
      and deleted_at is null
      and not (p_tag = any(coalesce(tags, '{}')));
  elsif p_mode = 'remove' then
    update public.contacts
    set tags = array_remove(coalesce(tags, '{}'), p_tag)
    where id = any(p_ids)
      and deleted_at is null
      and p_tag = any(coalesce(tags, '{}'));
  elsif p_mode = 'replace' then
    update public.contacts
    set tags = array[p_tag]
    where id = any(p_ids)
      and deleted_at is null
      and tags is distinct from array[p_tag];
  else
    raise exception 'Unknown mode %', p_mode;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_update_contacts(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  n integer := 0;
begin
  update public.contacts c
  set name = coalesce(r.name, c.name),
      email = coalesce(r.email, c.email),
      company = coalesce(r.company, c.company),
      notes = coalesce(r.notes, c.notes),
      date_saved = coalesce(r.date_saved, c.date_saved),
      tags = coalesce(r.tags, c.tags)
  from jsonb_to_recordset(p_rows) as r(
    id uuid,
    name text,
    email text,
    company text,
    notes text,
    date_saved date,
    tags text[]
  )
  where c.id = r.id
    and c.deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_broadcast_recipients(p_broadcast_id uuid, p_limit integer)
 RETURNS SETOF broadcast_recipients
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  update public.broadcast_recipients r
  set status = 'sending', claimed_at = now()
  where r.id in (
    select id from public.broadcast_recipients
    where broadcast_id = p_broadcast_id and status = 'pending'
    order by created_at, id
    limit p_limit
    for update skip locked
  )
  returning r.*;
$function$;

CREATE OR REPLACE FUNCTION public.touch_contact_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.contact_id is not null and new.deleted_at is null then
    update public.contacts
    set last_message_at = new.sent_at,
        last_message_text = left(
          coalesce(nullif(btrim(new.message_text), ''),
                   case when new.media_url is not null then 'Attachment' else '' end),
          120),
        last_message_direction = new.direction
    where id = new.contact_id
      and (last_message_at is null or last_message_at <= new.sent_at);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unread_conversations()
 RETURNS TABLE(contact_id uuid, unread_count bigint, last_message_at timestamp with time zone, last_message_text text, last_media_url text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    m.contact_id,
    count(*) as unread_count,
    max(m.sent_at) as last_message_at,
    (array_agg(m.message_text order by m.sent_at desc))[1] as last_message_text,
    (array_agg(m.media_url order by m.sent_at desc))[1] as last_media_url
  from public.whatsapp_messages m
  join public.contacts c
    on c.id = m.contact_id
   and c.deleted_at is null
  where m.direction = 'in'
    and m.deleted_at is null
    and m.sent_at > coalesce(c.last_read_at, '-infinity'::timestamptz)
    and m.sent_at > coalesce(
      (
        select max(o.sent_at)
        from public.whatsapp_messages o
        where o.contact_id = c.id
          and o.direction = 'out'
          and o.deleted_at is null
      ),
      '-infinity'::timestamptz
    )
  group by m.contact_id
  order by max(m.sent_at) desc;
$function$;

-- Triggers.
CREATE TRIGGER whatsapp_messages_touch_contact AFTER INSERT OR UPDATE OF contact_id ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION touch_contact_last_message();

commit;
