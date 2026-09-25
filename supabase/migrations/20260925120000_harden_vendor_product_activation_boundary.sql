-- Batch 4A: align product visibility and management with vendor activation.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  column_record record;
  public_read record;
  vendor_manage record;
  normalized_qual text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = pg_catalog.to_regclass('public.products')
      and relkind = 'r'
      and relrowsecurity
  ) then
    raise exception 'Batch 4A: public.products is missing, is not a table, or does not have RLS enabled.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = pg_catalog.to_regclass('public.vendors')
      and relkind = 'r'
      and relrowsecurity
  ) then
    raise exception 'Batch 4A: public.vendors is missing, is not a table, or does not have RLS enabled.';
  end if;

  select policy.*
  into public_read
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'products_public_read';

  if public_read.policyname is null
    or public_read.cmd <> 'SELECT'
    or public_read.permissive <> 'PERMISSIVE'
    or public_read.roles is distinct from array['public']::name[]
    or public_read.with_check is not null
    or pg_catalog.lower(pg_catalog.regexp_replace(
      public_read.qual,
      '[[:space:]()]',
      '',
      'g'
    )) <> 'is_active=true'
  then
    raise exception 'Batch 4A: products_public_read no longer matches the audited baseline.';
  end if;

  select policy.*
  into vendor_manage
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_manage_products';

  if vendor_manage.policyname is null
    or vendor_manage.cmd <> 'ALL'
    or vendor_manage.permissive <> 'PERMISSIVE'
    or vendor_manage.roles is distinct from array['authenticated']::name[]
    or vendor_manage.with_check is not null
  then
    raise exception 'Batch 4A: vendor_manage_products no longer matches the audited policy shape.';
  end if;

  normalized_qual := pg_catalog.lower(pg_catalog.replace(
    pg_catalog.regexp_replace(vendor_manage.qual, '[[:space:]()]', '', 'g'),
    'public.',
    ''
  ));

  if normalized_qual not in (
    'vendor_idinselectvendors.idfromvendorswherevendors.user_id=auth.uid',
    'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuid'
  ) then
    raise exception 'Batch 4A: vendor_manage_products ownership predicate no longer matches the audited baseline.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'products'
  ) <> 2 then
    raise exception 'Batch 4A: unexpected additional product policies exist.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and not attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'true'
  ) then
    raise exception 'Batch 4A: products.is_active default or nullability no longer matches the audited baseline.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'false'
  ) then
    raise exception 'Batch 4A: vendors.is_active default or nullability changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.vendors'::pg_catalog.regclass
      and conname = 'vendors_user_id_key'
      and contype = 'u'
      and convalidated
      and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (user_id)'
  ) then
    raise exception 'Batch 4A: the one-vendor-per-user ownership invariant changed.';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.vendors', 'UPDATE') then
    raise exception 'Batch 4A: authenticated unexpectedly has table-level vendor UPDATE.';
  end if;

  for column_record in
    select attribute.attname
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  loop
    if pg_catalog.has_column_privilege(
      'authenticated',
      'public.vendors',
      column_record.attname,
      'UPDATE'
    ) is distinct from (column_record.attname in ('name', 'phone', 'bank_details'))
    then
      raise exception 'Batch 4A: authenticated vendor UPDATE privileges changed on column %.',
        column_record.attname;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'is_vendor_active'
  ) then
    raise exception 'Batch 4A: public.is_vendor_active is unexpectedly occupied.';
  end if;
end
$preflight$;

create function public.is_vendor_active(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select vendor.is_active
    from public.vendors as vendor
    where vendor.id = p_vendor_id
  ), false)
$function$;

