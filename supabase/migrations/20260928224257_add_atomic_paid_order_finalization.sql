-- Ops 2B1: additive atomic paid-order finalization database foundation.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  required_table text;
  unexpected_columns text[];
  decrement_stock_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
begin
  foreach required_table in array array[
    'public.orders',
    'public.order_items',
    'public.checkout_attempts',
    'public.events_ledger',
    'public.payout_ledger',
    'public.vendors',
    'public.products',
    'storage.objects',
    'storage.buckets'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = pg_catalog.to_regclass(required_table)
        and class.relkind in ('r', 'p')
    ) then
      raise exception 'Ops 2B1: required table % is missing or has the wrong relation type.', required_table;
    end if;
  end loop;

  if pg_catalog.to_regclass('public.payments') is not null
    or pg_catalog.to_regclass('public.payment_events') is not null
  then
    raise exception 'Ops 2B1: atomic payment tables are unexpectedly occupied.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'finalize_paystack_paid_order'
  ) then
    raise exception 'Ops 2B1: finalize_paystack_paid_order is unexpectedly occupied.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into unexpected_columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.orders'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if unexpected_columns is distinct from array[
    'id', 'customer_id', 'customer_email', 'customer_phone', 'status',
    'total_amount', 'payment_ref', 'idempotency_key', 'shipping_address',
    'created_at', 'updated_at', 'checkout_attempt_id', 'customer_name'
  ]::text[] then
    raise exception 'Ops 2B1: public.orders columns no longer match the audited baseline.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into unexpected_columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if unexpected_columns is distinct from array[
    'id', 'order_id', 'product_id', 'vendor_id', 'quantity',
    'unit_price', 'subtotal', 'created_at'
  ]::text[] then
    raise exception 'Ops 2B1: public.order_items columns no longer match the audited baseline.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into unexpected_columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.events_ledger'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if unexpected_columns is distinct from array[
    'id', 'event_id', 'event_type', 'provider', 'payload_hash', 'processed_at'
  ]::text[] then
    raise exception 'Ops 2B1: public.events_ledger columns no longer match the audited baseline.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into unexpected_columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.payout_ledger'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if unexpected_columns is distinct from array[
    'id', 'vendor_id', 'order_id', 'amount', 'type', 'reference',
    'description', 'created_at'
  ]::text[] then
    raise exception 'Ops 2B1: public.payout_ledger columns no longer match the audited baseline.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.orders'::pg_catalog.regclass
      and attribute.attname = 'total_amount'
      and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'numeric(12,2)'
      and attribute.attnotnull
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
      and attribute.attname in ('unit_price', 'subtotal')
      and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'numeric(12,2)'
      and attribute.attnotnull
    group by attribute.attrelid
    having pg_catalog.count(*) = 2
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.payout_ledger'::pg_catalog.regclass
      and attribute.attname = 'amount'
      and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'numeric(12,2)'
      and attribute.attnotnull
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'platform_fee_pct'
      and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'numeric(5,2)'
      and not attribute.attnotnull
  ) then
    raise exception 'Ops 2B1: audited monetary column types or nullability changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.conname = 'orders_payment_ref_key'
      and constraint_record.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) = 'UNIQUE (payment_ref)'
  ) then
    raise exception 'Ops 2B1: orders.payment_ref is no longer uniquely constrained.';
  end if;

  if exists (
    select 1
    from public.orders as customer_order
    where customer_order.payment_ref is not null
    group by customer_order.payment_ref
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Ops 2B1: duplicate order payment references require reconciliation.';
  end if;

  if exists (
    select 1
    from public.payout_ledger as ledger
    where ledger.type = 'credit'
      and ledger.order_id is not null
    group by ledger.order_id, ledger.vendor_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Ops 2B1: duplicate historical order/vendor sale-credit groups require reconciliation.';
  end if;

  if exists (
    select 1
    from public.orders as customer_order
    where customer_order.status = 'confirmed'
      and not exists (
        select 1
        from public.payout_ledger as ledger
        where ledger.order_id = customer_order.id
          and ledger.type = 'credit'
      )
  ) then
    raise exception 'Ops 2B1: a confirmed historical order lacks a sale credit.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'service_role'
      and role.rolbypassrls
  ) or not pg_catalog.has_table_privilege('service_role', 'public.orders', 'SELECT,UPDATE')
    or not pg_catalog.has_table_privilege('service_role', 'public.order_items', 'SELECT,UPDATE')
    or not pg_catalog.has_table_privilege('service_role', 'public.payout_ledger', 'SELECT,INSERT')
    or not pg_catalog.has_table_privilege('service_role', 'public.vendors', 'SELECT')
  then
    raise exception 'Ops 2B1: service_role lacks required SECURITY INVOKER authority.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.orders'::pg_catalog.regclass
      and class.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.order_items'::pg_catalog.regclass
      and class.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.events_ledger'::pg_catalog.regclass
      and class.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.payout_ledger'::pg_catalog.regclass
      and class.relrowsecurity
  ) then
    raise exception 'Ops 2B1: relevant financial RLS baseline changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'payout_ledger'
      and policy.policyname = 'vendor_select_ledger'
      and policy.cmd = 'SELECT'
  ) then
    raise exception 'Ops 2B1: vendor payout-ledger SELECT behavior is missing.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid in (
      'public.events_ledger'::pg_catalog.regclass,
      'public.payout_ledger'::pg_catalog.regclass
    )
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attacl is not null
  ) then
    raise exception 'Ops 2B1: legacy financial ledgers have unexpected explicit column grants.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.products'::pg_catalog.regclass
      and class.relrowsecurity
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) <> 5 then
    raise exception 'Ops 2B1: Batch 4A product boundary changed.';
  end if;

  if not exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'product-images'
      and bucket.public
      and bucket.file_size_limit = 5242880
      and bucket.allowed_mime_types is not distinct from array[
        'image/jpeg', 'image/png', 'image/webp'
      ]::text[]
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
  ) <> 2 then
    raise exception 'Ops 2B1: Batch 4B1 Storage boundary changed.';
  end if;

  if decrement_stock_oid is not null then
    if not exists (
        select 1
        from pg_catalog.pg_proc as procedure
        where procedure.oid = decrement_stock_oid
          and procedure.proowner = 'postgres'::pg_catalog.regrole
          and not procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.proconfig is not distinct from array['search_path=""']::text[]
      )
      or pg_catalog.has_function_privilege(
        'anon', 'public.decrement_stock(uuid,integer)', 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated', 'public.decrement_stock(uuid,integer)', 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', decrement_stock_oid, 'EXECUTE'
      )
    then
      raise exception 'Ops 2B1: Ops 1A decrement_stock containment changed.';
    end if;
  end if;
end
$preflight$;

lock table public.orders in share mode;
lock table public.order_items in share mode;
lock table public.events_ledger in share mode;
lock table public.payout_ledger in share mode;
lock table public.products in share mode;

