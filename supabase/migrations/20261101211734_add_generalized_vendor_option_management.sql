-- Product Variants Batch 2C-B2: generalized vendor draft-option management.
-- Publication, purchasing, checkout, pricing, and paid-order inventory remain unchanged.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  expected_function record;
  relation_name text;
  rpc_signature text;
begin
  if pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.order_items') is null
    or pg_catalog.to_regclass('public.vendors') is null
    or pg_catalog.to_regclass('public.catalogue_categories') is null
    or pg_catalog.to_regclass('public.category_option_templates') is null
    or pg_catalog.to_regclass('public.product_option_policy') is null
    or pg_catalog.to_regclass('public.product_option_axes') is null
    or pg_catalog.to_regclass('public.product_option_values') is null
    or pg_catalog.to_regclass('public.product_variant_option_values') is null
    or pg_catalog.to_regclass('public.product_variant_combination_identities') is null
  then
    raise exception 'Product options B2 preflight: required relations are missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_mode_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ANY (ARRAY[''none''::text, ''size''::text, ''colour''::text, ''size_colour''::text]))'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_inventory_authority_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ''none''::text OR stock = 0)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_draft_publication_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ''none''::text OR is_active IS FALSE)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_label_required_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (size_normalized IS NOT NULL OR colour_normalized IS NOT NULL)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_draft_only_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (is_active IS FALSE)'
  ) then
    raise exception 'Product options B2 preflight: draft, publication, or inventory authority changed.';
  end if;

  if pg_catalog.pg_get_indexdef(
    'public.product_variants_normalized_combination_key'::pg_catalog.regclass
  ) <> 'CREATE UNIQUE INDEX product_variants_normalized_combination_key ON public.product_variants USING btree (product_id, size_normalized, colour_normalized) NULLS NOT DISTINCT' then
    raise exception 'Product options B2 preflight: legacy combination authority changed.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.variant_mode not in ('none', 'size', 'colour', 'size_colour')
  ) then
    raise exception 'Product options B2 preflight: an unsupported product mode exists.';
  end if;

  if (
    select pg_catalog.count(*)
    from public.product_option_policy as policy
    where policy.singleton
      and policy.max_axes = 3
      and policy.max_combinations = 100
  ) <> 1 then
    raise exception 'Product options B2 preflight: product option policy changed.';
  end if;

  foreach relation_name in array array[
    'catalogue_categories', 'catalogue_category_aliases', 'option_units',
    'option_size_systems', 'option_definitions', 'category_option_templates',
    'product_option_policy', 'product_option_axes', 'product_option_values',
    'product_variant_option_values', 'product_variant_combination_identities'
  ]::text[] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
    ) or exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = relation_name
    ) or pg_catalog.has_table_privilege(
      'public', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'Product options B2 preflight: private relation % authority changed.',
        relation_name;
    end if;
  end loop;

  for expected_function in
    select *
    from (values
      ('public.enforce_product_foundation_authority()'::text, '624c42c4ab1c60bd67336e2e2b3682e9'::text),
      ('public.enforce_product_variant_foundation()'::text, 'e78b76b04116caa821c78c8b00f6d44e'::text),
      ('public.guard_foundation_order_item_variant()'::text, 'b7ef9997e19e38d33274104723faccee'::text),
      ('public.protect_order_item_variant_identity()'::text, 'd296f4f90403c71faf597fcdd145914b'::text),
      ('public.lock_product_option_structure()'::text, 'a01cc6e7875d81c5cec91bc02aad692f'::text),
      ('public.validate_product_option_axis()'::text, '7a6745fc154f7d213a71e8e543546f07'::text),
      ('public.validate_product_option_value()'::text, '8325c80fc73e58efb6980c86532786b9'::text),
      ('public.assert_product_option_completeness(uuid)'::text, 'ee834b0171617e06efb05726e937ddb4'::text),
      ('public.enforce_product_option_completeness()'::text, '9c79d539cf207624a5cc263c01b7bf02'::text),
      ('public.enforce_product_option_policy()'::text, '8bba6895cf99dac9775ca85f16495bfe'::text),
      ('public.configure_vendor_product_variant_mode(uuid,text)'::text, 'd87e27030795ef2fd84136131344a708'::text),
      ('public.create_vendor_product_variant(uuid,text,text,integer)'::text, 'aeb5665ecf5f91821699f299bc9975c0'::text),
      ('public.update_vendor_product_variant_labels(uuid,text,text)'::text, '40463529dfc84ac168f95e7daefd69ea'::text),
      ('public.update_vendor_product_variant_stock(uuid,integer,bigint)'::text, '0faebe13683d65cd402f116807a1c62d'::text),
      ('public.delete_vendor_product_variant(uuid,bigint)'::text, '9c5a7c9c20fea5430764c491e1ff1594'::text),
      ('public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::text, '37c763494aed0f4e13daa004b88b6dee'::text),
      ('public.decrement_stock(uuid,integer)'::text, '0094f1ea6602edbfe18ac8f9619677b8'::text)
    ) as expected(signature, definition_hash)
  loop
    if pg_catalog.to_regprocedure(expected_function.signature) is null
      or pg_catalog.md5(pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(expected_function.signature)
      )) <> expected_function.definition_hash
    then
      raise exception 'Product options B2 preflight: function % changed.',
        expected_function.signature;
    end if;
  end loop;

  foreach rpc_signature in array array[
    'get_vendor_option_reference_data()',
    'get_vendor_product_option_configuration(uuid)',
    'configure_vendor_product_options(uuid,text)',
    'add_vendor_product_option_axis(uuid,text,text,smallint,text,text)',
    'update_vendor_product_option_axis(uuid,text,smallint,text,text)',
    'delete_vendor_product_option_axis(uuid)',
    'add_vendor_product_option_value(uuid,text,numeric,text,integer)',
    'update_vendor_product_option_value(uuid,text,numeric,text,integer)',
    'delete_vendor_product_option_value(uuid)',
    'create_vendor_product_option_variant(uuid,uuid[],integer)'
  ]::text[] loop
    if pg_catalog.to_regprocedure('public.' || rpc_signature) is not null then
      raise exception 'Product options B2 preflight: RPC % is occupied.', rpc_signature;
    end if;
  end loop;

  perform pg_catalog.set_config(
    'marketa.options_b2.products_hash',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(product)::text),
      '' order by product.id
    )) from public.products as product), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.options_b2.variants_hash',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
      '' order by variant.id
    )) from public.product_variants as variant), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.options_b2.order_items_hash',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(item)::text),
      '' order by item.id
    )) from public.order_items as item), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.options_b2.product_policies_hash',
    coalesce((select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(policy) order by policy.policyname
    )::text) from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'products'), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.options_b2.variant_policies_hash',
    coalesce((select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(policy) order by policy.policyname
    )::text) from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'product_variants'), pg_catalog.md5('')),
    true
  );
