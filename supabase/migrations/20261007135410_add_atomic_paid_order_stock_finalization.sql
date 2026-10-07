-- Ops 4C: atomically consume paid-order product stock inside the existing
-- financial finalizer. This migration performs no historical backfill.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

-- OPS_4C_PREFLIGHT_START
do $preflight$
declare
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  decrement_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
begin
  if rpc_oid is null
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'finalize_paystack_paid_order'
    ) <> 1
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language
        on language.oid = procedure.prolang
      where procedure.oid = rpc_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proconfig is not distinct from
          array['search_path=""']::text[]
        and language.lanname = 'plpgsql'
        and pg_catalog.pg_get_function_result(procedure.oid) =
          'TABLE(outcome text, order_id uuid, retryable boolean)'
        and pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) =
          'a7bcbaa3cbcdc90140e7dd476e6bc18a'
        and pg_catalog.md5(pg_catalog.regexp_replace(
          procedure.prosrc,
          '[[:space:]]',
          '',
          'g'
        )) = '514b72708d2e5fbdebce3d342372410b'
    )
    or pg_catalog.has_function_privilege('public', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', rpc_oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', rpc_oid, 'EXECUTE'
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = rpc_oid
    ) <> 2
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = rpc_oid
        and (
          acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            'service_role'::pg_catalog.regrole
          )
        )
    )
  then
    raise exception 'Ops 4C preflight: atomic finalizer drifted from the reviewed definition or authority.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_roles as role_record
      where role_record.rolname = 'service_role'
        and role_record.rolbypassrls
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.products', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.products', 'UPDATE'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.order_items', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.order_items', 'UPDATE'
    )
  then
    raise exception 'Ops 4C preflight: service-role stock authority changed.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = 'public.products'::pg_catalog.regclass
        and class.relkind = 'r'
        and class.relowner = 'postgres'::pg_catalog.regrole
        and class.relrowsecurity
        and not class.relforcerowsecurity
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ) <> 5
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname = 'id'
        and attribute.atttypid = 'uuid'::pg_catalog.regtype
        and attribute.attnotnull
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
        and constraint_record.conname = 'products_pkey'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) = 'PRIMARY KEY (id)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname = 'stock'
        and attribute.atttypid = 'integer'::pg_catalog.regtype
        and attribute.attnotnull
        and pg_catalog.pg_get_expr(
          default_value.adbin,
          default_value.adrelid
        ) = '0'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
        and constraint_record.conname = 'products_stock_check'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) = 'CHECK (stock >= 0)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname = 'updated_at'
        and attribute.atttypid =
          'timestamp with time zone'::pg_catalog.regtype
        and not attribute.attnotnull
        and pg_catalog.pg_get_expr(
          default_value.adbin,
          default_value.adrelid
        ) = 'now()'
    )
  then
    raise exception 'Ops 4C preflight: products stock schema or RLS changed.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = 'public.order_items'::pg_catalog.regclass
        and class.relkind = 'r'
        and class.relowner = 'postgres'::pg_catalog.regrole
        and class.relrowsecurity
        and not class.relforcerowsecurity
    )
    or exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'order_items'
        and policy.cmd <> 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.order_items', 'INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.order_items', 'INSERT,UPDATE,DELETE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
        and attribute.attname = 'order_id'
        and attribute.atttypid = 'uuid'::pg_catalog.regtype
        and attribute.attnotnull
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
        and attribute.attname = 'product_id'
        and attribute.atttypid = 'uuid'::pg_catalog.regtype
        and not attribute.attnotnull
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
        and attribute.attname = 'quantity'
        and attribute.atttypid = 'integer'::pg_catalog.regtype
        and attribute.attnotnull
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.order_items'::pg_catalog.regclass
        and constraint_record.conname = 'order_items_product_id_fkey'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) = 'FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.order_items'::pg_catalog.regclass
        and constraint_record.conname = 'order_items_quantity_check'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) = 'CHECK (quantity > 0)'
    )
  then
    raise exception 'Ops 4C preflight: order-item stock authority changed.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.payments'::pg_catalog.regclass
        and constraint_record.conname = 'payments_completion_check'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) ilike '%finalization_state = ''reconciliation_required''%outcome_code%RECONCILIATION_REQUIRED%'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.payment_events'::pg_catalog.regclass
        and constraint_record.conname = 'payment_events_completion_check'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) ilike '%processing_state%reconciliation_required%completed_at IS NOT NULL%'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.payment_events'::pg_catalog.regclass
        and constraint_record.conname = 'payment_events_outcome_code_check'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) ilike '%RECONCILIATION_REQUIRED%'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.payment_events'::pg_catalog.regclass
        and constraint_record.conname = 'payment_events_diagnostic_code_check'
        and pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        ) ilike '%diagnostic_code IS NULL%diagnostic_code ~ ''^[A-Z0-9_]{1,100}$''::text%'
    )
  then
    raise exception 'Ops 4C preflight: paid reconciliation state contract changed.';
  end if;

  if pg_catalog.to_regclass(
      'public.payout_ledger_idempotency_key_key'
    ) is null
    or pg_catalog.to_regclass(
      'public.payout_ledger_sale_order_vendor_key'
    ) is null
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname =
          'outbox_events_idempotency_key_key'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
          'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname =
          'outbox_events_event_type_order_id_key'
    )
  then
    raise exception 'Ops 4C preflight: payout or outbox idempotency boundary changed.';
  end if;

  if decrement_oid is null
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = decrement_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proconfig is not distinct from
          array['search_path=""']::text[]
        and pg_catalog.md5(
          pg_catalog.pg_get_functiondef(procedure.oid)
        ) = '0094f1ea6602edbfe18ac8f9619677b8'
    )
    or pg_catalog.has_function_privilege(
      'public', decrement_oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', decrement_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', decrement_oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', decrement_oid, 'EXECUTE'
    )
  then
    raise exception 'Ops 4C preflight: decrement_stock containment changed.';
  end if;
