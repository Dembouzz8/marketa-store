begin;

do $precondition$
declare
  orders_relation oid := pg_catalog.to_regclass('public.orders');
  customer_name_attribute smallint;
  customer_name_type oid;
  customer_name_type_modifier integer;
  customer_name_not_null boolean;
  customer_name_constraint_count integer;
  customer_name_constraint_name text;
  customer_name_constraint_definition text;
  normalized_constraint_definition text;
  customer_id_attribute smallint;
  customer_id_type oid;
  customer_id_type_modifier integer;
  customer_id_not_null boolean;
  unrelated_constraints_fingerprint text;
  orders_rls_enabled boolean;
begin
  if orders_relation is null then
    raise exception 'Required table public.orders is missing; migration stopped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = orders_relation
      and relation.relkind in ('r', 'p')
  ) then
    raise exception
      'Required relation public.orders is not a table; migration stopped.';
  end if;

  select
    attribute.attnum,
    attribute.atttypid,
    attribute.atttypmod,
    attribute.attnotnull
  into
    customer_name_attribute,
    customer_name_type,
    customer_name_type_modifier,
    customer_name_not_null
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = orders_relation
    and attribute.attname = 'customer_name'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if customer_name_attribute is null then
    raise exception
      'Required column public.orders.customer_name is missing; migration stopped.';
  end if;

  if customer_name_type is distinct from pg_catalog.to_regtype('text') then
    raise exception
      'public.orders.customer_name must have type text; migration stopped.';
  end if;

  if customer_name_not_null is distinct from false then
    raise exception
      'public.orders.customer_name must remain nullable; migration stopped.';
  end if;

  select pg_catalog.count(*)
  into customer_name_constraint_count
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.contype = 'c'
    and customer_name_attribute = any (constraint_record.conkey);

  if customer_name_constraint_count <> 1 then
    raise exception
      'Expected exactly one customer_name check constraint, found %; migration stopped.',
      customer_name_constraint_count;
  end if;

  select
    constraint_record.conname,
    pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
  into
    customer_name_constraint_name,
    customer_name_constraint_definition
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.contype = 'c'
    and customer_name_attribute = any (constraint_record.conkey);

  normalized_constraint_definition := pg_catalog.lower(
    pg_catalog.regexp_replace(
      customer_name_constraint_definition,
      '[[:space:]()]',
      '',
      'g'
    )
  );

  if normalized_constraint_definition not in (
    'checkcustomer_nameisnullorchar_lengthbtrimcustomer_namebetween2and100',
    'checkcustomer_nameisnullorchar_lengthbtrimcustomer_name>=2andchar_lengthbtrimcustomer_name<=100'
  ) then
    raise exception
      'Unexpected public.orders.customer_name constraint %: %; migration stopped.',
      customer_name_constraint_name,
      customer_name_constraint_definition;
  end if;

  select
    attribute.attnum,
    attribute.atttypid,
    attribute.atttypmod,
    attribute.attnotnull
  into
    customer_id_attribute,
    customer_id_type,
    customer_id_type_modifier,
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

  select relation.relrowsecurity
  into orders_rls_enabled
  from pg_catalog.pg_class as relation
  where relation.oid = orders_relation;

  if orders_rls_enabled is distinct from true then
    raise exception 'RLS must already be enabled on public.orders.';
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
      'Required Batch 4B ownership policies are missing or mis-scoped.';
  end if;

  select pg_catalog.md5(
    coalesce(
      pg_catalog.string_agg(
        constraint_record.conname
          || ':'
          || pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
        E'\n'
        order by constraint_record.conname
      ),
      ''
    )
  )
  into unrelated_constraints_fingerprint
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.conname <> customer_name_constraint_name;

  perform pg_catalog.set_config(
    'marketa_migration.customer_name_constraint_name',
    customer_name_constraint_name,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.customer_name_type',
    customer_name_type::text,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.customer_name_type_modifier',
    customer_name_type_modifier::text,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.customer_name_not_null',
    customer_name_not_null::text,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.customer_id_type',
    customer_id_type::text,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.customer_id_type_modifier',
    customer_id_type_modifier::text,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.customer_id_not_null',
    customer_id_not_null::text,
    true
  );
  perform pg_catalog.set_config(
    'marketa_migration.unrelated_constraints_fingerprint',
    unrelated_constraints_fingerprint,
    true
  );
end
$precondition$;

do $constraint_change$
declare
  customer_name_constraint_name text := pg_catalog.current_setting(
    'marketa_migration.customer_name_constraint_name'
  );
