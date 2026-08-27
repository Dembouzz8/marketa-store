begin;

do $migration$
begin
  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'vendor_applications'
  ) then
    raise exception
      'Conflicting relation public.vendor_applications already exists; migration stopped.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'submit_vendor_application'
  ) then
    raise exception
      'Conflicting function public.submit_vendor_application already exists; migration stopped.';
  end if;
end
$migration$;

create table public.vendor_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null,
  email text not null,
  phone text not null,
  business_category text not null,
  location text not null,
  business_description text not null,
  product_summary text not null,
  experience text,
  terms_accepted boolean not null,
  status text not null default 'submitted',
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_applications_business_name_check
    check (char_length(btrim(business_name)) between 1 and 120),
  constraint vendor_applications_contact_name_check
    check (char_length(btrim(contact_name)) between 1 and 120),
  constraint vendor_applications_email_check
    check (
      char_length(email) between 1 and 254
      and email = lower(btrim(email))
      and email ~ '[^[:space:]]'
    ),
  constraint vendor_applications_phone_check
    check (char_length(btrim(phone)) between 1 and 32),
  constraint vendor_applications_business_category_check
    check (char_length(btrim(business_category)) between 1 and 100),
  constraint vendor_applications_location_check
    check (char_length(btrim(location)) between 1 and 160),
  constraint vendor_applications_business_description_check
    check (char_length(btrim(business_description)) between 1 and 2000),
  constraint vendor_applications_product_summary_check
    check (char_length(btrim(product_summary)) between 1 and 2000),
  constraint vendor_applications_experience_check
    check (
      experience is null
      or char_length(btrim(experience)) between 1 and 2000
    ),
  constraint vendor_applications_terms_accepted_check
    check (terms_accepted = true),
  constraint vendor_applications_status_check
    check (status in ('submitted', 'under_review', 'approved', 'rejected')),
  constraint vendor_applications_review_notes_check
    check (
      review_notes is null
      or char_length(review_notes) <= 4000
    )
);

comment on table public.vendor_applications is
  'Private prospective-seller applications awaiting administrative review.';

comment on column public.vendor_applications.review_notes is
  'Private administrative review notes; never exposed through the public submission contract.';

create index vendor_applications_created_at_idx
  on public.vendor_applications (created_at desc);

create index vendor_applications_status_idx
  on public.vendor_applications (status);

create unique index vendor_applications_active_email_unique
  on public.vendor_applications (lower(email))
  where status in ('submitted', 'under_review');

alter table public.vendor_applications
  enable row level security;

revoke all privileges
on table public.vendor_applications
from public, anon, authenticated;

grant all privileges
on table public.vendor_applications
to service_role;

create function public.submit_vendor_application(
  p_business_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_business_category text,
  p_location text,
  p_business_description text,
  p_product_summary text,
  p_experience text,
  p_terms_accepted boolean
)
returns table (
  outcome text,
  application_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_business_name text := pg_catalog.btrim(p_business_name);
  normalized_contact_name text := pg_catalog.btrim(p_contact_name);
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  normalized_phone text := pg_catalog.btrim(p_phone);
  normalized_business_category text := pg_catalog.btrim(p_business_category);
  normalized_location text := pg_catalog.btrim(p_location);
  normalized_business_description text := pg_catalog.btrim(p_business_description);
  normalized_product_summary text := pg_catalog.btrim(p_product_summary);
  normalized_experience text := case
    when p_experience is null then null
    else pg_catalog.btrim(p_experience)
  end;
  inserted_application_id uuid;
  violated_constraint text;
begin
  if normalized_business_name is null
    or normalized_business_name = ''
    or pg_catalog.char_length(normalized_business_name) > 120
  then
    raise exception using
      errcode = '22023',
      message = 'business_name must be between 1 and 120 characters.';
  end if;

  if normalized_contact_name is null
    or normalized_contact_name = ''
    or pg_catalog.char_length(normalized_contact_name) > 120
  then
    raise exception using
      errcode = '22023',
      message = 'contact_name must be between 1 and 120 characters.';
  end if;

  if normalized_email is null
    or normalized_email = ''
    or pg_catalog.char_length(normalized_email) > 254
  then
    raise exception using
      errcode = '22023',
      message = 'email must be between 1 and 254 characters.';
  end if;

  if normalized_phone is null
    or normalized_phone = ''
    or pg_catalog.char_length(normalized_phone) > 32
  then
    raise exception using
      errcode = '22023',
      message = 'phone must be between 1 and 32 characters.';
  end if;

  if normalized_business_category is null
    or normalized_business_category = ''
    or pg_catalog.char_length(normalized_business_category) > 100
  then
    raise exception using
      errcode = '22023',
      message = 'business_category must be between 1 and 100 characters.';
  end if;

  if normalized_location is null
    or normalized_location = ''
    or pg_catalog.char_length(normalized_location) > 160
  then
    raise exception using
      errcode = '22023',
      message = 'location must be between 1 and 160 characters.';
  end if;

  if normalized_business_description is null
    or normalized_business_description = ''
    or pg_catalog.char_length(normalized_business_description) > 2000
  then
    raise exception using
      errcode = '22023',
      message = 'business_description must be between 1 and 2000 characters.';
  end if;

  if normalized_product_summary is null
    or normalized_product_summary = ''
    or pg_catalog.char_length(normalized_product_summary) > 2000
  then
    raise exception using
      errcode = '22023',
      message = 'product_summary must be between 1 and 2000 characters.';
  end if;

  if normalized_experience is not null
    and (
      normalized_experience = ''
      or pg_catalog.char_length(normalized_experience) > 2000
    )
  then
    raise exception using
      errcode = '22023',
      message = 'experience must be null or between 1 and 2000 characters.';
  end if;

  if p_terms_accepted is distinct from true then
    raise exception using
      errcode = '22023',
      message = 'terms_accepted must be true.';
  end if;

  insert into public.vendor_applications (
    business_name,
    contact_name,
    email,
    phone,
    business_category,
    location,
    business_description,
    product_summary,
    experience,
    terms_accepted,
    status,
    review_notes,
    reviewed_at
  )
  values (
    normalized_business_name,
    normalized_contact_name,
    normalized_email,
    normalized_phone,
    normalized_business_category,
    normalized_location,
    normalized_business_description,
    normalized_product_summary,
    normalized_experience,
    true,
    'submitted',
    null,
    null
  )
  returning id into inserted_application_id;

  return query
  select 'submitted'::text, inserted_application_id;
  return;

exception
  when unique_violation then
    get stacked diagnostics
      violated_constraint = constraint_name;

    if violated_constraint = 'vendor_applications_active_email_unique' then
      return query
      select 'duplicate_active_application'::text, null::uuid;
      return;
    end if;

    raise;
end
$function$;

comment on function public.submit_vendor_application(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) is
  'Controlled write-only submission contract for prospective sellers.';

revoke all privileges
on function public.submit_vendor_application(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
)
from public, anon, authenticated;

grant execute
on function public.submit_vendor_application(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
)
to anon, authenticated, service_role;

commit;
