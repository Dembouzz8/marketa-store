begin;

set transaction isolation level repeatable read;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  function_hash text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'D2 preflight: PostgreSQL 17 or newer is required.';
  end if;

  if pg_catalog.to_regnamespace('marketa_private') is not null
    or pg_catalog.to_regclass(
      'marketa_private.trusted_order_item_insert_authorizations'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)'
    ) is not null
  then
    raise exception 'D2 preflight: trusted construction objects already exist.';
  end if;

  if pg_catalog.to_regclass('public.orders') is null
    or pg_catalog.to_regclass('public.order_items') is null
    or pg_catalog.to_regclass('public.checkout_attempts') is null
    or pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.vendors') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.product_option_axes') is null
    or pg_catalog.to_regclass('public.product_option_values') is null
    or pg_catalog.to_regclass('public.product_variant_option_values') is null
    or pg_catalog.to_regclass('public.option_definitions') is null
    or pg_catalog.to_regclass('public.option_units') is null
    or pg_catalog.to_regclass('public.option_size_systems') is null
    or pg_catalog.to_regclass(
      'public.product_variant_combination_identities'
    ) is null
  then
    raise exception 'D2 preflight: required checkout or variant tables are missing.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'public.option_definitions'::pg_catalog.regclass::oid,
          'code'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        ),
        (
          'public.option_definitions'::pg_catalog.regclass::oid,
          'value_kind'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        ),
        (
          'public.option_units'::pg_catalog.regclass::oid,
          'code'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        ),
        (
          'public.option_units'::pg_catalog.regclass::oid,
          'name'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        ),
        (
          'public.option_units'::pg_catalog.regclass::oid,
          'symbol'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        ),
        (
          'public.option_size_systems'::pg_catalog.regclass::oid,
          'code'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        ),
        (
          'public.option_size_systems'::pg_catalog.regclass::oid,
          'name'::name,
          'pg_catalog.text'::pg_catalog.regtype::oid,
          true
        )
    ) as required_column(table_oid, column_name, type_oid, not_null)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = required_column.table_oid
     and attribute.attname = required_column.column_name
     and not attribute.attisdropped
    where attribute.attname is null
      or attribute.atttypid is distinct from required_column.type_oid
      or attribute.attnotnull is distinct from required_column.not_null
  ) then
    raise exception 'D2 preflight: option reference columns changed.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'public.option_definitions'::pg_catalog.regclass::oid,
          'option_definitions_pkey'::name,
          'PRIMARY KEY (code)'::text
        ),
        (
          'public.option_units'::pg_catalog.regclass::oid,
          'option_units_pkey'::name,
          'PRIMARY KEY (code)'::text
        ),
        (
          'public.option_size_systems'::pg_catalog.regclass::oid,
          'option_size_systems_pkey'::name,
          'PRIMARY KEY (code)'::text
        ),
        (
          'public.product_option_axes'::pg_catalog.regclass::oid,
          'product_option_axes_option_fkey'::name,
          'FOREIGN KEY (option_code) REFERENCES option_definitions(code) ON UPDATE RESTRICT ON DELETE RESTRICT'::text
        ),
        (
          'public.product_option_axes'::pg_catalog.regclass::oid,
          'product_option_axes_unit_fkey'::name,
          'FOREIGN KEY (unit_code) REFERENCES option_units(code) ON UPDATE RESTRICT ON DELETE RESTRICT'::text
        ),
        (
          'public.product_option_axes'::pg_catalog.regclass::oid,
          'product_option_axes_size_system_fkey'::name,
          'FOREIGN KEY (size_system_code) REFERENCES option_size_systems(code) ON UPDATE RESTRICT ON DELETE RESTRICT'::text
        )
    ) as required_constraint(table_oid, constraint_name, definition)
    left join pg_catalog.pg_constraint as constraint_record
      on constraint_record.conrelid = required_constraint.table_oid
     and constraint_record.conname = required_constraint.constraint_name
    where constraint_record.oid is null
      or not constraint_record.convalidated
      or pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        is distinct from required_constraint.definition
  ) then
    raise exception 'D2 preflight: option reference keys or relationships changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure;

  if function_hash is distinct from 'b7ef9997e19e38d33274104723faccee' then
    raise exception 'D2 preflight: purchase guard definition changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure;

  if function_hash is distinct from 'c34ac95900ffa3c7bd2072256a56f203' then
    raise exception 'D2 preflight: C2 snapshot validator changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure;

  if function_hash is distinct from '74a760039e13ce5ff09e3b9ef76d7c21' then
    raise exception 'D2 preflight: C3 finalizer definition changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_draft_publication_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ''none''::text OR is_active IS FALSE)'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_draft_only_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (is_active IS FALSE)'
      and constraint_record.convalidated
  ) then
    raise exception 'D2 preflight: draft-only publication boundary changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
      and trigger_record.tgname = 'order_items_foundation_variant_guard'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid =
        'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
  ) then
    raise exception 'D2 preflight: order-item purchase guard trigger changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
      and attribute.attname = 'variant_options_snapshot'
      and not attribute.attisdropped
      and attribute.atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.orders'::pg_catalog.regclass
      and attribute.attname = 'total_amount_kobo'
      and not attribute.attisdropped
      and attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
  ) then
    raise exception 'D2 preflight: C2 or financial snapshot columns changed.';
  end if;

  perform pg_catalog.set_config(
    'marketa.d2.orders_count',
    (select pg_catalog.count(*)::text from public.orders),
    true
  );
  perform pg_catalog.set_config(
    'marketa.d2.order_items_count',
    (select pg_catalog.count(*)::text from public.order_items),
    true
  );
  perform pg_catalog.set_config(
    'marketa.d2.checkout_attempts_count',
    (select pg_catalog.count(*)::text from public.checkout_attempts),
    true
  );
  perform pg_catalog.set_config(
    'marketa.d2.orders_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(customer_order)::text),
        '' order by customer_order.id
      ))
      from public.orders as customer_order
    ), pg_catalog.md5('')),
    true
  );
  perform pg_catalog.set_config(
    'marketa.d2.order_items_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(item)::text),
        '' order by item.id
      ))
      from public.order_items as item
    ), pg_catalog.md5('')),
    true
  );