end
$preflight$;

alter table public.products
  drop constraint products_variant_mode_check;

alter table public.products
  add constraint products_variant_mode_check
    check (variant_mode in ('none', 'size', 'colour', 'size_colour', 'options'))
    not valid;

alter table public.products
  validate constraint products_variant_mode_check;

alter table public.product_variants
  drop constraint product_variants_label_required_check;

alter table public.product_variants
  add constraint product_variants_label_required_check
    check (
      size_normalized is not null
      or colour_normalized is not null
      or (size is null and colour is null)
    )
    not valid;

alter table public.product_variants
  validate constraint product_variants_label_required_check;

drop index public.product_variants_normalized_combination_key;

create unique index product_variants_normalized_combination_key
on public.product_variants (
  product_id,
  size_normalized,
  colour_normalized
)
nulls not distinct
where size_normalized is not null or colour_normalized is not null;

create or replace function public.enforce_product_variant_foundation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  parent_mode text;
  parent_vendor_id uuid;
  normalized_size text;
  normalized_colour text;
begin
  if tg_op = 'UPDATE' and (
    new.product_id is distinct from old.product_id
    or new.vendor_id is distinct from old.vendor_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Product variant ownership cannot be reassigned.';
  end if;

  select product.variant_mode, product.vendor_id
  into parent_mode, parent_vendor_id
  from public.products as product
  where product.id = new.product_id;

  if not found or parent_vendor_id is distinct from new.vendor_id then
    raise exception using
      errcode = '23514',
      message = 'Product variant ownership does not match its product.';
  end if;

  normalized_size := case
    when new.size is null then null
    else nullif(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.btrim(new.size), '[[:space:]]+', ' ', 'g'
    )), '')
  end;
  normalized_colour := case
    when new.colour is null then null
    else nullif(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.btrim(new.colour), '[[:space:]]+', ' ', 'g'
    )), '')
  end;

  if parent_mode = 'none' then
    raise exception using
      errcode = '23514',
      message = 'Variant creation is unavailable for an ordinary product.';
  elsif parent_mode = 'size' and not (
    normalized_size is not null and normalized_colour is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Size variants require size only.';
  elsif parent_mode = 'colour' and not (
    normalized_size is null and normalized_colour is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Colour variants require colour only.';
  elsif parent_mode = 'size_colour' and not (
    normalized_size is not null and normalized_colour is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Size-and-colour variants require both labels.';
  elsif parent_mode = 'options' and not (
    normalized_size is null and normalized_colour is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Generalized option variants use option-value assignments instead of legacy labels.';
  elsif parent_mode not in ('size', 'colour', 'size_colour', 'options') then
    raise exception using
      errcode = '23514',
      message = 'The parent variant mode is unsupported.';
  end if;

  if tg_op = 'INSERT' then
    new.stock_version := 0;
  else
    if new.stock is distinct from old.stock then
      new.stock_version := old.stock_version + 1;
    elsif new.stock_version is distinct from old.stock_version then
      raise exception using
        errcode = '23514',
        message = 'Product variant stock version is database-managed.';
    end if;
  end if;

  return new;
end
$function$;

create or replace function public.create_vendor_product_variant(
  p_product_id uuid,
  p_size text,
  p_colour text,
  p_stock integer
)
returns table (
  outcome text,
  variant_id uuid,
  result_stock_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  product_record public.products%rowtype;
  created_variant_id uuid;
  created_stock_version bigint;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  if p_product_id is null or p_stock is null or p_stock < 0 then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
    return;
  end if;

  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  select product.*
  into product_record
  from public.products as product
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  if product_record.variant_mode not in ('size', 'colour', 'size_colour')
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, null::uuid, null::bigint;
    return;
  end if;

  insert into public.product_variants (
    product_id, vendor_id, size, colour, stock, is_active
  ) values (
    p_product_id, authorized_vendor_id, p_size, p_colour, p_stock, false
  )
  returning id, stock_version
  into created_variant_id, created_stock_version;

  return query select 'created'::text, created_variant_id, created_stock_version;
exception
  when unique_violation then
    return query select 'duplicate_combination'::text, null::uuid, null::bigint;
  when check_violation or not_null_violation then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::bigint;
end
$function$;

create or replace function public.update_vendor_product_variant_labels(
  p_variant_id uuid,
  p_size text,
  p_colour text
)
returns table (
  outcome text,
  variant_id uuid,
  result_stock_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  parent_mode text;
  parent_active boolean;
  parent_stock integer;
  variant_record public.product_variants%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  if p_variant_id is null then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
    return;
  end if;

  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  select variant.product_id
  into parent_product_id
  from public.product_variants as variant
  where variant.id = p_variant_id
    and variant.vendor_id = authorized_vendor_id;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );

  select product.variant_mode, product.is_active, product.stock
  into parent_mode, parent_active, parent_stock
  from public.products as product
  where product.id = parent_product_id
    and product.vendor_id = authorized_vendor_id
  for update;

  select variant.*
  into variant_record
  from public.product_variants as variant
  where variant.id = p_variant_id
    and variant.product_id = parent_product_id
    and variant.vendor_id = authorized_vendor_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  if parent_mode not in ('size', 'colour', 'size_colour')
    or parent_active is distinct from false
    or parent_stock <> 0
    or variant_record.is_active is distinct from false
  then
    return query select 'invalid_state'::text, p_variant_id, variant_record.stock_version;
    return;
  end if;

  update public.product_variants as variant
  set size = p_size, colour = p_colour
  where variant.id = p_variant_id
  returning variant.stock_version into variant_record.stock_version;

  return query select 'updated'::text, p_variant_id, variant_record.stock_version;
exception
  when unique_violation then
    return query select 'duplicate_combination'::text, p_variant_id, null::bigint;
  when check_violation or not_null_violation then
    return query select 'invalid_input'::text, p_variant_id, null::bigint;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::bigint;
end
$function$;

create function public.get_vendor_option_reference_data()
returns table (
  outcome text,
  reference_data jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::jsonb;
    return;
  end if;

  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::jsonb;
    return;
  end if;

  return query
  select 'ok'::text, pg_catalog.jsonb_build_object(
    'categories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', category.code,
        'name', category.name,
        'sort_order', category.sort_order
      ) order by category.sort_order, category.code)
      from public.catalogue_categories as category
      where category.is_active
    ), '[]'::jsonb),
    'options', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', definition.code,
        'name', definition.name,
        'value_kind', definition.value_kind,
        'dimension_code', definition.dimension_code,
        'requires_unit', definition.requires_unit,
        'requires_size_system', definition.requires_size_system,
        'sort_order', definition.sort_order
      ) order by definition.sort_order, definition.code)
      from public.option_definitions as definition
      where definition.is_active
    ), '[]'::jsonb),
    'units', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', unit.code,
        'name', unit.name,
        'symbol', unit.symbol,
        'dimension_code', unit.dimension_code,
        'sort_order', unit.sort_order
      ) order by unit.sort_order, unit.code)
      from public.option_units as unit
      where unit.is_active
    ), '[]'::jsonb),
    'size_systems', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', size_system.code,
        'name', size_system.name,
        'sort_order', size_system.sort_order
      ) order by size_system.sort_order, size_system.code)
      from public.option_size_systems as size_system
      where size_system.is_active
    ), '[]'::jsonb),
    'templates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'category_code', template.category_code,
        'option_code', template.option_code,
        'sort_order', template.sort_order,
        'default_unit_code', template.default_unit_code,
        'default_size_system_code', template.default_size_system_code
      ) order by template.category_code, template.sort_order, template.option_code)
      from public.category_option_templates as template
      join public.catalogue_categories as category
        on category.code = template.category_code and category.is_active
      join public.option_definitions as definition
        on definition.code = template.option_code and definition.is_active
    ), '[]'::jsonb)
  );
