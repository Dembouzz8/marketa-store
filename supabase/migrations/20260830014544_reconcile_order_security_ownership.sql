begin;

do $preflight$
declare
  orders_relation oid := pg_catalog.to_regclass('public.orders');
  order_items_relation oid := pg_catalog.to_regclass('public.order_items');
  auth_users_relation oid := pg_catalog.to_regclass('auth.users');
  customer_id_attribute smallint;
  auth_user_id_attribute smallint;
  customer_id_type oid;
  customer_id_not_null boolean;
  matching_fk_count integer;
  customer_id_fk_count integer;
  orders_rls_enabled boolean;
  order_items_rls_enabled boolean;
begin
  if orders_relation is null then
    raise exception 'Required table public.orders is missing.';
  end if;

  if order_items_relation is null then
    raise exception 'Required table public.order_items is missing.';
  end if;

  if auth_users_relation is null then
    raise exception 'Required table auth.users is missing.';
  end if;

  select
    attribute.attnum,
    attribute.atttypid,
    attribute.attnotnull
  into
    customer_id_attribute,
    customer_id_type,
    customer_id_not_null
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = orders_relation
    and attribute.attname = 'customer_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if customer_id_attribute is null then
    raise exception
      'Required column public.orders.customer_id is missing; migration stopped.';
  end if;

  if customer_id_type is distinct from pg_catalog.to_regtype('uuid') then
    raise exception
      'public.orders.customer_id must have type uuid; migration stopped.';
  end if;

  if customer_id_not_null is distinct from false then
    raise exception
      'public.orders.customer_id must remain nullable; migration stopped.';
  end if;

  select attribute.attnum
  into auth_user_id_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = auth_users_relation
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if auth_user_id_attribute is null then
    raise exception 'Required column auth.users.id is missing.';
  end if;

  select
    pg_catalog.count(*) filter (
      where constraint_record.confrelid = auth_users_relation
        and constraint_record.conkey =
          pg_catalog.array_append(array[]::smallint[], customer_id_attribute)
        and constraint_record.confkey =
          pg_catalog.array_append(array[]::smallint[], auth_user_id_attribute)
        and constraint_record.confdeltype = 'n'
    ),
    pg_catalog.count(*) filter (
      where customer_id_attribute = any (constraint_record.conkey)
    )
  into matching_fk_count, customer_id_fk_count
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.contype = 'f';

  if matching_fk_count <> 1 or customer_id_fk_count <> 1 then
    raise exception
      'public.orders.customer_id must have exactly one FK to auth.users(id) ON DELETE SET NULL; migration stopped.';
  end if;

  select relation.relrowsecurity
  into orders_rls_enabled
  from pg_catalog.pg_class as relation
  where relation.oid = orders_relation;

  select relation.relrowsecurity
  into order_items_rls_enabled
  from pg_catalog.pg_class as relation
  where relation.oid = order_items_relation;

  if orders_rls_enabled is distinct from true then
    raise exception 'RLS must already be enabled on public.orders.';
  end if;

  if order_items_rls_enabled is distinct from true then
    raise exception 'RLS must already be enabled on public.order_items.';
  end if;
end
$preflight$;

create function public.customer_owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.orders as customer_order
    where customer_order.id = p_order_id
      and customer_order.customer_id = (select auth.uid())
  );
$function$;

create function public.vendor_has_order_access(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.order_items as vendor_item
    inner join public.vendors as vendor
      on vendor.id = vendor_item.vendor_id
    where vendor_item.order_id = p_order_id
      and vendor.user_id = (select auth.uid())
  );
$function$;

create function public.vendor_owns_vendor(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.vendors as vendor
    where vendor.id = p_vendor_id
      and vendor.user_id = (select auth.uid())
  );
$function$;

alter function public.customer_owns_order(uuid) owner to postgres;
alter function public.vendor_has_order_access(uuid) owner to postgres;
alter function public.vendor_owns_vendor(uuid) owner to postgres;

revoke all privileges
on function public.customer_owns_order(uuid)
from public, anon, authenticated;

revoke all privileges
on function public.vendor_has_order_access(uuid)
from public, anon, authenticated;

revoke all privileges
on function public.vendor_owns_vendor(uuid)
from public, anon, authenticated;