end
$preflight$;

create schema marketa_private;
revoke all privileges on schema marketa_private
  from public, anon, authenticated, service_role;

create table marketa_private.trusted_order_item_insert_authorizations (
  transaction_id bigint not null,
  backend_pid integer not null,
  order_id uuid not null,
  line_identity text not null,
  product_id uuid not null,
  vendor_id uuid not null,
  quantity integer not null,
  unit_price numeric(12,2) not null,
  subtotal numeric(12,2) not null,
  unit_amount_kobo bigint not null,
  gross_amount_kobo bigint not null,
  platform_fee_bps integer not null,
  platform_fee_amount_kobo bigint not null,
  vendor_net_amount_kobo bigint not null,
  currency text not null,
  financial_contract_version smallint not null,
  product_variant_id uuid,
  variant_size_snapshot text,
  variant_colour_snapshot text,
  variant_options_snapshot jsonb,
  primary key (transaction_id, backend_pid, order_id, line_identity),
  constraint trusted_order_item_authorization_identity_check check (
    line_identity = product_id::text || ':' || coalesce(
      product_variant_id::text,
      'ordinary'
    )
  ),
  constraint trusted_order_item_authorization_quantity_check
    check (quantity between 1 and 99),
  constraint trusted_order_item_authorization_financial_check check (
    unit_amount_kobo > 0
    and gross_amount_kobo = unit_amount_kobo * quantity::bigint
    and platform_fee_bps between 0 and 10000
    and platform_fee_amount_kobo >= 0
    and vendor_net_amount_kobo >= 0
    and gross_amount_kobo = platform_fee_amount_kobo + vendor_net_amount_kobo
    and currency = 'NGN'
    and financial_contract_version = 2
    and unit_price * 100 = unit_amount_kobo
    and subtotal * 100 = gross_amount_kobo
  )
);

alter table marketa_private.trusted_order_item_insert_authorizations
  enable row level security;
revoke all privileges on table
  marketa_private.trusted_order_item_insert_authorizations
from public, anon, authenticated, service_role;

create or replace function public.guard_foundation_order_item_variant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parent_mode text;
  consumed_line_identity text;
begin
  if new.product_id is null then
    raise exception using
      errcode = '23514',
      message = 'Order items require a product.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(new.product_id::text, 0)
  );

  select product.variant_mode
  into parent_mode
  from public.products as product
  where product.id = new.product_id;

  if new.product_variant_id is null then
    if new.variant_size_snapshot is not null
      or new.variant_colour_snapshot is not null
      or new.variant_options_snapshot is not null
      or not found
      or parent_mode is distinct from 'none'
    then
      raise exception using
        errcode = '23514',
        message = 'Ordinary order items require an ordinary product.';
    end if;

    return new;
  end if;

  if not found or parent_mode is null or parent_mode = 'none' then
    raise exception using
      errcode = '23514',
      message = 'Variant order items require a variant product.';
  end if;

  delete from marketa_private.trusted_order_item_insert_authorizations
    as auth_row
  where auth_row.transaction_id = pg_catalog.txid_current()
    and auth_row.backend_pid = pg_catalog.pg_backend_pid()
    and auth_row.order_id = new.order_id
    and auth_row.line_identity = new.product_id::text || ':'
      || new.product_variant_id::text
    and auth_row.product_id = new.product_id
    and auth_row.vendor_id = new.vendor_id
    and auth_row.quantity = new.quantity
    and auth_row.unit_price = new.unit_price
    and auth_row.subtotal = new.subtotal
    and auth_row.unit_amount_kobo = new.unit_amount_kobo
    and auth_row.gross_amount_kobo = new.gross_amount_kobo
    and auth_row.platform_fee_bps = new.platform_fee_bps
    and auth_row.platform_fee_amount_kobo =
      new.platform_fee_amount_kobo
    and auth_row.vendor_net_amount_kobo = new.vendor_net_amount_kobo
    and auth_row.currency = new.currency
    and auth_row.financial_contract_version =
      new.financial_contract_version
    and auth_row.product_variant_id = new.product_variant_id
    and auth_row.variant_size_snapshot
      is not distinct from new.variant_size_snapshot
    and auth_row.variant_colour_snapshot
      is not distinct from new.variant_colour_snapshot
    and auth_row.variant_options_snapshot
      is not distinct from new.variant_options_snapshot
  returning auth_row.line_identity into consumed_line_identity;

  if consumed_line_identity is null then
    raise exception using
      errcode = '42501',
      message = 'Variant order-item insertion is not authorized.';
  end if;

  return new;