do $snapshot$
begin
  perform pg_catalog.set_config('marketa_ops2b1.orders_count', (
    select pg_catalog.count(*)::text from public.orders
  ), true);
  perform pg_catalog.set_config('marketa_ops2b1.orders_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.jsonb_build_array(
        customer_order.id, customer_order.customer_id,
        customer_order.customer_email, customer_order.customer_phone,
        customer_order.status, customer_order.total_amount,
        customer_order.payment_ref, customer_order.idempotency_key,
        customer_order.shipping_address, customer_order.created_at,
        customer_order.updated_at, customer_order.checkout_attempt_id,
        customer_order.customer_name
      )::text, E'\n' order by customer_order.id
    ), '')) from public.orders as customer_order
  ), true);

  perform pg_catalog.set_config('marketa_ops2b1.order_items_count', (
    select pg_catalog.count(*)::text from public.order_items
  ), true);
  perform pg_catalog.set_config('marketa_ops2b1.order_items_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.jsonb_build_array(
        item.id, item.order_id, item.product_id, item.vendor_id,
        item.quantity, item.unit_price, item.subtotal, item.created_at
      )::text, E'\n' order by item.id
    ), '')) from public.order_items as item
  ), true);

  perform pg_catalog.set_config('marketa_ops2b1.events_count', (
    select pg_catalog.count(*)::text from public.events_ledger
  ), true);
  perform pg_catalog.set_config('marketa_ops2b1.events_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.jsonb_build_array(
        event.id, event.event_id, event.event_type, event.provider,
        event.payload_hash, event.processed_at
      )::text, E'\n' order by event.id
    ), '')) from public.events_ledger as event
  ), true);

  perform pg_catalog.set_config('marketa_ops2b1.payout_count', (
    select pg_catalog.count(*)::text from public.payout_ledger
  ), true);
  perform pg_catalog.set_config('marketa_ops2b1.payout_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.jsonb_build_array(
        ledger.id, ledger.vendor_id, ledger.order_id, ledger.amount,
        ledger.type, ledger.reference, ledger.description, ledger.created_at
      )::text, E'\n' order by ledger.id
    ), '')) from public.payout_ledger as ledger
  ), true);

  perform pg_catalog.set_config('marketa_ops2b1.product_count', (
    select pg_catalog.count(*)::text from public.products
  ), true);
  perform pg_catalog.set_config('marketa_ops2b1.product_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(product)::text, E'\n' order by product.id
    ), '')) from public.products as product
  ), true);

  perform pg_catalog.set_config('marketa_ops2b1.products_security', (
    select pg_catalog.jsonb_build_object(
      'rls', class.relrowsecurity,
      'force_rls', class.relforcerowsecurity,
      'policies', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(policy) order by policy.policyname)
        from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public' and policy.tablename = 'products'
      ), '[]'::pg_catalog.jsonb),
      'product_is_active', (
        select pg_catalog.jsonb_build_object(
          'not_null', attribute.attnotnull,
          'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
        )
        from pg_catalog.pg_attribute as attribute
        left join pg_catalog.pg_attrdef as default_value
          on default_value.adrelid = attribute.attrelid
          and default_value.adnum = attribute.attnum
        where attribute.attrelid = 'public.products'::pg_catalog.regclass
          and attribute.attname = 'is_active'
      ),
      'vendor_is_active', (
        select pg_catalog.jsonb_build_object(
          'not_null', attribute.attnotnull,
          'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
          'authenticated_update', pg_catalog.has_column_privilege(
            'authenticated', 'public.vendors', 'is_active', 'UPDATE'
          )
        )
        from pg_catalog.pg_attribute as attribute
        left join pg_catalog.pg_attrdef as default_value
          on default_value.adrelid = attribute.attrelid
          and default_value.adnum = attribute.attnum
        where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
          and attribute.attname = 'is_active'
      ),
      'vendor_active_helper', (
        select pg_catalog.jsonb_build_object(
          'definition', pg_catalog.pg_get_functiondef(procedure.oid),
          'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
          'acl', procedure.proacl, 'config', procedure.proconfig,
          'security_definer', procedure.prosecdef,
          'volatility', procedure.provolatile
        )
        from pg_catalog.pg_proc as procedure
        where procedure.oid = pg_catalog.to_regprocedure('public.is_vendor_active(uuid)')
      )
    )::text
    from pg_catalog.pg_class as class
    where class.oid = 'public.products'::pg_catalog.regclass
  ), true);

  perform pg_catalog.set_config('marketa_ops2b1.storage_security', (
    select pg_catalog.jsonb_build_object(
      'rls', class.relrowsecurity,
      'force_rls', class.relforcerowsecurity,
      'policies', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(policy) order by policy.policyname)
        from pg_catalog.pg_policies as policy
        where policy.schemaname = 'storage' and policy.tablename = 'objects'
      ), '[]'::pg_catalog.jsonb),
      'bucket', (
        select pg_catalog.to_jsonb(bucket)
        from storage.buckets as bucket where bucket.id = 'product-images'
      ),
      'foldername', (
        select pg_catalog.pg_get_functiondef(procedure.oid)
        from pg_catalog.pg_proc as procedure
        where procedure.oid = pg_catalog.to_regprocedure('storage.foldername(text)')
      )
    )::text
    from pg_catalog.pg_class as class
    where class.oid = 'storage.objects'::pg_catalog.regclass
  ), true);
end
$snapshot$;

alter table public.orders
  add column total_amount_kobo bigint,
  add column currency text,
  add column financial_contract_version smallint,
  add column payment_finalized_at timestamptz,
  add constraint orders_financial_snapshot_bundle_check check (
    (
      financial_contract_version is null
      and total_amount_kobo is null
      and currency is null
      and payment_finalized_at is null
    ) or (
      financial_contract_version is not null
      and financial_contract_version in (1, 2)
      and total_amount_kobo is not null
      and total_amount_kobo > 0
      and currency = 'NGN'
      and total_amount * 100 = total_amount_kobo::numeric
      and (
        payment_finalized_at is null
        or status in ('confirmed', 'fulfilled')
      )
    )
  ),
  add constraint orders_versioned_finalization_check check (
    financial_contract_version is null
    or status not in ('confirmed', 'fulfilled')
    or payment_finalized_at is not null
  );

alter table public.order_items
  add column unit_amount_kobo bigint,
  add column gross_amount_kobo bigint,
  add column platform_fee_bps integer,
  add column platform_fee_amount_kobo bigint,
  add column vendor_net_amount_kobo bigint,
  add column currency text,
  add column financial_contract_version smallint,
  add constraint order_items_financial_snapshot_bundle_check check (
    (
      financial_contract_version is null
      and unit_amount_kobo is null
      and gross_amount_kobo is null
      and platform_fee_bps is null
      and platform_fee_amount_kobo is null
      and vendor_net_amount_kobo is null
      and currency is null
    ) or (
      financial_contract_version is not null
      and financial_contract_version in (1, 2)
      and unit_amount_kobo is not null
      and unit_amount_kobo > 0
      and gross_amount_kobo is not null
      and gross_amount_kobo > 0
      and platform_fee_bps is not null
      and platform_fee_bps between 0 and 10000
      and platform_fee_amount_kobo is not null
      and platform_fee_amount_kobo >= 0
      and vendor_net_amount_kobo is not null
      and vendor_net_amount_kobo >= 0
      and currency = 'NGN'
      and gross_amount_kobo = unit_amount_kobo * quantity::bigint
      and gross_amount_kobo = platform_fee_amount_kobo + vendor_net_amount_kobo
      and unit_price * 100 = unit_amount_kobo::numeric
      and subtotal * 100 = gross_amount_kobo::numeric
    )
  );

alter table public.payout_ledger
  add column source_kind text,
  add column idempotency_key text,
  add column gross_amount_kobo bigint,
  add column platform_fee_amount_kobo bigint,
  add column net_amount_kobo bigint,
  add column currency text,
  add column financial_contract_version smallint,
  add constraint payout_ledger_sale_evidence_check check (
    (
      source_kind is null
      and idempotency_key is null
      and gross_amount_kobo is null
      and platform_fee_amount_kobo is null
      and net_amount_kobo is null
      and currency is null
      and financial_contract_version is null
    ) or (
      source_kind is not null
      and source_kind = 'sale'
      and type = 'credit'
      and order_id is not null
      and vendor_id is not null
      and idempotency_key is not null
      and idempotency_key ~ '^sale:[0-9a-f-]{36}:[0-9a-f-]{36}$'
      and gross_amount_kobo is not null
      and gross_amount_kobo > 0
      and platform_fee_amount_kobo is not null
      and platform_fee_amount_kobo >= 0
      and net_amount_kobo is not null
      and net_amount_kobo >= 0
      and gross_amount_kobo = platform_fee_amount_kobo + net_amount_kobo
      and amount * 100 = net_amount_kobo::numeric
      and currency = 'NGN'
      and financial_contract_version is not null
      and financial_contract_version in (1, 2)
    )
  );

create unique index payout_ledger_idempotency_key_key
  on public.payout_ledger (idempotency_key)
  where idempotency_key is not null;