begin
  execute pg_catalog.format(
    'alter table public.orders drop constraint %I',
    customer_name_constraint_name
  );

  execute pg_catalog.format(
    'alter table public.orders add constraint %I check (
      customer_name is null
      or pg_catalog.char_length(pg_catalog.btrim(customer_name)) between 1 and 120
    )',
    customer_name_constraint_name
  );
end
$constraint_change$;

do $postcondition$
declare
  orders_relation oid := pg_catalog.to_regclass('public.orders');
  expected_constraint_name text := pg_catalog.current_setting(
    'marketa_migration.customer_name_constraint_name'
  );
  customer_name_attribute smallint;
  customer_name_type oid;
  customer_name_type_modifier integer;
  customer_name_not_null boolean;
  customer_name_constraint_count integer;
  customer_name_constraint_definition text;
  normalized_constraint_definition text;
  customer_id_type oid;
  customer_id_type_modifier integer;
  customer_id_not_null boolean;
  unrelated_constraints_fingerprint text;
begin
  if orders_relation is null then
    raise exception 'Postcondition failed: public.orders is missing.';
  end if;

  select
    attribute.attnum,
    attribute.atttypid,
    attribute.atttypmod,
    attribute.attnotnull
  into
    customer_name_attribute,
    customer_name_type,
    customer_name_type_modifier,
    customer_name_not_null
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = orders_relation
    and attribute.attname = 'customer_name'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if customer_name_attribute is null then
    raise exception
      'Postcondition failed: public.orders.customer_name is missing.';
  end if;

  if customer_name_type::text is distinct from pg_catalog.current_setting(
    'marketa_migration.customer_name_type'
  ) or customer_name_type_modifier::text is distinct from pg_catalog.current_setting(
    'marketa_migration.customer_name_type_modifier'
  ) or customer_name_not_null::text is distinct from pg_catalog.current_setting(
    'marketa_migration.customer_name_not_null'
  ) or customer_name_not_null is distinct from false then
    raise exception
      'Postcondition failed: customer_name type or nullability changed.';
  end if;

  select pg_catalog.count(*)
  into customer_name_constraint_count
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.contype = 'c'
    and customer_name_attribute = any (constraint_record.conkey);

  if customer_name_constraint_count <> 1 then
    raise exception
      'Postcondition failed: expected exactly one customer_name check constraint, found %.',
      customer_name_constraint_count;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
  into customer_name_constraint_definition
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.contype = 'c'
    and constraint_record.conname = expected_constraint_name
    and customer_name_attribute = any (constraint_record.conkey);

  if customer_name_constraint_definition is null then
    raise exception
      'Postcondition failed: customer_name constraint name was not preserved.';
  end if;

  normalized_constraint_definition := pg_catalog.lower(
    pg_catalog.regexp_replace(
      customer_name_constraint_definition,
      '[[:space:]()]',
      '',
      'g'
    )
  );

  if normalized_constraint_definition not in (
    'checkcustomer_nameisnullorchar_lengthbtrimcustomer_namebetween1and120',
    'checkcustomer_nameisnullorchar_lengthbtrimcustomer_name>=1andchar_lengthbtrimcustomer_name<=120'
  ) then
    raise exception
      'Postcondition failed: unexpected customer_name constraint definition: %.',
      customer_name_constraint_definition;
  end if;

  select
    attribute.atttypid,
    attribute.atttypmod,
    attribute.attnotnull
  into
    customer_id_type,
    customer_id_type_modifier,
    customer_id_not_null
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = orders_relation
    and attribute.attname = 'customer_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if customer_id_type::text is distinct from pg_catalog.current_setting(
    'marketa_migration.customer_id_type'
  ) or customer_id_type_modifier::text is distinct from pg_catalog.current_setting(
    'marketa_migration.customer_id_type_modifier'
  ) or customer_id_not_null::text is distinct from pg_catalog.current_setting(
    'marketa_migration.customer_id_not_null'
  ) then
    raise exception
      'Postcondition failed: public.orders.customer_id changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = orders_relation
      and relation.relrowsecurity
  ) then
    raise exception 'Postcondition failed: RLS is disabled on public.orders.';
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
      'Postcondition failed: Batch 4B ownership policies changed.';
  end if;

  select pg_catalog.md5(
    coalesce(
      pg_catalog.string_agg(
        constraint_record.conname
          || ':'
          || pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
        E'\n'
        order by constraint_record.conname
      ),
      ''
    )
  )
  into unrelated_constraints_fingerprint
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = orders_relation
    and constraint_record.conname <> expected_constraint_name;

  if unrelated_constraints_fingerprint is distinct from pg_catalog.current_setting(
    'marketa_migration.unrelated_constraints_fingerprint'
  ) then
    raise exception
      'Postcondition failed: an unrelated public.orders constraint changed.';
  end if;
end
$postcondition$;

commit;
