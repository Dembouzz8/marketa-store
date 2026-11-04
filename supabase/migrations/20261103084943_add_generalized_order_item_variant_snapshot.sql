-- Product Variants Batch 2C-C2: immutable generalized order-item snapshot foundation.
-- Variant purchasing and variant-aware paid-order finalization remain unavailable.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  function_record record;
begin
  if pg_catalog.to_regclass('public.order_items') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.vendors') is null
  then
    raise exception 'Product variants C2 preflight: required tables are missing.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
      and attribute.attname = 'variant_options_snapshot'
      and not attribute.attisdropped
  ) or pg_catalog.to_regprocedure(
    'public.validate_order_item_variant_options_snapshot(jsonb)'
  ) is not null then
    raise exception 'Product variants C2 preflight: snapshot foundation objects already exist.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid in (
      'public.order_items'::pg_catalog.regclass,
      'public.product_variants'::pg_catalog.regclass
    )
      and constraint_record.conname in (
        'product_variants_id_product_id_vendor_id_key',
        'order_items_product_variant_product_vendor_fkey'
      )
  ) then
    raise exception 'Product variants C2 preflight: relational identity object collision.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_id_product_id_key'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'UNIQUE (id, product_id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_variant_identity_check'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
  ) then
    raise exception 'Product variants C2 preflight: existing variant identity contract changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
      and trigger_record.tgname = 'order_items_foundation_variant_guard'
      and trigger_record.tgfoid =
        'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 7
      and trigger_record.tgnargs = 0
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
      and trigger_record.tgname = 'order_items_variant_identity_immutable'
      and trigger_record.tgfoid =
        'public.protect_order_item_variant_identity()'::pg_catalog.regprocedure
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 19
      and trigger_record.tgnargs = 0
      and (
        select pg_catalog.array_agg(
          attribute.attname::text order by trigger_column.ordinality
        )
        from pg_catalog.unnest(
          trigger_record.tgattr::smallint[]
        ) with ordinality as trigger_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = trigger_record.tgrelid
          and attribute.attnum = trigger_column.attnum
      ) = array[
        'product_variant_id',
        'variant_size_snapshot',
        'variant_colour_snapshot'
      ]::text[]
  ) then
    raise exception 'Product variants C2 preflight: order-item trigger contract changed.';
  end if;

  for function_record in
    select expected.signature, expected.definition_hash,
           procedure.oid, procedure.prosecdef, procedure.provolatile,
           procedure.proconfig,
           pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from (
      values
        ('public.guard_foundation_order_item_variant()'::text,
          'b7ef9997e19e38d33274104723faccee'::text),
        ('public.protect_order_item_variant_identity()'::text,
          'd296f4f90403c71faf597fcdd145914b'::text),
        ('public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::text,
          '37c763494aed0f4e13daa004b88b6dee'::text),
        ('public.decrement_stock(uuid,integer)'::text,
          '0094f1ea6602edbfe18ac8f9619677b8'::text)
    ) as expected(signature, definition_hash)
    join pg_catalog.pg_proc as procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  loop
    if function_record.owner <> 'postgres'
      or function_record.prosecdef
      or function_record.provolatile <> 'v'
      or function_record.proconfig is distinct from
        array['search_path=""']::text[]
      or pg_catalog.md5(pg_catalog.pg_get_functiondef(function_record.oid))
        <> function_record.definition_hash
    then
      raise exception 'Product variants C2 preflight: function % changed.',
        function_record.signature;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from (
      values
        ('public.guard_foundation_order_item_variant()'::text),
        ('public.protect_order_item_variant_identity()'::text),
        ('public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::text),
        ('public.decrement_stock(uuid,integer)'::text)
    ) as expected(signature)
    where pg_catalog.to_regprocedure(expected.signature) is not null
  ) <> 4 then
    raise exception 'Product variants C2 preflight: required function inventory is incomplete.';
  end if;

  perform pg_catalog.set_config(
    'marketa.variant_c2.order_items_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(item)::text),
        '' order by item.id
      ))
      from public.order_items as item
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_c2.variants_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
        '' order by variant.id
      ))
      from public.product_variants as variant
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_c2.policy_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.tablename, policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename in ('order_items', 'product_variants')
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_c2.table_acl_hash',
    (
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          relation.oid::text,
          relation.relrowsecurity,
          relation.relforcerowsecurity,
          relation.relacl::text,
          coalesce((
            select pg_catalog.string_agg(
              attribute.attname || ':' || coalesce(attribute.attacl::text, ''),
              '|' order by attribute.attnum
            )
            from pg_catalog.pg_attribute as attribute
            where attribute.attrelid = relation.oid
              and attribute.attnum > 0
              and not attribute.attisdropped
          ), '')
        ) order by relation.oid
      )::text)
      from pg_catalog.pg_class as relation
      where relation.oid in (
        'public.order_items'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass
      )
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_c2.other_trigger_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.jsonb_build_array(
          trigger_record.tgrelid::text,
          trigger_record.tgname,
          trigger_record.tgenabled,
          trigger_record.tgtype,
          trigger_record.tgattr::text,
          trigger_record.tgfoid::text,
          pg_catalog.pg_get_triggerdef(trigger_record.oid, true),
          pg_catalog.pg_get_expr(
            trigger_record.tgqual,
            trigger_record.tgrelid
          )
        )::text),
        '' order by trigger_record.tgrelid, trigger_record.tgname
      ))
      from pg_catalog.pg_trigger as trigger_record
      where not trigger_record.tgisinternal
        and trigger_record.tgrelid in (
          'public.order_items'::pg_catalog.regclass,
          'public.product_variants'::pg_catalog.regclass
        )
        and not (
          trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
          and trigger_record.tgname = 'order_items_variant_identity_immutable'
        )
    ), pg_catalog.md5('')),
    true
  );