create unique index payout_ledger_sale_order_vendor_key
  on public.payout_ledger (order_id, vendor_id)
  where source_kind = 'sale';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null,
  transaction_id text not null,
  reference text not null,
  order_id uuid,
  status text not null,
  amount_kobo bigint not null,
  currency text not null,
  paid_at timestamptz,
  financial_contract_version smallint,
  finalization_state text not null default 'processing',
  outcome_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  finalized_at timestamptz,
  constraint payments_provider_check check (provider = 'paystack'),
  constraint payments_environment_check check (environment in ('test', 'live')),
  constraint payments_transaction_id_check check (
    transaction_id ~ '^[1-9][0-9]{0,19}$'
  ),
  constraint payments_reference_check check (
    reference ~ '^[A-Za-z0-9._=-]{1,100}$'
  ),
  constraint payments_status_check check (status = 'success'),
  constraint payments_amount_check check (amount_kobo > 0),
  constraint payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint payments_contract_version_check check (
    financial_contract_version is null
    or financial_contract_version in (1, 2)
  ),
  constraint payments_finalization_state_check check (
    finalization_state in (
      'processing', 'completed', 'terminal_rejected',
      'retryable_failure', 'reconciliation_required'
    )
  ),
  constraint payments_outcome_code_check check (
    outcome_code is null or outcome_code in (
      'FINALIZED', 'ALREADY_FINALIZED', 'ORDER_NOT_FOUND_RETRYABLE',
      'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH',
      'PAYMENT_IDENTITY_CONFLICT', 'CREDIT_CONFLICT',
      'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
      'RECONCILIATION_REQUIRED', 'RETRYABLE_FAILURE'
    )
  ),
  constraint payments_completion_check check (
    (
      finalization_state = 'processing'
      and finalized_at is null
      and financial_contract_version is null
      and outcome_code is null
    ) or (
      finalization_state = 'completed'
      and finalized_at is not null
      and order_id is not null
      and financial_contract_version is not null
      and financial_contract_version in (1, 2)
      and outcome_code is not null
      and outcome_code in ('FINALIZED', 'ALREADY_FINALIZED')
    ) or (
      finalization_state = 'terminal_rejected'
      and finalized_at is null
      and financial_contract_version is null
      and outcome_code is not null
      and outcome_code in ('AMOUNT_MISMATCH', 'CURRENCY_MISMATCH')
    ) or (
      finalization_state = 'retryable_failure'
      and finalized_at is null
      and financial_contract_version is null
      and outcome_code is not null
      and outcome_code in ('ORDER_NOT_FOUND_RETRYABLE', 'RETRYABLE_FAILURE')
    ) or (
      finalization_state = 'reconciliation_required'
      and finalized_at is null
      and financial_contract_version is null
      and outcome_code is not null
      and outcome_code in (
        'PAYMENT_IDENTITY_CONFLICT', 'CREDIT_CONFLICT',
        'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
        'RECONCILIATION_REQUIRED'
      )
    )
  ),
  constraint payments_timestamps_check check (updated_at >= created_at),
  constraint payments_order_id_fkey foreign key (order_id)
    references public.orders (id) on delete restrict,
  constraint payments_provider_environment_transaction_key
    unique (provider, environment, transaction_id),
  constraint payments_provider_environment_reference_key
    unique (provider, environment, reference),
  constraint payments_order_id_key unique (order_id)
);

comment on table public.payments is
  'Authoritative service-role-only provider payment identity for atomic order finalization.';

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null,
  event_type text not null,
  payload_sha256 text not null,
  transaction_id text,
  reference text,
  processing_state text not null default 'received',
  attempt_count integer not null default 1,
  first_received_at timestamptz not null default pg_catalog.now(),
  last_attempted_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  outcome_code text,
  diagnostic_code text,
  payment_id uuid,
  constraint payment_events_provider_check check (provider = 'paystack'),
  constraint payment_events_environment_check check (environment in ('test', 'live')),
  constraint payment_events_event_type_check check (
    char_length(event_type) between 1 and 100
  ),
  constraint payment_events_payload_sha256_check check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_events_transaction_id_check check (
    transaction_id is null or transaction_id ~ '^[1-9][0-9]{0,19}$'
  ),
  constraint payment_events_reference_check check (
    reference is null or reference ~ '^[A-Za-z0-9._=-]{1,100}$'
  ),
  constraint payment_events_processing_state_check check (
    processing_state in (
      'received', 'processing', 'completed', 'terminal_rejected',
      'retryable_failure', 'reconciliation_required'
    )
  ),
  constraint payment_events_attempt_count_check check (attempt_count > 0),
  constraint payment_events_outcome_code_check check (
    outcome_code is null or outcome_code in (
      'FINALIZED', 'ALREADY_FINALIZED', 'EVENT_ALREADY_COMPLETED',
      'LEGACY_ALREADY_FINALIZED', 'ORDER_NOT_FOUND_RETRYABLE',
      'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH',
      'INVALID_PROVIDER_PAYLOAD', 'PAYMENT_IDENTITY_CONFLICT',
      'CREDIT_CONFLICT', 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
      'RECONCILIATION_REQUIRED', 'RETRYABLE_FAILURE'
    )
  ),
  constraint payment_events_diagnostic_code_check check (
    diagnostic_code is null or diagnostic_code ~ '^[A-Z0-9_]{1,100}$'
  ),
  constraint payment_events_completion_check check (
    (
      processing_state in ('completed', 'terminal_rejected', 'reconciliation_required')
      and completed_at is not null
      and outcome_code is not null
    ) or (
      processing_state in ('received', 'processing', 'retryable_failure')
      and completed_at is null
    )
  ),
  constraint payment_events_timestamps_check check (
    last_attempted_at >= first_received_at
    and (completed_at is null or completed_at >= first_received_at)
  ),
  constraint payment_events_payment_id_fkey foreign key (payment_id)
    references public.payments (id) on delete restrict,
  constraint payment_events_provider_environment_payload_key
    unique (provider, environment, payload_sha256)
);

comment on table public.payment_events is
  'Service-role-only signed webhook delivery evidence. Stores no raw payload or customer PII.';

alter table public.payments owner to postgres;
alter table public.payment_events owner to postgres;

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

revoke all privileges on table public.payments
  from public, anon, authenticated, service_role;
revoke all privileges on table public.payment_events
  from public, anon, authenticated, service_role;
grant all privileges on table public.payments to service_role;
grant all privileges on table public.payment_events to service_role;

revoke all privileges on table public.events_ledger
  from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.payout_ledger
  from public, anon, authenticated;
revoke select on table public.payout_ledger from public, anon;
grant select on table public.payout_ledger to authenticated;

