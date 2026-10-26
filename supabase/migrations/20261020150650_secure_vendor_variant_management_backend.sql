-- Product Variants Batch 2B1: authenticated vendor draft-management backend.
-- Variant purchasing and publication remain unavailable.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  function_record record;
  role_name text;
  column_name text;
  privilege_name text;
begin
  if pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.order_items') is null
    or pg_catalog.to_regclass('public.orders') is null
    or pg_catalog.to_regclass('public.vendors') is null
  then
    raise exception 'Product variants 2B1 preflight: required tables are missing.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'configure_vendor_product_variant_mode',
        'create_vendor_product_variant',
        'update_vendor_product_variant_labels',
        'update_vendor_product_variant_stock',
        'delete_vendor_product_variant'
      )
  ) then
    raise exception 'Product variants 2B1 preflight: RPC name collision.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid in (
      'public.products'::pg_catalog.regclass,
      'public.product_variants'::pg_catalog.regclass
    )
      and constraint_record.conname in (
        'products_variant_draft_publication_check',
        'product_variants_draft_only_check'
      )
  ) then
    raise exception 'Product variants 2B1 preflight: publication guard collision.';
  end if;

  if not exists (
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
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.conname = 'vendors_user_id_key'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'UNIQUE (user_id)'
  ) then
    raise exception 'Product variants 2B1 preflight: ownership or inventory authority changed.';
  end if;

  if (
    select pg_catalog.count(*)
    from public.product_variants
  ) <> 0 or exists (
    select 1
    from public.products as product
    where product.variant_mode <> 'none'
  ) then
    raise exception 'Product variants 2B1 preflight: unexpected variant data already exists.';
  end if;

  if (
    select pg_catalog.array_agg(
      policy.policyname::text order by policy.policyname
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) is distinct from array[
    'products_public_read',
    'vendor_delete_own_active_products',
    'vendor_insert_own_active_products',
    'vendor_select_own_products',
    'vendor_update_own_active_products'
  ]::text[] or (
    select pg_catalog.array_agg(
      policy.policyname::text order by policy.policyname
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'product_variants'
  ) is distinct from array[
    'product_variants_public_read',
    'vendor_select_own_product_variants'
  ]::text[] then
    raise exception 'Product variants 2B1 preflight: RLS policy inventory changed.';
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
  ) then
    raise exception 'Product variants 2B1 preflight: order-item variant guard changed.';
  end if;

  if (
    select pg_catalog.count(*)
    from (
      values
        ('public.enforce_product_foundation_authority()'::text),
        ('public.enforce_product_variant_foundation()'::text),
        ('public.guard_foundation_order_item_variant()'::text),
        ('public.protect_order_item_variant_identity()'::text),
        ('public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::text)
    ) as expected(signature)
    where pg_catalog.to_regprocedure(expected.signature) is not null
  ) <> 5 then
    raise exception 'Product variants 2B1 preflight: required functions are missing.';
  end if;

  for function_record in
    select expected.signature, expected.definition_hash,
           procedure.oid, procedure.prosecdef, procedure.provolatile,
           procedure.proconfig, pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from (
      values
        ('public.enforce_product_foundation_authority()'::text,
          '624c42c4ab1c60bd67336e2e2b3682e9'::text),
        ('public.enforce_product_variant_foundation()'::text,
          'e78b76b04116caa821c78c8b00f6d44e'::text),
        ('public.guard_foundation_order_item_variant()'::text,
          '686d43b726c7e89661d351d4129f0a9f'::text),
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
      or function_record.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.md5(pg_catalog.pg_get_functiondef(function_record.oid))
        <> function_record.definition_hash
    then
      raise exception 'Product variants 2B1 preflight: function % changed.',
        function_record.signature;
    end if;
  end loop;

  perform pg_catalog.set_config(
    'marketa.variant_2b1.decrement_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.decrement_stock(uuid,integer)'
      )
    ), 'absent'),
    true
  );

  if pg_catalog.has_table_privilege(
      'public', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_column_privilege(
      'authenticated', 'public.products', 'variant_mode', 'UPDATE'
    ) or pg_catalog.has_column_privilege(
      'authenticated', 'public.products', 'stock_version', 'UPDATE'
    )
  then
    raise exception 'Product variants 2B1 preflight: direct mutation authority changed.';
  end if;

  foreach role_name in array array[
    'public', 'anon', 'authenticated', 'service_role'
  ]::text[] loop
    foreach privilege_name in array array[
      'INSERT', 'UPDATE', 'REFERENCES'
    ]::text[] loop
      for column_name in
        select attribute.attname::text
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid =
            'public.product_variants'::pg_catalog.regclass
          and attribute.attnum > 0
          and not attribute.attisdropped
      loop
        if pg_catalog.has_column_privilege(
          role_name,
          'public.product_variants',
          column_name,
          privilege_name
        ) then
          raise exception
            'Product variants 2B1 preflight: % has % on product_variants.%.',
            role_name, privilege_name, column_name;
        end if;
      end loop;

      foreach column_name in array array[
        'variant_mode', 'stock_version'
      ]::text[] loop
        if pg_catalog.has_column_privilege(
          role_name,
          'public.products',
          column_name,
          privilege_name
        ) then
          raise exception
            'Product variants 2B1 preflight: % has % on products.%.',
            role_name, privilege_name, column_name;
        end if;
      end loop;
    end loop;
  end loop;

  perform pg_catalog.set_config(
    'marketa.variant_2b1.products_rows',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
      '' order by row_record.id
    )) from public.products as row_record), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.variant_2b1.order_items_rows',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
      '' order by row_record.id
    )) from public.order_items as row_record), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.variant_2b1.orders_rows',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
      '' order by row_record.id
    )) from public.orders as row_record), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.variant_2b1.payout_rows',
    coalesce((select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
      '' order by row_record.id
    )) from public.payout_ledger as row_record), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.variant_2b1.product_policies',
    (select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(policy) order by policy.policyname
    )::text) from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'products'),
    true
  );
  perform pg_catalog.set_config(
    'marketa.variant_2b1.variant_policies',
    (select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(policy) order by policy.policyname
    )::text) from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'product_variants'),
    true
  );