end
$preflight$;

alter table public.order_items
  add column variant_options_snapshot jsonb;

comment on column public.order_items.variant_options_snapshot is
  'Immutable versioned presentation snapshot for a generalized product-variant combination.';

create function public.validate_order_item_variant_options_snapshot(
  p_snapshot jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  required_top_keys constant text[] := array[
    'schema_version',
    'variant_id',
    'product_id',
    'vendor_id',
    'combination_signature',
    'options'
  ]::text[];
  required_option_keys constant text[] := array[
    'axis_id',
    'axis_position',
    'axis_display_name',
    'option_code',
    'value_kind',
    'value_id',
    'value_display_label',
    'numeric_value',
    'unit_code',
    'unit_name',
    'unit_symbol',
    'size_system_code',
    'size_system_name'
  ]::text[];
  option_record record;
  option_count integer;
  current_position integer;
  previous_position integer := 0;
  axis_id text;
  value_id text;
  value_kind text;
  numeric_value text;
  unit_code text;
  unit_name text;
  unit_symbol text;
  size_system_code text;
  size_system_name text;
  axis_ids text[] := array[]::text[];
  axis_positions integer[] := array[]::integer[];
  value_ids text[] := array[]::text[];
  expected_signature text;
begin
  if p_snapshot is null
    or pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or pg_catalog.octet_length(p_snapshot::text) > 16384
  then
    return false;
  end if;

  if not (p_snapshot ?& required_top_keys)
    or (p_snapshot - required_top_keys) is distinct from '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_snapshot -> 'schema_version')
      is distinct from 'number'
    or (p_snapshot ->> 'schema_version') is distinct from '1'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'variant_id')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'product_id')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'vendor_id')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'combination_signature')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'options')
      is distinct from 'array'
  then
    return false;
  end if;

  if (p_snapshot ->> 'variant_id') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_snapshot ->> 'product_id') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_snapshot ->> 'vendor_id') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.octet_length(p_snapshot ->> 'combination_signature')
      not between 73 and 221
  then
    return false;
  end if;

  option_count := pg_catalog.jsonb_array_length(p_snapshot -> 'options');
  if option_count not between 1 and 3 then
    return false;
  end if;

  for option_record in
    select option_entry.value as option_value, option_entry.ordinality
    from pg_catalog.jsonb_array_elements(
      p_snapshot -> 'options'
    ) with ordinality as option_entry(value, ordinality)
    order by option_entry.ordinality
  loop
    if pg_catalog.jsonb_typeof(option_record.option_value)
        is distinct from 'object'
      or not (option_record.option_value ?& required_option_keys)
      or (option_record.option_value - required_option_keys)
        is distinct from '{}'::jsonb
      or pg_catalog.jsonb_typeof(option_record.option_value -> 'axis_id')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(
        option_record.option_value -> 'axis_position'
      ) is distinct from 'number'
      or pg_catalog.jsonb_typeof(
        option_record.option_value -> 'axis_display_name'
      ) is distinct from 'string'
      or pg_catalog.jsonb_typeof(option_record.option_value -> 'option_code')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(option_record.option_value -> 'value_kind')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(option_record.option_value -> 'value_id')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(
        option_record.option_value -> 'value_display_label'
      ) is distinct from 'string'
    then
      return false;
    end if;

    axis_id := option_record.option_value ->> 'axis_id';
    value_id := option_record.option_value ->> 'value_id';
    value_kind := option_record.option_value ->> 'value_kind';

    if axis_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or value_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (option_record.option_value ->> 'axis_position') !~ '^[1-3]$'
      or pg_catalog.char_length(
        pg_catalog.btrim(option_record.option_value ->> 'axis_display_name')
      ) not between 1 and 80
      or pg_catalog.octet_length(option_record.option_value ->> 'option_code')
        not between 1 and 80
      or (option_record.option_value ->> 'option_code') !~
        '^[a-z0-9]+(?:_[a-z0-9]+)*$'
      or value_kind not in ('label', 'measurement', 'colour')
      or pg_catalog.char_length(
        pg_catalog.btrim(option_record.option_value ->> 'value_display_label')
      ) not between 1 and 80
    then
      return false;
    end if;

    current_position := (option_record.option_value ->> 'axis_position')::integer;
    if current_position <= previous_position
      or pg_catalog.array_position(axis_ids, axis_id) is not null
      or pg_catalog.array_position(axis_positions, current_position) is not null
      or pg_catalog.array_position(value_ids, value_id) is not null
    then
      return false;
    end if;

    axis_ids := pg_catalog.array_append(axis_ids, axis_id);
    axis_positions := pg_catalog.array_append(axis_positions, current_position);
    value_ids := pg_catalog.array_append(value_ids, value_id);
    previous_position := current_position;

    if option_record.option_value -> 'numeric_value' = 'null'::jsonb then
      numeric_value := null;
    elsif pg_catalog.jsonb_typeof(
      option_record.option_value -> 'numeric_value'
    ) = 'string' then
      numeric_value := option_record.option_value ->> 'numeric_value';
      if pg_catalog.octet_length(numeric_value) not between 1 and 19
        or numeric_value !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$'
        or numeric_value::pg_catalog.numeric <= 0
      then
        return false;
      end if;
    else
      return false;
    end if;

    if option_record.option_value -> 'unit_code' = 'null'::jsonb then
      unit_code := null;
    elsif pg_catalog.jsonb_typeof(option_record.option_value -> 'unit_code')
      = 'string' then
      unit_code := option_record.option_value ->> 'unit_code';
      if pg_catalog.octet_length(unit_code) not between 1 and 80
        or unit_code !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
      then
        return false;
      end if;
    else
      return false;
    end if;

    if option_record.option_value -> 'unit_name' = 'null'::jsonb then
      unit_name := null;
    elsif pg_catalog.jsonb_typeof(option_record.option_value -> 'unit_name')
      = 'string' then
      unit_name := option_record.option_value ->> 'unit_name';
      if pg_catalog.char_length(pg_catalog.btrim(unit_name)) not between 1 and 80
      then
        return false;
      end if;
    else
      return false;
    end if;

    if option_record.option_value -> 'unit_symbol' = 'null'::jsonb then
      unit_symbol := null;
    elsif pg_catalog.jsonb_typeof(option_record.option_value -> 'unit_symbol')
      = 'string' then
      unit_symbol := option_record.option_value ->> 'unit_symbol';
      if pg_catalog.char_length(pg_catalog.btrim(unit_symbol)) not between 1 and 20
      then
        return false;
      end if;
    else
      return false;
    end if;

    if option_record.option_value -> 'size_system_code' = 'null'::jsonb then
      size_system_code := null;
    elsif pg_catalog.jsonb_typeof(
      option_record.option_value -> 'size_system_code'
    ) = 'string' then
      size_system_code := option_record.option_value ->> 'size_system_code';
      if pg_catalog.octet_length(size_system_code) not between 1 and 80
        or size_system_code !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
      then
        return false;
      end if;
    else
      return false;
    end if;

    if option_record.option_value -> 'size_system_name' = 'null'::jsonb then
      size_system_name := null;
    elsif pg_catalog.jsonb_typeof(
      option_record.option_value -> 'size_system_name'
    ) = 'string' then
      size_system_name := option_record.option_value ->> 'size_system_name';
      if pg_catalog.char_length(pg_catalog.btrim(size_system_name))
        not between 1 and 80
      then
        return false;
      end if;
    else
      return false;
    end if;

    if (unit_code is null) <> (unit_name is null)
      or (unit_code is null) <> (unit_symbol is null)
      or (size_system_code is null) <> (size_system_name is null)
      or (value_kind = 'measurement' and (
        numeric_value is null
        or unit_code is null
        or size_system_code is not null
      ))
      or (value_kind = 'label' and (
        numeric_value is not null
        or unit_code is not null
      ))
      or (value_kind = 'colour' and (
        numeric_value is not null
        or unit_code is not null
        or size_system_code is not null
      ))
    then
      return false;
    end if;
  end loop;

  select pg_catalog.string_agg(
    (option_entry.value ->> 'axis_id')
      || '=' || (option_entry.value ->> 'value_id'),
    '|' order by option_entry.value ->> 'axis_id'
  )
  into expected_signature
  from pg_catalog.jsonb_array_elements(
    p_snapshot -> 'options'
  ) as option_entry(value);

  return (p_snapshot ->> 'combination_signature')
    is not distinct from expected_signature;