create function public.finalize_paystack_paid_order(
  p_payload_sha256 text,
  p_event_type text,
  p_environment text,
  p_transaction_id text,
  p_reference text,
  p_status text,
  p_amount_kobo bigint,
  p_currency text,
  p_paid_at timestamptz
)
returns table (
  outcome text,
  order_id uuid,
  retryable boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_event public.payment_events%rowtype;
  v_payment public.payments%rowtype;
  v_transaction_payment public.payments%rowtype;
  v_reference_payment public.payments%rowtype;
  v_safe_transaction_id text;
  v_safe_reference text;
  v_order public.orders%rowtype;
  v_payment_was_inserted boolean := false;
  v_transaction_payment_found boolean := false;
  v_reference_payment_found boolean := false;
  v_existing_order_payment_id uuid;
  v_event_order_id uuid;
  v_contract_version smallint;
  v_item_count bigint;
  v_item_total numeric;
  v_item_total_kobo bigint;
  v_items_valid boolean;
  v_vendor_count bigint;
  v_valid_vendor_count bigint;
  v_updated_rows integer;
  v_credit record;
begin
  if p_payload_sha256 is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_event_type is distinct from 'charge.success'
    or p_environment is null
    or p_environment not in ('test', 'live')
  then
    return query
    select 'INVALID_PROVIDER_PAYLOAD'::text, null::uuid, true;
    return;
  end if;

  v_safe_transaction_id := case
    when p_transaction_id ~ '^[1-9][0-9]{0,19}$' then p_transaction_id
    else null
  end;
  v_safe_reference := case
    when p_reference ~ '^[A-Za-z0-9._=-]{1,100}$' then p_reference
    else null
  end;

  insert into public.payment_events as existing_event (
    provider,
    environment,
    event_type,
    payload_sha256,
    transaction_id,
    reference,
    processing_state,
    attempt_count,
    first_received_at,
    last_attempted_at
  ) values (
    'paystack',
    p_environment,
    p_event_type,
    p_payload_sha256,
    v_safe_transaction_id,
    v_safe_reference,
    'received',
    1,
    v_now,
    v_now
  )
  on conflict (provider, environment, payload_sha256)
  do update set
    attempt_count = existing_event.attempt_count + 1,
    last_attempted_at = excluded.last_attempted_at
  returning * into v_event;

  if v_event.event_type is distinct from p_event_type
    or v_event.transaction_id is distinct from v_safe_transaction_id
    or v_event.reference is distinct from v_safe_reference
  then
    update public.payment_events as event
    set processing_state = 'reconciliation_required',
        completed_at = v_now,
        outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
        diagnostic_code = 'DELIVERY_IDENTITY_MISMATCH'
    where event.id = v_event.id;

    return query
    select 'PAYMENT_IDENTITY_CONFLICT'::text, null::uuid, false;
    return;
  end if;

  if v_event.processing_state = 'completed' then
    select payment.order_id
    into v_event_order_id
    from public.payments as payment
    where payment.id = v_event.payment_id;

    return query
    select 'EVENT_ALREADY_COMPLETED'::text, v_event_order_id, false;
    return;
  end if;

  if v_event.processing_state in ('terminal_rejected', 'reconciliation_required') then
    select payment.order_id
    into v_event_order_id
    from public.payments as payment
    where payment.id = v_event.payment_id;

    return query
    select v_event.outcome_code, v_event_order_id, false;
    return;
  end if;

  if p_transaction_id is null
    or p_transaction_id !~ '^[1-9][0-9]{0,19}$'
    or p_reference is null
    or p_reference !~ '^[A-Za-z0-9._=-]{1,100}$'
    or p_status is distinct from 'success'
    or p_amount_kobo is null
    or p_amount_kobo <= 0
    or p_currency is null
    or p_currency !~ '^[A-Z]{3}$'
  then
    update public.payment_events as event
    set processing_state = 'terminal_rejected',
        completed_at = v_now,
        outcome_code = 'INVALID_PROVIDER_PAYLOAD',
        diagnostic_code = 'INVALID_PAYMENT_FACTS'
    where event.id = v_event.id;

    return query
    select 'INVALID_PROVIDER_PAYLOAD'::text, null::uuid, false;
    return;
  end if;

  update public.payment_events as event
  set processing_state = 'processing',
      last_attempted_at = v_now,
      completed_at = null,
      outcome_code = null,
      diagnostic_code = null
  where event.id = v_event.id;

  begin
    insert into public.payments (
      provider,
      environment,
      transaction_id,
      reference,
      status,
      amount_kobo,
      currency,
      paid_at,
      finalization_state,
      created_at,
      updated_at
    ) values (
      'paystack',
      p_environment,
      p_transaction_id,
      p_reference,
      p_status,
      p_amount_kobo,
      p_currency,
      p_paid_at,
      'processing',
      v_now,
      v_now
    )
    on conflict do nothing
    returning id into v_existing_order_payment_id;

    v_payment_was_inserted := found;

    select payment.*
    into v_transaction_payment
    from public.payments as payment
    where payment.provider = 'paystack'
      and payment.environment = p_environment
      and payment.transaction_id = p_transaction_id
    for update;
    v_transaction_payment_found := found;

    select payment.*
    into v_reference_payment
    from public.payments as payment
    where payment.provider = 'paystack'
      and payment.environment = p_environment
      and payment.reference = p_reference
    for update;
    v_reference_payment_found := found;

    if not v_transaction_payment_found and not v_reference_payment_found then
      raise exception 'Ops 2B1 internal payment identity establishment failed.';
    end if;

    if v_transaction_payment_found
      and v_reference_payment_found
      and v_transaction_payment.id <> v_reference_payment.id
    then
      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          diagnostic_code = 'TRANSACTION_REFERENCE_SPLIT'
      where event.id = v_event.id;

      return query
      select 'PAYMENT_IDENTITY_CONFLICT'::text, null::uuid, false;
      return;
    end if;

    if v_transaction_payment_found then
      v_payment := v_transaction_payment;
    else
      v_payment := v_reference_payment;
    end if;

    if v_payment.transaction_id is distinct from p_transaction_id
      or v_payment.reference is distinct from p_reference
      or v_payment.status is distinct from p_status
      or v_payment.amount_kobo is distinct from p_amount_kobo
      or v_payment.currency is distinct from p_currency
      or v_payment.paid_at is distinct from p_paid_at
    then
      if v_payment.finalization_state <> 'completed' then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
            updated_at = v_now
        where payment.id = v_payment.id;
      end if;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          diagnostic_code = 'PAYMENT_FACT_MISMATCH',
          payment_id = v_payment.id
      where event.id = v_event.id;

      return query
      select 'PAYMENT_IDENTITY_CONFLICT'::text, v_payment.order_id, false;
      return;
    end if;

    update public.payment_events as event
    set payment_id = v_payment.id
    where event.id = v_event.id;

    if v_payment.finalization_state = 'completed' then
      select customer_order.*
      into v_order
      from public.orders as customer_order
      where customer_order.id = v_payment.order_id
      for update;

      if found
        and v_order.payment_ref = p_reference
        and v_order.status in ('confirmed', 'fulfilled')
        and v_order.payment_finalized_at is not null
      then
        update public.payment_events as event
        set processing_state = 'completed',
            completed_at = v_now,
            outcome_code = 'ALREADY_FINALIZED',
            diagnostic_code = null
        where event.id = v_event.id;

        return query
        select 'ALREADY_FINALIZED'::text, v_order.id, false;
        return;
      end if;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'COMPLETED_PAYMENT_STATE_MISMATCH'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_payment.order_id, false;
      return;
    end if;

    if v_payment.finalization_state in ('terminal_rejected', 'reconciliation_required') then
      update public.payment_events as event
      set processing_state = v_payment.finalization_state,
          completed_at = v_now,
          outcome_code = v_payment.outcome_code,
          diagnostic_code = 'PAYMENT_STATE_ALREADY_CLOSED'
      where event.id = v_event.id;

      return query
      select v_payment.outcome_code, v_payment.order_id, false;
      return;
    end if;

    update public.payments as payment
    set finalization_state = 'processing',
        outcome_code = null,
        updated_at = v_now
    where payment.id = v_payment.id;

    if p_currency <> 'NGN' then
      update public.payments as payment
      set finalization_state = 'terminal_rejected',
          outcome_code = 'CURRENCY_MISMATCH',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'terminal_rejected',
          completed_at = v_now,
          outcome_code = 'CURRENCY_MISMATCH',
          diagnostic_code = 'UNSUPPORTED_PAYMENT_CURRENCY'
      where event.id = v_event.id;

      return query
      select 'CURRENCY_MISMATCH'::text, null::uuid, false;
      return;
    end if;

    select customer_order.*
    into v_order
    from public.orders as customer_order
    where customer_order.payment_ref = p_reference
    for update;

    if not found then
      update public.payments as payment
      set finalization_state = 'retryable_failure',
          outcome_code = 'ORDER_NOT_FOUND_RETRYABLE',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'retryable_failure',
          completed_at = null,
          outcome_code = 'ORDER_NOT_FOUND_RETRYABLE',
          diagnostic_code = 'ORDER_REFERENCE_NOT_YET_VISIBLE'
      where event.id = v_event.id;

      return query
      select 'ORDER_NOT_FOUND_RETRYABLE'::text, null::uuid, true;
      return;
    end if;

    select payment.id
    into v_existing_order_payment_id
    from public.payments as payment
    where payment.order_id = v_order.id
      and payment.id <> v_payment.id
    for update;

    if found then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          diagnostic_code = 'ORDER_HAS_DIFFERENT_PAYMENT'
      where event.id = v_event.id;

      return query
      select 'PAYMENT_IDENTITY_CONFLICT'::text, v_order.id, false;
      return;
    end if;

    update public.payments as payment
    set order_id = v_order.id,
        updated_at = v_now
    where payment.id = v_payment.id;

    if v_order.status = 'cancelled' then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'PAID_CANCELLED_ORDER'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if v_order.status in ('confirmed', 'fulfilled') then
      if v_order.financial_contract_version is null
        and v_payment_was_inserted
      then
        update public.payment_events as event
        set payment_id = null
        where event.id = v_event.id;

        delete from public.payments as payment
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'completed',
            completed_at = v_now,
            outcome_code = 'LEGACY_ALREADY_FINALIZED',
            diagnostic_code = null
        where event.id = v_event.id;

        return query
        select 'LEGACY_ALREADY_FINALIZED'::text, v_order.id, false;
        return;
      end if;

      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'UNPROVEN_EXISTING_FINALIZATION'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if v_order.status <> 'pending' then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'UNKNOWN_ORDER_STATE'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if exists (
      select 1
      from public.payout_ledger as ledger
      where ledger.order_id = v_order.id
        and ledger.type = 'credit'
    ) then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'CREDIT_CONFLICT',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'CREDIT_CONFLICT',
          diagnostic_code = 'PENDING_ORDER_HAS_CREDIT'
      where event.id = v_event.id;

      return query
      select 'CREDIT_CONFLICT'::text, v_order.id, false;
      return;
    end if;

    if v_order.financial_contract_version = 2 then
      if v_order.currency is distinct from 'NGN'
        or v_order.total_amount_kobo is null
        or v_order.total_amount_kobo <= 0
        or v_order.total_amount * 100 <> v_order.total_amount_kobo::numeric
      then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'RECONCILIATION_REQUIRED',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'RECONCILIATION_REQUIRED',
            diagnostic_code = 'INVALID_V2_ORDER_SNAPSHOT'
        where event.id = v_event.id;

        return query
        select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
        return;
      end if;

      select
        pg_catalog.count(*),
        coalesce(pg_catalog.sum(item.gross_amount_kobo), 0)::bigint,
        coalesce(pg_catalog.bool_and(
          item.financial_contract_version = 2
          and item.currency = 'NGN'
          and item.vendor_id is not null
          and item.unit_amount_kobo > 0
          and item.gross_amount_kobo > 0
          and item.platform_fee_bps between 0 and 10000
          and item.platform_fee_amount_kobo >= 0
          and item.vendor_net_amount_kobo >= 0
          and item.gross_amount_kobo = item.unit_amount_kobo * item.quantity::bigint
          and item.gross_amount_kobo = item.platform_fee_amount_kobo + item.vendor_net_amount_kobo
        ), false)
      into v_item_count, v_item_total_kobo, v_items_valid
      from public.order_items as item
      where item.order_id = v_order.id;

      if v_item_count = 0
        or not v_items_valid
        or v_item_total_kobo <> v_order.total_amount_kobo
      then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'RECONCILIATION_REQUIRED',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'RECONCILIATION_REQUIRED',
            diagnostic_code = 'INVALID_V2_ITEM_SNAPSHOT'
        where event.id = v_event.id;

        return query
        select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
        return;
      end if;

      v_contract_version := 2;
    elsif v_order.financial_contract_version is null then
      select
        pg_catalog.count(*),
        coalesce(pg_catalog.sum(item.subtotal), 0),
        coalesce(pg_catalog.bool_and(
          item.vendor_id is not null
          and item.quantity > 0
          and item.unit_price > 0
          and item.subtotal > 0
          and item.unit_price * item.quantity::numeric = item.subtotal
          and item.unit_price * 100 = pg_catalog.trunc(item.unit_price * 100)
          and item.subtotal * 100 = pg_catalog.trunc(item.subtotal * 100)
          and item.financial_contract_version is null
          and item.unit_amount_kobo is null
          and item.gross_amount_kobo is null
          and item.platform_fee_bps is null
          and item.platform_fee_amount_kobo is null
          and item.vendor_net_amount_kobo is null
          and item.currency is null
        ), false)
      into v_item_count, v_item_total, v_items_valid
      from public.order_items as item
      where item.order_id = v_order.id;

      if v_item_count = 0
        or not v_items_valid
        or v_order.total_amount <= 0
        or v_order.total_amount * 100 <> pg_catalog.trunc(v_order.total_amount * 100)
        or v_item_total <> v_order.total_amount
      then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            diagnostic_code = 'INVALID_LEGACY_FINANCIAL_FACTS'
        where event.id = v_event.id;

        return query
        select 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION'::text, v_order.id, false;
        return;
      end if;

      perform vendor.id
      from public.vendors as vendor
      where vendor.id in (
        select item.vendor_id
        from public.order_items as item
        where item.order_id = v_order.id
      )
      order by vendor.id
      for update;

      select
        pg_catalog.count(distinct item.vendor_id),
        pg_catalog.count(distinct item.vendor_id) filter (
          where vendor.id is not null
            and vendor.platform_fee_pct is not null
            and vendor.platform_fee_pct between 0 and 100
            and vendor.platform_fee_pct * 100 = pg_catalog.trunc(vendor.platform_fee_pct * 100)
        )
      into v_vendor_count, v_valid_vendor_count
      from public.order_items as item
      left join public.vendors as vendor on vendor.id = item.vendor_id
      where item.order_id = v_order.id;

      if v_vendor_count = 0 or v_valid_vendor_count <> v_vendor_count then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            diagnostic_code = 'LEGACY_VENDOR_FEE_UNAVAILABLE'
        where event.id = v_event.id;

        return query
        select 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION'::text, v_order.id, false;
        return;
      end if;

      v_contract_version := 1;
    else
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'UNSUPPORTED_FINANCIAL_CONTRACT'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if (
      case
        when v_contract_version = 2 then v_order.total_amount_kobo
        else (v_order.total_amount * 100)::bigint
      end
    ) <> p_amount_kobo then
      update public.payments as payment
      set finalization_state = 'terminal_rejected',
          outcome_code = 'AMOUNT_MISMATCH',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'terminal_rejected',
          completed_at = v_now,
          outcome_code = 'AMOUNT_MISMATCH',
          diagnostic_code = 'PROVIDER_ORDER_AMOUNT_MISMATCH'
      where event.id = v_event.id;

      return query
      select 'AMOUNT_MISMATCH'::text, v_order.id, false;
      return;
    end if;

    begin
      if v_contract_version = 1 then
        update public.order_items as item
        set unit_amount_kobo = (item.unit_price * 100)::bigint,
            gross_amount_kobo = (item.subtotal * 100)::bigint,
            platform_fee_bps = (vendor.platform_fee_pct * 100)::integer,
            platform_fee_amount_kobo = pg_catalog.round(
              (item.subtotal * 100)
              * (vendor.platform_fee_pct * 100)
              / 10000
            )::bigint,
            vendor_net_amount_kobo = (item.subtotal * 100)::bigint
              - pg_catalog.round(
                  (item.subtotal * 100)
                  * (vendor.platform_fee_pct * 100)
                  / 10000
                )::bigint,
            currency = 'NGN',
            financial_contract_version = 1
        from public.vendors as vendor
        where item.order_id = v_order.id
          and vendor.id = item.vendor_id;

        get diagnostics v_updated_rows = row_count;
        if v_updated_rows <> v_item_count then
          raise exception 'Ops 2B1 legacy item snapshot update count changed.';
        end if;

        update public.orders as customer_order
        set total_amount_kobo = (customer_order.total_amount * 100)::bigint,
            currency = 'NGN',
            financial_contract_version = 1
        where customer_order.id = v_order.id
          and customer_order.status = 'pending'
          and customer_order.financial_contract_version is null;

        get diagnostics v_updated_rows = row_count;
        if v_updated_rows <> 1 then
          raise exception 'Ops 2B1 legacy order snapshot transition lost its guard.';
        end if;
      end if;

      for v_credit in
        select
          item.vendor_id,
          pg_catalog.sum(item.gross_amount_kobo)::bigint as gross_kobo,
          pg_catalog.sum(item.platform_fee_amount_kobo)::bigint as fee_kobo,
          pg_catalog.sum(item.vendor_net_amount_kobo)::bigint as net_kobo
        from public.order_items as item
        where item.order_id = v_order.id
        group by item.vendor_id
        order by item.vendor_id
      loop
        insert into public.payout_ledger (
          vendor_id,
          order_id,
          amount,
          type,
          reference,
          description,
          source_kind,
          idempotency_key,
          gross_amount_kobo,
          platform_fee_amount_kobo,
          net_amount_kobo,
          currency,
          financial_contract_version
        ) values (
          v_credit.vendor_id,
          v_order.id,
          v_credit.net_kobo::numeric / 100,
          'credit',
          p_reference,
          'Sale credit for order ' || v_order.id::text,
          'sale',
          'sale:' || v_order.id::text || ':' || v_credit.vendor_id::text,
          v_credit.gross_kobo,
          v_credit.fee_kobo,
          v_credit.net_kobo,
          'NGN',
          v_contract_version
        );
      end loop;

      update public.orders as customer_order
      set status = 'confirmed',
          payment_finalized_at = v_now,
          updated_at = v_now
      where customer_order.id = v_order.id
        and customer_order.status = 'pending';

      get diagnostics v_updated_rows = row_count;
      if v_updated_rows <> 1 then
        raise exception 'Ops 2B1 guarded order confirmation did not update exactly one row.';
      end if;

      update public.payments as payment
      set order_id = v_order.id,
          financial_contract_version = v_contract_version,
          finalization_state = 'completed',
          outcome_code = 'FINALIZED',
          updated_at = v_now,
          finalized_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'completed',
          completed_at = v_now,
          outcome_code = 'FINALIZED',
          diagnostic_code = null,
          payment_id = v_payment.id
      where event.id = v_event.id;
    exception
      when unique_violation then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'CREDIT_CONFLICT',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'CREDIT_CONFLICT',
            diagnostic_code = 'SALE_CREDIT_UNIQUE_CONFLICT',
            payment_id = v_payment.id
        where event.id = v_event.id;

        return query
        select 'CREDIT_CONFLICT'::text, v_order.id, false;
        return;
    end;

    return query
    select 'FINALIZED'::text, v_order.id, false;
    return;
  exception
    when others then
      update public.payment_events as event
      set processing_state = 'retryable_failure',
          completed_at = null,
          outcome_code = 'RETRYABLE_FAILURE',
          diagnostic_code = 'UNEXPECTED_DATABASE_FAILURE',
          last_attempted_at = pg_catalog.now()
      where event.id = v_event.id;

      return query
      select 'RETRYABLE_FAILURE'::text, null::uuid, true;
      return;
  end;
end
$function$;

comment on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) is
  'Atomic Paystack paid-order finalization. Success/idempotent: FINALIZED, ALREADY_FINALIZED, EVENT_ALREADY_COMPLETED, LEGACY_ALREADY_FINALIZED. Terminal: AMOUNT_MISMATCH, CURRENCY_MISMATCH, INVALID_PROVIDER_PAYLOAD. Retryable: ORDER_NOT_FOUND_RETRYABLE, RETRYABLE_FAILURE. Reconciliation: PAYMENT_IDENTITY_CONFLICT, CREDIT_CONFLICT, LEGACY_FINALIZATION_REQUIRES_RECONCILIATION, RECONCILIATION_REQUIRED.';