end
$preflight$;
-- OPS_4C_PREFLIGHT_END

-- OPS_4C_RPC_START
create or replace function public.finalize_paystack_paid_order(
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
  v_constraint_name text;
  v_initial_item_count bigint;
  v_initial_product_identity_valid boolean;
  v_initial_quantities_valid boolean;
  v_stock_product_ids uuid[];
  v_stock_required_quantities numeric[];
  v_stock_product_count bigint;
  v_rechecked_item_count bigint;
  v_rechecked_product_identity_valid boolean;
  v_rechecked_quantities_valid boolean;
  v_rechecked_product_ids uuid[];
  v_rechecked_required_quantities numeric[];
  v_rechecked_product_count bigint;
  v_locked_product_count bigint := 0;
  v_updated_product_count integer;
  v_stock_all_sufficient boolean;
  v_stock_diagnostic text;
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

    -- OPS_4C_STOCK_BOUNDARY_START
    select
      pg_catalog.count(*),
      coalesce(pg_catalog.bool_and(item.product_id is not null), false),
      coalesce(pg_catalog.bool_and(item.quantity > 0), false)
    into
      v_initial_item_count,
      v_initial_product_identity_valid,
      v_initial_quantities_valid
    from public.order_items as item
    where item.order_id = v_order.id;

    if v_initial_item_count = 0 or not v_initial_quantities_valid then
      v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
    elsif not v_initial_product_identity_valid then
      v_stock_diagnostic := 'PAID_STOCK_PRODUCT_UNAVAILABLE';
    else
      select
        pg_catalog.array_agg(
          requirement.product_id
          order by requirement.product_id
        ),
        pg_catalog.array_agg(
          requirement.required_quantity
          order by requirement.product_id
        ),
        pg_catalog.count(*)
      into
        v_stock_product_ids,
        v_stock_required_quantities,
        v_stock_product_count
      from (
        select
          item.product_id,
          pg_catalog.sum(item.quantity::numeric) as required_quantity
        from public.order_items as item
        where item.order_id = v_order.id
        group by item.product_id
      ) as requirement;

      if v_stock_product_count = 0 then
        v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
      else
        perform product.id
        from public.products as product
        join pg_catalog.unnest(
          v_stock_product_ids
        ) as requirement(product_id)
          on requirement.product_id = product.id
        order by product.id
        for update of product;

        get diagnostics v_locked_product_count = row_count;
      end if;
    end if;

    perform item.id
    from public.order_items as item
    where item.order_id = v_order.id
    order by item.id
    for update of item nowait;

    select
      pg_catalog.count(*),
      coalesce(pg_catalog.bool_and(item.product_id is not null), false),
      coalesce(pg_catalog.bool_and(item.quantity > 0), false)
    into
      v_rechecked_item_count,
      v_rechecked_product_identity_valid,
      v_rechecked_quantities_valid
    from public.order_items as item
    where item.order_id = v_order.id;

    if v_rechecked_item_count = 0 or not v_rechecked_quantities_valid then
      v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
    elsif not v_rechecked_product_identity_valid then
      v_stock_diagnostic := 'PAID_STOCK_PRODUCT_UNAVAILABLE';
    else
      select
        pg_catalog.array_agg(
          requirement.product_id
          order by requirement.product_id
        ),
        pg_catalog.array_agg(
          requirement.required_quantity
          order by requirement.product_id
        ),
        pg_catalog.count(*)
      into
        v_rechecked_product_ids,
        v_rechecked_required_quantities,
        v_rechecked_product_count
      from (
        select
          item.product_id,
          pg_catalog.sum(item.quantity::numeric) as required_quantity
        from public.order_items as item
        where item.order_id = v_order.id
        group by item.product_id
      ) as requirement;

      if v_rechecked_product_ids is distinct from v_stock_product_ids
        or v_rechecked_required_quantities
          is distinct from v_stock_required_quantities
        or v_rechecked_product_count is distinct from v_stock_product_count
        or pg_catalog.cardinality(v_rechecked_product_ids)
          is distinct from
            pg_catalog.cardinality(v_rechecked_required_quantities)
      then
        v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
      elsif v_locked_product_count <> v_stock_product_count then
        v_stock_diagnostic := 'PAID_STOCK_PRODUCT_UNAVAILABLE';
      elsif exists (
        select 1
        from pg_catalog.unnest(
          v_rechecked_required_quantities
        ) as requirement(required_quantity)
        where requirement.required_quantity <= 0
          or requirement.required_quantity > 2147483647
      ) then
        v_stock_diagnostic := 'PAID_STOCK_INSUFFICIENT';
      else
        select coalesce(pg_catalog.bool_and(
          product.stock::numeric >= requirement.required_quantity
        ), false)
        into v_stock_all_sufficient
        from rows from (
          pg_catalog.unnest(v_rechecked_product_ids),
          pg_catalog.unnest(v_rechecked_required_quantities)
        ) as requirement(product_id, required_quantity)
        join public.products as product
          on product.id = requirement.product_id;

        if not v_stock_all_sufficient then
          v_stock_diagnostic := 'PAID_STOCK_INSUFFICIENT';
        end if;
      end if;
    end if;

    if v_stock_diagnostic is not null then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          financial_contract_version = null,
          finalized_at = null,
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = v_stock_diagnostic,
          payment_id = v_payment.id
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;
    -- OPS_4C_STOCK_BOUNDARY_END

    begin
      -- OPS_4C_STOCK_SUCCESS_START
      update public.products as product
      set stock = product.stock - requirement.required_quantity::integer,
          updated_at = v_now
      from rows from (
        pg_catalog.unnest(v_rechecked_product_ids),
        pg_catalog.unnest(v_rechecked_required_quantities)
      ) as requirement(product_id, required_quantity)
      where product.id = requirement.product_id;

      get diagnostics v_updated_product_count = row_count;
      if v_updated_product_count <> v_rechecked_product_count then
        raise exception 'Ops 4C stock update count changed after locked validation.';
      end if;
      -- OPS_4C_STOCK_SUCCESS_END

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

      insert into public.outbox_events (
        event_type,
        event_version,
        order_id,
        idempotency_key
      ) values (
        'paid_order',
        1,
        v_order.id,
        'paid-order:' || v_order.id::text
      );
    exception
      when unique_violation then
        get stacked diagnostics
          v_constraint_name = constraint_name;

        if v_constraint_name in (
          'outbox_events_idempotency_key_key',
          'outbox_events_event_type_order_id_key'
        ) then
          update public.payments as payment
          set finalization_state = 'reconciliation_required',
              outcome_code = 'RECONCILIATION_REQUIRED',
              updated_at = v_now
          where payment.id = v_payment.id;

          update public.payment_events as event
          set processing_state = 'reconciliation_required',
              completed_at = v_now,
              outcome_code = 'RECONCILIATION_REQUIRED',
              diagnostic_code = 'OUTBOX_INTENT_CONFLICT',
              payment_id = v_payment.id
          where event.id = v_event.id;

          return query
          select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
          return;
        end if;

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
alter function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) owner to postgres;