grant execute
on function public.customer_owns_order(uuid)
to authenticated, service_role;

grant execute
on function public.vendor_has_order_access(uuid)
to authenticated, service_role;

grant execute
on function public.vendor_owns_vendor(uuid)
to authenticated, service_role;

drop policy if exists customer_insert_orders on public.orders;
drop policy if exists customer_select_orders on public.orders;
drop policy if exists vendor_select_orders on public.orders;
drop policy if exists customer_select_items on public.order_items;
drop policy if exists vendor_select_items on public.order_items;

create policy customer_select_orders
on public.orders
for select
to authenticated
using (customer_id = (select auth.uid()));

create policy vendor_select_orders
on public.orders
for select
to authenticated
using (public.vendor_has_order_access(id));

create policy customer_select_items
on public.order_items
for select
to authenticated
using (public.customer_owns_order(order_id));

create policy vendor_select_items
on public.order_items
for select
to authenticated
using (public.vendor_owns_vendor(vendor_id));

revoke all privileges
on table public.orders, public.order_items
from public, anon, authenticated;

grant select
on table public.orders, public.order_items
to authenticated;

grant all privileges
on table public.orders, public.order_items
to service_role;

create index orders_customer_id_created_at_idx
on public.orders (customer_id, created_at desc)
where customer_id is not null;

do $postcondition$
declare
  orders_relation oid := pg_catalog.to_regclass('public.orders');
  order_items_relation oid := pg_catalog.to_regclass('public.order_items');
  auth_users_relation oid := pg_catalog.to_regclass('auth.users');
  customer_id_attribute smallint;
  auth_user_id_attribute smallint;
  customer_id_type oid;
  customer_id_not_null boolean;
  matching_fk_count integer;
  customer_id_fk_count integer;
  helper_name text;
  helper_oid oid;
  helper_security_definer boolean;
  helper_configuration text[];
  target_table text;
  anon_role oid := (select role.oid from pg_catalog.pg_roles as role where role.rolname = 'anon');
