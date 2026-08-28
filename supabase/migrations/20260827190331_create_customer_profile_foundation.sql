begin;

do $preflight$
begin
  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'customer_profiles'
  ) then
    raise exception
      'Conflicting relation public.customer_profiles already exists; migration stopped.';
  end if;
end
$preflight$;

create table public.customer_profiles (
  user_id uuid not null primary key
    references auth.users(id)
    on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_profiles_full_name_check
    check (
      full_name is null
      or pg_catalog.char_length(pg_catalog.btrim(full_name)) between 1 and 120
    ),
  constraint customer_profiles_phone_check
    check (
      phone is null
      or pg_catalog.char_length(pg_catalog.btrim(phone)) between 1 and 32
    )
);

comment on table public.customer_profiles is
  'Private application profile data for customer Auth users.';

comment on column public.customer_profiles.user_id is
  'One-to-one owner reference to auth.users; vendor Auth users are not backfilled.';

alter table public.customer_profiles
  enable row level security;

revoke all privileges
on table public.customer_profiles
from public, anon, authenticated;

grant select, insert, update
on table public.customer_profiles
to authenticated;

grant all privileges
on table public.customer_profiles
to service_role;

create policy customer_profiles_select_own
on public.customer_profiles
for select
to authenticated
using (user_id = auth.uid());

create policy customer_profiles_insert_own
on public.customer_profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy customer_profiles_update_own
on public.customer_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

do $postcondition$
declare
  rls_enabled boolean;
begin
  if to_regclass('public.customer_profiles') is null then
    raise exception
      'Postcondition failed: public.customer_profiles is missing.';
  end if;

  select relation.relrowsecurity
  into rls_enabled
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'customer_profiles';

  if rls_enabled is distinct from true then
    raise exception
      'Postcondition failed: RLS is not enabled on public.customer_profiles.';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges as privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'customer_profiles'
      and privilege.grantee = 'PUBLIC'
  ) then
    raise exception
      'Postcondition failed: PUBLIC retains customer_profiles privileges.';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'TRUNCATE')
    or pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'REFERENCES')
    or pg_catalog.has_table_privilege('anon', 'public.customer_profiles', 'TRIGGER')
  then
    raise exception
      'Postcondition failed: anon retains customer_profiles privileges.';
  end if;

  if not pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'INSERT'
  ) or not pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'UPDATE'
  ) then
    raise exception
      'Postcondition failed: authenticated profile privileges are incomplete.';
  end if;

  if pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'DELETE'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'TRUNCATE'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'REFERENCES'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.customer_profiles',
    'TRIGGER'
  ) then
    raise exception
      'Postcondition failed: authenticated has excess customer_profiles privileges.';
  end if;

  if not (
    pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'SELECT')
    and pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'INSERT')
    and pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'UPDATE')
    and pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'DELETE')
    and pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'TRUNCATE')
    and pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'REFERENCES')
    and pg_catalog.has_table_privilege('service_role', 'public.customer_profiles', 'TRIGGER')
  ) then
    raise exception
      'Postcondition failed: service_role administration is incomplete.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'customer_profiles'
      and policy.policyname = 'customer_profiles_select_own'
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[]
  ) then
    raise exception
      'Postcondition failed: customer_profiles_select_own is missing or mis-scoped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'customer_profiles'
      and policy.policyname = 'customer_profiles_insert_own'
      and policy.cmd = 'INSERT'
      and policy.roles = array['authenticated']::name[]
  ) then
    raise exception
      'Postcondition failed: customer_profiles_insert_own is missing or mis-scoped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'customer_profiles'
      and policy.policyname = 'customer_profiles_update_own'
      and policy.cmd = 'UPDATE'
      and policy.roles = array['authenticated']::name[]
  ) then
    raise exception
      'Postcondition failed: customer_profiles_update_own is missing or mis-scoped.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'customer_profiles'
      and policy.cmd = 'DELETE'
  ) then
    raise exception
      'Postcondition failed: a customer_profiles DELETE policy exists.';
  end if;
end
$postcondition$;

commit;