alter function public.is_vendor_active(uuid) owner to postgres;
revoke all privileges on function public.is_vendor_active(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.is_vendor_active(uuid)
to anon, authenticated;

alter table public.products
  alter column is_active set default false;

drop policy products_public_read on public.products;
drop policy vendor_manage_products on public.products;

create policy products_public_read
on public.products
for select
to public
using (
  is_active = true
  and public.is_vendor_active(vendor_id)
);

create policy vendor_select_own_products
on public.products
for select
to authenticated
using (
  vendor_id in (
    select vendors.id
    from public.vendors
    where vendors.user_id = (select auth.uid())
  )
);

create policy vendor_insert_own_active_products
on public.products
for insert
to authenticated
with check (
  vendor_id in (
    select vendors.id
    from public.vendors
    where vendors.user_id = (select auth.uid())
      and vendors.is_active = true
  )
);

create policy vendor_update_own_active_products
on public.products
for update
to authenticated
using (
  vendor_id in (
    select vendors.id
    from public.vendors
    where vendors.user_id = (select auth.uid())
      and vendors.is_active = true
  )
)
with check (
  vendor_id in (
    select vendors.id
    from public.vendors
    where vendors.user_id = (select auth.uid())
      and vendors.is_active = true
  )
);

create policy vendor_delete_own_active_products
on public.products
for delete
to authenticated
using (
  vendor_id in (
    select vendors.id
    from public.vendors
    where vendors.user_id = (select auth.uid())
      and vendors.is_active = true
  )
);

do $postcondition$
declare
  function_oid oid := pg_catalog.to_regprocedure('public.is_vendor_active(uuid)');
  policy_record record;
  normalized_qual text;
  normalized_check text;
begin
  if function_oid is null
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = function_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and procedure.prosecdef
        and procedure.provolatile = 's'
        and procedure.prorettype = 'boolean'::pg_catalog.regtype
        and procedure.proconfig @> array['search_path=""']
        and procedure.prosrc like '%from public.vendors as vendor%'
        and procedure.prosrc not like '%execute%'
    )
  then
    raise exception 'Batch 4A postcondition: active-vendor helper security contract is incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'is_vendor_active'
      and procedure.oid <> function_oid
  ) then
    raise exception 'Batch 4A postcondition: unexpected active-vendor helper overload exists.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) as access
    where procedure.oid = function_oid
      and (
        access.grantee = 0
        or access.grantee = 'service_role'::pg_catalog.regrole
        or access.privilege_type <> 'EXECUTE'
        or access.is_grantable
        or access.grantee not in (
          'postgres'::pg_catalog.regrole,
          'anon'::pg_catalog.regrole,
          'authenticated'::pg_catalog.regrole
        )
      )
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) as access
    where procedure.oid = function_oid
      and access.grantee in (
        'anon'::pg_catalog.regrole,
        'authenticated'::pg_catalog.regrole
      )
      and access.privilege_type = 'EXECUTE'
  ) <> 2 then
    raise exception 'Batch 4A postcondition: active-vendor helper EXECUTE grants are incorrect.';
  end if;

  if public.is_vendor_active(null) is distinct from false
    or exists (
      select 1
      from public.vendors as vendor
      where public.is_vendor_active(vendor.id) is distinct from vendor.is_active
    )
  then
    raise exception 'Batch 4A postcondition: active-vendor helper result is incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'products'
  ) <> 5 then
    raise exception 'Batch 4A postcondition: unexpected product policy count.';
  end if;

  select policy.* into policy_record
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'products_public_read';

  normalized_qual := pg_catalog.lower(pg_catalog.replace(
    pg_catalog.regexp_replace(policy_record.qual, '[[:space:]()]', '', 'g'),
    'public.',
    ''
  ));
  if policy_record.policyname is null
    or policy_record.policyname <> 'products_public_read'
    or policy_record.permissive <> 'PERMISSIVE'
    or policy_record.cmd <> 'SELECT'
    or policy_record.roles is distinct from array['public']::name[]
    or policy_record.with_check is not null
    or normalized_qual <> 'is_active=trueandis_vendor_activevendor_id'
  then
    raise exception 'Batch 4A postcondition: public product visibility policy is incorrect.';
  end if;

  select policy.* into policy_record
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_select_own_products';

  normalized_qual := pg_catalog.lower(pg_catalog.replace(
    pg_catalog.regexp_replace(policy_record.qual, '[[:space:]()]', '', 'g'),
    'public.',
    ''
  ));
  if policy_record.policyname is null
    or policy_record.policyname <> 'vendor_select_own_products'
    or policy_record.permissive <> 'PERMISSIVE'
    or policy_record.cmd <> 'SELECT'
    or policy_record.roles is distinct from array['authenticated']::name[]
    or policy_record.with_check is not null
    or normalized_qual <> 'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuid'
  then
    raise exception 'Batch 4A postcondition: own-product SELECT policy is incorrect.';
  end if;

  for policy_record in
    select policy.*
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.policyname in (
        'vendor_insert_own_active_products',
        'vendor_update_own_active_products',
        'vendor_delete_own_active_products'
      )
  loop
    normalized_qual := case
      when policy_record.qual is null then null
      else pg_catalog.lower(pg_catalog.replace(
        pg_catalog.regexp_replace(policy_record.qual, '[[:space:]()]', '', 'g'),
        'public.',
        ''
      ))
    end;
    normalized_check := case
      when policy_record.with_check is null then null
      else pg_catalog.lower(pg_catalog.replace(
        pg_catalog.regexp_replace(policy_record.with_check, '[[:space:]()]', '', 'g'),
        'public.',
        ''
      ))
    end;

    if policy_record.policyname not in (
      'vendor_insert_own_active_products',
      'vendor_update_own_active_products',
      'vendor_delete_own_active_products'
    )
      or policy_record.permissive <> 'PERMISSIVE'
      or policy_record.roles is distinct from array['authenticated']::name[]
    then
      raise exception 'Batch 4A postcondition: product management role is incorrect for %.',
        policy_record.policyname;
    end if;

    if policy_record.policyname = 'vendor_insert_own_active_products' then
      if policy_record.cmd <> 'INSERT'
        or normalized_qual is not null
        or normalized_check <> 'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuidandvendors.is_active=true'
      then
        raise exception 'Batch 4A postcondition: product INSERT policy is incorrect.';
      end if;
    elsif policy_record.policyname = 'vendor_update_own_active_products' then
      if policy_record.cmd <> 'UPDATE'
        or normalized_qual <> 'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuidandvendors.is_active=true'
        or normalized_check <> normalized_qual
      then
        raise exception 'Batch 4A postcondition: product UPDATE policy is incorrect.';
      end if;
    elsif policy_record.policyname = 'vendor_delete_own_active_products' then
      if policy_record.cmd <> 'DELETE'
        or normalized_qual <> 'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuidandvendors.is_active=true'
        or normalized_check is not null
      then
        raise exception 'Batch 4A postcondition: product DELETE policy is incorrect.';
      end if;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname in (
        'vendor_insert_own_active_products',
        'vendor_update_own_active_products',
        'vendor_delete_own_active_products'
      )
  ) <> 3 then
    raise exception 'Batch 4A postcondition: product mutation policies are incomplete.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and not attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'false'
  ) then
    raise exception 'Batch 4A postcondition: products.is_active default or nullability is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'false'
  ) or pg_catalog.has_column_privilege(
    'authenticated',
    'public.vendors',
    'is_active',
    'UPDATE'
  ) then
    raise exception 'Batch 4A postcondition: vendor activation protection changed.';
  end if;
end
$postcondition$;

commit;
