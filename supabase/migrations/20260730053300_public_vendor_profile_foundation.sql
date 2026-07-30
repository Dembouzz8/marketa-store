begin;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'vendors'
      and relation.relkind in ('r', 'p')
  ) then
    raise exception
      'Required table public.vendors is missing; public vendor profile migration stopped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'public_active_vendors'
      and relation.relkind = 'v'
  ) then
    raise exception
      'Required view public.public_active_vendors is missing; public vendor profile migration stopped.';
  end if;
end
$migration$;

revoke all privileges
on table public.vendors
from anon;

alter table public.vendors
  add column slug text,
  add column description text,
  add column main_category text,
  add column location text,
  add column shipping_info text,
  add column return_info text,
  add constraint vendors_slug_public_profile_check
    check (
      slug is null
      or (
        char_length(slug) <= 80
        and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      )
    ),
  add constraint vendors_description_public_profile_check
    check (
      description is null
      or (
        char_length(description) <= 2000
        and description ~ '[^[:space:]]'
      )
    ),
  add constraint vendors_main_category_public_profile_check
    check (
      main_category is null
      or (
        char_length(main_category) <= 100
        and main_category ~ '[^[:space:]]'
      )
    ),
  add constraint vendors_location_public_profile_check
    check (
      location is null
      or (
        char_length(location) <= 120
        and location ~ '[^[:space:]]'
      )
    ),
  add constraint vendors_shipping_info_public_profile_check
    check (
      shipping_info is null
      or (
        char_length(shipping_info) <= 2000
        and shipping_info ~ '[^[:space:]]'
      )
    ),
  add constraint vendors_return_info_public_profile_check
    check (
      return_info is null
      or (
        char_length(return_info) <= 2000
        and return_info ~ '[^[:space:]]'
      )
    );

create unique index vendors_slug_lower_unique
  on public.vendors (lower(slug))
  where slug is not null;

create table public.vendor_verifications (
  vendor_id uuid primary key
    references public.vendors(id)
    on delete cascade,
  verified_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.vendor_verifications
  enable row level security;

revoke all privileges
on table public.vendor_verifications
from public, anon, authenticated;

grant all privileges
on table public.vendor_verifications
to service_role;

create or replace view public.public_active_vendors
with (security_barrier = true)
as
select
  vendor.id,
  vendor.name,
  vendor.slug,
  vendor.description,
  vendor.main_category,
  vendor.location,
  vendor.shipping_info,
  vendor.return_info,
  exists (
    select 1
    from public.vendor_verifications as verification
    where verification.vendor_id = vendor.id
  ) as is_verified
from public.vendors as vendor
where vendor.is_active = true;

revoke all privileges
on table public.public_active_vendors
from public, anon, authenticated;

grant select
on table public.public_active_vendors
to anon, authenticated;

commit;