begin
  select
    attribute.attnum,
    attribute.atttypid,
    attribute.attnotnull
  into
    customer_id_attribute,
    customer_id_type,
    customer_id_not_null
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = orders_relation
    and attribute.attname = 'customer_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select attribute.attnum
  into auth_user_id_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = auth_users_relation
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if customer_id_attribute is null
    or customer_id_type is distinct from pg_catalog.to_regtype('uuid')
    or customer_id_not_null is distinct from false
  then
    raise exception
      'Postcondition failed: public.orders.customer_id is not nullable uuid.';
  end if;

  select
    pg_catalog.count(*) filter (
      where constraint_record.confrelid = auth_users_relation
        and constraint_record.conkey =
          pg_catalog.array_append(array[]::smallint[], customer_id_attribute)
        and constraint_record.confkey =
          pg_catalog.array_append(array[]::smallint[], auth_user_id_attribute)
        and constraint_record.confdeltype = 'n'
    ),
    pg_catalog.count(*) filter (
      where customer_id_attribute = any (constraint_record.conkey)
    )
  into matching_fk_count, customer_id_fk_count
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.contype = 'f';

  if matching_fk_count <> 1 or customer_id_fk_count <> 1 then
    raise exception
      'Postcondition failed: customer_id FK no longer targets auth.users(id) ON DELETE SET NULL.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = orders_relation
      and relation.relrowsecurity
  ) then
    raise exception 'Postcondition failed: RLS is disabled on public.orders.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = order_items_relation
      and relation.relrowsecurity
  ) then
    raise exception
      'Postcondition failed: RLS is disabled on public.order_items.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'orders'
      and policy.policyname = 'customer_insert_orders'
  ) then
    raise exception
      'Postcondition failed: customer_insert_orders still exists.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and (
        (
          policy.tablename = 'orders'
          and policy.policyname in (
            'customer_select_orders',
            'vendor_select_orders'
          )
        )
        or (
          policy.tablename = 'order_items'
          and policy.policyname in (
            'customer_select_items',
            'vendor_select_items'
          )
        )
      )
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[]
  ) <> 4 then
    raise exception
      'Postcondition failed: ownership SELECT policies are missing or mis-scoped.';
  end if;

  foreach helper_name in array array[
    'public.customer_owns_order(uuid)',
    'public.vendor_has_order_access(uuid)',
    'public.vendor_owns_vendor(uuid)'
  ]
  loop
    helper_oid := pg_catalog.to_regprocedure(helper_name);

    if helper_oid is null then
      raise exception 'Postcondition failed: helper % is missing.', helper_name;
    end if;

    select procedure.prosecdef, procedure.proconfig
    into helper_security_definer, helper_configuration
    from pg_catalog.pg_proc as procedure
    where procedure.oid = helper_oid;

    if helper_security_definer is distinct from true then
      raise exception
        'Postcondition failed: helper % is not SECURITY DEFINER.', helper_name;
    end if;

    if not (
      coalesce(helper_configuration, array[]::text[])
      @> array['search_path=""']::text[]
    ) then
      raise exception
        'Postcondition failed: helper % does not use an empty search_path.', helper_name;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) as function_privilege
      where procedure.oid = helper_oid
        and function_privilege.privilege_type = 'EXECUTE'
        and function_privilege.grantee in (0, anon_role)
    ) then
      raise exception
        'Postcondition failed: PUBLIC or anon can execute helper %.', helper_name;
    end if;

    if not pg_catalog.has_function_privilege(
      'authenticated',
      helper_oid,
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'service_role',
      helper_oid,
      'EXECUTE'
    ) then
      raise exception
        'Postcondition failed: required execution grant is missing for helper %.', helper_name;
    end if;
  end loop;

  foreach target_table in array array[
    'public.orders',
    'public.order_items'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) as table_privilege
      where relation.oid = pg_catalog.to_regclass(target_table)
        and table_privilege.grantee = 0
    ) then
      raise exception
        'Postcondition failed: PUBLIC retains privileges on %.', target_table;
    end if;

    if pg_catalog.has_table_privilege('anon', target_table, 'SELECT')
      or pg_catalog.has_table_privilege('anon', target_table, 'INSERT')
      or pg_catalog.has_table_privilege('anon', target_table, 'UPDATE')
      or pg_catalog.has_table_privilege('anon', target_table, 'DELETE')
      or pg_catalog.has_table_privilege('anon', target_table, 'TRUNCATE')
      or pg_catalog.has_table_privilege('anon', target_table, 'REFERENCES')
      or pg_catalog.has_table_privilege('anon', target_table, 'TRIGGER')
    then
      raise exception
        'Postcondition failed: anon retains privileges on %.', target_table;
    end if;

    if not pg_catalog.has_table_privilege(
      'authenticated',
      target_table,
      'SELECT'
    ) then
      raise exception
        'Postcondition failed: authenticated lacks SELECT on %.', target_table;
    end if;

    if pg_catalog.has_table_privilege('authenticated', target_table, 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', target_table, 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', target_table, 'DELETE')
      or pg_catalog.has_table_privilege('authenticated', target_table, 'TRUNCATE')
      or pg_catalog.has_table_privilege('authenticated', target_table, 'REFERENCES')
      or pg_catalog.has_table_privilege('authenticated', target_table, 'TRIGGER')
    then
      raise exception
        'Postcondition failed: authenticated has excess privileges on %.', target_table;
    end if;

    if not (
      pg_catalog.has_table_privilege('service_role', target_table, 'SELECT')
      and pg_catalog.has_table_privilege('service_role', target_table, 'INSERT')
      and pg_catalog.has_table_privilege('service_role', target_table, 'UPDATE')
      and pg_catalog.has_table_privilege('service_role', target_table, 'DELETE')
      and pg_catalog.has_table_privilege('service_role', target_table, 'TRUNCATE')
      and pg_catalog.has_table_privilege('service_role', target_table, 'REFERENCES')
      and pg_catalog.has_table_privilege('service_role', target_table, 'TRIGGER')
    ) then
      raise exception
        'Postcondition failed: service_role administration is incomplete on %.', target_table;
    end if;
  end loop;

  if pg_catalog.to_regclass(
    'public.orders_customer_id_created_at_idx'
  ) is null then
    raise exception
      'Postcondition failed: customer history index is missing.';
  end if;

  if pg_catalog.to_regclass('public.idx_orders_customer') is null then
    raise exception
      'Postcondition failed: existing idx_orders_customer was not preserved.';
  end if;
end
$postcondition$;

commit;