alter function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) owner to postgres;

revoke all privileges on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) to service_role;

do $postcondition$
declare
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  relation_name text;
  column_names text[];
  products_security text;
  storage_security text;
  decrement_stock_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
begin
  if pg_catalog.to_regclass('public.payments') is null
    or pg_catalog.to_regclass('public.payment_events') is null
  then
    raise exception 'Ops 2B1 postcondition: payment foundation tables are missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.payments'::pg_catalog.regclass
      and class.relowner = 'postgres'::pg_catalog.regrole
  ) or not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.payment_events'::pg_catalog.regclass
      and class.relowner = 'postgres'::pg_catalog.regrole
  ) then
    raise exception 'Ops 2B1 postcondition: payment table ownership is incorrect.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into column_names
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.payments'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if column_names is distinct from array[
    'id', 'provider', 'environment', 'transaction_id', 'reference',
    'order_id', 'status', 'amount_kobo', 'currency', 'paid_at',
    'financial_contract_version', 'finalization_state', 'outcome_code',
    'created_at', 'updated_at', 'finalized_at'
  ]::text[] then
    raise exception 'Ops 2B1 postcondition: public.payments columns are incorrect.';
  end if;

  select pg_catalog.array_agg(
    attribute.attname::text || ':'
    || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':'
    || attribute.attnotnull::text
    order by attribute.attnum
  )
  into column_names
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.payments'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if column_names is distinct from array[
    'id:uuid:true', 'provider:text:true', 'environment:text:true',
    'transaction_id:text:true', 'reference:text:true', 'order_id:uuid:false',
    'status:text:true', 'amount_kobo:bigint:true', 'currency:text:true',
    'paid_at:timestamp with time zone:false',
    'financial_contract_version:smallint:false',
    'finalization_state:text:true', 'outcome_code:text:false',
    'created_at:timestamp with time zone:true',
    'updated_at:timestamp with time zone:true',
    'finalized_at:timestamp with time zone:false'
  ]::text[] then
    raise exception 'Ops 2B1 postcondition: public.payments types or nullability are incorrect.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into column_names
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.payment_events'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if column_names is distinct from array[
    'id', 'provider', 'environment', 'event_type', 'payload_sha256',
    'transaction_id', 'reference', 'processing_state', 'attempt_count',
    'first_received_at', 'last_attempted_at', 'completed_at',
    'outcome_code', 'diagnostic_code', 'payment_id'
  ]::text[] then
    raise exception 'Ops 2B1 postcondition: public.payment_events columns are incorrect.';
  end if;

  select pg_catalog.array_agg(
    attribute.attname::text || ':'
    || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':'
    || attribute.attnotnull::text
    order by attribute.attnum
  )
  into column_names
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.payment_events'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if column_names is distinct from array[
    'id:uuid:true', 'provider:text:true', 'environment:text:true',
    'event_type:text:true', 'payload_sha256:text:true',
    'transaction_id:text:false', 'reference:text:false',
    'processing_state:text:true', 'attempt_count:integer:true',
    'first_received_at:timestamp with time zone:true',
    'last_attempted_at:timestamp with time zone:true',
    'completed_at:timestamp with time zone:false', 'outcome_code:text:false',
    'diagnostic_code:text:false', 'payment_id:uuid:false'
  ]::text[] then
    raise exception 'Ops 2B1 postcondition: public.payment_events types or nullability are incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attrdef as default_value
    where default_value.adrelid = 'public.payments'::pg_catalog.regclass
  ) <> 4 or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.payments'::pg_catalog.regclass
      and attribute.attname = 'id'
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'gen_random_uuid()'
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.payments'::pg_catalog.regclass
      and attribute.attname = 'finalization_state'
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = '''processing''::text'
  ) then
    raise exception 'Ops 2B1 postcondition: public.payments defaults are incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attrdef as default_value
    where default_value.adrelid = 'public.payment_events'::pg_catalog.regclass
  ) <> 5 or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.payment_events'::pg_catalog.regclass
      and attribute.attname = 'processing_state'
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = '''received''::text'
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.payment_events'::pg_catalog.regclass
      and attribute.attname = 'attempt_count'
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = '1'
  ) then
    raise exception 'Ops 2B1 postcondition: public.payment_events defaults are incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.payments'::pg_catalog.regclass
      and constraint_record.conname in (
        'payments_pkey',
        'payments_provider_check',
        'payments_environment_check',
        'payments_transaction_id_check',
        'payments_reference_check',
        'payments_status_check',
        'payments_amount_check',
        'payments_currency_check',
        'payments_contract_version_check',
        'payments_finalization_state_check',
        'payments_outcome_code_check',
        'payments_completion_check',
        'payments_timestamps_check',
        'payments_order_id_fkey',
        'payments_provider_environment_transaction_key',
        'payments_provider_environment_reference_key',
        'payments_order_id_key'
      )
  ) <> 17 then
    raise exception 'Ops 2B1 postcondition: public.payments constraints are incomplete.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.payments'::pg_catalog.regclass
  ) <> 17 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_indexes as index_record
    where index_record.schemaname = 'public'
      and index_record.tablename = 'payments'
  ) <> 4 then
    raise exception 'Ops 2B1 postcondition: public.payments has unexpected constraints or indexes.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.payment_events'::pg_catalog.regclass
      and constraint_record.conname in (
        'payment_events_pkey',
        'payment_events_provider_check',
        'payment_events_environment_check',
        'payment_events_event_type_check',
        'payment_events_payload_sha256_check',
        'payment_events_transaction_id_check',
        'payment_events_reference_check',
        'payment_events_processing_state_check',
        'payment_events_attempt_count_check',
        'payment_events_outcome_code_check',
        'payment_events_diagnostic_code_check',
        'payment_events_completion_check',
        'payment_events_timestamps_check',
        'payment_events_payment_id_fkey',
        'payment_events_provider_environment_payload_key'
      )
  ) <> 15 then
    raise exception 'Ops 2B1 postcondition: public.payment_events constraints are incomplete.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.payment_events'::pg_catalog.regclass
  ) <> 15 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_indexes as index_record
    where index_record.schemaname = 'public'
      and index_record.tablename = 'payment_events'
  ) <> 2 then
    raise exception 'Ops 2B1 postcondition: public.payment_events has unexpected constraints or indexes.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.payments'::pg_catalog.regclass
      and constraint_record.conname = 'payments_order_id_fkey'
      and constraint_record.confrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.payment_events'::pg_catalog.regclass
      and constraint_record.conname = 'payment_events_payment_id_fkey'
      and constraint_record.confrelid = 'public.payments'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
  ) then
    raise exception 'Ops 2B1 postcondition: financial evidence FK preservation is incorrect.';
  end if;

  if pg_catalog.to_regclass('public.payout_ledger_idempotency_key_key') is null
    or pg_catalog.to_regclass('public.payout_ledger_sale_order_vendor_key') is null
    or position(
      'WHERE (idempotency_key IS NOT NULL)'
      in pg_catalog.pg_get_indexdef(
        'public.payout_ledger_idempotency_key_key'::pg_catalog.regclass
      )
    ) = 0
    or position(
      'WHERE (source_kind = ''sale''::text)'
      in pg_catalog.pg_get_indexdef(
        'public.payout_ledger_sale_order_vendor_key'::pg_catalog.regclass
      )
    ) = 0
  then
    raise exception 'Ops 2B1 postcondition: deterministic sale-credit indexes are incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where (
      constraint_record.conrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.conname in (
        'orders_financial_snapshot_bundle_check',
        'orders_versioned_finalization_check'
      )
    ) or (
      constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_financial_snapshot_bundle_check'
    ) or (
      constraint_record.conrelid = 'public.payout_ledger'::pg_catalog.regclass
      and constraint_record.conname = 'payout_ledger_sale_evidence_check'
    )
  ) <> 4 then
    raise exception 'Ops 2B1 postcondition: financial snapshot checks are missing.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.orders'::pg_catalog.regclass
      and attribute.attname in (
        'total_amount_kobo', 'currency', 'financial_contract_version',
        'payment_finalized_at'
      )
      and not attribute.attnotnull
      and not exists (
        select 1 from pg_catalog.pg_attrdef as default_value
        where default_value.adrelid = attribute.attrelid
          and default_value.adnum = attribute.attnum
      )
  ) <> 4 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
      and attribute.attname in (
        'unit_amount_kobo', 'gross_amount_kobo', 'platform_fee_bps',
        'platform_fee_amount_kobo', 'vendor_net_amount_kobo', 'currency',
        'financial_contract_version'
      )
      and not attribute.attnotnull
      and not exists (
        select 1 from pg_catalog.pg_attrdef as default_value
        where default_value.adrelid = attribute.attrelid
          and default_value.adnum = attribute.attnum
      )
  ) <> 7 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.payout_ledger'::pg_catalog.regclass
      and attribute.attname in (
        'source_kind', 'idempotency_key', 'gross_amount_kobo',
        'platform_fee_amount_kobo', 'net_amount_kobo', 'currency',
        'financial_contract_version'
      )
      and not attribute.attnotnull
      and not exists (
        select 1 from pg_catalog.pg_attrdef as default_value
        where default_value.adrelid = attribute.attrelid
          and default_value.adnum = attribute.attnum
      )
  ) <> 7 then
    raise exception 'Ops 2B1 postcondition: additive legacy-compatible columns are not nullable without defaults.';
  end if;

  foreach relation_name in array array[
    'public.payments', 'public.payment_events'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = pg_catalog.to_regclass(relation_name)
        and class.relrowsecurity
        and not class.relforcerowsecurity
    ) or exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = pg_catalog.split_part(relation_name, '.', 2)
    ) then
      raise exception 'Ops 2B1 postcondition: % RLS state is incorrect.', relation_name;
    end if;

    if pg_catalog.has_table_privilege('anon', relation_name, 'SELECT')
      or pg_catalog.has_table_privilege('anon', relation_name, 'INSERT')
      or pg_catalog.has_table_privilege('anon', relation_name, 'UPDATE')
      or pg_catalog.has_table_privilege('anon', relation_name, 'DELETE')
      or pg_catalog.has_table_privilege('anon', relation_name, 'TRUNCATE')
      or pg_catalog.has_table_privilege('anon', relation_name, 'REFERENCES')
      or pg_catalog.has_table_privilege('anon', relation_name, 'TRIGGER')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'DELETE')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'TRUNCATE')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'REFERENCES')
      or pg_catalog.has_table_privilege('authenticated', relation_name, 'TRIGGER')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'SELECT')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'INSERT')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'UPDATE')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'DELETE')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'TRUNCATE')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'REFERENCES')
      or not pg_catalog.has_table_privilege('service_role', relation_name, 'TRIGGER')
    then
      raise exception 'Ops 2B1 postcondition: % grants are incorrect.', relation_name;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_class as class
      cross join lateral pg_catalog.aclexplode(coalesce(
        class.relacl,
        pg_catalog.acldefault('r', class.relowner)
      )) as acl
      where class.oid = pg_catalog.to_regclass(relation_name)
        and acl.grantee not in (
          class.relowner,
          'service_role'::pg_catalog.regrole
        )
    ) then
      raise exception 'Ops 2B1 postcondition: % has an unexpected grantee.', relation_name;
    end if;
  end loop;

  if pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'TRUNCATE')
    or pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'REFERENCES')
    or pg_catalog.has_table_privilege('anon', 'public.events_ledger', 'TRIGGER')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'TRUNCATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'REFERENCES')
    or pg_catalog.has_table_privilege('authenticated', 'public.events_ledger', 'TRIGGER')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'TRUNCATE')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'REFERENCES')
    or pg_catalog.has_table_privilege('anon', 'public.payout_ledger', 'TRIGGER')
    or not pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'TRUNCATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'REFERENCES')
    or pg_catalog.has_table_privilege('authenticated', 'public.payout_ledger', 'TRIGGER')
  then
    raise exception 'Ops 2B1 postcondition: legacy financial ledger browser grants are incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'payout_ledger'
      and policy.policyname = 'vendor_select_ledger'
      and policy.cmd = 'SELECT'
  ) then
    raise exception 'Ops 2B1 postcondition: vendor payout-ledger SELECT policy changed.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid in (
      'public.events_ledger'::pg_catalog.regclass,
      'public.payout_ledger'::pg_catalog.regclass
    )
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attacl is not null
  ) then
    raise exception 'Ops 2B1 postcondition: legacy financial ledger column grants are unexpected.';
  end if;

  if rpc_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_language as language
      on language.oid = procedure.prolang
    where procedure.oid = rpc_oid
      and procedure.proowner = 'postgres'::pg_catalog.regrole
      and not procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig is not distinct from array['search_path=""']::text[]
      and language.lanname = 'plpgsql'
      and pg_catalog.pg_get_function_result(procedure.oid) =
        'TABLE(outcome text, order_id uuid, retryable boolean)'
  ) then
    raise exception 'Ops 2B1 postcondition: finalization RPC metadata is incorrect.';
  end if;

  if pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = rpc_oid
        and acl.grantee not in (
          procedure.proowner,
          'service_role'::pg_catalog.regrole
        )
    )
  then
    raise exception 'Ops 2B1 postcondition: finalization RPC EXECUTE grants are incorrect.';
  end if;

  if (select pg_catalog.count(*)::text from public.orders)
      is distinct from pg_catalog.current_setting('marketa_ops2b1.orders_count')
    or (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.jsonb_build_array(
          customer_order.id, customer_order.customer_id,
          customer_order.customer_email, customer_order.customer_phone,
          customer_order.status, customer_order.total_amount,
          customer_order.payment_ref, customer_order.idempotency_key,
          customer_order.shipping_address, customer_order.created_at,
          customer_order.updated_at, customer_order.checkout_attempt_id,
          customer_order.customer_name
        )::text, E'\n' order by customer_order.id
      ), '')) from public.orders as customer_order
    ) is distinct from pg_catalog.current_setting('marketa_ops2b1.orders_rows')
    or exists (
      select 1 from public.orders as customer_order
      where customer_order.total_amount_kobo is not null
        or customer_order.currency is not null
        or customer_order.financial_contract_version is not null
        or customer_order.payment_finalized_at is not null
    )
  then
    raise exception 'Ops 2B1 postcondition: historical orders changed.';
  end if;

  if (select pg_catalog.count(*)::text from public.order_items)
      is distinct from pg_catalog.current_setting('marketa_ops2b1.order_items_count')
    or (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.jsonb_build_array(
          item.id, item.order_id, item.product_id, item.vendor_id,
          item.quantity, item.unit_price, item.subtotal, item.created_at
        )::text, E'\n' order by item.id
      ), '')) from public.order_items as item
    ) is distinct from pg_catalog.current_setting('marketa_ops2b1.order_items_rows')
    or exists (
      select 1 from public.order_items as item
      where item.unit_amount_kobo is not null
        or item.gross_amount_kobo is not null
        or item.platform_fee_bps is not null
        or item.platform_fee_amount_kobo is not null
        or item.vendor_net_amount_kobo is not null
        or item.currency is not null
        or item.financial_contract_version is not null
    )
  then
    raise exception 'Ops 2B1 postcondition: historical order items changed.';
  end if;

  if (select pg_catalog.count(*)::text from public.events_ledger)
      is distinct from pg_catalog.current_setting('marketa_ops2b1.events_count')
    or (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.jsonb_build_array(
          event.id, event.event_id, event.event_type, event.provider,
          event.payload_hash, event.processed_at
        )::text, E'\n' order by event.id
      ), '')) from public.events_ledger as event
    ) is distinct from pg_catalog.current_setting('marketa_ops2b1.events_rows')
  then
    raise exception 'Ops 2B1 postcondition: historical event rows changed.';
  end if;

  if (select pg_catalog.count(*)::text from public.payout_ledger)
      is distinct from pg_catalog.current_setting('marketa_ops2b1.payout_count')
    or (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.jsonb_build_array(
          ledger.id, ledger.vendor_id, ledger.order_id, ledger.amount,
          ledger.type, ledger.reference, ledger.description, ledger.created_at
        )::text, E'\n' order by ledger.id
      ), '')) from public.payout_ledger as ledger
    ) is distinct from pg_catalog.current_setting('marketa_ops2b1.payout_rows')
    or exists (
      select 1 from public.payout_ledger as ledger
      where ledger.source_kind is not null
        or ledger.idempotency_key is not null
        or ledger.gross_amount_kobo is not null
        or ledger.platform_fee_amount_kobo is not null
        or ledger.net_amount_kobo is not null
        or ledger.currency is not null
        or ledger.financial_contract_version is not null
    )
  then
    raise exception 'Ops 2B1 postcondition: historical payout rows changed.';
  end if;

  if exists (select 1 from public.payments)
    or exists (select 1 from public.payment_events)
  then
    raise exception 'Ops 2B1 postcondition: migration fabricated payment evidence.';
  end if;

  if (select pg_catalog.count(*)::text from public.products)
      is distinct from pg_catalog.current_setting('marketa_ops2b1.product_count')
    or (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(product)::text, E'\n' order by product.id
      ), '')) from public.products as product
    ) is distinct from pg_catalog.current_setting('marketa_ops2b1.product_rows')
  then
    raise exception 'Ops 2B1 postcondition: product rows or stock changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(policy) order by policy.policyname)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public' and policy.tablename = 'products'
    ), '[]'::pg_catalog.jsonb),
    'product_is_active', (
      select pg_catalog.jsonb_build_object(
        'not_null', attribute.attnotnull,
        'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
      )
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname = 'is_active'
    ),
    'vendor_is_active', (
      select pg_catalog.jsonb_build_object(
        'not_null', attribute.attnotnull,
        'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
        'authenticated_update', pg_catalog.has_column_privilege(
          'authenticated', 'public.vendors', 'is_active', 'UPDATE'
        )
      )
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
        and attribute.attname = 'is_active'
    ),
    'vendor_active_helper', (
      select pg_catalog.jsonb_build_object(
        'definition', pg_catalog.pg_get_functiondef(procedure.oid),
        'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
        'acl', procedure.proacl, 'config', procedure.proconfig,
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile
      )
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure('public.is_vendor_active(uuid)')
    )
  )::text
  into products_security
  from pg_catalog.pg_class as class
  where class.oid = 'public.products'::pg_catalog.regclass;

  if products_security is distinct from pg_catalog.current_setting(
    'marketa_ops2b1.products_security'
  ) then
    raise exception 'Ops 2B1 postcondition: Batch 4A product boundary changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(policy) order by policy.policyname)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage' and policy.tablename = 'objects'
    ), '[]'::pg_catalog.jsonb),
    'bucket', (
      select pg_catalog.to_jsonb(bucket)
      from storage.buckets as bucket where bucket.id = 'product-images'
    ),
    'foldername', (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure('storage.foldername(text)')
    )
  )::text
  into storage_security
  from pg_catalog.pg_class as class
  where class.oid = 'storage.objects'::pg_catalog.regclass;

  if storage_security is distinct from pg_catalog.current_setting(
    'marketa_ops2b1.storage_security'
  ) then
    raise exception 'Ops 2B1 postcondition: Batch 4B1 Storage boundary changed.';
  end if;

  if decrement_stock_oid is not null then
    if not exists (
        select 1
        from pg_catalog.pg_proc as procedure
        where procedure.oid = decrement_stock_oid
          and procedure.proowner = 'postgres'::pg_catalog.regrole
          and not procedure.prosecdef
          and procedure.proconfig is not distinct from array['search_path=""']::text[]
      )
      or pg_catalog.has_function_privilege(
        'anon', 'public.decrement_stock(uuid,integer)', 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated', 'public.decrement_stock(uuid,integer)', 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', decrement_stock_oid, 'EXECUTE'
      )
    then
      raise exception 'Ops 2B1 postcondition: Ops 1A decrement_stock containment changed.';
    end if;
  end if;
end
$postcondition$;

commit;