end
$function$;

create function public.get_vendor_product_option_configuration(
  p_product_id uuid
)
returns table (
  outcome text,
  configuration jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  product_record public.products%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::jsonb;
    return;
  end if;

  if p_product_id is null then
    return query select 'invalid_input'::text, null::jsonb;
    return;
  end if;

  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::jsonb;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  select product.*
  into product_record
  from public.products as product
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id;

  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  return query
  select 'ok'::text, pg_catalog.jsonb_build_object(
    'product_id', product_record.id,
    'category_code', product_record.category_code,
    'variant_mode', product_record.variant_mode,
    'is_active', product_record.is_active,
    'parent_stock', product_record.stock,
    'axes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', axis.id,
        'option_code', axis.option_code,
        'display_name', axis.display_name,
        'position', axis.position,
        'unit_code', axis.unit_code,
        'size_system_code', axis.size_system_code,
        'values', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', value.id,
            'display_label', value.display_label,
            'numeric_value', value.numeric_value,
            'swatch_hex', value.swatch_hex,
            'sort_order', value.sort_order
          ) order by value.sort_order, value.id)
          from public.product_option_values as value
          where value.axis_id = axis.id
            and value.product_id = product_record.id
            and value.vendor_id = authorized_vendor_id
        ), '[]'::jsonb)
      ) order by axis.position, axis.id)
      from public.product_option_axes as axis
      where axis.product_id = product_record.id
        and axis.vendor_id = authorized_vendor_id
    ), '[]'::jsonb),
    'variants', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', variant.id,
        'stock', variant.stock,
        'stock_version', variant.stock_version,
        'is_active', variant.is_active,
        'selected_value_ids', coalesce((
          select pg_catalog.jsonb_agg(assignment.value_id order by assignment.axis_id)
          from public.product_variant_option_values as assignment
          where assignment.variant_id = variant.id
            and assignment.product_id = product_record.id
            and assignment.vendor_id = authorized_vendor_id
        ), '[]'::jsonb)
      ) order by variant.created_at, variant.id)
      from public.product_variants as variant
      where variant.product_id = product_record.id
        and variant.vendor_id = authorized_vendor_id
    ), '[]'::jsonb)
  );