revoke all privileges on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) to service_role;
-- OPS_4C_RPC_END

-- OPS_4C_POSTCONDITION_START
do $postcondition$
declare
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  decrement_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
  function_definition text;
  stock_boundary text;
  stock_boundary_position integer;
  stock_update_position integer;
  credit_position integer;
  confirmation_position integer;
  payment_completion_position integer;
  event_completion_position integer;
  outbox_position integer;
  lifecycle_signature text;
  lifecycle_oid oid;
begin
  if rpc_oid is null
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language
        on language.oid = procedure.prolang
      where procedure.oid = rpc_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proconfig is not distinct from
          array['search_path=""']::text[]
        and language.lanname = 'plpgsql'
        and pg_catalog.pg_get_function_result(procedure.oid) =
          'TABLE(outcome text, order_id uuid, retryable boolean)'
        and pg_catalog.md5(pg_catalog.regexp_replace(
          procedure.prosrc,
          '[[:space:]]',
          '',
          'g'
        )) = '7d381e91b5fe6585d4d5e60c4d7f6cc8'
    )
    or pg_catalog.has_function_privilege('public', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', rpc_oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', rpc_oid, 'EXECUTE'
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = rpc_oid
    ) <> 2
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = rpc_oid
        and (
          acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            'service_role'::pg_catalog.regrole
          )
        )
    )
  then
    raise exception 'Ops 4C postcondition: finalizer metadata or authority is incorrect.';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(rpc_oid))
  into function_definition;

  stock_boundary_position := position(
    '-- ops_4c_stock_boundary_start' in function_definition
  );
  stock_update_position := position(
    'update public.products as product' in function_definition
  );
  credit_position := position(
    'insert into public.payout_ledger' in function_definition
  );
  confirmation_position := position(
    'set status = ''confirmed''' in function_definition
  );
  payment_completion_position := position(
    'set order_id = v_order.id,' || chr(10)
      || '          financial_contract_version = v_contract_version,'
      || chr(10) || '          finalization_state = ''completed'''
    in function_definition
  );
  if payment_completion_position > 0 then
    event_completion_position := payment_completion_position - 1 + position(
      'set processing_state = ''completed'''
      in substring(function_definition from payment_completion_position)
    );
    outbox_position := payment_completion_position - 1 + position(
      'insert into public.outbox_events'
      in substring(function_definition from payment_completion_position)
    );
  else
    event_completion_position := 0;
    outbox_position := 0;
  end if;

  stock_boundary := substring(
    function_definition
    from stock_boundary_position
    for position(
      '-- ops_4c_stock_boundary_end' in function_definition
    ) - stock_boundary_position
  );

  if stock_boundary_position = 0
    or stock_update_position = 0
    or credit_position = 0
    or confirmation_position = 0
    or payment_completion_position = 0
    or event_completion_position = 0
    or outbox_position = 0
    or stock_boundary_position >= stock_update_position
    or stock_update_position >= credit_position
    or credit_position >= confirmation_position
    or confirmation_position >= payment_completion_position
    or payment_completion_position >= event_completion_position
    or event_completion_position >= outbox_position
    or (
      pg_catalog.length(function_definition)
      - pg_catalog.length(pg_catalog.replace(
          function_definition,
          'update public.products as product',
          ''
        ))
    ) / pg_catalog.length('update public.products as product') <> 1
  then
    raise exception 'Ops 4C postcondition: stock mutation is outside the atomic success boundary.';
  end if;

  if function_definition like '%decrement_stock%'
    or function_definition not like '%sum(item.quantity::numeric)%'
    or function_definition not like '%where item.order_id = v_order.id%'
    or function_definition not like '%order by product.id%for update of product%'
    or function_definition not like '%order by item.id%for update of item nowait%'
    or function_definition not like '%v_rechecked_product_ids is distinct from v_stock_product_ids%'
    or function_definition not like '%v_rechecked_required_quantities%is distinct from v_stock_required_quantities%'
    or function_definition not like '%paid_stock_product_unavailable%'
    or function_definition not like '%paid_stock_insufficient%'
    or function_definition not like '%paid_stock_requirements_changed%'
    or function_definition not like '%stock = product.stock - requirement.required_quantity::integer%'
    or function_definition not like '%updated_at = v_now%'
    or function_definition not like '%v_updated_product_count <> v_rechecked_product_count%'
    or stock_boundary like '%product.is_active%'
    or stock_boundary like '%vendor.is_active%'
  then
    raise exception 'Ops 4C postcondition: stock derivation, locking, or mutation contract is incorrect.';
  end if;

  if position(
      'if v_stock_diagnostic is not null' in function_definition
    ) = 0
    or position(
      'if v_stock_diagnostic is not null' in function_definition
    ) >= stock_update_position
    or stock_boundary not like
      '%finalization_state = ''reconciliation_required''%'
    or stock_boundary not like
      '%outcome_code = ''reconciliation_required''%'
    or stock_boundary not like
      '%processing_state = ''reconciliation_required''%'
    or stock_boundary not like '%completed_at = v_now%'
    or stock_boundary not like '%diagnostic_code = v_stock_diagnostic%'
    or stock_boundary not like
      '%select ''reconciliation_required''::text, v_order.id, false%'
  then
    raise exception 'Ops 4C postcondition: paid-stock reconciliation is not durable and controlled.';
  end if;

  if position('''event_already_completed''' in function_definition) = 0
    or position('''event_already_completed''' in function_definition) >=
      stock_boundary_position
    or position('''already_finalized''' in function_definition) = 0
    or position('''already_finalized''' in function_definition) >=
      stock_boundary_position
    or position('''legacy_already_finalized''' in function_definition) = 0
    or position('''legacy_already_finalized''' in function_definition) >=
      stock_boundary_position
    or position('''amount_mismatch''' in function_definition) = 0
    or position('''amount_mismatch''' in function_definition) >=
      stock_boundary_position
    or position('''currency_mismatch''' in function_definition) = 0
    or position('''currency_mismatch''' in function_definition) >=
      stock_boundary_position
  then
    raise exception 'Ops 4C postcondition: a closed or invalid payment path can reach stock consumption.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = 'public.products'::pg_catalog.regclass
        and class.relrowsecurity
        and not class.relforcerowsecurity
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ) <> 5
    or exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'order_items'
        and policy.cmd <> 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.order_items', 'INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.order_items', 'INSERT,UPDATE,DELETE'
    )
  then
    raise exception 'Ops 4C postcondition: product or order-item RLS authority changed.';
  end if;

  if decrement_oid is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(decrement_oid)) <>
      '0094f1ea6602edbfe18ac8f9619677b8'
    or pg_catalog.has_function_privilege(
      'public', decrement_oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', decrement_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', decrement_oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', decrement_oid, 'EXECUTE'
    )
  then
    raise exception 'Ops 4C postcondition: decrement_stock changed.';
  end if;

  foreach lifecycle_signature in array array[
    'public.claim_paid_order_outbox(text,integer)',
    'public.mark_paid_order_outbox_delivered(uuid,uuid)',
    'public.mark_paid_order_outbox_failed(uuid,uuid,text)',
    'public.expand_paid_order_notification_deliveries(uuid,uuid)',
    'public.begin_paid_order_notification_delivery(uuid,uuid,uuid,text)',
    'public.mark_paid_order_notification_delivered(uuid,uuid,uuid,uuid,text)',
    'public.mark_paid_order_notification_failed(uuid,uuid,uuid,uuid,text,boolean)',
    'public.mark_paid_order_notification_unknown(uuid,uuid,uuid,uuid,text)'
  ]
  loop
    lifecycle_oid := pg_catalog.to_regprocedure(lifecycle_signature);

    if lifecycle_oid is null
      or not exists (
        select 1
        from pg_catalog.pg_proc as procedure
        where procedure.oid = lifecycle_oid
          and procedure.proowner = 'postgres'::pg_catalog.regrole
          and not procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.proconfig is not distinct from
            array['search_path=""']::text[]
      )
      or pg_catalog.has_function_privilege(
        'public', lifecycle_oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege('anon', lifecycle_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'authenticated', lifecycle_oid, 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', lifecycle_oid, 'EXECUTE'
      )
    then
      raise exception 'Ops 4C postcondition: frozen outbox or notification authority changed for %.',
        lifecycle_signature;
    end if;
  end loop;
end
$postcondition$;
-- OPS_4C_POSTCONDITION_END

commit;