end
$function$;

alter function public.guard_foundation_order_item_variant() owner to postgres;
revoke all privileges on function public.guard_foundation_order_item_variant()
  from public, anon, authenticated, service_role;

create function public.construct_trusted_checkout_order(
  p_checkout_attempt_id uuid,
  p_customer_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_customer_phone text,
  p_shipping_address jsonb,
  p_request_fingerprint text,
  p_expires_at timestamptz,
  p_items jsonb
)
returns table (
  construction_outcome text,
  constructed_order_id uuid,
  constructed_total_amount_kobo bigint,
  constructed_item_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  normalized_items jsonb;
  prepared_items jsonb := '[]'::jsonb;
  input_item_count integer;
  normalized_item_count integer;
  locked_product_count integer;
  locked_variant_count integer;
  expected_variant_count integer;
  item_record record;
  product_record record;
  variant_record record;
  existing_record record;
  new_order_id uuid;
  total_kobo numeric := 0;
  unit_amount_kobo bigint;
  gross_amount_kobo bigint;
  fee_bps integer;
  fee_amount_kobo bigint;
  vendor_net_kobo bigint;
  size_snapshot text;
  colour_snapshot text;
  options_snapshot jsonb;
  options_array jsonb;
  persisted_signature text;
  computed_signature text;
  axis_count integer;
  assignment_count integer;
  authorization_count integer;
begin
  if p_checkout_attempt_id is null
    or p_customer_id is null
    or p_customer_email is null
    or pg_catalog.char_length(pg_catalog.btrim(p_customer_email))
      not between 3 and 320
    or p_customer_name is null
    or pg_catalog.char_length(pg_catalog.btrim(p_customer_name))
      not between 1 and 120
    or p_customer_phone is null
    or pg_catalog.char_length(pg_catalog.btrim(p_customer_phone))
      not between 1 and 32
    or p_request_fingerprint is null
    or p_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= pg_catalog.statement_timestamp()
    or pg_catalog.jsonb_typeof(p_shipping_address) is distinct from 'object'
    or not (p_shipping_address ?& array['address', 'city', 'state']::text[])
    or (p_shipping_address - array['address', 'city', 'state']::text[])
      is distinct from '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_shipping_address -> 'address')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_shipping_address -> 'city')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_shipping_address -> 'state')
      is distinct from 'string'
    or pg_catalog.char_length(pg_catalog.btrim(p_shipping_address ->> 'address'))
      not between 5 and 300
    or pg_catalog.char_length(pg_catalog.btrim(p_shipping_address ->> 'city'))
      not between 2 and 100
    or pg_catalog.char_length(pg_catalog.btrim(p_shipping_address ->> 'state'))
      not between 2 and 100
    or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_items) not between 1 and 50
  then
    raise exception using
      errcode = '22023',
      message = 'Trusted checkout input is invalid.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
      or not (item.value ?& array['product_id', 'quantity']::text[])
      or (item.value - array[
        'product_id', 'product_variant_id', 'quantity'
      ]::text[]) is distinct from '{}'::jsonb
      or pg_catalog.jsonb_typeof(item.value -> 'product_id')
        is distinct from 'string'
      or (item.value ->> 'product_id') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or pg_catalog.jsonb_typeof(item.value -> 'quantity')
        is distinct from 'number'
      or (item.value ->> 'quantity') !~ '^[0-9]+$'
      or (item.value ->> 'quantity')::integer not between 1 and 99
      or (
        item.value ? 'product_variant_id'
        and item.value -> 'product_variant_id' <> 'null'::jsonb
        and (
          pg_catalog.jsonb_typeof(item.value -> 'product_variant_id')
            is distinct from 'string'
          or (item.value ->> 'product_variant_id') !~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Trusted checkout items are invalid.';
  end if;

  input_item_count := pg_catalog.jsonb_array_length(p_items);

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'product_id', requested.product_id::text,
      'product_variant_id', requested.product_variant_id::text,
      'quantity', requested.quantity
    ) order by requested.product_id, requested.product_variant_id nulls first
  )
  into normalized_items
  from (
    select
      (item.value ->> 'product_id')::uuid as product_id,
      case
        when not (item.value ? 'product_variant_id')
          or item.value -> 'product_variant_id' = 'null'::jsonb
        then null
        else (item.value ->> 'product_variant_id')::uuid
      end as product_variant_id,
      pg_catalog.sum((item.value ->> 'quantity')::integer)::integer
        as quantity
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
    group by
      (item.value ->> 'product_id')::uuid,
      case
        when not (item.value ? 'product_variant_id')
          or item.value -> 'product_variant_id' = 'null'::jsonb
        then null
        else (item.value ->> 'product_variant_id')::uuid
      end
  ) as requested;

  if normalized_items is null or exists (
    select 1
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
    where (item.value ->> 'quantity')::integer not between 1 and 99
  ) then
    raise exception using
      errcode = '22023',
      message = 'Combined checkout quantity is invalid.';
  end if;

  normalized_item_count := pg_catalog.jsonb_array_length(normalized_items);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'marketa-checkout-attempt:' || p_checkout_attempt_id::text,
      0
    )
  );

  select
    customer_order.id,
    customer_order.customer_id,
    customer_order.customer_email,
    customer_order.customer_name,
    customer_order.customer_phone,
    customer_order.shipping_address,
    customer_order.status,
    customer_order.total_amount_kobo,
    customer_order.financial_contract_version,
    attempt.request_fingerprint,
    attempt.expires_at,
    (
      select pg_catalog.count(*)::integer
      from public.order_items as existing_item
      where existing_item.order_id = customer_order.id
    ) as item_count
  into existing_record
  from public.checkout_attempts as attempt
  join public.orders as customer_order
    on customer_order.id = attempt.order_id
   and customer_order.checkout_attempt_id = attempt.checkout_attempt_id
  where attempt.checkout_attempt_id = p_checkout_attempt_id;

  if found then
    if existing_record.customer_id is distinct from p_customer_id
      or existing_record.customer_email is distinct from
        pg_catalog.lower(pg_catalog.btrim(p_customer_email))
      or existing_record.customer_name is distinct from
        pg_catalog.btrim(p_customer_name)
      or existing_record.customer_phone is distinct from
        pg_catalog.btrim(p_customer_phone)
      or existing_record.shipping_address is distinct from p_shipping_address
      or existing_record.request_fingerprint is distinct from
        p_request_fingerprint
      or existing_record.status is distinct from 'pending'
      or existing_record.financial_contract_version is distinct from 2
      or existing_record.total_amount_kobo is null
      or existing_record.item_count is distinct from normalized_item_count
      or exists (
        select 1
        from (
          (
            select
              (item.value ->> 'product_id')::uuid as product_id,
              (item.value ->> 'product_variant_id')::uuid
                as product_variant_id,
              (item.value ->> 'quantity')::integer as quantity
            from pg_catalog.jsonb_array_elements(normalized_items)
              as item(value)
            except
            select
              existing_item.product_id,
              existing_item.product_variant_id,
              pg_catalog.sum(existing_item.quantity)::integer as quantity
            from public.order_items as existing_item
            where existing_item.order_id = existing_record.id
            group by
              existing_item.product_id,
              existing_item.product_variant_id
          )
          union all
          (
            select
              existing_item.product_id,
              existing_item.product_variant_id,
              pg_catalog.sum(existing_item.quantity)::integer as quantity
            from public.order_items as existing_item
            where existing_item.order_id = existing_record.id
            group by
              existing_item.product_id,
              existing_item.product_variant_id
            except
            select
              (item.value ->> 'product_id')::uuid as product_id,
              (item.value ->> 'product_variant_id')::uuid
                as product_variant_id,
              (item.value ->> 'quantity')::integer as quantity
            from pg_catalog.jsonb_array_elements(normalized_items)
              as item(value)
          )
        ) as item_difference
      )
    then
      raise exception using
        errcode = '23505',
        message = 'Checkout attempt conflicts with existing construction.';
    end if;

    if existing_record.expires_at is null
      or existing_record.expires_at <= pg_catalog.statement_timestamp()
    then
      raise exception using
        errcode = '23514',
        message = 'Checkout attempt has expired.';
    end if;

    return query select
      'already_constructed'::text,
      existing_record.id,
      existing_record.total_amount_kobo,
      existing_record.item_count;
    return;
  end if;

  if exists (
    select 1
    from public.orders as customer_order
    where customer_order.checkout_attempt_id = p_checkout_attempt_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Checkout attempt requires reconciliation.';
  end if;

  perform vendor.id
  from public.vendors as vendor
  join (
    select distinct product.vendor_id
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
    join public.products as product
      on product.id = (item.value ->> 'product_id')::uuid
  ) as required_vendor
    on required_vendor.vendor_id = vendor.id
  order by vendor.id
  for share of vendor;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
    join public.products as product
      on product.id = (item.value ->> 'product_id')::uuid
    left join public.vendors as vendor on vendor.id = product.vendor_id
    where vendor.id is null or vendor.is_active is distinct from true
  ) then
    raise exception using
      errcode = '23514',
      message = 'A checkout vendor is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(requested.product_id::text, 0)
  )
  from (
    select distinct (item.value ->> 'product_id')::uuid as product_id
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
    order by product_id
  ) as requested;

  perform product.id
  from public.products as product
  join (
    select distinct (item.value ->> 'product_id')::uuid as product_id
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
  ) as requested on requested.product_id = product.id
  order by product.id
  for share of product;
  get diagnostics locked_product_count = row_count;

  if locked_product_count is distinct from (
    select pg_catalog.count(distinct (item.value ->> 'product_id'))::integer
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
  ) then
    raise exception using
      errcode = '23514',
      message = 'A checkout product is unavailable.';
  end if;

  select pg_catalog.count(*)::integer
  into expected_variant_count
  from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
  where item.value ->> 'product_variant_id' is not null;

  perform variant.id
  from public.product_variants as variant
  join (
    select distinct
      (item.value ->> 'product_variant_id')::uuid as variant_id,
      (item.value ->> 'product_id')::uuid as product_id
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
    where item.value ->> 'product_variant_id' is not null
  ) as requested
    on requested.variant_id = variant.id
   and requested.product_id = variant.product_id
  order by variant.id
  for share of variant;
  get diagnostics locked_variant_count = row_count;

  if locked_variant_count is distinct from expected_variant_count then
    raise exception using
      errcode = '23514',
      message = 'A checkout variant is unavailable.';
  end if;

  for item_record in
    select
      (item.value ->> 'product_id')::uuid as product_id,
      (item.value ->> 'product_variant_id')::uuid as product_variant_id,
      (item.value ->> 'quantity')::integer as quantity
    from pg_catalog.jsonb_array_elements(normalized_items) as item(value)
    order by
      (item.value ->> 'product_id')::uuid,
      (item.value ->> 'product_variant_id')::uuid nulls first
  loop
    select
      product.id,
      product.vendor_id,
      product.price,
      product.stock,
      product.is_active,
      product.variant_mode,
      vendor.platform_fee_pct,
      vendor.is_active as vendor_is_active
    into product_record
    from public.products as product
    join public.vendors as vendor on vendor.id = product.vendor_id
    where product.id = item_record.product_id;

    if not found
      or product_record.is_active is distinct from true
      or product_record.vendor_is_active is distinct from true
      or product_record.price is null
      or product_record.price <= 0
      or product_record.price * 100
        is distinct from pg_catalog.trunc(product_record.price * 100)
      or product_record.platform_fee_pct is null
      or product_record.platform_fee_pct not between 0 and 100
      or product_record.platform_fee_pct * 100 is distinct from
        pg_catalog.trunc(product_record.platform_fee_pct * 100)
    then
      raise exception using
        errcode = '23514',
        message = 'A checkout product is unavailable.';
    end if;

    size_snapshot := null;
    colour_snapshot := null;
    options_snapshot := null;

    if item_record.product_variant_id is null then
      if product_record.variant_mode is distinct from 'none'
        or product_record.stock < item_record.quantity
      then
        raise exception using
          errcode = '23514',
          message = 'Ordinary checkout inventory is unavailable.';
      end if;
    else
      if product_record.variant_mode = 'none' then
        raise exception using
          errcode = '23514',
          message = 'Variant checkout requires a variant product.';
      end if;

      select variant.*
      into variant_record
      from public.product_variants as variant
      where variant.id = item_record.product_variant_id
        and variant.product_id = item_record.product_id
        and variant.vendor_id = product_record.vendor_id;

      if not found
        or variant_record.is_active is distinct from true
        or variant_record.stock < item_record.quantity
      then
        raise exception using
          errcode = '23514',
          message = 'Variant checkout inventory is unavailable.';
      end if;

      if product_record.variant_mode = 'size' then
        if variant_record.size_normalized is null
          or variant_record.colour_normalized is not null
        then
          raise exception using
            errcode = '23514',
            message = 'Legacy size variant identity is invalid.';
        end if;
        size_snapshot := pg_catalog.btrim(variant_record.size);
      elsif product_record.variant_mode = 'colour' then
        if variant_record.size_normalized is not null
          or variant_record.colour_normalized is null
        then
          raise exception using
            errcode = '23514',
            message = 'Legacy colour variant identity is invalid.';
        end if;
        colour_snapshot := pg_catalog.btrim(variant_record.colour);
      elsif product_record.variant_mode = 'size_colour' then
        if variant_record.size_normalized is null
          or variant_record.colour_normalized is null
        then
          raise exception using
            errcode = '23514',
            message = 'Legacy size-colour variant identity is invalid.';
        end if;
        size_snapshot := pg_catalog.btrim(variant_record.size);
        colour_snapshot := pg_catalog.btrim(variant_record.colour);
      elsif product_record.variant_mode = 'options' then
        select pg_catalog.count(*)::integer
        into axis_count
        from public.product_option_axes as axis
        where axis.product_id = item_record.product_id
          and axis.vendor_id = product_record.vendor_id;

        select
          pg_catalog.count(*)::integer,
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'axis_id', axis.id::text,
              'axis_position', axis.position,
              'axis_display_name', axis.display_name,
              'option_code', axis.option_code,
              'value_kind', definition.value_kind,
              'value_id', option_value.id::text,
              'value_display_label', option_value.display_label,
              'numeric_value', case
                when option_value.numeric_value is null then null
                else option_value.numeric_value::text
              end,
              'unit_code', axis.unit_code,
              'unit_name', unit.name,
              'unit_symbol', unit.symbol,
              'size_system_code', axis.size_system_code,
              'size_system_name', size_system.name
            ) order by axis.position
          ),
          pg_catalog.string_agg(
            assignment.axis_id::text || '=' || assignment.value_id::text,
            '|' order by assignment.axis_id
          )
        into assignment_count, options_array, computed_signature
        from public.product_variant_option_values as assignment
        join public.product_option_axes as axis
          on axis.id = assignment.axis_id
         and axis.product_id = assignment.product_id
         and axis.vendor_id = assignment.vendor_id
        join public.product_option_values as option_value
          on option_value.id = assignment.value_id
         and option_value.axis_id = assignment.axis_id
         and option_value.product_id = assignment.product_id
         and option_value.vendor_id = assignment.vendor_id
        join public.option_definitions as definition
          on definition.code = axis.option_code
        left join public.option_units as unit
          on unit.code = axis.unit_code
        left join public.option_size_systems as size_system
          on size_system.code = axis.size_system_code
        where assignment.variant_id = item_record.product_variant_id
          and assignment.product_id = item_record.product_id
          and assignment.vendor_id = product_record.vendor_id;

        select identity.combination_signature
        into persisted_signature
        from public.product_variant_combination_identities as identity
        where identity.variant_id = item_record.product_variant_id
          and identity.product_id = item_record.product_id;

        if axis_count not between 1 and 3
          or assignment_count is distinct from axis_count
          or persisted_signature is null
          or persisted_signature is distinct from computed_signature
          or options_array is null
        then
          raise exception using
            errcode = '23514',
            message = 'Generalized variant identity is incomplete.';
        end if;

        options_snapshot := pg_catalog.jsonb_build_object(
          'schema_version', 1,
          'variant_id', item_record.product_variant_id::text,
          'product_id', item_record.product_id::text,
          'vendor_id', product_record.vendor_id::text,
          'combination_signature', persisted_signature,
          'options', options_array
        );

        if public.validate_order_item_variant_options_snapshot(
          options_snapshot
        ) is distinct from true then
          raise exception using
            errcode = '23514',
            message = 'Generalized variant snapshot is invalid.';
        end if;
      else
        raise exception using
          errcode = '23514',
          message = 'Product variant mode is unsupported.';
      end if;
    end if;

    unit_amount_kobo := (product_record.price * 100)::bigint;
    gross_amount_kobo := unit_amount_kobo * item_record.quantity::bigint;
    fee_bps := (product_record.platform_fee_pct * 100)::integer;
    fee_amount_kobo := pg_catalog.round(
      gross_amount_kobo::numeric * fee_bps::numeric / 10000
    )::bigint;
    vendor_net_kobo := gross_amount_kobo - fee_amount_kobo;
    total_kobo := total_kobo + gross_amount_kobo;

    prepared_items := prepared_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'line_identity', item_record.product_id::text || ':' || coalesce(
          item_record.product_variant_id::text,
          'ordinary'
        ),
        'product_id', item_record.product_id::text,
        'vendor_id', product_record.vendor_id::text,
        'quantity', item_record.quantity,
        'unit_price', product_record.price::text,
        'subtotal', (gross_amount_kobo::numeric / 100)::text,
        'unit_amount_kobo', unit_amount_kobo,
        'gross_amount_kobo', gross_amount_kobo,
        'platform_fee_bps', fee_bps,
        'platform_fee_amount_kobo', fee_amount_kobo,
        'vendor_net_amount_kobo', vendor_net_kobo,
        'product_variant_id', item_record.product_variant_id::text,
        'variant_size_snapshot', size_snapshot,
        'variant_colour_snapshot', colour_snapshot,
        'variant_options_snapshot', options_snapshot
      )
    );
  end loop;

  if total_kobo <= 0 or total_kobo > 999999999999 then
    raise exception using
      errcode = '22003',
      message = 'Checkout total is outside the supported money range.';
  end if;

  insert into public.orders (
    checkout_attempt_id,
    customer_id,
    customer_name,
    customer_email,
    customer_phone,
    status,
    total_amount,
    total_amount_kobo,
    currency,
    financial_contract_version,
    idempotency_key,
    shipping_address
  ) values (
    p_checkout_attempt_id,
    p_customer_id,
    pg_catalog.btrim(p_customer_name),
    pg_catalog.lower(pg_catalog.btrim(p_customer_email)),
    pg_catalog.btrim(p_customer_phone),
    'pending',
    total_kobo / 100,
    total_kobo::bigint,
    'NGN',
    2,
    'CHECKOUT-' || p_checkout_attempt_id::text,
    p_shipping_address
  )
  returning id into new_order_id;

  insert into public.checkout_attempts (
    checkout_attempt_id,
    order_id,
    request_fingerprint,
    payment_reference,
    payment_authorization_url,
    expires_at
  ) values (
    p_checkout_attempt_id,
    new_order_id,
    p_request_fingerprint,
    null,
    null,
    p_expires_at
  );

  for item_record in
    select item.value
    from pg_catalog.jsonb_array_elements(prepared_items) as item(value)
    order by item.value ->> 'line_identity'
  loop
    if item_record.value ->> 'product_variant_id' is not null then
      insert into marketa_private.trusted_order_item_insert_authorizations (
      transaction_id,
      backend_pid,
      order_id,
      line_identity,
      product_id,
      vendor_id,
      quantity,
      unit_price,
      subtotal,
      unit_amount_kobo,
      gross_amount_kobo,
      platform_fee_bps,
      platform_fee_amount_kobo,
      vendor_net_amount_kobo,
      currency,
      financial_contract_version,
      product_variant_id,
      variant_size_snapshot,
      variant_colour_snapshot,
      variant_options_snapshot
      ) values (
        pg_catalog.txid_current(),
        pg_catalog.pg_backend_pid(),
        new_order_id,
        item_record.value ->> 'line_identity',
        (item_record.value ->> 'product_id')::uuid,
        (item_record.value ->> 'vendor_id')::uuid,
        (item_record.value ->> 'quantity')::integer,
        (item_record.value ->> 'unit_price')::numeric,
        (item_record.value ->> 'subtotal')::numeric,
        (item_record.value ->> 'unit_amount_kobo')::bigint,
        (item_record.value ->> 'gross_amount_kobo')::bigint,
        (item_record.value ->> 'platform_fee_bps')::integer,
        (item_record.value ->> 'platform_fee_amount_kobo')::bigint,
        (item_record.value ->> 'vendor_net_amount_kobo')::bigint,
        'NGN',
        2,
        (item_record.value ->> 'product_variant_id')::uuid,
        item_record.value ->> 'variant_size_snapshot',
        item_record.value ->> 'variant_colour_snapshot',
        case
          when item_record.value -> 'variant_options_snapshot' = 'null'::jsonb
          then null
          else item_record.value -> 'variant_options_snapshot'
        end
      );
    end if;

    insert into public.order_items (
      order_id,
      product_id,
      vendor_id,
      quantity,
      unit_price,
      subtotal,
      unit_amount_kobo,
      gross_amount_kobo,
      platform_fee_bps,
      platform_fee_amount_kobo,
      vendor_net_amount_kobo,
      currency,
      financial_contract_version,
      product_variant_id,
      variant_size_snapshot,
      variant_colour_snapshot,
      variant_options_snapshot
    ) values (
      new_order_id,
      (item_record.value ->> 'product_id')::uuid,
      (item_record.value ->> 'vendor_id')::uuid,
      (item_record.value ->> 'quantity')::integer,
      (item_record.value ->> 'unit_price')::numeric,
      (item_record.value ->> 'subtotal')::numeric,
      (item_record.value ->> 'unit_amount_kobo')::bigint,
      (item_record.value ->> 'gross_amount_kobo')::bigint,
      (item_record.value ->> 'platform_fee_bps')::integer,
      (item_record.value ->> 'platform_fee_amount_kobo')::bigint,
      (item_record.value ->> 'vendor_net_amount_kobo')::bigint,
      'NGN',
      2,
      (item_record.value ->> 'product_variant_id')::uuid,
      item_record.value ->> 'variant_size_snapshot',
      item_record.value ->> 'variant_colour_snapshot',
      case
        when item_record.value -> 'variant_options_snapshot' = 'null'::jsonb
        then null
        else item_record.value -> 'variant_options_snapshot'
      end
    );
  end loop;

  select pg_catalog.count(*)::integer
  into authorization_count
  from marketa_private.trusted_order_item_insert_authorizations
    as auth_row
  where auth_row.transaction_id = pg_catalog.txid_current()
    and auth_row.backend_pid = pg_catalog.pg_backend_pid()
    and auth_row.order_id = new_order_id;

  if authorization_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Trusted order-item authorization was not fully consumed.';
  end if;

  return query select
    'constructed'::text,
    new_order_id,
    total_kobo::bigint,
    normalized_item_count;
