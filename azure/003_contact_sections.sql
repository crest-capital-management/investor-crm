-- Contact sections: each contact belongs to one section, shown as tabs on the
-- Contacts and Investors pages. Starts with "Tab 1" and "Tab 2"; the list is
-- renamed and edited in the app (Contacts -> Manage sections).
--
-- Safe to apply before the code that uses it is deployed: the new column is
-- optional, so the running app keeps working. Every existing contact is put in
-- the first section. Run once on crest_crm with `node azure/apply-003.js`.

begin;

create table public.contact_sections (
  id uuid not null default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint contact_sections_pkey primary key (id),
  constraint contact_sections_name_not_blank check (btrim(name) <> '')
);

create unique index contact_sections_name_unique on public.contact_sections (lower(name));

alter table public.contacts
  add column section_id uuid references public.contact_sections(id) on delete restrict;

create index contacts_section_id_idx on public.contacts (section_id);

-- Placeholder names; rename them in the app (Contacts -> Manage sections).
insert into public.contact_sections (name, sort_order) values ('Tab 1', 1), ('Tab 2', 2);

update public.contacts
   set section_id = (select id from public.contact_sections where name = 'Tab 1')
 where section_id is null;

commit;