end
$preflight$;

alter table public.products
  add constraint products_variant_draft_publication_check
    check (variant_mode = 'none' or is_active is false)
    not valid;

alter table public.products
  validate constraint products_variant_draft_publication_check;

alter table public.product_variants
  add constraint product_variants_draft_only_check
    check (is_active is false)
    not valid;

alter table public.product_variants
  validate constraint product_variants_draft_only_check;

create or replace function public.guard_foundation_order_item_variant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  parent_mode text;
begin
  if new.product_id is null then
    raise exception using
      errcode = '23514',
      message = 'Ordinary order items require a product.';
  end if;

  -- Conversion and ordinary checkout use the same transaction-scoped key.
  -- This closes the gap between checkout validation and order-item insertion
  -- without adding product row locks to ordinary multi-product checkout.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(new.product_id::text, 0)
  );

  if new.product_variant_id is not null
    or new.variant_size_snapshot is not null
    or new.variant_colour_snapshot is not null
  then
    raise exception using
      errcode = '23514',
      message = 'Variant purchasing is not available.';
  end if;

  select product.variant_mode
  into parent_mode
  from public.products as product
  where product.id = new.product_id;

  if not found or parent_mode is distinct from 'none' then
    raise exception using
      errcode = '23514',
      message = 'Ordinary order items require an ordinary product.';
  end if;

  return new;
end
$function$;

alter function public.guard_foundation_order_item_variant() owner to postgres;
revoke all privileges on function public.guard_foundation_order_item_variant()
  from public, anon, authenticated, service_role;

