begin;

do $d4_3_preflight$
declare
  target_table text;
  target_privilege text;
  relation_record record;
  actual_columns text[];
  expected_columns text[];
  authenticated_role oid := (
    select role.oid from pg_catalog.pg_roles as role
    where role.rolname = 'authenticated'
  );
  anon_role oid := (
    select role.oid from pg_catalog.pg_roles as role
    where role.rolname = 'anon'
  );
  service_role oid := (
    select role.oid from pg_catalog.pg_roles as role
    where role.rolname = 'service_role'
  );
  matched_policy_count integer;
  actual_policy_count integer;
begin
  if authenticated_role is null or anon_role is null or service_role is null then
    raise exception 'D4-3 preflight: required API roles are missing.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.oid in (authenticated_role, anon_role)
      and (role.rolsuper or role.rolbypassrls)
  ) or not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.oid = service_role
      and not role.rolsuper
      and role.rolbypassrls
  ) then
    raise exception 'D4-3 preflight: API role security attributes changed.';
  end if;

  foreach target_table in array array['orders', 'order_items'] loop
    select
      class.oid,
      class.relowner,
      class.relkind,
      class.relrowsecurity,
      class.relforcerowsecurity,
      class.relacl
    into relation_record
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = target_table;

    if relation_record.oid is null
      or relation_record.relkind <> 'r'
      or pg_catalog.pg_get_userbyid(relation_record.relowner) <> 'postgres'
      or not relation_record.relrowsecurity
      or relation_record.relforcerowsecurity
    then
      raise exception 'D4-3 preflight: public.% relation contract changed.', target_table;
    end if;

    select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
    into actual_columns
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = relation_record.oid
      and attribute.attnum > 0
      and not attribute.attisdropped;

    expected_columns := case target_table
      when 'orders' then array[
        'id', 'customer_id', 'customer_email', 'customer_phone', 'status',
        'total_amount', 'payment_ref', 'idempotency_key', 'shipping_address',
        'created_at', 'updated_at', 'checkout_attempt_id', 'customer_name',
        'total_amount_kobo', 'currency', 'financial_contract_version',
        'payment_finalized_at'
      ]::text[]
      else array[
        'id', 'order_id', 'product_id', 'vendor_id', 'quantity', 'unit_price',
        'subtotal', 'created_at', 'unit_amount_kobo', 'gross_amount_kobo',
        'platform_fee_bps', 'platform_fee_amount_kobo',
        'vendor_net_amount_kobo', 'currency', 'financial_contract_version',
        'product_variant_id', 'variant_size_snapshot',
        'variant_colour_snapshot', 'variant_options_snapshot'
      ]::text[]
    end;

    if actual_columns is distinct from expected_columns then
      raise exception 'D4-3 preflight: public.% columns changed.', target_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = relation_record.oid
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attacl is not null
    ) then
      raise exception 'D4-3 preflight: public.% has unexpected column ACLs.', target_table;
    end if;

    if not pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('public.%I', target_table), 'SELECT'
    ) or pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('public.%I', target_table),
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'D4-3 preflight: authenticated ACL changed on public.%.', target_table;
    end if;

    if pg_catalog.has_table_privilege(
      'anon', pg_catalog.format('public.%I', target_table),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'D4-3 preflight: anon unexpectedly reaches public.%.', target_table;
    end if;

    foreach target_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER'
    ] loop
      if not pg_catalog.has_table_privilege(
        'service_role',
        pg_catalog.format('public.%I', target_table),
        target_privilege
      ) then
        raise exception
          'D4-3 preflight: service-role % privilege changed on public.%.',
          target_privilege, target_table;
      end if;
    end loop;

    if (
      select pg_catalog.array_agg(acl.privilege_type order by acl.privilege_type)
      from pg_catalog.aclexplode(
        coalesce(
          relation_record.relacl,
          pg_catalog.acldefault('r', relation_record.relowner)
        )
      ) as acl
      where acl.grantee = authenticated_role
    ) is distinct from array['SELECT']::text[] then
      raise exception 'D4-3 preflight: authenticated direct ACL changed on public.%.', target_table;
    end if;

    if exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          relation_record.relacl,
          pg_catalog.acldefault('r', relation_record.relowner)
        )
      ) as acl
      where acl.grantee in (0, anon_role)
    ) then
      raise exception 'D4-3 preflight: PUBLIC or anon has a direct ACL on public.%.', target_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_roles as inherited_role
      where inherited_role.oid <> authenticated_role
        and pg_catalog.pg_has_role(
          authenticated_role,
          inherited_role.oid,
          'MEMBER'
        )
        and pg_catalog.has_table_privilege(
          inherited_role.oid,
          relation_record.oid,
          'SELECT'
        )
    ) then
      raise exception 'D4-3 preflight: authenticated inherits SELECT on public.%.', target_table;
    end if;
  end loop;

  with expected_policy(table_name, policy_name, policy_qual) as (
    values
      (
        'orders',
        'customer_select_orders',
        '(customer_id = ( SELECT auth.uid() AS uid))'
      ),
      ('orders', 'vendor_select_orders', 'vendor_has_order_access(id)'),
      ('order_items', 'customer_select_items', 'customer_owns_order(order_id)'),
      ('order_items', 'vendor_select_items', 'vendor_owns_vendor(vendor_id)')
  )
  select pg_catalog.count(*)
  into matched_policy_count
  from expected_policy
  join pg_catalog.pg_policies as policy
    on policy.schemaname = 'public'
   and policy.tablename = expected_policy.table_name
   and policy.policyname = expected_policy.policy_name
   and policy.permissive = 'PERMISSIVE'
   and policy.roles = array['authenticated']::name[]
   and policy.cmd = 'SELECT'
   and policy.qual = expected_policy.policy_qual
   and policy.with_check is null;

  select pg_catalog.count(*)
  into actual_policy_count
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename in ('orders', 'order_items');

  if matched_policy_count <> 4 or actual_policy_count <> 4 then
    raise exception 'D4-3 preflight: order RLS policy contract changed.';
  end if;

  if pg_catalog.to_regproc('public.construct_trusted_checkout_order') is null
    or pg_catalog.to_regproc('public.validate_order_item_variant_options_snapshot') is null
    or pg_catalog.to_regproc('public.finalize_paystack_paid_order') is null
    or pg_catalog.to_regproc('public.guard_foundation_order_item_variant') is null
    or pg_catalog.to_regproc('public.protect_order_item_variant_identity') is null
    or pg_catalog.to_regproc('public.customer_owns_order') is null
    or pg_catalog.to_regproc('public.vendor_has_order_access') is null
    or pg_catalog.to_regproc('public.vendor_owns_vendor') is null
  then
    raise exception 'D4-3 preflight: protected order functions are missing.';
  end if;

  if not pg_catalog.has_function_privilege(
      'service_role',
      pg_catalog.to_regproc('public.construct_trusted_checkout_order'),
      'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      pg_catalog.to_regproc('public.finalize_paystack_paid_order'),
      'EXECUTE'
    )
  then
    raise exception 'D4-3 preflight: trusted service function grants changed.';
  end if;

  perform pg_catalog.set_config(
    'marketa.d4_3.policy_hash',
    (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.concat_ws(
          '|', policy.tablename, policy.policyname, policy.permissive,
          policy.roles::text, policy.cmd, policy.qual,
          coalesce(policy.with_check, '')
        ),
        E'\n' order by policy.tablename, policy.policyname
      ), ''))
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename in ('orders', 'order_items')
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa.d4_3.function_hash',
    (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.concat_ws(
          '|', function_record.oid::pg_catalog.regprocedure::text,
          pg_catalog.pg_get_functiondef(function_record.oid)
        ),
        E'\n' order by function_record.oid::pg_catalog.regprocedure::text
      ), ''))
      from pg_catalog.pg_proc as function_record
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = function_record.pronamespace
      where namespace.nspname = 'public'
        and (
          function_record.prosrc ~* '\morders\M'
          or function_record.prosrc ~* '\morder_items\M'
        )
    ),
    true
  );