exception
  when others then
    return false;
end
$function$;

alter function public.validate_order_item_variant_options_snapshot(jsonb)
  owner to postgres;
revoke all privileges on function
  public.validate_order_item_variant_options_snapshot(jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.validate_order_item_variant_options_snapshot(jsonb)
to service_role;

alter table public.product_variants
  add constraint product_variants_id_product_id_vendor_id_key
    unique (id, product_id, vendor_id);

alter table public.order_items
  add constraint order_items_product_variant_product_vendor_fkey
    foreign key (product_variant_id, product_id, vendor_id)
    references public.product_variants (id, product_id, vendor_id)
    on update restrict
    on delete restrict
    not valid;

alter table public.order_items
  validate constraint order_items_product_variant_product_vendor_fkey;

alter table public.order_items
  drop constraint order_items_variant_identity_check;

alter table public.order_items
  add constraint order_items_variant_identity_check
    check (
      (
        product_variant_id is null
        and variant_size_snapshot is null
        and variant_colour_snapshot is null
        and variant_options_snapshot is null
      )
      or (
        product_variant_id is not null
        and product_id is not null
        and (
          variant_size_snapshot is not null
          or variant_colour_snapshot is not null
        )
        and variant_options_snapshot is null
      )
      or (
        product_variant_id is not null
        and product_id is not null
        and vendor_id is not null
        and variant_size_snapshot is null
        and variant_colour_snapshot is null
        and variant_options_snapshot is not null
        and public.validate_order_item_variant_options_snapshot(
          variant_options_snapshot
        ) is true
        and variant_options_snapshot ->> 'variant_id'
          = product_variant_id::text
        and variant_options_snapshot ->> 'product_id' = product_id::text
        and variant_options_snapshot ->> 'vendor_id' = vendor_id::text
      )
    )
    not valid;

alter table public.order_items
  validate constraint order_items_variant_identity_check;

create or replace function public.protect_order_item_variant_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.product_variant_id is distinct from old.product_variant_id
    or new.variant_size_snapshot is distinct from old.variant_size_snapshot
    or new.variant_colour_snapshot is distinct from old.variant_colour_snapshot
    or new.variant_options_snapshot is distinct from old.variant_options_snapshot
    or (
      (
        old.product_variant_id is not null
        or new.product_variant_id is not null
      )
      and (
        new.product_id is distinct from old.product_id
        or new.vendor_id is distinct from old.vendor_id
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Order-item variant identity and snapshots are immutable.';
  end if;

  return new;
end
$function$;

alter function public.protect_order_item_variant_identity() owner to postgres;
revoke all privileges on function public.protect_order_item_variant_identity()
  from public, anon, authenticated, service_role;

drop trigger order_items_variant_identity_immutable on public.order_items;

create trigger order_items_variant_identity_immutable
before update of
  product_id,
  vendor_id,
  product_variant_id,
  variant_size_snapshot,
  variant_colour_snapshot,
  variant_options_snapshot
on public.order_items
for each row
execute function public.protect_order_item_variant_identity();

do $postcondition$
declare
  function_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    left join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
      and attribute.attname = 'variant_options_snapshot'
      and attribute.atttypid = 'jsonb'::pg_catalog.regtype
      and not attribute.attnotnull
      and not attribute.attisdropped
      and default_value.oid is null
  ) then
    raise exception 'Product variants C2 postcondition: snapshot column is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
        'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and not procedure.prosecdef
      and procedure.provolatile = 'i'
      and procedure.proconfig is not distinct from
        array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege(
        'public', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
  ) then
    raise exception 'Product variants C2 postcondition: validator authority is incorrect.';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure
  ))
  into function_definition;

  if function_definition not like '%pg_catalog.octet_length(p_snapshot::text) > 16384%'
    or function_definition not like '%option_count not between 1 and 3%'
    or function_definition not like '%p_snapshot - required_top_keys%'
    or function_definition not like '%option_record.option_value - required_option_keys%'
    or function_definition not like '%pg_catalog.string_agg%'
    or function_definition not like '%when others then%return false%'
    or function_definition like '%execute %'
  then
    raise exception 'Product variants C2 postcondition: snapshot validator is incomplete.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname =
        'product_variants_id_product_id_vendor_id_key'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'UNIQUE (id, product_id, vendor_id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname =
        'order_items_product_variant_product_vendor_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
      and constraint_record.confupdtype = 'r'
      and constraint_record.confdeltype = 'r'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'FOREIGN KEY (product_variant_id, product_id, vendor_id) REFERENCES product_variants(id, product_id, vendor_id) ON UPDATE RESTRICT ON DELETE RESTRICT'
  ) then
    raise exception 'Product variants C2 postcondition: composite identity is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_variant_identity_check'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        like '%validate_order_item_variant_options_snapshot(variant_options_snapshot) IS TRUE%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        like '%variant_options_snapshot ->> ''variant_id''::text%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        like '%variant_options_snapshot ->> ''product_id''::text%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        like '%variant_options_snapshot ->> ''vendor_id''::text%'
  ) then
    raise exception 'Product variants C2 postcondition: identity CHECK is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
        'public.protect_order_item_variant_identity()'::pg_catalog.regprocedure
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and not procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig is not distinct from
        array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege(
        'public', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
      and trigger_record.tgname = 'order_items_variant_identity_immutable'
      and trigger_record.tgfoid =
        'public.protect_order_item_variant_identity()'::pg_catalog.regprocedure
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 19
      and trigger_record.tgnargs = 0
      and (
        select pg_catalog.array_agg(
          attribute.attname::text order by trigger_column.ordinality
        )
        from pg_catalog.unnest(
          trigger_record.tgattr::smallint[]
        ) with ordinality as trigger_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = trigger_record.tgrelid
          and attribute.attnum = trigger_column.attnum
      ) = array[
        'product_id',
        'vendor_id',
        'product_variant_id',
        'variant_size_snapshot',
        'variant_colour_snapshot',
        'variant_options_snapshot'
      ]::text[]
  ) then
    raise exception 'Product variants C2 postcondition: immutable identity trigger is incorrect.';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.protect_order_item_variant_identity()'::pg_catalog.regprocedure
  ))
  into function_definition;

  if function_definition not like
      '%new.variant_options_snapshot is distinct from old.variant_options_snapshot%'
    or function_definition not like
      '%old.product_variant_id is not null%new.product_variant_id is not null%'
    or function_definition not like
      '%new.product_id is distinct from old.product_id%'
    or function_definition not like
      '%new.vendor_id is distinct from old.vendor_id%'
  then
    raise exception 'Product variants C2 postcondition: immutable identity logic is incomplete.';
  end if;

  if pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
    )) <> 'b7ef9997e19e38d33274104723faccee'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure
    )) <> '37c763494aed0f4e13daa004b88b6dee'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.decrement_stock(uuid,integer)'::pg_catalog.regprocedure
    )) <> '0094f1ea6602edbfe18ac8f9619677b8'
  then
    raise exception 'Product variants C2 postcondition: purchase or financial authority changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
      and trigger_record.tgname = 'order_items_foundation_variant_guard'
      and trigger_record.tgfoid =
        'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 7
      and trigger_record.tgnargs = 0
  ) then
    raise exception 'Product variants C2 postcondition: purchase guard changed.';
  end if;

  if pg_catalog.current_setting('marketa.variant_c2.order_items_hash')
    is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5((
          pg_catalog.to_jsonb(item) - 'variant_options_snapshot'
        )::text),
        '' order by item.id
      ))
      from public.order_items as item
    ), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.variant_c2.variants_hash')
    is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
        '' order by variant.id
      ))
      from public.product_variants as variant
    ), pg_catalog.md5(''))
  then
    raise exception 'Product variants C2 postcondition: business rows changed.';
  end if;

  if pg_catalog.current_setting('marketa.variant_c2.policy_hash')
    is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.tablename, policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename in ('order_items', 'product_variants')
    ), pg_catalog.md5(''))
  then
    raise exception 'Product variants C2 postcondition: existing RLS policies changed.';
  end if;

  if pg_catalog.current_setting('marketa.variant_c2.table_acl_hash')
    is distinct from (
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          relation.oid::text,
          relation.relrowsecurity,
          relation.relforcerowsecurity,
          relation.relacl::text,
          coalesce((
            select pg_catalog.string_agg(
              attribute.attname || ':' || coalesce(attribute.attacl::text, ''),
              '|' order by attribute.attnum
            )
            from pg_catalog.pg_attribute as attribute
            where attribute.attrelid = relation.oid
              and attribute.attnum > 0
              and not attribute.attisdropped
              and attribute.attname <> 'variant_options_snapshot'
          ), '')
        ) order by relation.oid
      )::text)
      from pg_catalog.pg_class as relation
      where relation.oid in (
        'public.order_items'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass
      )
    )
  then
    raise exception 'Product variants C2 postcondition: table authority changed.';
  end if;

  if pg_catalog.current_setting('marketa.variant_c2.other_trigger_hash')
    is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.jsonb_build_array(
          trigger_record.tgrelid::text,
          trigger_record.tgname,
          trigger_record.tgenabled,
          trigger_record.tgtype,
          trigger_record.tgattr::text,
          trigger_record.tgfoid::text,
          pg_catalog.pg_get_triggerdef(trigger_record.oid, true),
          pg_catalog.pg_get_expr(
            trigger_record.tgqual,
            trigger_record.tgrelid
          )
        )::text),
        '' order by trigger_record.tgrelid, trigger_record.tgname
      ))
      from pg_catalog.pg_trigger as trigger_record
      where not trigger_record.tgisinternal
        and trigger_record.tgrelid in (
          'public.order_items'::pg_catalog.regclass,
          'public.product_variants'::pg_catalog.regclass
        )
        and not (
          trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
          and trigger_record.tgname = 'order_items_variant_identity_immutable'
        )
    ), pg_catalog.md5(''))
  then
    raise exception 'Product variants C2 postcondition: unrelated triggers changed.';
  end if;
end
$postcondition$;

commit;