create function public.configure_vendor_product_variant_mode(
  p_product_id uuid,
  p_variant_mode text
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

  if p_product_id is null
    or p_variant_mode is null
    or p_variant_mode not in ('size', 'colour', 'size_colour')
  then
    return query select 'invalid_input'::text, null::uuid, null::text;
    return;
  end if;

  -- Global RPC lock order: vendor SHARE, product advisory, product UPDATE,
  -- then variant UPDATE when the operation addresses an existing variant.
  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id
    and vendor.is_active = true
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

  -- order_items is the authoritative product linkage for every checkout and
  -- payment state. Blocking every reference covers pending, paid, cancelled,
  -- fulfilled, retryable, and reconciliation cases without status guessing.
  if exists (
    select 1
    from public.order_items as item
    where item.product_id = p_product_id
  ) then
    return query select 'order_history_exists'::text, p_product_id, product_record.variant_mode;
    return;
  end if;

  if exists (
    select 1
    from public.product_variants as variant
    where variant.product_id = p_product_id
  ) then
    return query select 'invalid_state'::text, p_product_id, product_record.variant_mode;
    return;
  end if;

  update public.products as product
  set variant_mode = p_variant_mode,
      is_active = false
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id;

  return query select 'configured'::text, p_product_id, p_variant_mode;
exception
  when check_violation then
    return query select 'invalid_state'::text, p_product_id, null::text;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::text;
end
$function$;

create function public.create_vendor_product_variant(
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

  -- Keep the active-vendor decision locked through the complete operation.
  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id
    and vendor.is_active = true
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

  if product_record.variant_mode = 'none'
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

  return query
  select 'created'::text, created_variant_id, created_stock_version;
exception
  when unique_violation then
    return query select 'duplicate_combination'::text, null::uuid, null::bigint;
  when check_violation or not_null_violation then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::bigint;
end
$function$;

create function public.update_vendor_product_variant_labels(
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

  -- Keep the active-vendor decision locked through the complete operation.
  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id
    and vendor.is_active = true
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

  if parent_mode = 'none'
    or parent_active is distinct from false
    or parent_stock <> 0
    or variant_record.is_active is distinct from false
  then
    return query select 'invalid_state'::text, p_variant_id, variant_record.stock_version;
    return;
  end if;

  update public.product_variants as variant
  set size = p_size,
      colour = p_colour
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

create function public.update_vendor_product_variant_stock(
  p_variant_id uuid,
  p_stock integer,
  p_expected_stock_version bigint
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
  updated_stock_version bigint;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  if p_variant_id is null
    or p_stock is null
    or p_stock < 0
    or p_expected_stock_version is null
    or p_expected_stock_version < 0
  then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
    return;
  end if;

  -- Keep the active-vendor decision locked through the complete operation.
  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id
    and vendor.is_active = true
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

  if parent_mode = 'none'
    or parent_active is distinct from false
    or parent_stock <> 0
    or variant_record.is_active is distinct from false
  then
    return query select 'invalid_state'::text, p_variant_id, variant_record.stock_version;
    return;
  end if;

  if variant_record.stock_version <> p_expected_stock_version then
    return query select 'conflict'::text, p_variant_id, variant_record.stock_version;
    return;
  end if;

  if variant_record.stock = p_stock then
    return query select 'no_change'::text, p_variant_id, variant_record.stock_version;
    return;
  end if;

  update public.product_variants as variant
  set stock = p_stock
  where variant.id = p_variant_id
    and variant.stock_version = p_expected_stock_version
  returning variant.stock_version into updated_stock_version;

  if not found then
    return query select 'conflict'::text, p_variant_id, variant_record.stock_version;
    return;
  end if;

  return query select 'updated'::text, p_variant_id, updated_stock_version;
exception
  when check_violation or not_null_violation then
    return query select 'invalid_input'::text, p_variant_id, null::bigint;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::bigint;
end
$function$;

create function public.delete_vendor_product_variant(
  p_variant_id uuid,
  p_expected_stock_version bigint
)
returns table (
  outcome text,
  variant_id uuid
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
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;

  if p_variant_id is null
    or p_expected_stock_version is null
    or p_expected_stock_version < 0
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  -- Keep the active-vendor decision locked through the complete operation.
  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id
    and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::uuid;
    return;
  end if;

  select variant.product_id
  into parent_product_id
  from public.product_variants as variant
  where variant.id = p_variant_id
    and variant.vendor_id = authorized_vendor_id;

  if not found then
    return query select 'not_found'::text, null::uuid;
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
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if parent_mode = 'none'
    or parent_active is distinct from false
    or parent_stock <> 0
    or variant_record.is_active is distinct from false
  then
    return query select 'invalid_state'::text, p_variant_id;
    return;
  end if;

  if variant_record.stock_version <> p_expected_stock_version then
    return query select 'conflict'::text, p_variant_id;
    return;
  end if;

  if exists (
    select 1
    from public.order_items as item
    where item.product_variant_id = p_variant_id
  ) then
    return query select 'historical_reference'::text, p_variant_id;
    return;
  end if;

  delete from public.product_variants as variant
  where variant.id = p_variant_id
    and variant.stock_version = p_expected_stock_version;

  if not found then
    return query select 'conflict'::text, p_variant_id;
    return;
  end if;

  return query select 'deleted'::text, p_variant_id;
exception
  when foreign_key_violation then
    return query select 'historical_reference'::text, p_variant_id;
  when others then
    return query select 'operation_failed'::text, null::uuid;
end
$function$;

alter function public.configure_vendor_product_variant_mode(uuid, text)
  owner to postgres;
alter function public.create_vendor_product_variant(uuid, text, text, integer)
  owner to postgres;
alter function public.update_vendor_product_variant_labels(uuid, text, text)
  owner to postgres;
alter function public.update_vendor_product_variant_stock(uuid, integer, bigint)
  owner to postgres;
alter function public.delete_vendor_product_variant(uuid, bigint)
  owner to postgres;

revoke all privileges on function
  public.configure_vendor_product_variant_mode(uuid, text),
  public.create_vendor_product_variant(uuid, text, text, integer),
  public.update_vendor_product_variant_labels(uuid, text, text),
  public.update_vendor_product_variant_stock(uuid, integer, bigint),
  public.delete_vendor_product_variant(uuid, bigint)
from public, anon, authenticated, service_role;

grant execute on function
  public.configure_vendor_product_variant_mode(uuid, text),
  public.create_vendor_product_variant(uuid, text, text, integer),
  public.update_vendor_product_variant_labels(uuid, text, text),
  public.update_vendor_product_variant_stock(uuid, integer, bigint),
  public.delete_vendor_product_variant(uuid, bigint)
to authenticated;

do $postcondition$
declare
  function_record record;
  function_definition text;
  role_name text;
  column_name text;
  privilege_name text;
begin
  if not exists (
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
      and constraint_record.conname = 'product_variants_draft_only_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (is_active IS FALSE)'
  ) then
    raise exception 'Product variants 2B1 postcondition: publication guards are incorrect.';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
  )) into function_definition;

  if function_definition not like '%pg_catalog.pg_advisory_xact_lock_shared%'
    or function_definition not like '%pg_catalog.hashtextextended(new.product_id::text, 0%'
    or function_definition not like '%variant purchasing is not available%'
    or function_definition not like '%parent_mode is distinct from ''none''%'
  then
    raise exception 'Product variants 2B1 postcondition: synchronized order-item guard is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
        'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and not procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig is not distinct from array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) or not exists (
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
    raise exception 'Product variants 2B1 postcondition: order-item guard authority or trigger changed.';
  end if;

  if (
    select pg_catalog.count(*)
    from (
      values
        ('public.configure_vendor_product_variant_mode(uuid,text)'::text),
        ('public.create_vendor_product_variant(uuid,text,text,integer)'::text),
        ('public.update_vendor_product_variant_labels(uuid,text,text)'::text),
        ('public.update_vendor_product_variant_stock(uuid,integer,bigint)'::text),
        ('public.delete_vendor_product_variant(uuid,bigint)'::text)
    ) as expected(signature)
    where pg_catalog.to_regprocedure(expected.signature) is not null
  ) <> 5 then
    raise exception 'Product variants 2B1 postcondition: RPC inventory is incomplete.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'configure_vendor_product_variant_mode',
        'create_vendor_product_variant',
        'update_vendor_product_variant_labels',
        'update_vendor_product_variant_stock',
        'delete_vendor_product_variant'
      )
  ) <> 5 then
    raise exception 'Product variants 2B1 postcondition: unexpected RPC overload exists.';
  end if;

  for function_record in
    select expected.signature, procedure.oid, procedure.prosecdef,
           procedure.provolatile, procedure.proconfig,
           pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from (
      values
        ('public.configure_vendor_product_variant_mode(uuid,text)'::text),
        ('public.create_vendor_product_variant(uuid,text,text,integer)'::text),
        ('public.update_vendor_product_variant_labels(uuid,text,text)'::text),
        ('public.update_vendor_product_variant_stock(uuid,integer,bigint)'::text),
        ('public.delete_vendor_product_variant(uuid,bigint)'::text)
    ) as expected(signature)
    join pg_catalog.pg_proc as procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
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
      raise exception 'Product variants 2B1 postcondition: RPC authority is incorrect for %.',
        function_record.signature;
    end if;

    function_definition := pg_catalog.lower(
      pg_catalog.pg_get_functiondef(function_record.oid)
    );
    if function_definition not like '%auth.uid()%'
      or function_definition not like '%vendor.user_id = actor_id%'
      or function_definition not like '%vendor.is_active = true%'
      or position('for share' in function_definition) = 0
      or position(
        'for share' in function_definition
      ) > position(
        'pg_catalog.pg_advisory_xact_lock' in function_definition
      )
      or position(
        'pg_catalog.pg_advisory_xact_lock' in function_definition
      ) > position('for update' in function_definition)
      or function_definition like '%execute %'
    then
      raise exception 'Product variants 2B1 postcondition: RPC identity boundary is incorrect for %.',
        function_record.signature;
    end if;
  end loop;

  if pg_catalog.has_table_privilege(
      'public', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_column_privilege(
      'authenticated', 'public.products', 'variant_mode', 'UPDATE'
    ) or pg_catalog.has_column_privilege(
      'authenticated', 'public.products', 'stock_version', 'UPDATE'
    )
  then
    raise exception 'Product variants 2B1 postcondition: direct mutation authority widened.';
  end if;

  foreach role_name in array array[
    'public', 'anon', 'authenticated', 'service_role'
  ]::text[] loop
    foreach privilege_name in array array[
      'INSERT', 'UPDATE', 'REFERENCES'
    ]::text[] loop
      for column_name in
        select attribute.attname::text
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid =
            'public.product_variants'::pg_catalog.regclass
          and attribute.attnum > 0
          and not attribute.attisdropped
      loop
        if pg_catalog.has_column_privilege(
          role_name,
          'public.product_variants',
          column_name,
          privilege_name
        ) then
          raise exception
            'Product variants 2B1 postcondition: % has % on product_variants.%.',
            role_name, privilege_name, column_name;
        end if;
      end loop;

      foreach column_name in array array[
        'variant_mode', 'stock_version'
      ]::text[] loop
        if pg_catalog.has_column_privilege(
          role_name,
          'public.products',
          column_name,
          privilege_name
        ) then
          raise exception
            'Product variants 2B1 postcondition: % has % on products.%.',
            role_name, privilege_name, column_name;
        end if;
      end loop;
    end loop;
  end loop;

  if pg_catalog.current_setting('marketa.variant_2b1.product_policies')
    is distinct from (
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'products'
    ) or pg_catalog.current_setting('marketa.variant_2b1.variant_policies')
    is distinct from (
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'product_variants'
    )
  then
    raise exception 'Product variants 2B1 postcondition: RLS policies changed.';
  end if;

  if pg_catalog.current_setting('marketa.variant_2b1.products_rows')
      is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
        '' order by row_record.id
      )) from public.products as row_record), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.variant_2b1.order_items_rows')
      is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
        '' order by row_record.id
      )) from public.order_items as row_record), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.variant_2b1.orders_rows')
      is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
        '' order by row_record.id
      )) from public.orders as row_record), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.variant_2b1.payout_rows')
      is distinct from coalesce((select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(row_record)::text),
        '' order by row_record.id
      )) from public.payout_ledger as row_record), pg_catalog.md5(''))
    or exists (
      select 1 from public.products as product
      where product.variant_mode <> 'none'
    )
    or exists (select 1 from public.product_variants)
  then
    raise exception 'Product variants 2B1 postcondition: business data changed.';
  end if;

  if pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure
    )) <> '37c763494aed0f4e13daa004b88b6dee'
    or pg_catalog.current_setting('marketa.variant_2b1.decrement_hash')
      is distinct from coalesce((
        select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
        from pg_catalog.pg_proc as procedure
        where procedure.oid = pg_catalog.to_regprocedure(
          'public.decrement_stock(uuid,integer)'
        )
      ), 'absent')
  then
    raise exception 'Product variants 2B1 postcondition: Ops 4 functions changed.';
  end if;
end
$postcondition$;

commit;