end;
$d4_3_preflight$;

revoke select
on table public.orders, public.order_items
from authenticated;

revoke all privileges
on table public.orders, public.order_items
from anon, public;

do $d4_3_postcondition$
declare
  target_table text;
  target_column text;
  target_privilege text;
  relation_record record;
  policy_hash text;
  function_hash text;
begin
  if exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname in ('authenticated', 'anon')
      and (role.rolsuper or role.rolbypassrls)
  ) or not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'service_role'
      and not role.rolsuper
      and role.rolbypassrls
  ) then
    raise exception 'D4-3 postcondition: API role security attributes changed.';
  end if;

  foreach target_table in array array['orders', 'order_items'] loop
    select class.oid, class.relowner, class.relacl
    into relation_record
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = target_table;

    if pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('public.%I', target_table), 'SELECT'
    ) or pg_catalog.has_table_privilege(
      'anon', pg_catalog.format('public.%I', target_table), 'SELECT'
    ) then
      raise exception 'D4-3 postcondition: API role still has SELECT on public.%.', target_table;
    end if;

    if exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          relation_record.relacl,
          pg_catalog.acldefault('r', relation_record.relowner)
        )
      ) as acl
      where acl.grantee = 0
        and acl.privilege_type = 'SELECT'
    ) then
      raise exception 'D4-3 postcondition: PUBLIC still has SELECT on public.%.', target_table;
    end if;

    for target_column in
      select attribute.attname
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = relation_record.oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    loop
      if pg_catalog.has_column_privilege(
        'authenticated',
        pg_catalog.format('public.%I', target_table),
        target_column,
        'SELECT'
      ) or pg_catalog.has_column_privilege(
        'anon',
        pg_catalog.format('public.%I', target_table),
        target_column,
        'SELECT'
      ) then
        raise exception 'D4-3 postcondition: API role still selects public.%.%.',
          target_table, target_column;
      end if;
    end loop;

    foreach target_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER'
    ] loop
      if not pg_catalog.has_table_privilege(
        'service_role',
        pg_catalog.format('public.%I', target_table),
        target_privilege
      ) then
        raise exception
          'D4-3 postcondition: service-role % privilege changed on public.%.',
          target_privilege, target_table;
      end if;
    end loop;

    if not (
      select class.relrowsecurity and not class.relforcerowsecurity
      from pg_catalog.pg_class as class
      where class.oid = relation_record.oid
    ) then
      raise exception 'D4-3 postcondition: RLS state changed on public.%.', target_table;
    end if;
  end loop;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    pg_catalog.concat_ws(
      '|', policy.tablename, policy.policyname, policy.permissive,
      policy.roles::text, policy.cmd, policy.qual,
      coalesce(policy.with_check, '')
    ),
    E'\n' order by policy.tablename, policy.policyname
  ), ''))
  into policy_hash
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename in ('orders', 'order_items');

  if policy_hash is distinct from pg_catalog.current_setting(
    'marketa.d4_3.policy_hash'
  ) then
    raise exception 'D4-3 postcondition: order RLS policies changed.';
  end if;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    pg_catalog.concat_ws(
      '|', function_record.oid::pg_catalog.regprocedure::text,
      pg_catalog.pg_get_functiondef(function_record.oid)
    ),
    E'\n' order by function_record.oid::pg_catalog.regprocedure::text
  ), ''))
  into function_hash
  from pg_catalog.pg_proc as function_record
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function_record.pronamespace
  where namespace.nspname = 'public'
    and (
      function_record.prosrc ~* '\morders\M'
      or function_record.prosrc ~* '\morder_items\M'
    );

  if function_hash is distinct from pg_catalog.current_setting(
    'marketa.d4_3.function_hash'
  ) then
    raise exception 'D4-3 postcondition: protected order functions changed.';
  end if;
end;
$d4_3_postcondition$;

commit;