end
$function$;

create function public.configure_vendor_product_options(
  p_product_id uuid,
  p_category_code text
)
returns table (
  outcome text,
  configured_product_id uuid,
  configured_variant_mode text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  product_record public.products%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::text;
    return;
  end if;

  if p_product_id is null or p_category_code is null then
    return query select 'invalid_input'::text, null::uuid, null::text;
    return;
  end if;

  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::uuid, null::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  select product.*
  into product_record
  from public.products as product
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text;
    return;
  end if;

  if product_record.variant_mode <> 'none'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, p_product_id, product_record.variant_mode;
    return;
  end if;

  if exists (
    select 1 from public.order_items as item
    where item.product_id = p_product_id
  ) then
    return query select 'order_history_exists'::text, p_product_id, product_record.variant_mode;
    return;
  end if;

  if exists (
    select 1 from public.product_variants as variant
    where variant.product_id = p_product_id
  ) or exists (
    select 1 from public.product_option_axes as axis
    where axis.product_id = p_product_id
  ) then
    return query select 'invalid_state'::text, p_product_id, product_record.variant_mode;
    return;
  end if;

  if not exists (
    select 1
    from public.catalogue_categories as category
    where category.code = p_category_code and category.is_active
  ) then
    return query select 'invalid_input'::text, p_product_id, product_record.variant_mode;
    return;
  end if;

  update public.products as product
  set category_code = p_category_code,
      variant_mode = 'options',
      is_active = false
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id;

  return query select 'configured'::text, p_product_id, 'options'::text;
exception
  when check_violation or foreign_key_violation then
    return query select 'invalid_state'::text, p_product_id, null::text;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::text;
end
$function$;

create function public.add_vendor_product_option_axis(
  p_product_id uuid,
  p_option_code text,
  p_display_name text,
  p_position smallint,
  p_unit_code text,
  p_size_system_code text
)
returns table (outcome text, axis_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  product_record public.products%rowtype;
  maximum_axes integer;
  created_axis_id uuid;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  if p_product_id is null or p_option_code is null
    or p_display_name is null
    or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 80
    or p_position is null or p_position not between 1 and 3
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = p_product_id and product.vendor_id = authorized_vendor_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.product_variants as variant
             where variant.product_id = p_product_id) then
    return query select 'unsafe_state'::text, null::uuid;
    return;
  end if;
  if not exists (
    select 1
    from public.category_option_templates as template
    join public.option_definitions as definition
      on definition.code = template.option_code and definition.is_active
    where template.category_code = product_record.category_code
      and template.option_code = p_option_code
  ) then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;
  select policy.max_axes into maximum_axes
  from public.product_option_policy as policy where policy.singleton;
  if maximum_axes is null or (
    select pg_catalog.count(*) from public.product_option_axes as axis
    where axis.product_id = p_product_id
  ) >= maximum_axes then
    return query select 'limit_reached'::text, null::uuid;
    return;
  end if;

  insert into public.product_option_axes (
    product_id, vendor_id, option_code, display_name, position,
    unit_code, size_system_code
  ) values (
    p_product_id, authorized_vendor_id, p_option_code,
    pg_catalog.btrim(p_display_name), p_position, p_unit_code, p_size_system_code
  ) returning id into created_axis_id;
  return query select 'created'::text, created_axis_id;
exception
  when unique_violation then
    return query select 'duplicate_axis'::text, null::uuid;
  when check_violation or foreign_key_violation or not_null_violation then
    return query select 'invalid_input'::text, null::uuid;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

alter function public.enforce_product_variant_foundation() owner to postgres;
revoke all privileges on function public.enforce_product_variant_foundation()
  from public, anon, authenticated, service_role;

create function public.update_vendor_product_option_axis(
  p_axis_id uuid,
  p_display_name text,
  p_position smallint,
  p_unit_code text,
  p_size_system_code text
)
returns table (outcome text, axis_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  product_record public.products%rowtype;
  axis_record public.product_option_axes%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  if p_axis_id is null or p_display_name is null
    or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 80
    or p_position is null or p_position not between 1 and 3
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;

  select axis.product_id into parent_product_id
  from public.product_option_axes as axis
  where axis.id = p_axis_id and axis.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = parent_product_id and product.vendor_id = authorized_vendor_id
  for update;
  select axis.* into axis_record
  from public.product_option_axes as axis
  where axis.id = p_axis_id
    and axis.product_id = parent_product_id
    and axis.vendor_id = authorized_vendor_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, p_axis_id;
    return;
  end if;
  if exists (select 1 from public.product_variants as variant
             where variant.product_id = parent_product_id) then
    return query select 'unsafe_state'::text, p_axis_id;
    return;
  end if;

  update public.product_option_axes as axis
  set display_name = pg_catalog.btrim(p_display_name),
      position = p_position,
      unit_code = p_unit_code,
      size_system_code = p_size_system_code,
      updated_at = pg_catalog.now()
  where axis.id = p_axis_id;
  return query select 'updated'::text, p_axis_id;
exception
  when unique_violation then
    return query select 'duplicate_axis'::text, p_axis_id;
  when check_violation or foreign_key_violation or not_null_violation then
    return query select 'invalid_input'::text, p_axis_id;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

create function public.delete_vendor_product_option_axis(
  p_axis_id uuid
)
returns table (outcome text, axis_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  product_record public.products%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  if p_axis_id is null then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;
  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  select axis.product_id into parent_product_id
  from public.product_option_axes as axis
  where axis.id = p_axis_id and axis.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = parent_product_id and product.vendor_id = authorized_vendor_id
  for update;
  if not found or product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, p_axis_id;
    return;
  end if;
  if exists (select 1 from public.product_variants as variant
             where variant.product_id = parent_product_id) then
    return query select 'unsafe_state'::text, p_axis_id;
    return;
  end if;
  delete from public.product_option_axes as axis
  where axis.id = p_axis_id
    and axis.product_id = parent_product_id
    and axis.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  return query select 'deleted'::text, p_axis_id;
exception
  when foreign_key_violation then
    return query select 'unsafe_state'::text, p_axis_id;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

create function public.add_vendor_product_option_value(
  p_axis_id uuid,
  p_display_label text,
  p_numeric_value numeric,
  p_swatch_hex text,
  p_sort_order integer
)
returns table (outcome text, value_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  product_record public.products%rowtype;
  axis_record public.product_option_axes%rowtype;
  created_value_id uuid;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  if p_axis_id is null or p_display_label is null
    or pg_catalog.char_length(pg_catalog.btrim(p_display_label)) not between 1 and 80
    or p_sort_order is null or p_sort_order < 0
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;
  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  select axis.product_id into parent_product_id
  from public.product_option_axes as axis
  where axis.id = p_axis_id and axis.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = parent_product_id and product.vendor_id = authorized_vendor_id
  for update;
  select axis.* into axis_record
  from public.product_option_axes as axis
  where axis.id = p_axis_id
    and axis.product_id = parent_product_id
    and axis.vendor_id = authorized_vendor_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, null::uuid;
    return;
  end if;
  insert into public.product_option_values (
    axis_id, product_id, vendor_id, display_label,
    numeric_value, swatch_hex, sort_order
  ) values (
    p_axis_id, parent_product_id, authorized_vendor_id,
    pg_catalog.btrim(p_display_label), p_numeric_value, p_swatch_hex, p_sort_order
  ) returning id into created_value_id;
  return query select 'created'::text, created_value_id;
exception
  when unique_violation then
    return query select 'duplicate_value'::text, null::uuid;
  when check_violation or foreign_key_violation or not_null_violation then
    return query select 'invalid_input'::text, null::uuid;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

create function public.update_vendor_product_option_value(
  p_value_id uuid,
  p_display_label text,
  p_numeric_value numeric,
  p_swatch_hex text,
  p_sort_order integer
)
returns table (outcome text, value_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  product_record public.products%rowtype;
  value_record public.product_option_values%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  if p_value_id is null or p_display_label is null
    or pg_catalog.char_length(pg_catalog.btrim(p_display_label)) not between 1 and 80
    or p_sort_order is null or p_sort_order < 0
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;
  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  select value.product_id into parent_product_id
  from public.product_option_values as value
  where value.id = p_value_id and value.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = parent_product_id and product.vendor_id = authorized_vendor_id
  for update;
  select value.* into value_record
  from public.product_option_values as value
  where value.id = p_value_id
    and value.product_id = parent_product_id
    and value.vendor_id = authorized_vendor_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, p_value_id;
    return;
  end if;
  if exists (
    select 1 from public.product_variant_option_values as assignment
    where assignment.value_id = p_value_id
  ) then
    return query select 'value_in_use'::text, p_value_id;
    return;
  end if;
  update public.product_option_values as value
  set display_label = pg_catalog.btrim(p_display_label),
      numeric_value = p_numeric_value,
      swatch_hex = p_swatch_hex,
      sort_order = p_sort_order,
      updated_at = pg_catalog.now()
  where value.id = p_value_id;
  return query select 'updated'::text, p_value_id;
exception
  when unique_violation then
    return query select 'duplicate_value'::text, p_value_id;
  when check_violation or foreign_key_violation or not_null_violation then
    return query select 'invalid_input'::text, p_value_id;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

create function public.delete_vendor_product_option_value(
  p_value_id uuid
)
returns table (outcome text, value_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  product_record public.products%rowtype;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  if p_value_id is null then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;
  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;
  select value.product_id into parent_product_id
  from public.product_option_values as value
  where value.id = p_value_id and value.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = parent_product_id and product.vendor_id = authorized_vendor_id
  for update;
  if not found or product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, p_value_id;
    return;
  end if;
  if exists (
    select 1 from public.product_variant_option_values as assignment
    where assignment.value_id = p_value_id
  ) then
    return query select 'value_in_use'::text, p_value_id;
    return;
  end if;
  delete from public.product_option_values as value
  where value.id = p_value_id
    and value.product_id = parent_product_id
    and value.vendor_id = authorized_vendor_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  return query select 'deleted'::text, p_value_id;
exception
  when foreign_key_violation then
    return query select 'value_in_use'::text, p_value_id;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

create function public.create_vendor_product_option_variant(
  p_product_id uuid,
  p_value_ids uuid[],
  p_stock integer
)
returns table (
  outcome text,
  variant_id uuid,
  result_stock_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  product_record public.products%rowtype;
  selected_axis_ids uuid[];
  required_axis_ids uuid[];
  requested_combination_signature text;
  maximum_combinations integer;
  created_variant_id uuid;
  created_stock_version bigint;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;
  if p_product_id is null or p_value_ids is null
    or pg_catalog.cardinality(p_value_ids) not between 1 and 3
    or pg_catalog.array_position(p_value_ids, null) is not null
    or (select pg_catalog.count(distinct selected_id)
        from pg_catalog.unnest(p_value_ids) as selected(selected_id))
       <> pg_catalog.cardinality(p_value_ids)
    or p_stock is null or p_stock < 0
  then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
    return;
  end if;

  select vendor.id into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id and vendor.is_active = true
  for share;
  if not found then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );
  select product.* into product_record
  from public.products as product
  where product.id = p_product_id and product.vendor_id = authorized_vendor_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;
  if product_record.variant_mode <> 'options'
    or product_record.is_active is distinct from false
    or product_record.stock <> 0
  then
    return query select 'invalid_state'::text, null::uuid, null::bigint;
    return;
  end if;

  select pg_catalog.array_agg(axis.id order by axis.id)
  into required_axis_ids
  from public.product_option_axes as axis
  where axis.product_id = p_product_id
    and axis.vendor_id = authorized_vendor_id;
  if required_axis_ids is null then
    return query select 'invalid_state'::text, null::uuid, null::bigint;
    return;
  end if;

  select
    pg_catalog.array_agg(value.axis_id order by value.axis_id),
    pg_catalog.string_agg(
      value.axis_id::text || '=' || value.id::text,
      '|' order by value.axis_id
    )
  into selected_axis_ids, requested_combination_signature
  from public.product_option_values as value
  where value.id = any(p_value_ids)
    and value.product_id = p_product_id
    and value.vendor_id = authorized_vendor_id;

  if selected_axis_ids is distinct from required_axis_ids
    or pg_catalog.cardinality(selected_axis_ids)
      is distinct from pg_catalog.cardinality(p_value_ids)
    or requested_combination_signature is null
  then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
    return;
  end if;

  select policy.max_combinations into maximum_combinations
  from public.product_option_policy as policy where policy.singleton;
  if maximum_combinations is null or (
    select pg_catalog.count(*) from public.product_variants as variant
    where variant.product_id = p_product_id
  ) >= maximum_combinations then
    return query select 'limit_reached'::text, null::uuid, null::bigint;
    return;
  end if;

  if exists (
    select 1
    from public.product_variant_combination_identities as identity
    where identity.product_id = p_product_id
      and identity.combination_signature = requested_combination_signature
  ) then
    return query select 'duplicate_combination'::text, null::uuid, null::bigint;
    return;
  end if;

  insert into public.product_variants (
    product_id, vendor_id, size, colour, stock, is_active
  ) values (
    p_product_id, authorized_vendor_id, null, null, p_stock, false
  ) returning id, stock_version into created_variant_id, created_stock_version;

  insert into public.product_variant_option_values (
    variant_id, axis_id, value_id, product_id, vendor_id
  )
  select
    created_variant_id, value.axis_id, value.id,
    p_product_id, authorized_vendor_id
  from public.product_option_values as value
  where value.id = any(p_value_ids)
    and value.product_id = p_product_id
    and value.vendor_id = authorized_vendor_id;

  -- Force the same authoritative completeness and persisted-identity rebuild
  -- before reporting success. Deferred triggers repeat the check at commit.
  perform public.assert_product_option_completeness(p_product_id);

  return query select 'created'::text, created_variant_id, created_stock_version;
exception
  when unique_violation then
    return query select 'duplicate_combination'::text, null::uuid, null::bigint;
  when check_violation or foreign_key_violation or not_null_violation then
    return query select 'invalid_state'::text, null::uuid, null::bigint;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::bigint;
end
$function$;

alter function public.get_vendor_option_reference_data() owner to postgres;
alter function public.get_vendor_product_option_configuration(uuid) owner to postgres;
alter function public.configure_vendor_product_options(uuid, text) owner to postgres;
alter function public.add_vendor_product_option_axis(uuid, text, text, smallint, text, text) owner to postgres;
alter function public.update_vendor_product_option_axis(uuid, text, smallint, text, text) owner to postgres;
alter function public.delete_vendor_product_option_axis(uuid) owner to postgres;
alter function public.add_vendor_product_option_value(uuid, text, numeric, text, integer) owner to postgres;
alter function public.update_vendor_product_option_value(uuid, text, numeric, text, integer) owner to postgres;
alter function public.delete_vendor_product_option_value(uuid) owner to postgres;
alter function public.create_vendor_product_option_variant(uuid, uuid[], integer) owner to postgres;

revoke all privileges on function
  public.get_vendor_option_reference_data(),
  public.get_vendor_product_option_configuration(uuid),
  public.configure_vendor_product_options(uuid, text),
  public.add_vendor_product_option_axis(uuid, text, text, smallint, text, text),
  public.update_vendor_product_option_axis(uuid, text, smallint, text, text),
  public.delete_vendor_product_option_axis(uuid),
  public.add_vendor_product_option_value(uuid, text, numeric, text, integer),
  public.update_vendor_product_option_value(uuid, text, numeric, text, integer),
  public.delete_vendor_product_option_value(uuid),
  public.create_vendor_product_option_variant(uuid, uuid[], integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.get_vendor_option_reference_data(),
  public.get_vendor_product_option_configuration(uuid),
  public.configure_vendor_product_options(uuid, text),
  public.add_vendor_product_option_axis(uuid, text, text, smallint, text, text),
  public.update_vendor_product_option_axis(uuid, text, smallint, text, text),
  public.delete_vendor_product_option_axis(uuid),
  public.add_vendor_product_option_value(uuid, text, numeric, text, integer),
  public.update_vendor_product_option_value(uuid, text, numeric, text, integer),
  public.delete_vendor_product_option_value(uuid),
  public.create_vendor_product_option_variant(uuid, uuid[], integer)
to authenticated;

do $postcondition$
declare
  function_record record;
  relation_name text;
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_mode_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ANY (ARRAY[''none''::text, ''size''::text, ''colour''::text, ''size_colour''::text, ''options''::text]))'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_label_required_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (size_normalized IS NOT NULL OR colour_normalized IS NOT NULL OR size IS NULL AND colour IS NULL)'
  ) then
    raise exception 'Product options B2 postcondition: generalized draft constraints are incorrect.';
  end if;

  if pg_catalog.pg_get_indexdef(
    'public.product_variants_normalized_combination_key'::pg_catalog.regclass
  ) <> 'CREATE UNIQUE INDEX product_variants_normalized_combination_key ON public.product_variants USING btree (product_id, size_normalized, colour_normalized) NULLS NOT DISTINCT WHERE ((size_normalized IS NOT NULL) OR (colour_normalized IS NOT NULL))' then
    raise exception 'Product options B2 postcondition: legacy combination index is incorrect.';
  end if;

  for function_record in
    select procedure.oid, procedure.prosecdef, procedure.provolatile,
           procedure.proconfig, pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.get_vendor_option_reference_data()'::pg_catalog.regprocedure,
      'public.get_vendor_product_option_configuration(uuid)'::pg_catalog.regprocedure,
      'public.configure_vendor_product_options(uuid,text)'::pg_catalog.regprocedure,
      'public.add_vendor_product_option_axis(uuid,text,text,smallint,text,text)'::pg_catalog.regprocedure,
      'public.update_vendor_product_option_axis(uuid,text,smallint,text,text)'::pg_catalog.regprocedure,
      'public.delete_vendor_product_option_axis(uuid)'::pg_catalog.regprocedure,
      'public.add_vendor_product_option_value(uuid,text,numeric,text,integer)'::pg_catalog.regprocedure,
      'public.update_vendor_product_option_value(uuid,text,numeric,text,integer)'::pg_catalog.regprocedure,
      'public.delete_vendor_product_option_value(uuid)'::pg_catalog.regprocedure,
      'public.create_vendor_product_option_variant(uuid,uuid[],integer)'::pg_catalog.regprocedure
    )
  loop
    if function_record.owner <> 'postgres'
      or not function_record.prosecdef
      or function_record.provolatile <> 'v'
      or function_record.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.has_function_privilege('public', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    then
      raise exception 'Product options B2 postcondition: generalized RPC authority is incorrect.';
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.get_vendor_option_reference_data()'::pg_catalog.regprocedure,
      'public.get_vendor_product_option_configuration(uuid)'::pg_catalog.regprocedure,
      'public.configure_vendor_product_options(uuid,text)'::pg_catalog.regprocedure,
      'public.add_vendor_product_option_axis(uuid,text,text,smallint,text,text)'::pg_catalog.regprocedure,
      'public.update_vendor_product_option_axis(uuid,text,smallint,text,text)'::pg_catalog.regprocedure,
      'public.delete_vendor_product_option_axis(uuid)'::pg_catalog.regprocedure,
      'public.add_vendor_product_option_value(uuid,text,numeric,text,integer)'::pg_catalog.regprocedure,
      'public.update_vendor_product_option_value(uuid,text,numeric,text,integer)'::pg_catalog.regprocedure,
      'public.delete_vendor_product_option_value(uuid)'::pg_catalog.regprocedure,
      'public.create_vendor_product_option_variant(uuid,uuid[],integer)'::pg_catalog.regprocedure
    )
  ) <> 10 then
    raise exception 'Product options B2 postcondition: generalized RPC inventory is incorrect.';
  end if;

  for function_record in
    select procedure.oid, procedure.prosecdef, procedure.provolatile,
           procedure.proconfig, pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.configure_vendor_product_variant_mode(uuid,text)'::pg_catalog.regprocedure,
      'public.create_vendor_product_variant(uuid,text,text,integer)'::pg_catalog.regprocedure,
      'public.update_vendor_product_variant_labels(uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_vendor_product_variant_stock(uuid,integer,bigint)'::pg_catalog.regprocedure,
      'public.delete_vendor_product_variant(uuid,bigint)'::pg_catalog.regprocedure
    )
  loop
    if function_record.owner <> 'postgres'
      or not function_record.prosecdef
      or function_record.provolatile <> 'v'
      or function_record.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.has_function_privilege('public', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    then
      raise exception 'Product options B2 postcondition: legacy RPC authority changed.';
    end if;
  end loop;

  foreach relation_name in array array[
    'catalogue_categories', 'catalogue_category_aliases', 'option_units',
    'option_size_systems', 'option_definitions', 'category_option_templates',
    'product_option_policy', 'product_option_axes', 'product_option_values',
    'product_variant_option_values', 'product_variant_combination_identities'
  ]::text[] loop
    if pg_catalog.has_table_privilege(
      'public', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'Product options B2 postcondition: private relation % gained authority.',
        relation_name;
    end if;
  end loop;

  if pg_catalog.current_setting('marketa.options_b2.products_hash')
    is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(product)::text),
      '' order by product.id
    )) from public.products as product), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.options_b2.variants_hash')
    is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
      '' order by variant.id
    )) from public.product_variants as variant), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.options_b2.order_items_hash')
    is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(item)::text),
      '' order by item.id
    )) from public.order_items as item), pg_catalog.md5(''))
  then
    raise exception 'Product options B2 postcondition: business rows changed.';
  end if;

  if pg_catalog.current_setting('marketa.options_b2.product_policies_hash')
    is distinct from coalesce((select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(policy) order by policy.policyname
    )::text) from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'products'), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.options_b2.variant_policies_hash')
    is distinct from coalesce((select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(policy) order by policy.policyname
    )::text) from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'product_variants'), pg_catalog.md5(''))
  then
    raise exception 'Product options B2 postcondition: existing RLS policies changed.';
  end if;

  if pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure
  )) <> '37c763494aed0f4e13daa004b88b6dee'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.decrement_stock(uuid,integer)'::pg_catalog.regprocedure
    )) <> '0094f1ea6602edbfe18ac8f9619677b8'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.update_vendor_product_variant_stock(uuid,integer,bigint)'::pg_catalog.regprocedure
    )) <> '0faebe13683d65cd402f116807a1c62d'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.delete_vendor_product_variant(uuid,bigint)'::pg_catalog.regprocedure
    )) <> '9c5a7c9c20fea5430764c491e1ff1594'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.configure_vendor_product_variant_mode(uuid,text)'::pg_catalog.regprocedure
    )) <> 'd87e27030795ef2fd84136131344a708'
  then
    raise exception 'Product options B2 postcondition: preserved stock, payment, or legacy RPC authority changed.';
  end if;

  if exists (
    select 1 from public.products as product
    where product.variant_mode = 'options'
      and (product.is_active or product.stock <> 0)
  ) or exists (
    select 1 from public.product_variants as variant
    join public.products as product on product.id = variant.product_id
    where product.variant_mode = 'options'
      and (variant.is_active or variant.size is not null or variant.colour is not null)
  ) then
    raise exception 'Product options B2 postcondition: generalized draft authority is unsafe.';
  end if;
end
$postcondition$;

commit;