end
$function$;

alter function public.construct_trusted_checkout_order(
  uuid, uuid, text, text, text, jsonb, text, timestamptz, jsonb
) owner to postgres;
revoke all privileges on function public.construct_trusted_checkout_order(
  uuid, uuid, text, text, text, jsonb, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.construct_trusted_checkout_order(
  uuid, uuid, text, text, text, jsonb, text, timestamptz, jsonb
) to service_role;

comment on function public.construct_trusted_checkout_order(
  uuid, uuid, text, text, text, jsonb, text, timestamptz, jsonb
) is
  'Service-role checkout construction. The caller must authenticate the customer and apply the canonical handle-checkout shipping normalization and Nigerian-state validation before invocation.';

do $postcondition$
declare
  function_record record;
  function_hash text;
  service_role_execute_count integer;
  service_role_oid oid;
  unexpected_grantee text;
begin
  if pg_catalog.current_setting('marketa.d2.orders_count', true)::bigint
      is distinct from (select pg_catalog.count(*) from public.orders)
    or pg_catalog.current_setting('marketa.d2.order_items_count', true)::bigint
      is distinct from (select pg_catalog.count(*) from public.order_items)
    or pg_catalog.current_setting(
      'marketa.d2.checkout_attempts_count', true
    )::bigint is distinct from (
      select pg_catalog.count(*) from public.checkout_attempts
    )
  then
    raise exception 'D2 postcondition: checkout row counts changed.';
  end if;

  if pg_catalog.current_setting('marketa.d2.orders_hash', true)
      is distinct from coalesce((
        select pg_catalog.md5(pg_catalog.string_agg(
          pg_catalog.md5(pg_catalog.to_jsonb(customer_order)::text),
          '' order by customer_order.id
        ))
        from public.orders as customer_order
      ), pg_catalog.md5(''))
    or pg_catalog.current_setting('marketa.d2.order_items_hash', true)
      is distinct from coalesce((
        select pg_catalog.md5(pg_catalog.string_agg(
          pg_catalog.md5(pg_catalog.to_jsonb(item)::text),
          '' order by item.id
        ))
        from public.order_items as item
      ), pg_catalog.md5(''))
  then
    raise exception 'D2 postcondition: existing checkout data changed.';
  end if;

  select
    procedure.prosecdef,
    procedure.provolatile,
    procedure.proowner as owner_oid,
    procedure.proowner::pg_catalog.regrole::text as owner_name,
    procedure.proconfig,
    procedure.proacl
  into function_record
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)'::pg_catalog.regprocedure;

  select role.oid
  into service_role_oid
  from pg_catalog.pg_roles as role
  where role.rolname = 'service_role';

  if service_role_oid is null then
    raise exception 'D2 postcondition: service_role is missing.';
  end if;

  if function_record.owner_name is distinct from 'postgres'
    or function_record.prosecdef is distinct from true
    or function_record.provolatile is distinct from 'v'
    or function_record.proconfig is distinct from array['search_path=""']::text[]
    or function_record.proacl is null
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'public',
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)',
      'EXECUTE'
    )
  then
    raise exception 'D2 postcondition: trusted construction RPC authority is incorrect.';
  end if;

  select pg_catalog.count(*)::integer
  into service_role_execute_count
  from pg_catalog.aclexplode(function_record.proacl) as acl
  where acl.grantee = service_role_oid
    and acl.grantor = function_record.owner_oid
    and acl.privilege_type = 'EXECUTE'
    and not acl.is_grantable;

  if service_role_execute_count <> 1 or exists (
    select 1
    from pg_catalog.aclexplode(function_record.proacl) as acl
    where acl.grantee = service_role_oid
      and (
        acl.grantor is distinct from function_record.owner_oid
        or acl.privilege_type is distinct from 'EXECUTE'
        or acl.is_grantable
      )
  ) then
    raise exception 'D2 postcondition: service_role EXECUTE ACL is incorrect.';
  end if;

  select case
    when acl.grantee = 0 then 'PUBLIC'
    else coalesce(role.rolname, 'oid:' || acl.grantee::text)
  end
  into unexpected_grantee
  from pg_catalog.aclexplode(function_record.proacl) as acl
  left join pg_catalog.pg_roles as role on role.oid = acl.grantee
  where acl.privilege_type = 'EXECUTE'
    and acl.grantee <> function_record.owner_oid
    and acl.grantee <> service_role_oid
  limit 1;

  if unexpected_grantee is not null then
    raise exception 'D2 postcondition: unexpected construction RPC grantee %.',
      unexpected_grantee;
  end if;

  select
    procedure.prosecdef,
    procedure.proowner::pg_catalog.regrole::text as owner_name,
    procedure.proconfig,
    procedure.proacl
  into function_record
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure;

  if function_record.owner_name is distinct from 'postgres'
    or function_record.prosecdef is distinct from true
    or function_record.proconfig is distinct from array['search_path=""']::text[]
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.guard_foundation_order_item_variant()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.guard_foundation_order_item_variant()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.guard_foundation_order_item_variant()',
      'EXECUTE'
    )
  then
    raise exception 'D2 postcondition: purchase guard authority is incorrect.';
  end if;

  if pg_catalog.has_schema_privilege(
      'service_role', 'marketa_private', 'USAGE'
    )
    or pg_catalog.has_schema_privilege(
      'anon', 'marketa_private', 'USAGE'
    )
    or pg_catalog.has_schema_privilege(
      'authenticated', 'marketa_private', 'USAGE'
    )
    or pg_catalog.has_table_privilege(
      'service_role',
      'marketa_private.trusted_order_item_insert_authorizations',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon',
      'marketa_private.trusted_order_item_insert_authorizations',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'marketa_private.trusted_order_item_insert_authorizations',
      'SELECT,INSERT,UPDATE,DELETE'
    )
  then
    raise exception 'D2 postcondition: private authorization authority leaked.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'marketa_private'
      and relation.relname = 'trusted_order_item_insert_authorizations'
      and relation.relrowsecurity
      and relation.relowner::pg_catalog.regrole::text = 'postgres'
  ) or exists (
    select 1
    from marketa_private.trusted_order_item_insert_authorizations
  ) then
    raise exception 'D2 postcondition: private authorization table is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
      and trigger_record.tgname = 'order_items_foundation_variant_guard'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid =
        'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
  ) then
    raise exception 'D2 postcondition: order-item purchase guard trigger changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure;

  if function_hash is distinct from 'c34ac95900ffa3c7bd2072256a56f203' then
    raise exception 'D2 postcondition: C2 validator changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure;

  if function_hash is distinct from '74a760039e13ce5ff09e3b9ef76d7c21' then
    raise exception 'D2 postcondition: C3 finalizer changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_draft_publication_check'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_draft_only_check'
      and constraint_record.convalidated
  ) then
    raise exception 'D2 postcondition: draft-only constraints changed.';
  end if;
end
$postcondition$;

commit;
